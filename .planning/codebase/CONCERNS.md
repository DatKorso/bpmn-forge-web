---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# Codebase Concerns

**Analysis Date:** 2026-11-22

## Tech Debt

**Monolithic alignment planner:**
- Issue: The core planning algorithm is concentrated in a 1,307-line module with many mutually dependent layout, routing, validation, and fallback paths.
- Files: `src/alignment-plan.js`
- Impact: Changes to one diagram shape or route policy can affect unrelated BPMN cases; review and debugging require understanding a large stateful pipeline.
- Fix approach: Split the planner into explicit phases (snapshot/graph, placement, routing, validation) while preserving the existing plan object contract and adding phase-level tests.

**UI bootstrap and editor orchestration are coupled:**
- Issue: DOM lookup, event registration, modeler lifecycle, file I/O, validation, and status reporting all run at module initialization or in one controller.
- Files: `src/main.js`, `src/properties.js`, `src/toolbar.js`
- Impact: Browser-only behavior is difficult to exercise in isolation, and a lifecycle regression can leave controls or the staging model out of sync.
- Fix approach: Extract modeler lifecycle and pure control-state functions behind small interfaces; keep DOM adapters at the edge.

## Known Bugs

**Not detected:** No confirmed functional bug is established by the available source and regression tests. Remaining behavior should be validated through browser workflows because the test suite does not instantiate the editor.

## Security Considerations

**Unbounded client-side BPMN import:**
- Risk: `File.text()` accepts any user-selected file without a size or complexity limit; parsing and rendering a very large or pathological BPMN document can consume substantial browser memory or block the UI.
- Files: `src/main.js:137-142`, `src/main.js:75-124`
- Current mitigation: Import errors are caught and the temporary modeler is destroyed; file selection is restricted by an `accept` hint in `index.html:45` (not an enforcement boundary).
- Recommendations: Add an explicit byte limit before reading, enforce a parse/render time or cancellation policy where supported, and surface a clear rejection message. Treat this as a resilience limitation until measured with representative files.

**Deployment archive relies on GitHub and HTTPS:**
- Risk: `publish.sh` resolves a branch SHA and downloads an archive over HTTPS, but does not verify a detached signature or checksum published independently of the fetched branch metadata.
- Files: `deploy/publish.sh:10-32`
- Current mitigation: The download URL identifies the archive by its publication commit SHA. The script stages extraction and checks the output tree and the format of the source revision marker.
- Recommendations: Pin and verify a release manifest/checksum or signature from a separately trusted channel, and retain the current release until health checks pass.

## Performance Bottlenecks

**Potentially expensive all-in-browser layout search:**
- Problem: Alignment can perform repeated placement and route searches, including obstacle candidate enumeration and fallback attempts.
- Files: `src/alignment-plan.js:724-1306`, `src/layout.js:68-143`, `src/route-flows.js:190-344`
- Cause: Search work grows with figures, obstacles, branches, and annotations; there is no documented complexity guard or worker boundary.
- Improvement path: Add benchmark fixtures at increasing diagram sizes, report duration in the UI, and consider aborting or moving large plans to a worker after a measurable threshold.

## Fragile Areas

**Command-stack synchronization:**
- Files: `src/auto-align.js:136-241`, `src/main.js:75-124`
- Why fragile: Alignment updates bounds, waypoints, labels, and relayout through custom command-stack handlers while model replacement and undo/redo are also coordinated by the UI.
- Safe modification: Keep all model changes in the registered command handler, test undo/redo after every new mutation, and do not mutate model elements outside modeling/command-stack APIs.
- Test coverage: Node tests cover planner outputs, but no test exercises `bpmn-js` command-stack integration or browser lifecycle.

**Deployment replacement and rollback window:**
- Files: `deploy/publish.sh:36-45`, `deploy/bpmn-forge-deploy.timer:4-7`
- Why fragile: A timer polls every 30 seconds and swaps `current` atomically, but publication has no HTTP health check after switching and cleanup removes releases older than seven days except current/previous.
- Safe modification: Validate the served build before switching the symlink, preserve a configurable number of known-good releases, and log/alert failed publication or rollback decisions.
- Test coverage: Deployment shell/systemd behavior is not covered by repository tests.

## Scaling Limits

**Single browser main thread:**
- Current capacity: No explicit maximum diagram size or planning duration is enforced.
- Limit: `src/main.js:228-243` invokes alignment synchronously from the click handler, so sufficiently complex diagrams can make the editor unresponsive.
- Scaling path: Establish performance budgets, add cancellation/progress feedback, and move expensive planning into a Web Worker if budgets are exceeded.

## Dependencies at Risk

**Not detected:** Dependency versions are pinned in `package.json` and `package-lock.json`; no deprecated package or unsupported runtime is confirmed from repository evidence.

## Missing Critical Features

**Automated browser regression coverage:**
- Problem: The repository tests pure layout/planning and metadata only; editor import, alignment, undo/redo, download, properties, and accessibility workflows are not automated.
- Blocks: Regressions in `src/main.js`, `src/auto-align.js`, and DOM wiring can pass `npm test` and `npm run build` unnoticed.

## Test Coverage Gaps

**Editor integration and deployment:**
- What's not tested: `bpmn-js` import/export, custom command handlers, model replacement failures, browser controls, and `deploy/publish.sh`.
- Files: `src/main.js`, `src/auto-align.js`, `src/properties.js`, `deploy/publish.sh`
- Risk: High-impact user and release failures are detected only manually or in production.
- Priority: High

---

*Concerns audit: 2026-11-22*
