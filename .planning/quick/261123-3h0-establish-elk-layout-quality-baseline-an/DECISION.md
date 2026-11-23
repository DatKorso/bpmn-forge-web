# Graph layout quality baseline

The baseline covers all 18 BPMN files and two generated workflows with 34 and 35 flow nodes. Three repository fixtures exercise unsupported models. The eight prototype fixtures keep all 240 DI perturbations. The other supported cases contribute 54 additional perturbations. The route fingerprints include absolute waypoint coordinates and persist separately for both engines.

- R1–R4 and strict R6 pass on the baseline. All fixed R5 flows are straight. The per-ID R5 exceptions are in the quality report.
- Invoice approval fails the unrelated overlap criterion. `ForReview` and `Late` share 26 px on x=400. This is an open quality defect.
- All supported fixtures meet the per-fixture crossing limit. The report lists every flow requiring manual bend review and flags the tight-pool area at 1.73× legacy. No degradation is approved by this record.

## Performance baseline

Apple M1 Pro, macOS 26.5.2, Node.js 24.14.0, Chromium 159.0.8154.6 headless, 200 nodes and 216 flows. All times are in milliseconds.

| Measurement | Cold | Five warm runs | Warm median |
|---|---:|---|---:|
| Node plan | 2480 | 2322, 2271, 2304, 2342, 2361 | 2322 |
| Chromium click to preview | 2393 | 2225, 2228, 2248, 2238, 2238 | 2238 |
| Chromium longest main-thread task | 2086 | 2094, 2092, 2130, 2123, 2102 | 2102 |

## Occupied-segment index

Exact route fingerprints matched both engines for every original fixture and every one of the 294 perturbed inputs.

| Measurement | Cold | Five warm runs | Warm median |
|---|---:|---|---:|
| Node plan | 510 | 309, 301, 308, 287, 305 | 305 |
| Chromium click to preview | 503 | 327, 309, 306, 302, 297 | 306 |
| Chromium longest main-thread task | 213 | 188, 179, 180, 180, 186 | 180 |

## Placement

- Adopted lane order as the tie-breaker between ready nodes. On invoice approval this reduced area from 486000 to 423000 px² and removed one bend. The 26 px overlap remained.
- Added downstream-corner placement for a single boundary event whose flow leaves its host unit. Invoice approval now has no shared length between unrelated flows, five bends instead of eight, and route length 1279 px instead of 1816 px. Both fixed same-lane continuations remain straight. Returning boundary flows keep centered placement.
- Rejected individual gateway ports. The trial added four bends in each medium workload. Boundary-event ports improved incident escalation but erased the invoice gains when combined with lane ordering. Centering data objects on their owners after ELK caused a collision in `shared-data`.
- Authored branch-order agreement stayed at five agreeing pairs, four ties and zero inversions. A one-task local edit moved 3 of 34 and 4 of 35 existing nodes respectively. Both median shifts stayed at 0 px and both maxima at 180 px. Results match the baseline on both measures.
- All 17 supported cases pass R1–R6 after placement, including 294 DI perturbations. The three excluded fixtures still produce the documented refusals. Legacy route fingerprints still match the original baseline. `graph-layout-current.json` records the accepted placement changes. The original snapshot remains the crossing reference.

## Visual review

Compared legacy and graph layouts in Chromium on all nine flagged diagrams at minimum gaps 40×30. The extra bend in the incident and invoice handoffs preserves forward placement across lanes. Acyclic reorder reserves the middle row for the two-edge continuation and routes its shortcut around it. Both compact-loop variants preserve a straight main path and make the return visible along the outside of the packed pool. Both medium workflows preserve the three lane bands and keep their exception paths separate from the direct bypass.

Two visibility concerns remain. At 1.73× the legacy area, tight pool uses an extra column and its timeout return is close to the gateway caption. The self-loop exit and return approach the same side of the task, giving a tight visual pairing of opposing arrowheads. Keep these examples open for stabilization before expanding to collaborations. The initial review thresholds remain active. The beta flag remains a product decision.

## Worker decision after placement

| Measurement | Cold | Five warm runs | Warm median |
|---|---:|---|---:|
| Node plan | 499 | 305, 318, 291, 295, 281 | 295 |
| Chromium click to preview | 512 | 334, 314, 306, 303, 299 | 306 |
| Chromium longest main-thread task | 217 | 191, 183, 180, 179, 187 | 183 |

The final warm result meets both agreed criteria. Zero of five main-thread tasks reached 200 ms, and the median to preview was 306 ms. Retain the main-thread planner and remeasure if the representative workload or planner changes.

## Bypass clearance

Graph routing now tries a 16 px offset for bypasses. The 8 px offset is used when the larger offset cannot route the scope or when it reduces crossings or shared length. On `invoice-approval`, the larger offset would add 64 px of shared length between `Approved` and `Late`, so the accepted routes use the smaller offset.

Seven graph route fingerprints changed. Five fixtures add 16 px to total route length, and the invoice and access lifecycle workloads each save 14 px. The changed cases retain their area and bend counts. All legacy route fingerprints match the previous snapshot.

The wider grid reuses the search estimates for remaining turns and distance. On the 200-node workload, the warm Node.js median was 73 ms with those estimates and 431 ms in the initial 16 px trial. The Chromium preview median was 137 ms, with zero warm runs reaching a 200 ms main-thread task.
