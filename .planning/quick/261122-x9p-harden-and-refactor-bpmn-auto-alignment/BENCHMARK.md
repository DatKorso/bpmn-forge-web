# Alignment timing baseline

Measured before production changes at `1180031` on Apple M1 Pro, macOS arm64, Node.js 24.22.3. Run `node scripts/benchmark-alignment.js` from the repository root. Seed 42, minimum gaps 40 × 30, one warm-up and five measured calls for each case. The branching graph adds a bypass around two tasks every six nodes.

| Nodes | Linear median (range), ms | Branching median (range), ms |
|---:|---:|---:|
| 50 | 3.2 (2.1–6.2) | 4.1 (3.7–5.7) |
| 200 | 14.4 (12.9–15.7) | 35.0 (34.5–35.6) |
| 500 | 57.0 (53.5–64.2) | 194.2 (192.3–195.5) |

These figures cover `planAlignment` in Node with synthetic inputs. Editor snapshotting, rendering, and command application are outside the measurement.
