---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# Codebase Structure

**Analysis Date:** 2026-11-22

## Directory Layout

```text
bpmn-forge-web/
├── index.html                  # Russian BPMN editor shell and dialogs
├── src/                        # Browser application and layout engine
├── test/                       # Node.js layout and metadata tests
├── scripts/                    # Build-time metadata helpers
├── deploy/                     # PM2/systemd/Nginx/VPS deployment files
├── .github/workflows/          # CI and production-build workflow
├── .planning/                  # GSD planning artifacts
├── package.json                # Scripts and dependencies
└── vite.config.js              # Vite build configuration
```

## Directory Purposes

**`src/`:**
- Purpose: All client-side editor code, BPMN integrations, planning algorithms, and styles.
- Contains: ES modules (`*.js`) and stylesheet (`style.css`).
- Key files: `src/main.js`, `src/auto-align.js`, `src/alignment-plan.js`, `src/layout.js`.

**`test/`:**
- Purpose: Node test runner coverage for pure geometry/planning and build helpers.
- Contains: `*.test.js` fixtures and assertions.
- Key files: `test/layout.test.js`, `test/alignment-plan.test.js`, `test/gateway-label-layout.test.js`, `test/build-metadata.test.js`.

**`scripts/`:**
- Purpose: Build-time utilities that read repository metadata.
- Contains: `scripts/build-metadata.js`.

**`deploy/`:**
- Purpose: Production service, timer, PM2, Nginx, and publication configuration.
- Contains: `deploy/ecosystem.config.cjs`, `deploy/bpmn-forge-web.service`, `deploy/bpmn-forge-deploy.service`, `deploy/bpmn-forge-deploy.timer`, `deploy/nginx.conf`, `deploy/publish.sh`.

**`.planning/`:**
- Purpose: GSD state, phase/quick artifacts, UI reviews, and generated codebase maps.
- Contains: `STATE.md`, `quick/`, `ui-reviews/`, and `codebase/`.

## Key File Locations

**Entry Points:**
- `index.html`: HTML shell and DOM IDs consumed by the client modules.
- `src/main.js`: Runtime entry that creates the initial empty BPMN Modeler.

**Configuration:**
- `package.json`: npm scripts, ESM mode, bpmn-js/color-picker/Vite dependencies.
- `vite.config.js`: Vite define hook for `__BUILD_METADATA__`.
- `.github/workflows/ci-cd.yml`: CI/build and production publication workflow.

**Core Logic:**
- `src/auto-align.js`: bpmn-js service and command-stack boundary.
- `src/alignment-plan.js`: whole diagram and selection planning.
- `src/layout.js`: graph layout and rectangle geometry.
- `src/route-flows.js`: orthogonal flow routing.
- `src/pool-layout.js`, `src/annotation-layout.js`, `src/gateway-label-layout.js`: specialized BPMN layout.

**Testing:**
- `test/layout.test.js`: geometry and process-layout behavior.
- `test/alignment-plan.test.js`: alignment plan regressions and stability.
- `test/gateway-label-layout.test.js`: gateway label placement.
- `test/build-metadata.test.js`: build metadata behavior.

## Naming Conventions

**Files:**
- Use kebab-case for multiword source files, e.g. `alignment-plan.js` and `gateway-label-layout.js`.
- Use `*.test.js` for Node tests in `test/`.

**Directories:**
- Keep application modules in `src/`, tests in `test/`, deployment assets in `deploy/`, and build helpers in `scripts/`.

## Where to Add New Code

**New Feature:**
- Primary code: Add editor event/UI integration to `src/main.js` only when it coordinates DOM and Modeler lifecycle; put domain behavior in a focused `src/*.js` module.
- Tests: Add pure behavior regressions to `test/*.test.js`, using small BPMN/geometry fixtures.

**New Component/Module:**
- Implementation: Add a kebab-case module under `src/`; import it explicitly from `src/main.js` or the owning planning module with the `.js` extension.
- For bpmn-js services or undoable mutations, extend `src/auto-align.js` or register through its additional modules rather than mutating elements from UI code.

**Utilities:**
- Shared geometry helpers: `src/layout.js`.
- Routing helpers: `src/route-flows.js`.
- Build/repository metadata helpers: `scripts/build-metadata.js`.

## Special Directories

**`dist/`:**
- Purpose: Vite production output (`dist/index.html` and hashed assets).
- Generated: Yes.
- Committed: Present in the working tree; treat as build output and regenerate with `npm run build` rather than hand-editing.

**`node_modules/`:**
- Purpose: Installed npm dependencies.
- Generated: Yes.
- Committed: No.

**`.planning/codebase/`:**
- Purpose: Generated architecture, structure, stack, quality, and concern maps consumed by GSD planning.
- Generated: Yes.
- Committed: Managed as planning artifacts.

---

*Structure analysis: 2026-11-22*
