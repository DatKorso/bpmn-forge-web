---
status: complete
---

# Experimental BPMN graph layout

The β button lazily loads a planner that uses BPMN model order and the layered ELK 0.12.1 algorithm. It builds lane and subprocess bounds from their contents, docks sequence flows at the actual BPMN figures, and applies the accepted plan in one undoable command. Unsupported diagrams and failed routes produce a single refusal naming the region. Data associations retain their BPMN direction and are relaid by bpmn-js.

[DECISION.md](./DECISION.md) records the prototype gate. [PROTOTYPE.jsonl](./PROTOTYPE.jsonl) contains the final rerun with ELK geometry and diagnostic routes, packed geometry, final routing metrics and the legacy comparison. All eight fixtures meet R1–R4. All 240 seeded perturbations reproduce the exact normalized boxes and sequence routes. The gate passes on tight-pool and vertical-pool. Tight-pool gains two bends relative to the legacy result while staying free of path crossings. Vertical-pool keeps both flows straight.

## Build and timing

Production builds on Node 24.22.3. The baseline is commit `8ea9f1e`.

| Chunk | Baseline kB | Final kB | Baseline gzip kB | Final gzip kB |
|---|---:|---:|---:|---:|
| Initial JavaScript | 690.87 | 658.82 | 205.96 | 194.88 |
| Graph planner, on demand | — | 10.92 | — | 4.68 |
| ELK, on demand | — | 1463.91 | — | 452.44 |

Whole-diagram and selection planning now load on demand as well. Selection eligibility remains synchronous.

The 200-node benchmark uses 216 sequence flows, seed 42 and 60 × 40 minimum gaps. On Apple M1 Pro, the cold plan took 2,438 ms and the five warm runs took 2,219–2,364 ms with a median of 2,288 ms. It exceeds the existing one-second threshold. The [Web Worker task](../../todos/pending/2026-11-23-move-graph-layout-to-a-web-worker.md) tracks the follow-up.

## Verification

- `npm ci`, `npm test` with 127 passing tests, `npm run build`, and `npm run test:e2e` with 27 passing Chromium scenarios. The existing keyboard undo test timed out once in a parallel run. It then passed five isolated repeats and the full parallel rerun.
- On Vite dev, moved a task in tight-pool, reproduced the graph layout, downloaded the BPMN and reopened it. The next graph run reported «Изменений нет».
- Local PR screenshots are in `.planning/ui-reviews/261123-2iv-graph-layout/`.
