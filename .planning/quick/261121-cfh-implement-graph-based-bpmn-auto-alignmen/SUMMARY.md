---
status: complete
date: 2026-11-21
---

# Graph-based BPMN auto-alignment

`1959784` implements process-wide layout and orthogonal Sequence Flow routing, compares neighboring branch orders, and expands containers when the layout needs space. The editor applies bounds and route changes in one undoable command and reports any skipped regions.

- All 26 tests and the production build passed on Node.js 24.22.3.
- A Chromium test imported a two-pool diagram, applied alignment, and verified container growth, neighboring pool displacement, Message Flow rerouting, and preserved BPMN semantics.
- The same browser test verified that a second run created zero changes, one undo restored the original export, redo restored the aligned export, and reimport preserved the aligned geometry and semantics.
- The branch-order search evaluates up to 12 layouts per scope. Message Flow uses the modeler's existing routing when an endpoint moves.
