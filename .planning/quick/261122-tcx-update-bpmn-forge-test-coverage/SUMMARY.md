---
status: complete
completed: 2026-11-22
implementation: d29d4a8
---

# Update BPMN Forge test coverage

- Exercise supported lane selection and verify final node bounds, 40-unit container clearance, atomic refusal, and obstacle-safe routing. Preserve the 15-transition graph and its second-run stability check.
- Test version formatting directly and use 21 reachable commits plus one newer commit to verify the 20-entry history limit and detached HEAD.
- Run the Chromium import, alignment, undo, redo, and export round trip against Vite Preview. GitHub Actions uploads the Playwright trace when the browser test fails.

## Verification

- On Node.js 24.22.3, `npm ci`, `npm test` (75 tests), `npm run build`, and `npm run test:e2e` passed. The Chromium test also passed three consecutive runs.
- The history case took 3.09 seconds before and 0.80 seconds after in standalone runs of `node --test test/build-metadata.test.js`. The full metadata test file went from 5.43 to 3.10 seconds.
- GitHub Actions passed the Chromium test on Ubuntu using Node.js 24.22.3. The draft PR contains the implementation commit rebased onto the remote main branch. [Draft PR #1](https://github.com/DatKorso/bpmn-forge-web/pull/1) · [GitHub Actions run](https://github.com/DatKorso/bpmn-forge-web/actions/runs/45053796244)
