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
  /** Arbitrary user data; available in click handlers etc. */
  data?: unknown;
  /** Child nodes (can be nested arbitrarily deep). */
  children?: GraphNode[];
}

export interface RelationGraphOptions {
  /** Spacing between sibling nodes and between ranks (levels). */
  margin?: {
    /** Gap between sibling nodes. Default 24. */
    node?: number;
    /** Gap between parent and child ranks (levels). Default 64. */
    rank?: number;
  };
  /** Default size for nodes that omit width/height. */
  defaultNodeSize?: { width: number; height: number };
  /** Default node style. */
  nodeStyle?: Partial<NodeStyle>;
  /** Connector (link line) style. */
  connector?: { color?: string; width?: number };
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
