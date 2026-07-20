# relaph

Zero-dependency TypeScript canvas library for **infinitely-nestable relation graphs** with Google-Maps-like zoom & pan.

```sh
npm install relaph
```

## Features

- Place children on any side (`direction`: top / right / bottom / left)
- Per-node sizing: fixed `width` / `height`, or `'fit-content'` to size the box to the label
- Node shape (`style.shape`): `'rect'` (default) or `'diamond'`
- Edge labels (`GraphNode.edgeLabel` for a tree edge, `JoinEdge.label` for a join edge), centered on the connector with an automatic readability halo; per-node text color override via `GraphNode.edgeLabelColor` (falls back to `nodeStyle.textColor`)
- Label overflow policy (`labelOverflow`): `'visible'` (default) or `'truncate'` — pixel-accurate `…` ellipsis inside the box; edge labels get their own independent cap, `connector.labelMaxWidth`
- Sibling and rank (level) spacing (`margin.node` / `margin.rank`) — `margin.rank` accepts a single `number` (both axes) or `{ x?, y? }` to split the vertical-stack and horizontal-stack rank gaps independently
- Child-group alignment (`baseline`: `start` / `center` / `end` — vertical stack = top/middle/bottom, horizontal stack = left/middle/right)
- Connectors always join edge-center to edge-center
- Node click handler (`onNodeClick`) / background click (`onBackgroundClick`)
- Scroll to zoom (cursor-centered) / drag to pan
- Arbitrarily deep nesting via `children`, HiDPI (Retina) support, zero dependencies

## Usage

```ts
import { RelationGraph, type GraphNode } from 'relaph';

const tree: GraphNode = {
  id: 'root',
  label: 'Root',
  children: [
    { id: 'a', label: 'A', direction: 'right', baseline: 'center',
      children: [{ id: 'a1', label: 'A-1', direction: 'right' }] },
    { id: 'b', label: 'B', direction: 'left' },
  ],
};

const graph = new RelationGraph(canvas, {
  margin: { node: 24, rank: 64 },
  onNodeClick: (node) => console.log('clicked', node.id),
});
graph.setData(tree);
```

### Via a `<script>` tag (no bundler / CDN)

A global (IIFE) build is shipped at `dist/index.global.js`, exposing a `Relaph` global.
A classic script tag works directly from `file://` (unlike ES module imports, which a
`file://` origin blocks via CORS — that is why `demo/index.html` needs a server, while
`demo/standalone.html` does not).

```html
<script src="https://unpkg.com/relaph/dist/index.global.js"></script>
<script>
  const graph = new Relaph.RelationGraph(canvas, { /* options */ });
  graph.setData(tree);
</script>
```

### Node sizing & labels

`width` / `height` on a node accept a number (world units) or `'fit-content'`, which sizes
the box to the label measured with the node's effective font, plus `labelPadding`
(default `{ x: 16, y: 10 }`) on each side. Nodes that omit them use `defaultNodeSize`.

Labels are always a single line. When a label is wider than its box, `labelOverflow`
decides what happens: `'visible'` (default) draws it overflowing the box, `'truncate'`
ellipsizes it to fit inside the box minus `labelPadding.x`.

```ts
const graph = new RelationGraph(canvas, {
  labelOverflow: 'truncate',            // fixed-size nodes ellipsize instead of overflowing
  labelPadding: { x: 12, y: 10 },
});
graph.setData({
  id: 'root',
  label: 'sized to this label',
  width: 'fit-content',                 // grows with the label — never truncated
  children: [{ id: 'a', label: 'a very long label in a fixed box', width: 220 }],
});
```

### Node shape

Set `style.shape` (globally via `nodeStyle.shape`, or per node via `node.style.shape`) to
`'diamond'` for a rhombus connecting the node rectangle's 4 edge midpoints — connector
attachment is unchanged, since those midpoints are exactly where connectors already attach.
Default `'rect'`.

A `'fit-content'` diamond sizes itself so the label stays inscribed (a plain "label size + padding"
box, as used for a rect, would let the label overflow the diamond's slanted sides). `hitTest`
(node click / hit detection) stays a plain axis-aligned bounding-box test regardless of shape —
for a diamond, the rect's corners (outside the drawn rhombus) still register a click. This is a
known, accepted minor gap.

```ts
graph.setData({
  id: 'root',
  label: 'Decision',
  style: { shape: 'diamond' },
  width: 'fit-content',
  children: [{ id: 'a', label: 'Yes', direction: 'right' }],
});
```

### Edge labels

`GraphNode.edgeLabel` labels the incoming tree edge from a node's parent; `JoinEdge.label` labels
a join edge (a non-tree connector passed as `setData`'s second argument — used e.g. to draw a
"confluence" node's incoming edges from multiple sources). Both render the same way: horizontal
text, centered on the connector's middle segment, with an automatic background-color halo so it
stays readable over the line. Font and color always come from the graph's default node style
(`nodeStyle`), never a per-node style override — a recolored node does not recolor its own
incoming edge label. Edge labels draw in full by default; cap their width with
`connector.labelMaxWidth` (graph-level only — there is no per-edge override) for the same
`…`-style ellipsis truncation node labels use.

A node whose incoming tree connector is draw-suppressed in favor of join edges (a fork
confluence — see `JoinEdge`'s doc comment in `src/types.ts`) ignores its own `edgeLabel`; use
`JoinEdge.label` on its join edges instead.

```ts
const graph = new RelationGraph(canvas, {
  connector: { labelMaxWidth: 80 },
});
graph.setData({
  id: 'root',
  children: [{ id: 'a', edgeLabel: 'triggers', direction: 'right' }],
});
```

## API

| Method | Description |
| --- | --- |
| `setData(root)` | Set the tree, then re-layout and fit |
| `refresh()` | Re-layout the current tree |
| `fit(padding?)` | Fit the whole graph into the view |
| `zoomBy(factor)` | Zoom centered on the view |
| `destroy()` | Detach event listeners / observers |

Data / option fields added in 0.4.0 (see the sections above for behavior details):

| Field | Where | Description |
| --- | --- | --- |
| `shape?: 'rect' \| 'diamond'` | `NodeStyle` (global `nodeStyle` or per-node `node.style`) | Node outline shape; default `'rect'` |
| `edgeLabel?: string` | `GraphNode` | Label of the incoming tree edge from the parent (ignored on the root and on confluence nodes) |
| `label?: string` | `JoinEdge` | Label of a join edge |
| `labelMaxWidth?: number` | `RelationGraphOptions.connector` (graph-level only) | Edge-label width cap; unset draws labels in full |

Data / option fields added in 0.5.0:

| Field | Where | Description |
| --- | --- | --- |
| `edgeLabelColor?: string` | `GraphNode` | Per-node text color override for the incoming tree edge's `edgeLabel`; unset falls back to `nodeStyle.textColor`. No equivalent on `JoinEdge`. |
| `rank?: number \| { x?: number; y?: number }` | `RelationGraphOptions.margin` | Rank (level) gap; a `number` applies to both axes as before, `{ x?, y? }` splits the vertical-stack and horizontal-stack (+ confluence reposition) gaps independently |

## Layout constraints

Subtrees in each direction (top / bottom / left / right) are laid out **independently**, with
**no cross-direction collision avoidance**. As a result, when a subtree in one direction grows large
it may visually overlap a subtree in another direction (e.g. a large right-side child overlapping the
area of the bottom-side subtree). Coordinates stay separate, so connectivity is never broken — only the
visuals cross.

This is by design. The intent is that you balance things to some degree via each child's `direction`,
keeping per-direction subtree sizes in mind. Global, all-direction collision resolution is intentionally
omitted: it is not worth the computational cost and the way it tends to distort the intended tree shape.

## Develop

```sh
npm install
npm run typecheck  # type-check (tsc --noEmit)
npm test           # run vitest (layout & viewport logic)
npm run build      # generate dist/
# then open demo/index.html in a browser (it imports from dist)
```
