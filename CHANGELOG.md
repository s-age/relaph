# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.4.0] - 2026-07-20

### Added
- `NodeStyle.shape`: `'rect'` (default) | `'diamond'`, with fit-content diamond sizing and label truncation.
- `GraphNode.edgeLabel` / `JoinEdge.label` with automatic background halo; `connector.labelMaxWidth`.
- `GraphNode.edgeLabelColor` to override a node's incoming edge label color.
- `margin.rank` now accepts `{ x?, y? }` to split vertical/horizontal rank gaps independently (backward compatible with the bare-number form).
