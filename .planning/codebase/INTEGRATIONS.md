---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# External Integrations

**Analysis Date:** 2026-11-22

## APIs & External Services

**BPMN modeler library:**
- `bpmn-js` is the only application-level library integration; it runs entirely in the browser and exposes the modeler, canvas, import/export, selection, and command-stack services used by `src/main.js` and `src/auto-align.js`.
  - SDK/Client: `bpmn-js` 18.31.0 from `package.json`.
  - Auth: None.

**GitHub repository and Actions:**
- GitHub hosts source and the `production-build` branch; Actions executes CI/build and deployment publication in `.github/workflows/ci-cd.yml`.
  - SDK/Client: Git CLI and GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`).
  - Auth: GitHub Actions repository permissions (`contents: read` for build, `contents: write` for deploy); no application secret is referenced in source.

## Data Storage

**Databases:**
- None. BPMN documents are held by the browser modeler and serialized to XML for download in `src/main.js`.

**File Storage:**
- Local browser file picker and downloads only: `src/main.js` reads selected files with `File.text()` and writes BPMN XML using a `Blob` and object URL.
- VPS release files are stored on local disk under `/var/lib/bpmn-forge/releases` with the active symlink `/var/lib/bpmn-forge/current` (`deploy/publish.sh`).

**Caching:**
- Browser/proxy cache headers are configured by Nginx: immutable one-year caching for `/assets/` and `no-cache` for other routes (`deploy/nginx.conf`).

## Authentication & Identity

**Auth Provider:**
- None for the editor; it is a public static site and has no login/session implementation in `src/` or `index.html`.
- Deployment access relies on GitHub Actions permissions and the VPS service account (`.github/workflows/ci-cd.yml`, `deploy/bpmn-forge-deploy.service`).

## Monitoring & Observability

**Error Tracking:**
- None detected. User-facing failures are reported in the editor UI and details are sent to the browser console by `src/main.js`.

**Logs:**
- Browser `console.error` records import, save, and alignment exceptions in `src/main.js`.
- Deployment scripts print publication/verification status; CI verifies the public revision through `https://bpmn.korso.cc/deployment-version.txt` (`.github/workflows/ci-cd.yml`, `deploy/publish.sh`).

## CI/CD & Deployment

**Hosting:**
- Production domain `https://bpmn.korso.cc` is fronted by Nginx and proxies to a local `serve`/PM2 process on `127.0.0.1:41283` (`deploy/nginx.conf`, `deploy/ecosystem.config.cjs`).

**CI Pipeline:**
- GitHub Actions runs on pull requests to `main`, pushes to `main`, and manual dispatch; it installs with `npm ci`, runs `npm test`, and runs `npm run build` (`.github/workflows/ci-cd.yml`).
- Successful `main` builds archive `dist/` with `deployment-version.txt`, publish a commit containing `bpmn-forge.tar.gz` to `production-build`, and poll the production endpoint for the deployed SHA (`.github/workflows/ci-cd.yml`).
- A systemd timer runs `/etc/bpmn-forge/publish.sh` every 30 seconds; the script downloads the current GitHub release, validates its Vite output, atomically switches the active release, and prunes old releases (`deploy/bpmn-forge-deploy.timer`, `deploy/publish.sh`).

## Environment Configuration

**Required env vars:**
- Application: none detected.
- Deployment process settings are PM2 environment values (`PM2_SERVE_HOST`, `PM2_SERVE_PORT`, `PM2_SERVE_PATH`) declared directly in `deploy/ecosystem.config.cjs`.
- CI uses built-in GitHub context variables such as `GITHUB_SHA`, `GITHUB_REF`, and `RUNNER_TEMP` (`.github/workflows/ci-cd.yml`).

**Secrets location:**
- No repository secret names or credential files are referenced by application code. GitHub Actions environment/repository permissions provide deployment authorization (`.github/workflows/ci-cd.yml`).

## Webhooks & Callbacks

**Incoming:**
- None. The browser application has no server endpoints; Nginx only serves static assets through the local proxy (`deploy/nginx.conf`).

**Outgoing:**
- CI verification performs HTTPS GET requests to `https://bpmn.korso.cc/deployment-version.txt` (`.github/workflows/ci-cd.yml`).
- VPS publication performs GitHub remote queries and downloads the release archive from `raw.githubusercontent.com` (`deploy/publish.sh`).

---

*Integration audit: 2026-11-22*
