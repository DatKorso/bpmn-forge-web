---
status: complete
---

# Graph layout quality and performance

- Captured the initial beta and legacy baselines across all repository fixtures and two medium business workflows. Verified the occupied-segment index against exact original and perturbed routes for both engines before changing placement.
- Adopted lane-aware node order and downstream placement for a solitary outgoing boundary event. All 17 supported cases met the hard quality criteria. The invoice handoff and timer routes no longer share a segment.
- Verified in Node.js 24, production Vite build, and Chromium. The 130 Node tests and 27 standard browser scenarios passed. The opt-in benchmark passed separately. Visually compared all nine review cases in Chromium.
- The final warmed Chromium median was 306 ms to preview. No warm run reached a 200 ms main-thread task. Retain the main-thread planner.
- Clarified beta scope in the tooltip and verified legacy alignment after collaboration refusal. Tight-pool label clearance and the self-loop arrowheads remain under review. Coverage expansion stays sequenced after stabilization, starting with collaborations and message flows before groups. Product approval still controls beta removal.

See [DECISION.md](DECISION.md) for measured results and the placement trials.
