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
