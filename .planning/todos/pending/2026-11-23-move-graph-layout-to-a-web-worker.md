---
created: 2026-11-23
title: Re-evaluate a Web Worker if graph layout exceeds the Chromium threshold
area: editor
files:
  - src/graph-layout/index.js
  - src/auto-align.js
  - src/main.js
  - scripts/benchmark-graph-layout.mjs
---

## Decision

Defer Worker implementation. On Apple M1 Pro with Chromium 159.0.8154.6, the optimized 200-node, 216-flow workload took 306 ms median from click to preview. The five warm main-thread tasks were 191, 183, 180, 179 and 187 ms. Re-evaluate when at least three of five warm runs reach 200 ms or more. Track median click-to-preview against the separate one-second goal.

See the [measurement record](../../quick/261123-3h0-establish-elk-layout-quality-baseline-an/DECISION.md).

## Scope

- Send a serializable snapshot with canonical keys to a worker. Keep the BPMN editor command, gateway labels and association relayout on the main thread.
- Run ELK, placement and sequence routing in the worker. Return the full plan or one refusal. Discard results when the model or command history changes.
- Recheck R1–R7, exported DI and the lazy ELK chunk. Measure UI responsiveness and total planning time on the same workload.
