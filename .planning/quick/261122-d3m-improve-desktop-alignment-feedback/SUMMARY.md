---
status: complete
date: 2026-11-22
---

# Desktop alignment feedback

Commit `5d78f0f` displays alignment results in the footer and links to the full counts and skip reasons. Both commands explain their scope on hover and keyboard focus. The visible summary clears on edits, undo, redo, and successful imports. Dismissing it keeps the last result available in Messages for the current diagram.

- Node.js 24.22.3 passed all 52 tests and built the production bundle. Vite reported its existing chunk-size warning.
- Chromium at 1280×800 and 1440×900 verified global alignment of a process and a collaboration, alignment of one and two selected pools, repeats with no changes, a skipped scope, keyboard tooltips, focus return, footer geometry, undo and redo, edits, and BPMN export and reopening.
- Chromium verified the concrete error on a refused selection and one live-region update per attempt across two identical refusals.
- Local captures are in `.planning/ui-reviews/261122-d3m-desktop-alignment-feedback/`.
- The repository has a quick-task log without a roadmap. The approved plan was executed directly and recorded in that log.
