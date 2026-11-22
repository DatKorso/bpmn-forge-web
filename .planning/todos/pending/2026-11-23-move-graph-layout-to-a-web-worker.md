---
created: 2026-11-23
title: Move graph layout to a Web Worker
area: editor
files:
  - src/graph-layout/index.js
  - src/auto-align.js
  - src/main.js
  - scripts/benchmark-graph-layout.mjs
---

## Problem

The β planner exceeded the one-second threshold recorded in the alignment benchmark. On 200 nodes with 216 SequenceFlow edges, the measured median was about 2.3 s on Apple M1 Pro with Node 24.22.3. ELK and final route planning currently run on the main thread.

## Scope

- Send a serializable snapshot with canonical keys to a worker. Keep the BPMN editor command, gateway labels and association relayout on the main thread.
- Run ELK, placement and sequence routing in the worker. Return the full plan or one refusal. Discard results when the model or command history changes.
- Recheck R1–R7, exported DI and the lazy ELK chunk. Measure UI responsiveness and total planning time on the same workload.
