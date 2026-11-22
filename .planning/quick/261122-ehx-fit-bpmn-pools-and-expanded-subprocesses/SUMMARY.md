---
status: complete
completed: 2026-11-22
implementation: 9562f3a
---

# Fit BPMN pools and expanded subprocesses

- Use 40 units of clearance around nodes and boundary events in pools and expanded subprocesses. Measure from the inside of the pool header in either orientation.
- Fit the descendants of a single selected container from the inside out. Compare viable layouts by crossings, shared route length, bends, frame area, and figure movement. Preserve the selected frame origin, lane structure, labels, annotations, and external docking.
- Apply geometry in one undoable edit and report the number of resized containers.

## Verification

- All 76 tests passed on Node.js 24.22.3.
- The production build passed on Node.js 24.22.3. Vite reported its size warning for the main bundle.
- Chromium verified full alignment and single-pool alignment on a collaboration with a lane and an expanded subprocess. Both modes preserved geometry on repeat, restored the original geometry on undo, and restored the aligned geometry on redo. Both downloaded files reopened with matching bounds, waypoints, and BPMN references.
