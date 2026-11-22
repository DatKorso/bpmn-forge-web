---
name: bpmn-forge-editor
description: Use for BPMN Forge editor changes involving automatic layout, BPMN import and export, undo and redo, or editor controls.
---

# BPMN Forge Editor

Use the relevant source and its closest test first. Consult `.planning/quick/` or `git log -- <path>` when the rationale for a specific behavior matters. Check current test commands in `package.json` and `playwright.config.js`.

## Alignment

- Pick the layer by the symptom. `src/layout.js` handles graph order, rows and spacing. `src/alignment-plan.js` orchestrates whole-diagram alignment, `src/scope-plan.js` builds and refines candidates, `src/selection-plan.js` handles selection, and `src/container-fit.js` fits containers and lanes. `src/route-flows.js` handles sequence flows, `src/pool-layout.js` handles pool placement and message flows, and `src/annotation-layout.js` handles linked notes and associations. Gateway label geometry lives in `src/gateway-label-layout.js`.
- Keep planner changes in the snapshot-to-plan path. `src/auto-align.js` applies bounds and DI through `editor.autoAlign`. Keep nested waypoint and label commands in `postExecute` so a single undo restores pre-alignment geometry and label DI, including labels that originally lacked DI bounds. Check `keepFractionalBounds` in `src/main.js` if geometry drifts after reopening an export.
- Preserve BPMN relations and lane membership. For selection, preserve stationary geometry while allowing owned containers, linked notes and affected routes to update under existing planner rules. An infeasible selection leaves the model untouched. Whole-diagram alignment can report skipped regions.
- Preserve clear straight continuations and default branches where feasible. Minimum gaps constrain placement. Maximum gaps are soft and use diagram axes, including in vertical pools. Reuse clearance and routing checks when adding a placement candidate.
- For whole-diagram alignment, detect a compact loop in process coordinates from its incoming geometry in `src/layout.js`. In `src/compact-loops.js`, try the upper task's placement over the left gateway after pool, lane and annotation layout. Keep the task's calculated height and preserve the other bounds and routes. Require a straight main flow, a vertical return and a one-bend entry without worsening spacing or route interactions. Use `compact-loop.bpmn`, `vertical-compact-loop.bpmn`, and `e2e/alignment.spec.js` to verify this workflow.
- For BPMN geometry goldens, add the diagram under `test/fixtures/`. Review bounds, routes and skipped regions whenever updating the expected JSON. For an isolated geometry regression, extend the closest fixture in `test/alignment-plan.test.js` or `test/layout.test.js`. Assert the affected bounds or routes, and repeat alignment when changing candidate selection or routing. For command or export changes, reuse `e2e/alignment.spec.js` and `tight-pool.bpmn`. Compare exported DI and BPMN relations across undo, redo and reopening.

## Document and controls

- `src/main.js` stages imports before replacing the live model and tracks the download checkpoint by command identity. Preserve the live diagram and history on failure. Check undo, redo and a new history branch in `e2e/document.spec.js`.
- Use `src/toolbar.js` and `src/footer.js` for control and status behavior, and `src/keyboard-palette.js` and `src/viewport.js` for keyboard placement and canvas navigation. Check focus and the affected path in `e2e/alignment.spec.js` or `e2e/viewport.spec.js`.

## Verification

Run targeted Node tests for planner changes. For editor workflows, build first with `npm run build`, then run `npm run test:e2e -- e2e/<spec>.spec.js` with the matching spec. Playwright serves `dist/` via Vite preview. Use the full suites for changes that span multiple workflows.

## Updating bpmn-js

Keep version-sensitive imports and methods in `src/bpmn-internals.js`. After changing the pinned dependency and lockfile, run `npm ci`, `npm test` (including the adapter signature test), `npm run build` and `npm run test:e2e`. Check the alignment spec for manual edits after alignment, unchanged BPMN relations, undo and redo, and export/reopen. Check the document spec for download checkpoint behavior.
