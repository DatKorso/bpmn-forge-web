---
status: complete
---

# Harden and refactor BPMN auto-alignment

Captured ten baseline geometry goldens before changing production code. All ten remain byte-for-byte identical. The suite now includes 15 BPMN goldens, with a vertical compact-loop case and four synthetic scenarios requested in place of production files. The scenarios cover invoices, order fulfilment, vertical incident escalation, and supplier onboarding. Deterministic property tests exercise linear and branching processes, lane membership, connections, clearance and repeat alignment.

Split scope planning into named stages and moved selection, container fitting, compact loops, annotation finishing and routing into focused modules. The bpmn-js adapter has a pinned-library signature test. In Chromium, alignment preserves manual editing, BPMN relations, boundary timers, collaboration routes, undo and redo, and XML reopening.

The branching median at 500 nodes fell from 194.2 ms to 121.9 ms in the repeatable Node benchmark. The measured cases stayed below the one-second Web Worker threshold. The editor paints progress before synchronous planning and locks repeated starts while calculation or confirmation is active. It previews the planned changes, remembers valid gaps, supports both alignment shortcuts, and identifies skipped regions with a canvas outline and a reason-specific hint.

Validated on Node.js 24.22.3 with 97 Node tests, a successful production build and 21 Chromium tests. Vite reports its existing chunk-size warning. The repository already runs both test suites on pull requests targeting main.

The project had a planning directory and prior quick tasks but no active ROADMAP.md. This task used the existing local quick-task artifact format and was implemented on the `improve-bpmn-alignment` branch.
