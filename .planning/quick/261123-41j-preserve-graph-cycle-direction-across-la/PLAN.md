---
quick_id: 261123-41j
date: 2026-11-23
---

# Preserve graph cycle direction across lanes

1. Add a two-lane BPMN fixture with two entries into the same cycle. Confirm that the test fails because the planner selects the wrong back edge.
2. Pass lane rank to the ready queue and retain model order for DFS. Document the ordering rule in the editor skill.
3. Verify the regression, route snapshots, invoice route separation and browser graph layout workflow on Node.js 24.
