# BPMN Forge

## What This Is

BPMN Forge is a Russian-language browser editor for people who create, edit, and tidy BPMN process diagrams. Users can work with a local BPMN file, apply automatic layout to a diagram or eligible selection, and download the edited BPMN XML.

## Core Value

Turn a hard-to-read BPMN diagram into a readable, editable diagram in the browser while preserving its process semantics.

## Requirements

### Validated

- ✓ Create a blank diagram, import local BPMN XML, and download editable `.bpmn` XML ([editor lifecycle](../src/main.js)).
- ✓ Edit BPMN elements and supported properties, including names, documentation, and sequence-flow conditions and defaults ([properties panel](../src/properties.js)).
- ✓ Auto-align a diagram or eligible selection with configurable spacing. Layout handles supported pools, lanes, expanded subprocesses, message flows, gateway labels, and linked annotations ([alignment planner](../src/alignment-plan.js)).
- ✓ Undo and redo editor operations, including automatic layout, through the modeler's command stack ([alignment adapter](../src/auto-align.js)).

### Active

Project baseline recorded. Future requirements will be defined when a milestone is scoped.

### Out of Scope

Milestone scope, release requirements, and phase planning are deferred until the project owner starts the first GSD milestone.

## Context

- The existing application is a static Vite site with a `bpmn-js` modeler. The [codebase map](codebase/ARCHITECTURE.md) describes the editor, layout planner, and [deployment pipeline](codebase/INTEGRATIONS.md).
- Previous improvements are recorded in the [quick-task history](STATE.md#quick-tasks-completed).
- The test suite covers geometry, alignment planning, and build metadata. Editor workflows are verified manually in the browser. [Testing patterns](codebase/TESTING.md)

## Constraints

- The current editor processes BPMN files locally in the browser and distributes a static build.
- Keep geometry calculations in the layout modules and apply model changes through `bpmn-js` so edits remain undoable.
- Use Node.js 24 to match CI, and keep user-facing editor copy in Russian.

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Adopt the existing editor as the GSD project baseline | The editor and its deployment workflow are already implemented | Existing capabilities documented |
| Defer milestone planning | The project owner requested initialization only | Project initialized without an active milestone |

## Evolution

After each phase, update validated and active requirements, record decisions, and check that the project description still matches the editor. At each milestone boundary, review the core value, context, and scope.

---

*Last updated: 2026-11-22 after initialization*
