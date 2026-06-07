import type { Baseline, Direction, GraphNode, Rect } from './types';

export interface LayoutConfig {
  nodeMargin: number;
  rankMargin: number;
  defaultWidth: number;
  defaultHeight: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayoutResult {
  /** World-coordinate rectangle for each node. */
  rects: Map<GraphNode, Rect>;
  /** Bounding box of the whole graph. */
  bounds: Bounds;
}

interface Measured {
  /** Local coordinates of this subtree. The root node rect is placed at (0,0). */
  rects: Map<GraphNode, Rect>;
  bounds: Bounds;
}

const sizeOf = (n: GraphNode, c: LayoutConfig): [number, number] => [
  n.width ?? c.defaultWidth,
  n.height ?? c.defaultHeight,
];

const boundsOf = (rects: Iterable<Rect>): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
};

/** Translate m.rects by (dx, dy) and merge into dst. */
const mergeShifted = (dst: Map<GraphNode, Rect>, m: Measured, dx: number, dy: number): void => {
  for (const [n, r] of m.rects) dst.set(n, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
};

/**
 * Start offset for aligning a child group (size `total`) along the parent edge (length `parentSize`).
 * start = leading (vertical stack = top / horizontal stack = left), center = centered,
 * end = trailing (bottom / right).
 */
const alignStart = (parentSize: number, total: number, b: Baseline): number =>
  b === 'start' ? 0 : b === 'end' ? parentSize - total : parentSize / 2 - total / 2;

/**
 * Measure a subtree and return its placement in local coordinates (root rect = (0,0)).
 * Children are grouped by direction and stacked perpendicular to that axis.
 * Each child is anchored by its own node rect, so connector attachment stays stable
 * no matter how deeply grandchildren nest.
 */
function measure(node: GraphNode, c: LayoutConfig): Measured {
  const [w, h] = sizeOf(node, c);
  const rects = new Map<GraphNode, Rect>();
  rects.set(node, { x: 0, y: 0, w, h });

  // baseline controls how this parent's child groups align along the parent edge.
  const baseline: Baseline = node.baseline ?? 'center';

  const groups: Record<Direction, GraphNode[]> = { top: [], right: [], bottom: [], left: [] };
  for (const child of node.children ?? []) groups[child.direction ?? 'right'].push(child);

  // Vertical stack (right / left): space the children's attachment points (node centers) evenly.
  // Measure each child's upward / downward overhang from its own node center, then set the
  // neighbor pitch to the max requirement across all children.
  // -> attachment points are evenly spaced and subtrees never overlap. Uniform children keep
  //    the same pitch as a naive stack.
  const placeVertical = (children: GraphNode[], side: 'right' | 'left') => {
    const n = children.length;
    if (n === 0) return;
    const ms = children.map((ch) => measure(ch, c));
    // Overhang above / below relative to the node center (= childRect.h / 2).
    const above = ms.map((m, i) => m.rects.get(children[i]!)!.h / 2 - m.bounds.minY);
    const below = ms.map((m, i) => m.bounds.maxY - m.rects.get(children[i]!)!.h / 2);
    // Uniform pitch between attachment points (max of each neighbor's minimum non-overlap pitch).
    let pitch = 0;
    for (let i = 0; i < n - 1; i++) pitch = Math.max(pitch, below[i]! + c.nodeMargin + above[i + 1]!);
    const groupH = above[0]! + (n - 1) * pitch + below[n - 1]!;
    const firstCenter = alignStart(h, groupH, baseline) + above[0]!; // block top + first child's overhang
    children.forEach((ch, i) => {
      const m = ms[i]!;
      const childRect = m.rects.get(ch)!;
      const cx = side === 'right' ? w + c.rankMargin : -c.rankMargin - childRect.w;
      const cy = firstCenter + i * pitch - childRect.h / 2; // place node center on the attachment point
      mergeShifted(rects, m, cx, cy);
    });
  };

  // Horizontal stack (top / bottom): x-axis version of the above. Evenly space the node centers.
  const placeHorizontal = (children: GraphNode[], side: 'top' | 'bottom') => {
    const n = children.length;
    if (n === 0) return;
    const ms = children.map((ch) => measure(ch, c));
    const before = ms.map((m, i) => m.rects.get(children[i]!)!.w / 2 - m.bounds.minX);
    const after = ms.map((m, i) => m.bounds.maxX - m.rects.get(children[i]!)!.w / 2);
    let pitch = 0;
    for (let i = 0; i < n - 1; i++) pitch = Math.max(pitch, after[i]! + c.nodeMargin + before[i + 1]!);
    const groupW = before[0]! + (n - 1) * pitch + after[n - 1]!;
    const firstCenter = alignStart(w, groupW, baseline) + before[0]!;
    children.forEach((ch, i) => {
      const m = ms[i]!;
      const childRect = m.rects.get(ch)!;
      const cy = side === 'bottom' ? h + c.rankMargin : -c.rankMargin - childRect.h;
      const cx = firstCenter + i * pitch - childRect.w / 2; // place node center on the attachment point
      mergeShifted(rects, m, cx, cy);
    });
  };

  placeVertical(groups.right, 'right');
  placeVertical(groups.left, 'left');
  placeHorizontal(groups.bottom, 'bottom');
  placeHorizontal(groups.top, 'top');

  return { rects, bounds: boundsOf(rects.values()) };
}

/** Lay out the root tree and return a map of world-coordinate rectangles. */
export function layout(root: GraphNode, c: LayoutConfig): LayoutResult {
  const m = measure(root, c);
  return { rects: m.rects, bounds: m.bounds };
}
