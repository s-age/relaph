import type { Baseline, Direction, GraphNode, Rect } from './types';

export interface LayoutConfig {
  nodeMargin: number;
  rankMargin: number;
  defaultWidth: number;
  defaultHeight: number;
  /**
   * Resolves the box of a 'fit-content' node (label size + padding). Only consulted for
   * nodes that request 'fit-content'; when absent those nodes fall back to the defaults,
   * so the pure layout stays usable without a canvas (RelationGraph always supplies one
   * backed by ctx.measureText).
   */
  measureNode?: (node: GraphNode) => { width: number; height: number };
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

const sizeOf = (node: GraphNode, config: LayoutConfig): [number, number] => {
  const fit =
    node.width === 'fit-content' || node.height === 'fit-content'
      ? config.measureNode?.(node)
      : undefined;
  const w = node.width === 'fit-content' ? (fit?.width ?? config.defaultWidth) : (node.width ?? config.defaultWidth);
  const h =
    node.height === 'fit-content' ? (fit?.height ?? config.defaultHeight) : (node.height ?? config.defaultHeight);
  return [w, h];
};

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

/** Translate measured.rects by (dx, dy) and merge into dst. */
const mergeShifted = (dst: Map<GraphNode, Rect>, measured: Measured, dx: number, dy: number): void => {
  for (const [node, rect] of measured.rects) {
    dst.set(node, { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h });
  }
};

/**
 * Start offset for aligning a child group (size `total`) along the parent edge (length `parentSize`).
 * start = leading (vertical stack = top / horizontal stack = left), center = centered,
 * end = trailing (bottom / right).
 */
const alignStart = (parentSize: number, total: number, baseline: Baseline): number =>
  baseline === 'start' ? 0 : baseline === 'end' ? parentSize - total : parentSize / 2 - total / 2;

/**
 * Measure a subtree and return its placement in local coordinates (root rect = (0,0)).
 * Children are grouped by direction and stacked perpendicular to that axis.
 * Each child is anchored by its own node rect, so connector attachment stays stable
 * no matter how deeply grandchildren nest.
 */
function measure(node: GraphNode, config: LayoutConfig): Measured {
  const [w, h] = sizeOf(node, config);
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
    const count = children.length;
    if (count === 0) return;
    const subtrees = children.map((child) => measure(child, config));
    // Overhang above / below relative to the node center (= childRect.h / 2).
    const above = subtrees.map((s, i) => s.rects.get(children[i]!)!.h / 2 - s.bounds.minY);
    const below = subtrees.map((s, i) => s.bounds.maxY - s.rects.get(children[i]!)!.h / 2);
    // Uniform pitch between attachment points (max of each neighbor's minimum non-overlap pitch).
    let pitch = 0;
    for (let i = 0; i < count - 1; i++) {
      pitch = Math.max(pitch, below[i]! + config.nodeMargin + above[i + 1]!);
    }
    const groupH = above[0]! + (count - 1) * pitch + below[count - 1]!;
    const firstCenter = alignStart(h, groupH, baseline) + above[0]!; // block top + first child's overhang
    children.forEach((child, i) => {
      const subtree = subtrees[i]!;
      const childRect = subtree.rects.get(child)!;
      const cx = side === 'right' ? w + config.rankMargin : -config.rankMargin - childRect.w;
      const cy = firstCenter + i * pitch - childRect.h / 2; // place node center on the attachment point
      mergeShifted(rects, subtree, cx, cy);
    });
  };

  // Horizontal stack (top / bottom): x-axis version of the above. Evenly space the node centers.
  const placeHorizontal = (children: GraphNode[], side: 'top' | 'bottom') => {
    const count = children.length;
    if (count === 0) return;
    const subtrees = children.map((child) => measure(child, config));
    const before = subtrees.map((s, i) => s.rects.get(children[i]!)!.w / 2 - s.bounds.minX);
    const after = subtrees.map((s, i) => s.bounds.maxX - s.rects.get(children[i]!)!.w / 2);
    let pitch = 0;
    for (let i = 0; i < count - 1; i++) {
      pitch = Math.max(pitch, after[i]! + config.nodeMargin + before[i + 1]!);
    }
    const groupW = before[0]! + (count - 1) * pitch + after[count - 1]!;
    const firstCenter = alignStart(w, groupW, baseline) + before[0]!;
    children.forEach((child, i) => {
      const subtree = subtrees[i]!;
      const childRect = subtree.rects.get(child)!;
      const cy = side === 'bottom' ? h + config.rankMargin : -config.rankMargin - childRect.h;
      const cx = firstCenter + i * pitch - childRect.w / 2; // place node center on the attachment point
      mergeShifted(rects, subtree, cx, cy);
    });
  };

  placeVertical(groups.right, 'right');
  placeVertical(groups.left, 'left');
  placeHorizontal(groups.bottom, 'bottom');
  placeHorizontal(groups.top, 'top');

  return { rects, bounds: boundsOf(rects.values()) };
}

/** Lay out the root tree and return a map of world-coordinate rectangles. */
export function layout(root: GraphNode, config: LayoutConfig): LayoutResult {
  const measured = measure(root, config);
  return { rects: measured.rects, bounds: measured.bounds };
}
