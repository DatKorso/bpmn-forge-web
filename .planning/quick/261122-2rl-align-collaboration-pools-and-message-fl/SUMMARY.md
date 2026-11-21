---
status: complete
date: 2026-11-22
---

# Collaboration pool alignment

Commit `82facc3` adds collaboration-wide pool placement and orthogonal message routing to the existing undoable alignment command. Connected pools on the same side can shift together to improve their routes to the anchor. Selection alignment keeps a single pool's frame fixed and moves multiple selected pools with their contents and internal connections.

- Node.js 24.22.3 passed all 52 tests and built the production bundle. Vite reported its chunk-size warning.
- Chromium preserved all nine pools and 13 message flows. Marketing stayed anchored, the container-loading message cleared External Logistics, and the order handoff went from 898 px of horizontal travel to zero.
- Chromium verified selection of the two logistics pools, undo and redo of both alignment commands, a repeat run with zero changes, and export and reopen with identical geometry, labels, participants, and connection references.
