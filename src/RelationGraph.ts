import { layout, type Bounds, type LayoutConfig } from './layout';
import { render, type RenderContext } from './renderer';
import type { GraphNode, JoinEdge, NodeStyle, Point, Rect, RelationGraphOptions } from './types';
import { Viewport } from './viewport';

const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: '#ffffff',
  stroke: '#94a3b8',
  strokeWidth: 1.5,
  textColor: '#0f172a',
  borderRadius: 8,
  font: '14px system-ui, sans-serif',
};

interface Resolved {
  layout: LayoutConfig;
  nodeStyle: NodeStyle;
  connector: { color: string; width: number };
  background: string;
  zoomSpeed: number;
  labelPadding: { x: number; y: number };
  labelOverflow: 'visible' | 'truncate';
}

/** Movement threshold (CSS px) for distinguishing a click from a drag. */
const CLICK_SLOP = 4;

export class RelationGraph {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly vp: Viewport;
  private readonly opts: Resolved;
  private readonly cb: Pick<RelationGraphOptions, 'onNodeClick' | 'onBackgroundClick'>;

  private dpr = 1;
  private root?: GraphNode;
  private joinEdges: JoinEdge[] = [];
  private rects: Map<GraphNode, Rect> = new Map();
  private bounds: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  private rafId = 0;
  private dirty = false;
  /** Whether fit() has succeeded since the last setData. Drives a one-time auto-fit once the
   *  canvas gains a real size (e.g. setData was called while hidden). Reset on each setData. */
  private fitted = false;

  // Pointer interaction state
  private pointerId: number | null = null;
  private last: Point = { x: 0, y: 0 };
  private down: Point = { x: 0, y: 0 };
  private moved = false;

  private readonly ro: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, options: RelationGraphOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('RelationGraph: 2D context not available');
    this.canvas = canvas;
    this.ctx = ctx;

    this.opts = {
      layout: {
        nodeMargin: options.margin?.node ?? 24,
        rankMargin: options.margin?.rank ?? 64,
        defaultWidth: options.defaultNodeSize?.width ?? 120,
        defaultHeight: options.defaultNodeSize?.height ?? 44,
        measureNode: (node) => this.measureNode(node),
      },
      nodeStyle: { ...DEFAULT_NODE_STYLE, ...options.nodeStyle },
      connector: {
        color: options.connector?.color ?? '#cbd5e1',
        width: options.connector?.width ?? 1.5,
      },
      background: options.background ?? '#ffffff',
      zoomSpeed: options.zoomSpeed ?? 1,
      labelPadding: { x: options.labelPadding?.x ?? 16, y: options.labelPadding?.y ?? 10 },
      labelOverflow: options.labelOverflow ?? 'visible',
    };
    this.cb = { onNodeClick: options.onNodeClick, onBackgroundClick: options.onBackgroundClick };
    this.vp = new Viewport(options.minScale ?? 0.2, options.maxScale ?? 4);

    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.style.touchAction = 'none';

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    this.resize();
  }

  /**
   * Set the tree, fit it into the view, and render. `joinEdges` (optional) additionally draws
   * confluence "join" connectors — see `layout()` / `JoinEdge`. Omitted/empty reproduces the
   * plain tree layout exactly.
   */
  setData(root: GraphNode, joinEdges: JoinEdge[] = []): void {
    this.root = root;
    this.joinEdges = joinEdges;
    this.fitted = false; // each setData re-fits — if hidden now, fit happens when shown
    const res = layout(root, this.opts.layout, joinEdges);
    this.rects = res.rects;
    this.bounds = res.bounds;
    this.fit();
    this.requestRender();
  }

  /** Re-layout the current tree (call after changing node sizes or structure). */
  refresh(): void {
    if (this.root) this.setData(this.root, this.joinEdges);
  }

  /** Fit the whole graph into the view. */
  fit(padding = 48): void {
    if (!this.root) return;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    if (bw <= 0 || bh <= 0 || cw <= 0 || ch <= 0) return; // canvas hidden / zero-size: cannot fit yet
    const scale = Math.min((cw - padding * 2) / bw, (ch - padding * 2) / bh);
    this.vp.setScale(scale);
    // Move the bounding-box center to the view center.
    const cx = (this.bounds.minX + this.bounds.maxX) / 2;
    const cy = (this.bounds.minY + this.bounds.maxY) / 2;
    this.vp.setTranslate(cw / 2 - cx * this.vp.scale, ch / 2 - cy * this.vp.scale);
    this.fitted = true;
    this.requestRender();
  }

  /** Programmatic zoom, centered on the view. */
  zoomBy(factor: number): void {
    this.vp.zoomAt({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 }, factor);
    this.requestRender();
  }

  get viewport(): Viewport {
    return this.vp;
  }

  destroy(): void {
    this.ro.disconnect();
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Box of a 'fit-content' node: label measured with the node's effective font, plus
   * labelPadding on each side. Label-less nodes fall back to the default size (an empty
   * measurement would collapse the box to bare padding).
   */
  private measureNode(node: GraphNode): { width: number; height: number } {
    const label = node.label ?? '';
    if (!label) return { width: this.opts.layout.defaultWidth, height: this.opts.layout.defaultHeight };
    const font = node.style?.font ?? this.opts.nodeStyle.font;
    this.ctx.font = font;
    const m = this.ctx.measureText(label);
    const boxH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    // Older engines report no font box metrics; approximate from the font-size token then.
    const textH = boxH > 0 ? boxH : parseFloat(font) || 16;
    const pad = this.opts.labelPadding;
    return { width: m.width + pad.x * 2, height: textH + pad.y * 2 };
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    // Auto-fit only the first time the canvas gains a real size (e.g. setData was called while
    // hidden in a tab/modal). After the first successful fit we never re-fit on resize, so the
    // user's pan/zoom is preserved.
    if (this.root && !this.fitted) this.fit();
    else this.requestRender();
  }

  /** Convert event coordinates to CSS px within the canvas. */
  private toLocal(e: PointerEvent | WheelEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hitTest(screen: Point): GraphNode | undefined {
    const w = this.vp.screenToWorld(screen);
    let hit: GraphNode | undefined;
    // Last match wins (later in draw order = on top). Deeper children are registered later,
    // so keep the last rect that contains the point.
    for (const [node, r] of this.rects) {
      if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) hit = node;
    }
    return hit;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015 * this.opts.zoomSpeed);
    this.vp.zoomAt(this.toLocal(e), factor);
    this.requestRender();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.last = this.toLocal(e);
    this.down = this.last;
    this.moved = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    const p = this.toLocal(e);
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    this.last = p;
    if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > CLICK_SLOP) this.moved = true;
    if (this.moved) {
      this.vp.panBy(dx, dy);
      this.requestRender();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.moved) return; // it was a drag, not a click
    const screen = this.toLocal(e);
    const node = this.hitTest(screen);
    if (node) this.cb.onNodeClick?.(node, e);
    else this.cb.onBackgroundClick?.(this.vp.screenToWorld(screen), e);
  };

  private requestRender(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.rafId = requestAnimationFrame(this.draw);
  }

  private draw = (): void => {
    this.dirty = false;
    this.rafId = 0; // the scheduled frame is now running; `dirty` alone tracks "render pending"
    const { ctx } = this;
    const { width, height } = this.canvas;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.opts.background;
    ctx.fillRect(0, 0, width, height);

    if (!this.root) return;

    // Apply DPR and the view transform together, so everything below draws in world coordinates.
    const s = this.vp.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.vp.tx * this.dpr, this.vp.ty * this.dpr);

    const rc: RenderContext = {
      ctx,
      rects: this.rects,
      nodeStyle: this.opts.nodeStyle,
      connector: this.opts.connector,
      labelOverflow: this.opts.labelOverflow,
      labelPadding: this.opts.labelPadding,
      joinEdges: this.joinEdges,
    };
    render(rc, this.root);
  };
}
