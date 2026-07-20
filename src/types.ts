/** Which side of the parent a child is placed on (direction seen from the parent). */
export type Direction = 'top' | 'right' | 'bottom' | 'left';

/**
 * How a child group is aligned along the parent's edge.
 * - Vertical stack (right / left children): start = top, center = middle, end = bottom
 * - Horizontal stack (top / bottom children): start = left, center = middle, end = right
 *
 * The connector itself always joins "edge center <-> edge center"; this setting does
 * not move the attachment points.
 */
export type Baseline = 'start' | 'center' | 'end';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Node box size: a fixed size in world units, or 'fit-content' to size the box to the
 * node's label (measured with the node's effective font, plus labelPadding).
 */
export type NodeSize = number | 'fit-content';

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  borderRadius: number;
  font: string;
  /** Node outline shape. 'rect' (default) or 'diamond' (the rhombus connecting the node
   *  rectangle's 4 edge midpoints — connector attachment is unchanged, since `edgeCenter()`
   *  already attaches at those same midpoints). */
  shape?: 'rect' | 'diamond';
}

/**
 * A graph node. Can be nested arbitrarily deep via `children`.
 * `direction` / `baseline` describe how this node lays out relative to its parent.
 */
export interface GraphNode {
  id: string;
  label?: string;
  /** Node rectangle width, or 'fit-content' to size to the label. Falls back to defaultNodeSize. */
  width?: NodeSize;
  /** Node rectangle height, or 'fit-content' to size to the label. Falls back to defaultNodeSize. */
  height?: NodeSize;
  /** Placement direction seen from the parent. Default 'right'. Ignored on the root. */
  direction?: Direction;
  /**
   * How to align this node's child groups along the parent edge (= this node's edge).
   * Default 'center'. Ignored for leaf nodes. Applies to every direction group (all four sides).
   */
  baseline?: Baseline;
  /** Per-node style overrides. */
  style?: Partial<NodeStyle>;
  /**
   * Label of the incoming tree edge from this node's parent (each non-root node is 1:1 with
   * that edge). Rendered centered on the connector's middle segment. Ignored for a node whose
   * incoming tree connector is suppressed (a confluence node — see `JoinEdge`); use
   * `JoinEdge.label` for those instead. Ignored on the root (no incoming edge).
   */
  edgeLabel?: string;
  /**
   * Per-node text color override for `edgeLabel` (the incoming tree edge label). Unset falls
   * back to the graph-level `nodeStyle.textColor` (the current default). This is a standalone
   * channel dedicated to the incoming edge label only — it is never merged with `style` (a
   * recolored node still does not recolor its own incoming edge label via `style.textColor`),
   * and `JoinEdge` has no equivalent per-edge color knob. Ignored wherever `edgeLabel` itself is
   * ignored (the root, or a confluence node).
   */
  edgeLabelColor?: string;
  /** Arbitrary user data; available in click handlers etc. */
  data?: unknown;
  /** Child nodes (can be nested arbitrarily deep). */
  children?: GraphNode[];
}

/** Connector (link line) color/width. Shared by the default connector style and per-`JoinEdge`
 *  overrides. */
export interface ConnectorStyle {
  color?: string;
  width?: number;
}

/**
 * A "confluence" edge: draws a connector from `from` (a source node's bottom edge-center) to
 * `to` (a confluence node's top edge-center), on top of the normal tree layout. `to` is
 * repositioned by `layout()` to sit centered below all of its sources (see `layout.ts`); the
 * ordinary parent -> `to` tree connector is suppressed in favor of these join edges (see
 * `renderer.ts`). `from` / `to` reference `GraphNode.id`. Purely additive: omitting `joinEdges`
 * (or passing an empty array) reproduces the pre-confluence tree layout/render exactly.
 */
export interface JoinEdge {
  /** Source node id (a tracked branch's tail, or another confluence). */
  from: string;
  /** Confluence node id — the node this edge fans into. */
  to: string;
  /** Per-edge connector style override, layered over the graph's default connector style. */
  style?: Partial<ConnectorStyle>;
  /** Label for this join edge, centered on the connector's middle segment (same rendering as
   *  `GraphNode.edgeLabel`, since a confluence's incoming tree edges are draw-suppressed in
   *  favor of join edges). */
  label?: string;
}

export interface RelationGraphOptions {
  /** Spacing between sibling nodes and between ranks (levels). */
  margin?: {
    /** Gap between sibling nodes. Default 24. */
    node?: number;
    /**
     * Gap between parent and child ranks (levels). A `number` applies to both axes (the
     * pre-0.5.0 shape — fully backward compatible). Pass `{ x?, y? }` to split it: `x` is the
     * vertical-stack (right/left children) rank gap, `y` is the horizontal-stack (top/bottom
     * children) rank gap AND the confluence-reposition gap (`applyConfluences`, itself a
     * top-of-block placement — a y-axis concern). Either axis omitted from the object form
     * falls back to the same default as the bare number, 64.
     */
    rank?: number | { x?: number; y?: number };
  };
  /** Default size for nodes that omit width/height. */
  defaultNodeSize?: { width: number; height: number };
  /** Default node style. */
  nodeStyle?: Partial<NodeStyle>;
  /**
   * Connector (link line) style, plus the graph-level cap for edge-label width (`labelMaxWidth`).
   * `labelMaxWidth` is intentionally NOT part of the shared `ConnectorStyle` type (that would
   * silently allow a per-`JoinEdge` override via `JoinEdge.style`, which is `Partial<ConnectorStyle>`)
   * — it lives only at this graph-level option site. Unset = edge labels draw in full (no
   * truncation).
   */
  connector?: ConnectorStyle & { labelMaxWidth?: number };
  /** Background color. Default '#ffffff'. */
  background?: string;
  /**
   * Inner padding between the label and the node border, per side.
   * Sizes 'fit-content' boxes and insets 'truncate' clipping. Default { x: 16, y: 10 }.
   */
  labelPadding?: { x?: number; y?: number };
  /**
   * What to do when a label is wider than its node box ('fit-content' boxes never are).
   * - 'visible' (default): draw the full label, overflowing the box.
   * - 'truncate': ellipsize the label to fit inside the box minus labelPadding.x.
   */
  labelOverflow?: 'visible' | 'truncate';
  /** Zoom lower / upper bound. Default 0.2 / 4. */
  minScale?: number;
  maxScale?: number;
  /** Wheel zoom sensitivity. Default 1. */
  zoomSpeed?: number;
  /** Handler invoked when a node is clicked. */
  onNodeClick?: (node: GraphNode, event: PointerEvent) => void;
  /** Handler invoked when the background (outside any node) is clicked. */
  onBackgroundClick?: (world: Point, event: PointerEvent) => void;
}
