import type { Direction, GraphNode, JoinEdge, NodeStyle, Point, Rect } from './types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  rects: Map<GraphNode, Rect>;
  nodeStyle: NodeStyle;
  connector: { color: string; width: number };
  labelOverflow: 'visible' | 'truncate';
  labelPadding: { x: number; y: number };
  /** Confluence join edges — drawn in place of the suppressed parent -> confluence tree
   *  connector (see `render`). Defaults to none. */
  joinEdges?: JoinEdge[];
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

/** Draw an elbow connector from parent to child (parent edge center <-> child edge center). */
function drawConnector(rc: RenderContext, parent: Rect, child: Rect, dir: Direction): void {
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
}

/** Draw one join edge: source's bottom edge-center -> confluence's top edge-center (reusing
 *  `drawConnector`'s 'bottom' geometry), honoring a per-edge style override. */
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
  drawConnector(rc, fromRect, toRect, 'bottom');
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
      if (cr && !confluenceIds.has(child.id)) drawConnector(rc, pr, cr, child.direction ?? 'right');
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
      roundRectPath(ctx, r, s.borderRadius);
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
        const label =
          rc.labelOverflow === 'truncate'
            ? fitLabel((t) => ctx.measureText(t).width, node.label, r.w - rc.labelPadding.x * 2)
            : node.label;
        if (label) ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    for (const child of node.children ?? []) walkNodes(child);
  };
  walkNodes(root);
}
