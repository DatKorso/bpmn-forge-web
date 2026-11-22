---
status: complete
---

# Refine timer branches and gateway labels

The layout planner tries grid-snapped single-node detours between rows on full alignment. It requires room for the move, fewer bends on the detour, preserved straight inputs at the merge, and no increase in regional crossings, shared line length, or turns. Exclusive gateway label placement reads the final modeled routes and records label bounds in the auto-alignment undo group.

- Chromium, original marketing diagram, default spacing. Each timer route has one bend, the return docks to the top of «Анализ запроса», and the flow from «Формирование коллекции» stays straight. The «Новый товар?» label clears the routes. All 88 link IDs, sources, and targets matched the input, as did lane references.
- Undo restored the original exported geometry. Redo, a second alignment, and reopening the downloaded BPMN reproduced the aligned geometry.
- A separate Chromium fixture verified that selection can move just the selected gateway label, with the neighboring gateway label fixed and undo and redo available.
- Node.js 24.22.3 passed all 71 tests and built the production bundle. Vite reported a bundle-size warning.

Implementation commit `9f39e33`.
