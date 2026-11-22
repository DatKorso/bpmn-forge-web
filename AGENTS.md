# Repository Guidelines

## Project Structure

BPMN Forge is a browser-based BPMN editor built with Vite and `bpmn-js`. The HTML entry point is `index.html`. In `src/`, `main.js` wires up the editor and toolbar, `auto-align.js` integrates alignment with the modeler's command stack, and `layout.js` contains the geometry and layout logic. Russian interface text lives in `index.html`, `src/main.js`, and `src/russian.js`. Styles are in `src/style.css`, and Vite bundles the BPMN fonts and assets from `bpmn-js`. Layout tests live in `test/layout.test.js`.

## Build, Test, and Development

Use Node.js 24 to match CI.

- `npm ci` installs the versions in `package-lock.json`.
- `npm run dev` starts the local Vite development server.
- `npm test` runs the Node.js test suite.
- `npm run build` creates the production site in `dist/`.
- `npm run preview` serves the production build locally after a build.

## Coding Style

Use two-space indentation, single quotes, semicolons, and camelCase identifiers in JavaScript. Use ES modules and include the `.js` extension on relative imports. Follow the existing kebab-case naming for multiword files and CSS classes. Keep geometry changes in `layout.js` and undoable model changes in the modeler's command stack. Match the surrounding formatting. The project has no configured linter or formatter.

## Testing

Use `node:test` and `node:assert/strict`. Name test files `*.test.js` and describe the expected behavior in each test name. Use small diagram fixtures for layout regressions and check repeat-run stability when relevant. There is no configured coverage threshold. For editor changes, also verify the affected workflow in the browser, such as opening, aligning, undoing, or downloading a BPMN file.

## Editor Skill Maintenance

When a change affects an editor workflow, module responsibility, behavioral invariant, or test entry point covered by [the editor skill](.agents/skills/bpmn-forge-editor/SKILL.md), update the relevant instructions in the same change. Keep reusable guidance grounded in the current code and tests.

## Commits and Pull Requests

Use short, imperative commit subjects, such as `Deploy BPMN Forge through PM2`. In a pull request, explain the behavior change, list the checks you ran, link the related issue when available, and include screenshots for visible UI changes.

## Deployment

GitHub Actions tests and builds pull requests targeting `main`. On `main`, successful builds are published to the `production-build` branch for the VPS to pick up. The PM2, systemd, and Nginx configuration lives in `deploy/`. Keep credentials, `node_modules/`, and local `dist/` output out of source commits.
