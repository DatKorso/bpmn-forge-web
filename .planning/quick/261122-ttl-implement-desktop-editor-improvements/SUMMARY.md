---
status: complete
date: 2026-11-22
---

# Desktop editor improvements

- `152d40a` tracks unsaved edits across import, download, undo, redo, and new branches. New and Open share a confirmation dialog. Import and export failures appear below the toolbar and in editor messages. [Pull request #2](https://github.com/DatKorso/bpmn-forge-web/pull/2)
- `c91e4ad` makes the palette keyboard-accessible and uses the built-in BPMN factories, rules, and label editor for placement. It docks properties beside the canvas and adds zoom and fit controls. [Pull request #3](https://github.com/DatKorso/bpmn-forge-web/pull/3)
- `71b1b04` labels the alignment actions, adds an Open BPMN action to the empty canvas, puts gap errors below the relevant fields, and keeps the footer result concise.

On Node.js 24.22.3, all 75 unit tests and 11 Chromium scenarios passed, and the production build succeeded. The Playwright suite covers protection against discarding edits, browser unload confirmation, keyboard and mouse placement, and the desktop layouts at 1024×600, 1280×800, and 1440×900. The pull request workflow attaches the screenshots to its CI runs.
