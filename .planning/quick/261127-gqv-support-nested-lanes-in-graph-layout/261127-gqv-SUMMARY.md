---
quick_id: 261127-gqv
status: complete
commits: [4ae5b8c]
---

# Nested lanes in graph layout

The graph planner reads lane order and membership from BPMN and validates the visible lane tree before running ELK. It packs a parent band ahead of its children when the parent directly owns nodes, reserves space for empty leaves, and transposes the same geometry for vertical pools. SequenceFlow routing keeps 8 px from lane headers at every level. Gateway labels stay inside their assigned band. MessageFlow and Association use the final geometry.

Chromium verified cancellation, one-step undo and redo, and stable geometry after export and reopening. The lane tree, ordered node references, connection endpoints, and default flow survived the round trip. A missing child lane shape reported the lane ID and left geometry and history untouched.

## Verification

All checks ran on Node.js 24.22.3.

- `npm test` passed 169 tests.
- `npm run build` passed.
- `npm run test:e2e -- e2e/graph-layout.spec.js` passed 24 production tests. Both mixed-orientation tests passed separately in the verification build.
- `node scripts/graph-layout-quality.mjs --quality --check-routes` passed all 22 route fingerprints.

The approved plan was executed inline and recorded in the existing quick-task history because the project has no active roadmap.
