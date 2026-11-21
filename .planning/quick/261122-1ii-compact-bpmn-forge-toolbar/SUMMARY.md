---
status: complete
date: 2026-11-22
---

# Compact BPMN Forge toolbar

Commit `037e951` puts the diagram name in the header and adds 36 × 36 px icon controls with Russian tooltips. The alignment group wraps as a unit. The spacing popover keeps the 80 and 60 defaults and focuses the first invalid field when either alignment command is invoked.

- Node.js 24.22.3 passed all 35 tests and built the production bundle.
- Chromium at 1280 and 320 px verified toolbar placement, filename ellipsis and full hover text, edge tooltip placement, keyboard navigation, the properties toggle, and spacing dismissal by Escape and outside click.
- Chromium verified focus for invalid spacing in both alignment commands, creating and opening a diagram, alignment geometry, undo, redo, and downloading a BPMN file with the aligned coordinates.
