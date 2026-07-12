# relaph

Zero-dependency TypeScript canvas library for **infinitely-nestable relation graphs** with Google-Maps-like zoom & pan.

```sh
npm install relaph
```

## Features

- Place children on any side (`direction`: top / right / bottom / left)
- Per-node sizing: fixed `width` / `height`, or `'fit-content'` to size the box to the label
- Label overflow policy (`labelOverflow`): `'visible'` (default) or `'truncate'` — pixel-accurate `…` ellipsis inside the box
- Sibling and rank (level) spacing (`margin.node` / `margin.rank`)
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

## API

| Method | Description |
| --- | --- |
| `setData(root)` | Set the tree, then re-layout and fit |
| `refresh()` | Re-layout the current tree |
| `fit(padding?)` | Fit the whole graph into the view |
| `zoomBy(factor)` | Zoom centered on the view |
| `destroy()` | Detach event listeners / observers |

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
