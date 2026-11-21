---
status: complete
date: 2026-11-22
---

# Scoped alignment, BPMN properties, and editor styling

Commit `eb0cb75` adds selection alignment, a collapsible properties panel, and shared controls for the editor interface. Selection alignment uses the existing layout and routing algorithms and applies the planned geometry in one command. The panel persists names, documentation records, condition expressions, and default-flow references through the BPMN command stack.

- Node.js 24.22.3 passed all 35 tests and built the production bundle.
- Chromium verified lane, pool, expanded subprocess, and cross-lane selection alignment with horizontal and vertical lanes. The checks covered container and neighbor geometry, lane membership, unaffected routes, boundary events and labels, repeat runs, undo, redo, and refusal without changes when space ran out.
- Chromium verified property edits, conditional and default markers, explicit condition clearing, and the BPMN download. The downloaded XML was parsed and reopened in Forge.
- Wide and narrow browser checks covered panel layout, focus return, canvas zoom, keyboard access to the selection status, and text input with canvas shortcuts suppressed.
