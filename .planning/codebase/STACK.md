---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# Technology Stack

**Analysis Date:** 2026-11-22

## Languages

**Primary:**
- JavaScript (ES modules) - browser editor behavior and layout algorithms in `src/*.js`, Vite configuration in `vite.config.js`, and build metadata generation in `scripts/build-metadata.js`.
- HTML - editor shell and Russian UI markup in `index.html`.

**Secondary:**
- CSS - editor and BPMN diagram styling in `src/style.css`.
- Bash - VPS publication script in `deploy/publish.sh`.

## Runtime

**Environment:**
- Node.js 24 for development and CI, as specified in `README.md` and `.github/workflows/ci-cd.yml`.
- Modern browser runtime for the Vite-generated application; `src/main.js` uses browser APIs such as `File`, `Blob`, `URL.createObjectURL`, and DOM events.

**Package Manager:**
- npm (scripts and lockfile workflow in `package.json` and `.github/workflows/ci-cd.yml`).
- Lockfile: present at `package-lock.json`; CI uses `npm ci`.

## Frameworks

**Core:**
- Vite 8.3.1 - development server, bundling, and production build through `vite.config.js` and `package.json`.
- bpmn-js 18.31.0 - in-browser BPMN modeler, import/export, canvas, command stack, and modeling services in `src/main.js` and `src/auto-align.js`.
- bpmn-js-color-picker 0.7.2 - modeler color-picker module registered in `src/main.js`.

**Testing:**
- Node.js built-in test runner (`node --test`) - tests in `test/*.test.js`, configured by the `test` script in `package.json`.
- `node:assert/strict` is used by the test suite; no third-party test runner is configured.

**Build/Dev:**
- Vite config defines the compile-time `__BUILD_METADATA__` constant using `scripts/build-metadata.js` (`vite.config.js`).
- GitHub Actions runs checkout, npm install, tests, build, and artifact packaging in `.github/workflows/ci-cd.yml`.

## Key Dependencies

**Critical:**
- `bpmn-js` 18.31.0 - BPMN rendering/modeling engine and built-in diagram CSS/fonts imported by `src/main.js`.
- `bpmn-js-color-picker` 0.7.2 - color editing support added as a modeler module in `src/main.js`.

**Infrastructure:**
- `vite` 8.3.1 - local development and static asset production in `package.json` and `vite.config.js`.
- Node.js standard library (`node:child_process`, `node:url`) - Git metadata extraction in `scripts/build-metadata.js`.

## Configuration

**Environment:**
- No application environment-variable configuration is detected in the repository; no `.env*` file is present.
- CI sets the standard `CI` variable, which makes metadata generation strict in `scripts/build-metadata.js`.
- Runtime deployment configuration is file-based in `deploy/ecosystem.config.cjs`, `deploy/nginx.conf`, and systemd unit files under `deploy/`.

**Build:**
- `vite.config.js` injects build metadata and otherwise uses Vite defaults.
- `package.json` provides `dev`, `build`, `preview`, and `test` scripts.
- `scripts/build-metadata.js` requires complete Git history for strict CI builds and embeds up to 20 commit records.

## Platform Requirements

**Development:**
- Node.js 24 and npm; run `npm ci` before `npm run dev`, `npm test`, or `npm run build` (`README.md`).
- A complete Git checkout is required for CI-style metadata generation; shallow history falls back locally but fails when `CI` is true (`scripts/build-metadata.js`).

**Production:**
- Linux VPS with systemd, Nginx, and PM2/`serve`; deployment files target `/var/lib/bpmn-forge/current` and localhost port `41283` (`deploy/bpmn-forge-deploy.service`, `deploy/ecosystem.config.cjs`, `deploy/nginx.conf`).
- GitHub Actions publishes a static `dist/` tarball to the `production-build` branch for the VPS pull job (`.github/workflows/ci-cd.yml`).

---

*Stack analysis: 2026-11-22*
