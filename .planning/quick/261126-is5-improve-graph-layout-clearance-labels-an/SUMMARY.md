---
quick_id: 261126-is5
status: complete
commits: [077a08f, e7d728b]
---

# Graph layout clearance, gateway labels and linked notes

SequenceFlow candidates use at least 8 px of clearance, with a preference for 16 px on bypasses. The graph planner preserves clear straight paths, allows a short host exit for attached events, and retries in a wider local corridor when necessary.

All visible gateway labels are planned before the command. The planner reserves accepted label geometry for external routes and reports unresolved gateway or route conflicts in the preview. Notes retain their original anchor offset where it fits. The editor moves linked notes and their associations in the same history command as the anchors and preserves artifact ownership.

## Verification

- Node.js 24.22.3, 162 tests passed.
- Route quality and fingerprint checks passed for 22 diagrams. See [DECISION.md](DECISION.md) for the route changes.
- The production build passed. Chromium passed 42 tests. The verification build passed 22 graph tests, including both mixed orientations.
- Browser checks covered a blocked preview, shortcut clearance, long and neighboring labels, note dragging and container boundaries. Export and reopening preserved BPMN geometry, relation types, endpoints, conditions and default paths.
