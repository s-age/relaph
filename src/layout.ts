import type { Baseline, Direction, GraphNode, JoinEdge, Rect } from './types';

export interface LayoutConfig {
  nodeMargin: number;
  /**
   * Gap between parent/child ranks (levels), applied to BOTH axes when `rankMarginX` /
   * `rankMarginY` are not given — the pre-0.5.0 single-value shape, kept as the fallback so
   * existing `LayoutConfig` literals (no axis-specific fields) reproduce identical layouts.
   */
  rankMargin: number;
  /** Rank gap for the vertical stack (right/left children — `placeVertical`'s `cx` offset).
   *  Falls back to `rankMargin` when omitted. */
  rankMarginX?: number;
  /** Rank gap for the horizontal stack (top/bottom children — `placeHorizontal`'s `cy` offset)
   *  AND the confluence reposition top offset (`applyConfluences`). Falls back to `rankMargin`
   *  when omitted. */
  rankMarginY?: number;
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
  const rankMarginX = config.rankMarginX ?? config.rankMargin;
  const rankMarginY = config.rankMarginY ?? config.rankMargin;

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
      const cx = side === 'right' ? w + rankMarginX : -rankMarginX - childRect.w;
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
      const cy = side === 'bottom' ? h + rankMarginY : -rankMarginY - childRect.h;
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

/** Shift `node` and every descendant (via `node.children`) already present in `rects` by (dx, dy). */
const shiftSubtree = (rects: Map<GraphNode, Rect>, node: GraphNode, dx: number, dy: number): void => {
  const r = rects.get(node);
  if (r) rects.set(node, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
  for (const child of node.children ?? []) shiftSubtree(rects, child, dx, dy);
};

/** Map every node's id to itself, walking the whole tree once. */
const indexById = (root: GraphNode): Map<string, GraphNode> => {
  const byId = new Map<string, GraphNode>();
  const walk = (node: GraphNode) => {
    byId.set(node.id, node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return byId;
};

/**
 * Reposition each confluence node (a `JoinEdge.to`) — and its whole subtree — to sit centered
 * below its sources: `top = max(source.y + source.h) + rankMargin`, `centerX = average(source
 * center-x)`. Confluences are recomputed to a fixpoint (bounded by one pass per confluence) so
 * that nesting — a confluence whose own subtree contains another fork+confluence, or whose
 * source is itself a confluence — settles regardless of processing order: each pass recomputes
 * every confluence from the CURRENT rects, so a confluence that depended on a not-yet-placed
 * confluence in an earlier pass is corrected once that one lands.
 *
 * `rankMargin` here is always the Y-axis value (`LayoutConfig.rankMarginY`, falling back to
 * `rankMargin`) — a confluence's reposition is a top-of-block placement, the same axis as
 * `placeHorizontal`'s rank gap.
 */
const applyConfluences = (rects: Map<GraphNode, Rect>, root: GraphNode, joinEdges: JoinEdge[], rankMargin: number): void => {
  if (joinEdges.length === 0) return;
  const byId = indexById(root);
  const sourcesByTarget = new Map<string, string[]>();
  for (const edge of joinEdges) {
    const list = sourcesByTarget.get(edge.to);
    if (list) list.push(edge.from);
    else sourcesByTarget.set(edge.to, [edge.from]);
  }
  const targetIds = [...sourcesByTarget.keys()];
  const maxIterations = targetIds.length + 1;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;
    for (const targetId of targetIds) {
      const target = byId.get(targetId);
      if (!target) continue;
      const current = rects.get(target);
      if (!current) continue;
      const sourceRects = (sourcesByTarget.get(targetId) ?? [])
        .map((id) => byId.get(id))
        .filter((n): n is GraphNode => !!n)
        .map((n) => rects.get(n))
        .filter((r): r is Rect => !!r);
      if (sourceRects.length === 0) continue;
      const top = Math.max(...sourceRects.map((r) => r.y + r.h)) + rankMargin;
      const centerX = sourceRects.reduce((sum, r) => sum + (r.x + r.w / 2), 0) / sourceRects.length;
      const dx = centerX - (current.x + current.w / 2);
      const dy = top - current.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
      changed = true;
      shiftSubtree(rects, target, dx, dy);
    }
    if (!changed) break;
  }
};

/**
 * Lay out the root tree and return a map of world-coordinate rectangles.
 * `joinEdges` (optional) additionally repositions each confluence (`JoinEdge.to`) below its
 * sources — see `applyConfluences`. Omitted/empty `joinEdges` reproduces the plain tree layout
 * exactly (no behavior change for existing callers).
 */
export function layout(root: GraphNode, config: LayoutConfig, joinEdges?: JoinEdge[]): LayoutResult {
  const measured = measure(root, config);
  if (joinEdges && joinEdges.length > 0) {
    applyConfluences(measured.rects, root, joinEdges, config.rankMarginY ?? config.rankMargin);
    return { rects: measured.rects, bounds: boundsOf(measured.rects.values()) };
  }
  return { rects: measured.rects, bounds: measured.bounds };
}
