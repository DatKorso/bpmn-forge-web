---
status: complete
---

# Preserve graph cycle direction across lanes

- DFS uses model order to choose back edges. The topological ready queue prefers default-flow targets, then lane order, then model order.
- With the lower-lane task A first in model order, the regression failed before the fix because AB was marked as the back edge. It now confirms BA is the only back edge and AB proceeds forward.
- The regression fixture lives under `test/fixtures/graph-layout/`. The quality script discovers top-level fixtures automatically. A comparison before moving the fixture found one new snapshot entry and exact matches for every existing case. Both committed snapshots were preserved.
- Invoice approval retains an area of 423,000 px², five bends and zero shared route length. Its original and 30 perturbed route fingerprints match the accepted snapshot.
- Verified on Node.js 24.22.3 with 131 Node tests, the route snapshot and quality checks, the production build, and six Chromium graph layout tests.

The project defers milestone planning, so the quick task used the existing state log and ran inline.
