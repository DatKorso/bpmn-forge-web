---
status: complete
date: 2026-11-22
---

# Soft maximum gaps for BPMN alignment

Commit `08c1fdc` adds optional maximums of 120 px horizontally and 80 px vertically. Both alignment commands compare compressed layouts with the original planner's result and keep larger gaps when the grid, boundaries, obstacles, or routing require them. Selection alignment checks routes to fixed tasks and applies the result through the existing undoable command.

- Node.js 24.22.3 passed all 44 tests and built the production bundle. Vite emitted a chunk-size warning.
- Chromium verified both commands on a BPMN diagram with 300 px horizontal gaps. The tested gaps shortened to 120 px, and repeated alignment kept positions and routes stable.
- Chromium verified focus for invalid maximums, disabling a maximum by clearing the field, undo and redo, and reopening the downloaded BPMN with its updated geometry.
