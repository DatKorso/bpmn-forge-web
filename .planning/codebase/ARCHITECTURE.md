---
last_mapped_commit: 05214e22142e9c6139c3ad15cff98b982a2b0d91
last_mapped_at: 2026-11-22
---
<!-- refreshed: 2026-11-22 -->

# Architecture

**Analysis Date:** 2026-11-22

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser UI / BPMN editor                                   │
│ `index.html`, `src/main.js`, `src/style.css`               │
├──────────────────┬──────────────────┬───────────────────────┤
│ Editor lifecycle  │ UI panels/status │ bpmn-js extensions    │
│ `src/main.js`     │ `properties.js`  │ `auto-align.js`       │
│                   │ `footer.js`      │ `toolbar.js`          │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Pure layout and planning engine                             │
│ `src/alignment-plan.js`, `layout.js`, `pool-layout.js`,      │
│ `route-flows.js`, `annotation-layout.js`,                    │
│ `gateway-label-layout.js`                                    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ bpmn-js model, command stack, XML import/export              │
│ Modeler instance managed by `src/main.js`                    │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Editor shell | Creates/destroys `bpmn-js` Modeler, handles file I/O, controls, gaps, undo/redo | `src/main.js` |
| Alignment adapter | Snapshots diagram elements, translates plans into an undoable command, reroutes connections | `src/auto-align.js` |
| Alignment planner | Computes whole-diagram and selection plans, container fitting, moves, and route changes | `src/alignment-plan.js` |
| Geometry engine | Grid snapping, graph ordering, regions, spacing, and collision-free placement | `src/layout.js` |
| Flow router | Orthogonal route generation, route costs, collision and boundary checks | `src/route-flows.js` |
| Collaboration layout | Pool/lane positioning and message-flow routing | `src/pool-layout.js` |
| Annotation layout | Text annotation placement and association routing | `src/annotation-layout.js` |
| UI adapters | Properties editing, Russian translation, footer messages, tooltips | `src/properties.js`, `src/russian.js`, `src/footer.js`, `src/toolbar.js` |

## Pattern Overview

**Overall:** Browser MVC-style shell around bpmn-js, with a functional geometry/planning core and a command-stack adapter.

**Key Characteristics:**
- `src/main.js` owns DOM event wiring and the single active Modeler instance.
- Planning modules operate on snapshots and return geometry/routes; they do not directly mutate the model.
- `src/auto-align.js` applies all planned mutations through one registered `editor.autoAlign` command, preserving undo/redo.
- Layout and routing utilities are ES modules with explicit exports and are independently testable under `test/`.

## Layers

**Presentation and shell:**
- Purpose: Render toolbar, canvas, properties, dialogs, and status feedback.
- Location: `index.html`, `src/main.js`, `src/style.css`, `src/footer.js`, `src/toolbar.js`, `src/properties.js`
- Contains: DOM event handlers, accessibility state, Modeler lifecycle, browser file APIs.
- Depends on: bpmn-js services and the alignment adapter.
- Used by: Browser entry point only.

**Model integration:**
- Purpose: Convert bpmn-js registry objects to planner figures and commit planned changes.
- Location: `src/auto-align.js`
- Contains: Snapshot construction, labels/lanes metadata, `AlignCommand`, `AutoAlign` service registration.
- Depends on: bpmn-js utilities and planning modules.
- Used by: `src/main.js` through `modeler.get('autoAlign')`.

**Planning and geometry:**
- Purpose: Compute deterministic positions, dimensions, waypoints, and label locations.
- Location: `src/alignment-plan.js`, `src/layout.js`, `src/route-flows.js`, `src/pool-layout.js`, `src/annotation-layout.js`, `src/gateway-label-layout.js`
- Contains: Pure calculations over diagram snapshots and geometry records.
- Depends on: Other geometry modules only.
- Used by: `src/auto-align.js` and unit tests.

## Data Flow

### Primary Request Path

1. User opens/creates a diagram; `loadDiagram` creates a staging Modeler and imports XML (`src/main.js:82`).
2. User clicks alignment; `src/main.js:220` validates gap controls and calls `autoAlign.run`.
3. `AutoAlign` snapshots the canvas and calls `planAlignment` (`src/auto-align.js:202`, `src/alignment-plan.js:724`).
4. The command applies bounds, routes, and labels through bpmn-js modeling services (`src/auto-align.js:135`).
5. bpmn-js command history emits updates; controls/status are refreshed and the operation is undoable (`src/main.js:104`, `src/auto-align.js:174`).

### Selection Flow

1. Selection changes invoke `updateControls` (`src/main.js:105`).
2. `autoAlign.selection` snapshots the root and evaluates supported selection (`src/auto-align.js:226`).
3. `runSelection` calls `planSelection`, then applies the same command-stack path (`src/auto-align.js:272`).

**State Management:** The active Modeler and filename are module-local state in `src/main.js`; bpmn-js owns diagram state and history. UI status state is held by DOM elements in `src/footer.js` and `src/properties.js`.

## Key Abstractions

**Diagram snapshot:**
- Purpose: Planner-facing representation of figures, edges, message flows, and auxiliary connections.
- Examples: `snapshot` and `figureKind` in `src/auto-align.js`.
- Pattern: Convert mutable bpmn-js elements to records before planning.

**Alignment command:**
- Purpose: Group geometry, routing, and label changes into one undoable operation.
- Examples: `AlignCommand` in `src/auto-align.js`.
- Pattern: `execute`, `revert`, and nested `postExecute` modeling operations.

**Geometry primitives:**
- Purpose: Shared rectangle/point operations and deterministic routing helpers.
- Examples: `boundsOf`, `nearestFreeBox`, `layoutProcess` in `src/layout.js`; `routeFlow` in `src/route-flows.js`.
- Pattern: Stateless functions returning new records.

## Entry Points

**Browser application:**
- Location: `index.html` loads the Vite module entry through the generated bundle.
- Triggers: Browser page load.
- Responsibilities: Provide semantic DOM and controls; `src/main.js` initializes the editor.

**Build entry:**
- Location: `vite.config.js`, `package.json` (`build` script).
- Triggers: `npm run build`.
- Responsibilities: Bundle `index.html` and inject build metadata from `scripts/build-metadata.js`.

## Architectural Constraints

- **Threading:** Single browser event loop; no workers or server runtime detected.
- **Global state:** One module-level active Modeler in `src/main.js`; UI modules cache DOM references at import time.
- **Circular imports:** No known circular import chain; planning dependencies flow from `alignment-plan.js` into geometry helpers.
- **Mutation boundary:** Keep geometry changes in planner modules and model mutations in the bpmn-js command path (`src/auto-align.js`).

## Anti-Patterns

### Direct model mutation from planners

**What happens:** Mutating bpmn-js elements while calculating layout would bypass command history.
**Why it's wrong:** Undo/redo and bpmn-js DI updates depend on `AlignCommand` and modeling services.
**Do this instead:** Return bounds/routes from `src/alignment-plan.js` and apply them in `src/auto-align.js`.

### Replacing the live model before import succeeds

**What happens:** Destroying the current Modeler before a new XML import completes would lose the working diagram on malformed input.
**Why it's wrong:** Import is asynchronous and may fail.
**Do this instead:** Use the staging-host transaction in `loadDiagram` (`src/main.js:82-125`).

## Error Handling

**Strategy:** Catch browser/modeler I/O and alignment failures at the shell boundary; planners generally signal invalid plans with null/skip records.

**Patterns:**
- `loadDiagram` and download handlers report Russian UI errors and log the exception (`src/main.js:118`, `src/main.js:162`).
- Alignment returns skip reasons and footer renders warning/error severity (`src/footer.js:47`).

## Cross-Cutting Concerns

**Logging:** `console.error` at browser operation boundaries; user-facing messages use `src/footer.js`.
**Validation:** Gap form validation is in `src/main.js`; BPMN semantic checks use bpmn-js descriptors/utilities in `src/properties.js`.
**Authentication:** Not applicable; local browser editor with file upload/download.

---

*Architecture analysis: 2026-11-22*
