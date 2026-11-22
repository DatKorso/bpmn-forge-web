---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
# Coding Conventions

**Analysis Date:** 2026-11-22

## Naming Patterns

**Files:**
- Use kebab-case for multiword JavaScript modules, for example `src/auto-align.js`, `src/alignment-plan.js`, and `src/gateway-label-layout.js`.
- Keep tests in `test/` with the matching feature name and a `.test.js` suffix, such as `test/layout.test.js`.

**Functions:**
- Use camelCase for functions and predicates (`nearestFreeBox`, `planAlignment`, `isAnnotation`) in `src/layout.js`, `src/alignment-plan.js`, and `src/annotation-layout.js`.
- Use short local geometry helpers (`right`, `bottom`, `center`, `box`, `point`) when their scope is unambiguous; prefer named functions for multi-step algorithms.

**Variables:**
- Use camelCase for locals and module state (`modeler`, `fileInput`, `useUniformGap`) in `src/main.js`.
- Use descriptive uppercase constants for fixed configuration (`GRID`, `TOLERANCE`, `EPSILON`, `ROUTE_MARGIN`, `COMMAND`) in `src/layout.js`, `src/route-flows.js`, and `src/auto-align.js`.
- Destructure geometry objects when only their coordinates are needed, as in `src/gateway-label-layout.js`.

**Types:**
- This is plain JavaScript with no declared type system. Represent geometry as `{ x, y, width, height }` and points as `{ x, y }`; preserve those shapes across layout modules (`src/layout.js`, `src/alignment-plan.js`).
- Use object `kind`/`type` fields for diagram roles rather than classes in the layout data model (`src/auto-align.js`). Classes are reserved for bpmn-js command/module integration (`AlignCommand`, `AutoAlign` in `src/auto-align.js`).

## Code Style

**Formatting:**
- Use two-space indentation, single quotes, semicolons, and ES modules. Relative imports include `.js`, as shown throughout `src/*.js` and `scripts/build-metadata.js`.
- There is no configured formatter or linter: no `.prettierrc`, ESLint config, or Biome config is present. Match surrounding formatting manually.
- Keep expressions compact, but preserve explicit intermediate helpers for geometry and routing. Existing code uses occasional long import lines in `src/alignment-plan.js` and `src/auto-align.js`; do not introduce unrelated reformatting.

**Linting:**
- No lint command or lint rules are configured. Use `npm test` and `npm run build` as the automated syntax/integration checks.

## Import Organization

**Order:**
1. External packages and Node built-ins (`bpmn-js`, `node:assert/strict`, `node:child_process`).
2. Relative project modules, ordered by dependency/use (`src/auto-align.js`, `src/alignment-plan.js`).
3. CSS/assets after JavaScript imports in the browser entry point (`src/main.js`).

**Path Aliases:**
- Not detected. Use relative paths with explicit `.js` extensions; package imports use their published names (`bpmn-js/lib/...`).

## Error Handling

**Patterns:**
- Guard invalid or impossible geometry by returning `null` or a result with a `reason`; callers check these atomically (`nearestFreeBox` in `src/layout.js`, `planSelection` in `src/alignment-plan.js`).
- Wrap browser import/export operations in `try/catch`, report a user-facing Russian status, and log the exception with `console.error` (`loadDiagram` and the download handler in `src/main.js`).
- For build metadata, use a local fallback outside CI and throw in strict CI mode (`readBuildMetadata` in `scripts/build-metadata.js`).

## Logging

**Framework:** console plus the UI status/footer system.

**Patterns:**
- User-visible operations go through `reportOperation`/alignment reporting in `src/footer.js` and `src/main.js`.
- Use `console.error(error)` only for caught diagnostic exceptions in `src/main.js`; do not add general debug logging to geometry modules.

## Comments

**When to Comment:**
- Comment algorithm invariants and non-obvious integration constraints, such as fractional DI bounds and command-stack atomicity in `src/main.js` and `src/auto-align.js`.
- Avoid comments that merely restate straightforward code; tests communicate behavior through descriptive names in `test/*.test.js`.

**JSDoc/TSDoc:**
- Not detected. Function contracts are conveyed by names, object shapes, and tests.

## Function Design

**Size:** Prefer small pure helpers for geometry (`src/layout.js`) and split orchestration into named phases (`src/alignment-plan.js`). Large planners are acceptable when they maintain a single algorithmic phase.

**Parameters:** Pass geometry and planner state as plain objects; use options objects with defaults for optional behavior (`collaboration`/`routeMessages` in `src/pool-layout.js`, `planSelection` in `src/alignment-plan.js`).

**Return Values:** Return new geometry objects rather than mutating inputs in pure layout helpers (`translate`, `translateWaypoints` in `src/layout.js`). Use `Map`/`Set` for planned changes and `null`/`{ reason }` for inability to place or route.

## Module Design

**Exports:** Export focused named helpers from computational modules (`src/layout.js`, `src/route-flows.js`, `src/alignment-plan.js`); export the bpmn-js module object as default from `src/auto-align.js`.

**Barrel Files:** Not used. Import directly from the owning module.

---

*Convention analysis: 2026-11-22*
