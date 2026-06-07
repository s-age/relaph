import type { Direction, GraphNode, NodeStyle, Point, Rect } from './types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  rects: Map<GraphNode, Rect>;
  nodeStyle: NodeStyle;
  connector: { color: string; width: number };
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
  const a = edgeCenter(parent, dir);
  const z = edgeCenter(child, opposite(dir));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (dir === 'right' || dir === 'left') {
    const midX = (a.x + z.x) / 2;
    ctx.lineTo(midX, a.y);
    ctx.lineTo(midX, z.y);
  } else {
    const midY = (a.y + z.y) / 2;
    ctx.lineTo(a.x, midY);
    ctx.lineTo(z.x, midY);
  }
  ctx.lineTo(z.x, z.y);
  ctx.stroke();
}

export function render(rc: RenderContext, root: GraphNode): void {
  const { ctx, rects } = rc;

  // 1) Draw connectors first so they sit beneath the nodes.
  ctx.strokeStyle = rc.connector.color;
  ctx.lineWidth = rc.connector.width;
  ctx.lineJoin = 'round';
  const walkEdges = (node: GraphNode) => {
    const pr = rects.get(node);
    if (!pr) return;
    for (const child of node.children ?? []) {
      const cr = rects.get(child);
      if (cr) drawConnector(rc, pr, cr, child.direction ?? 'right');
      walkEdges(child);
    }
  };
  walkEdges(root);

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
        ctx.fillText(node.label, r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    for (const child of node.children ?? []) walkNodes(child);
  };
  walkNodes(root);
}
