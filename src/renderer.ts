import type { Direction, GraphNode, JoinEdge, NodeStyle, Point, Rect } from './types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  rects: Map<GraphNode, Rect>;
  nodeStyle: NodeStyle;
  /** `labelMaxWidth` caps edge-label pixel width (see `RelationGraphOptions.connector`);
   *  unset draws edge labels in full. */
  connector: { color: string; width: number; labelMaxWidth?: number };
  labelOverflow: 'visible' | 'truncate';
  labelPadding: { x: number; y: number };
  /** Confluence join edges — drawn in place of the suppressed parent -> confluence tree
   *  connector (see `render`). Defaults to none. */
  joinEdges?: JoinEdge[];
  /** Canvas background color — used as the fill behind each edge label's readability halo.
   *  Optional so pure/test-constructed contexts that draw no edge labels need not supply it;
   *  `RelationGraph` always passes its resolved `background`. */
  background?: string;
}

const ELLIPSIS = '…';

/**
 * Fit `label` into `maxWidth` using `measure` (text -> width). Returns the label unchanged
 * when it already fits, the longest `…`-terminated prefix that fits when it doesn't, and ''
 * when not even the ellipsis alone fits.
 */
export function fitLabel(measure: (text: string) => number, label: string, maxWidth: number): string {
  if (measure(label) <= maxWidth) return label;
  if (measure(ELLIPSIS) > maxWidth) return '';
  // Binary search the longest prefix whose width, ellipsis included, still fits.
  let lo = 0;
  let hi = label.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(label.slice(0, mid) + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  // Don't cut a surrogate pair in half (the prefix would end on a lone high surrogate).
  if (lo > 0 && /[\uD800-\uDBFF]/.test(label[lo - 1]!)) lo -= 1;
  return lo === 0 ? ELLIPSIS : label.slice(0, lo) + ELLIPSIS;
}

/**
 * Center point of the rectangle's edge facing the given direction.
 * Connectors use this "edge center" as the endpoint on both the parent and the child.
 */
function edgeCenter(r: Rect, dir: Direction): Point {
  switch (dir) {
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'top':
      return { x: r.x + r.w / 2, y: r.y };
  }
}

/** Opposite of dir. A child connects on the edge facing back toward its parent. */
const opposite = (dir: Direction): Direction =>
  dir === 'right' ? 'left' : dir === 'left' ? 'right' : dir === 'bottom' ? 'top' : 'bottom';

function roundRectPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rr = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

/** Diamond path: the rhombus connecting the 4 edge midpoints of `r`. These midpoints are
 *  exactly what `edgeCenter()` already attaches connectors to, so connector attachment needs
 *  no change for this shape. */
function diamondPath(ctx: CanvasRenderingContext2D, r: Rect): void {
  const top = { x: r.x + r.w / 2, y: r.y };
  const right = { x: r.x + r.w, y: r.y + r.h / 2 };
  const bottom = { x: r.x + r.w / 2, y: r.y + r.h };
  const left = { x: r.x, y: r.y + r.h / 2 };
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
}

/** Shape-dispatching path builder: 'rect' (default) keeps `roundRectPath`'s exact call
 *  sequence (byte-identical to the pre-shape-option renderer); 'diamond' draws `diamondPath`. */
function shapePath(ctx: CanvasRenderingContext2D, shape: 'rect' | 'diamond', r: Rect, radius: number): void {
  if (shape === 'diamond') diamondPath(ctx, r);
  else roundRectPath(ctx, r, radius);
}

/**
 * Diamond bounding-box width required so a label of width `labelW` (plus `padding` on each
 * side) is fully inscribed in the diamond, given text line height `textH` and the diamond's
 * effective height `h` (the node's fixed numeric height if specified, else its measured
 * fit-content height). Inverts the inscribed-width constraint `inscribed = w * (1 - textH/h)`
 * solving for `w`. Falls back to the rect-equivalent width `labelW + 2*padding` when the
 * denominator is non-positive (h too small relative to textH, or h <= 0) — guards against
 * NaN/Infinity ever reaching layout. Pure.
 */
export function diamondBoxWidth(labelW: number, padding: number, textH: number, h: number): number {
  const rectW = labelW + padding * 2;
  const denom = 1 - textH / h;
  return denom > 0 ? rectW / denom : rectW;
}

/**
 * Inverse of `diamondBoxWidth`: the width of the largest label that still fully inscribes in a
 * diamond of bounding width `boundingWidth`, given text line height `textH` and effective
 * height `h` (same rule as `diamondBoxWidth`). Falls back to `boundingWidth` (the rect-equivalent
 * cap) when the denominator is non-positive. Pure. Used to cap diamond node-label truncation
 * (`labelOverflow: 'truncate'` only — 'visible' never calls this).
 */
export function diamondInscribedWidth(boundingWidth: number, textH: number, h: number): number {
  const denom = 1 - textH / h;
  return denom > 0 ? boundingWidth * denom : boundingWidth;
}

/**
 * Midpoint of the middle segment of the elbow connector `parent(dir) <-> child(opposite dir)` —
 * where an edge label is centered (always horizontal, per feature spec). The elbow's bend is
 * always axis-aligned, so this collapses to the plain average of the two edge-center endpoints
 * regardless of `dir` (a zero-length middle segment — colinear parent/child — still yields that
 * same point). Pure; shares `edgeCenter`'s geometry with the connector itself.
 */
export function connectorLabelPoint(parent: Rect, child: Rect, dir: Direction): Point {
  const from = edgeCenter(parent, dir);
  const to = edgeCenter(child, opposite(dir));
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/** Edge-label halo padding (px) around the text — not user-configurable; the halo is automatic
 *  (see feature spec: "no knob"). */
const EDGE_LABEL_HALO_PAD_X = 4;
const EDGE_LABEL_HALO_PAD_Y = 2;

/**
 * Draw one edge label: horizontal text centered at `point`, with a background halo (filled with
 * the canvas background color, `rc.background`) behind it so the text stays readable over the
 * connector line. Font always comes from `rc.nodeStyle` — the resolved options-level style,
 * NEVER a per-node merged style (a recolored node's `style.textColor` must not recolor its
 * incoming edge label; there is no per-node style-merge channel for edge labels at all). Text
 * color defaults to that same `rc.nodeStyle.textColor`, overridable only via the standalone
 * `color` param (sourced from `GraphNode.edgeLabelColor` — a dedicated channel for the incoming
 * edge label, independent of `style`). Width is capped via `rc.connector.labelMaxWidth` using
 * the same `fitLabel` ellipsis rule as node labels; unset draws in full. No-op once fitting
 * reduces the label to ''.
 */
function drawEdgeLabel(rc: RenderContext, point: Point, label: string, color: string = rc.nodeStyle.textColor): void {
  const { ctx } = rc;
  ctx.font = rc.nodeStyle.font;
  const text =
    rc.connector.labelMaxWidth != null
      ? fitLabel((t) => ctx.measureText(t).width, label, rc.connector.labelMaxWidth)
      : label;
  if (!text) return;
  const m = ctx.measureText(text);
  const textH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent || parseFloat(rc.nodeStyle.font) || 16;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rc.background ?? '#ffffff';
  ctx.fillRect(
    point.x - m.width / 2 - EDGE_LABEL_HALO_PAD_X,
    point.y - textH / 2 - EDGE_LABEL_HALO_PAD_Y,
    m.width + EDGE_LABEL_HALO_PAD_X * 2,
    textH + EDGE_LABEL_HALO_PAD_Y * 2,
  );
  ctx.fillStyle = color;
  ctx.fillText(text, point.x, point.y);
}

/** Draw an elbow connector from parent to child (parent edge center <-> child edge center).
 *  `label` (optional — the incoming tree edge's `GraphNode.edgeLabel`, or a `JoinEdge.label`)
 *  draws centered on the middle segment via `drawEdgeLabel`; omitted draws no label (and no
 *  extra canvas calls at all — the connector-only call sequence is unchanged). `labelColor`
 *  (optional — the incoming tree edge's `GraphNode.edgeLabelColor`) overrides the label's text
 *  color; omitted keeps `drawEdgeLabel`'s own default (`rc.nodeStyle.textColor`). `JoinEdge` has
 *  no equivalent color override, so join-edge callers never pass this. */
function drawConnector(
  rc: RenderContext,
  parent: Rect,
  child: Rect,
  dir: Direction,
  label?: string,
  labelColor?: string,
): void {
  const { ctx } = rc;
  const from = edgeCenter(parent, dir);
  const to = edgeCenter(child, opposite(dir));
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  if (dir === 'right' || dir === 'left') {
    const midX = (from.x + to.x) / 2;
    ctx.lineTo(midX, from.y);
    ctx.lineTo(midX, to.y);
  } else {
    const midY = (from.y + to.y) / 2;
    ctx.lineTo(from.x, midY);
    ctx.lineTo(to.x, midY);
  }
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  if (label) drawEdgeLabel(rc, connectorLabelPoint(parent, child, dir), label, labelColor);
}

/** Draw one join edge: source's bottom edge-center -> confluence's top edge-center (reusing
 *  `drawConnector`'s 'bottom' geometry), honoring a per-edge style override and `edge.label`. */
function drawJoinEdge(rc: RenderContext, edge: JoinEdge, byId: Map<string, GraphNode>): void {
  const { ctx, rects } = rc;
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) return;
  const fromRect = rects.get(from);
  const toRect = rects.get(to);
  if (!fromRect || !toRect) return;
  const prevColor = ctx.strokeStyle;
  const prevWidth = ctx.lineWidth;
  if (edge.style?.color) ctx.strokeStyle = edge.style.color;
  if (edge.style?.width) ctx.lineWidth = edge.style.width;
  drawConnector(rc, fromRect, toRect, 'bottom', edge.label);
  ctx.strokeStyle = prevColor;
  ctx.lineWidth = prevWidth;
}

export function render(rc: RenderContext, root: GraphNode): void {
  const { ctx, rects } = rc;
  const joinEdges = rc.joinEdges ?? [];
  // A node that is a join edge's `to` is a confluence: its incoming visual is the join edge(s),
  // not the ordinary parent -> child tree connector.
  const confluenceIds = new Set(joinEdges.map((e) => e.to));

  // 1) Draw connectors first so they sit beneath the nodes.
  ctx.strokeStyle = rc.connector.color;
  ctx.lineWidth = rc.connector.width;
  ctx.lineJoin = 'round';
  const walkEdges = (node: GraphNode) => {
    const pr = rects.get(node);
    if (!pr) return;
    for (const child of node.children ?? []) {
      const cr = rects.get(child);
      if (cr && !confluenceIds.has(child.id))
        drawConnector(rc, pr, cr, child.direction ?? 'right', child.edgeLabel, child.edgeLabelColor);
      walkEdges(child);
    }
  };
  walkEdges(root);

  // 1b) Draw the join (confluence) edges on top of the suppressed tree connectors.
  if (joinEdges.length > 0) {
    const byId = new Map<string, GraphNode>();
    const collect = (node: GraphNode) => {
      byId.set(node.id, node);
      for (const child of node.children ?? []) collect(child);
    };
    collect(root);
    ctx.strokeStyle = rc.connector.color;
    ctx.lineWidth = rc.connector.width;
    for (const edge of joinEdges) drawJoinEdge(rc, edge, byId);
  }

  // 2) Draw the nodes.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const walkNodes = (node: GraphNode) => {
    const r = rects.get(node);
    if (r) {
      const s = { ...rc.nodeStyle, ...node.style };
      const shape = s.shape ?? 'rect';
      shapePath(ctx, shape, r, s.borderRadius);
      ctx.fillStyle = s.fill;
      ctx.fill();
      if (s.strokeWidth > 0) {
        ctx.lineWidth = s.strokeWidth;
        ctx.strokeStyle = s.stroke;
        ctx.stroke();
      }
      if (node.label) {
        ctx.fillStyle = s.textColor;
        ctx.font = s.font;
        let label = node.label;
        if (rc.labelOverflow === 'truncate') {
          let maxWidth = r.w - rc.labelPadding.x * 2;
          if (shape === 'diamond') {
            const m = ctx.measureText(node.label);
            const textH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent || parseFloat(s.font) || 16;
            maxWidth = diamondInscribedWidth(maxWidth, textH, r.h);
          }
          label = fitLabel((t) => ctx.measureText(t).width, node.label, maxWidth);
        }
        if (label) ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    for (const child of node.children ?? []) walkNodes(child);
  };
  walkNodes(root);
}
