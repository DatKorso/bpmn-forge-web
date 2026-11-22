---
status: complete
---

# Preserve compact BPMN loops

Whole-diagram horizontal alignment preserves eligible compact loops by centering the upper task over the left exclusive gateway. The candidate keeps the task's calculated vertical position and all other bounds and waypoints. Container fit, minimum gaps, soft maximum excess, crossings, and shared segment length determine whether the candidate is accepted.

The reduced regression fixture preserves the source loop geometry and adjacent flows. Planner tests cover the compact result, an obstruction, insufficient clearance, the previous stretched-loop result, and a second alignment. The browser test checks exported bounds, waypoints and sequence-flow relationships across import, alignment, undo, redo and reopening.

On Node.js 24.22.3, all 79 Node tests and 12 Chromium tests passed. The production build succeeded with Vite's existing chunk-size warning. A separate Chromium run compared the original BPMN against the previous build at a uniform gap of 80. Only the task's X coordinate and its two routes changed. Undo, redo, repeat alignment, and export/reopen preserved the expected geometry and BPMN relationships.
