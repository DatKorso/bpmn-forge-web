# Quick task 261122-2rl — UI Review

- **Audit date** 2026-11-22
- **Baseline** Abstract six-pillar standards, with the collaboration plan and the approved compact toolbar plan as context.
- **Scope** Desktop editor at current HEAD.
- **Screenshot** Local 1440×900 capture at `.planning/ui-reviews/261122-2rl-20261122-022207/desktop.png`.
- **Interaction captures** Off (`workflow.ui_interaction_capture` is `false`).

The static desktop screenshot was inspected. Interaction findings below are code-derived; no post-click, hover, focus, or alignment-result state was captured.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Completion copy is specific, but the primary action label does not disclose that it can move pools and reroute message flows. |
| 2. Visuals | 2/4 | The empty canvas is clear, but the selection-alignment action is an unlabeled toolbar glyph in the captured desktop state. |
| 3. Color | 3/4 | The restrained token palette is coherent, yet status/error visibility relies on a small red dot or a dialog rather than a persistent semantic surface. |
| 4. Typography | 2/4 | Desktop UI text uses seven explicit sizes, exceeding the four-size abstract-standard threshold. |
| 5. Spacing | 3/4 | The primary 4/8/12/16/24 scale is mostly consistent, but several non-token 3/6/7/14/20 px gaps fragment it. |
| 6. Experience Design | 2/4 | Alignment outcome counts are produced, but only inside a footer dialog; users receive no immediate, visible confirmation on the canvas. |

**Overall: 15/24**

---

## Top 3 Priority Fixes

1. **WARNING — Surface the collaboration-alignment result next to the canvas or primary action.** Pool/message-flow counts and skipped reasons currently require opening “Сообщения редактора”; users cannot promptly verify whether the requested collaboration layout ran. Add a visible, dismissible success/error notice after alignment, retaining the dialog as history.
2. **WARNING — Explain the scope of each alignment action.** Give the global button a tooltip such as “Выровнять всю схему, включая пулы и потоки сообщений” and explain the one-pool and multiple-pool behavior in the selection action’s hover and focus help. The approved compact toolbar calls for a single visible text label. [Compact toolbar plan](../261122-1ii-compact-bpmn-forge-toolbar/PLAN.md)
3. **WARNING — Consolidate the type scale.** Reduce the desktop UI to a documented 12/13/16/21 (or similar) scale, reserving exceptions for the BPMN palette, so hierarchy does not depend on many near-duplicate sizes.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

- **WARNING:** The implemented completion copy explicitly reports `Перемещено пулов` and `Перестроено потоков сообщений`, so the behavioral change is described after execution ([src/main.js:220](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:220)). Error and impossible-selection messages are also specific, including the mixed-pool restriction ([src/alignment-plan.js:549](/Users/korso/Documents/projects/bpmn-forge-web/src/alignment-plan.js:549)).
- **WARNING:** The only persistent global-action label is “Автовыровнять” ([index.html:85](/Users/korso/Documents/projects/bpmn-forge-web/index.html:85)). It does not communicate that this task can reposition collaboration pools or redraw message flows, an effect more consequential than ordinary in-pool alignment.
- **WARNING:** The static empty state says only to select an element from the left palette or open BPMN ([index.html:91](/Users/korso/Documents/projects/bpmn-forge-web/index.html:91)); it gives no desktop-oriented first-use route for a collaboration diagram or the two alignment modes.

### Pillar 2: Visuals (2/4)

- **WARNING.** The desktop capture has a clear canvas focal point and a well-separated 290 px properties panel. The selection-alignment control has an accessible name and uses an icon as specified in the approved toolbar plan. Its meaning is hard to infer from the icon alone, especially next to the spacing control. [index.html:79](/Users/korso/Documents/projects/bpmn-forge-web/index.html:79) · [Compact toolbar plan](../261122-1ii-compact-bpmn-forge-toolbar/PLAN.md)
- **WARNING:** Tooltips are implemented for pointer hover and keyboard focus ([src/toolbar.js:37](/Users/korso/Documents/projects/bpmn-forge-web/src/toolbar.js:37)), but no tooltip is persistent in the first desktop paint. This is not evidence that an infrequent alignment action is discoverable without hover; interaction capture was off.
- **WARNING:** The available primary-action hierarchy is strong visually (`--accent` filled button, [src/style.css:152](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:152)), but it visually prioritizes an operation whose broad collaboration impact is unexplained.

### Pillar 3: Color (3/4)

- **WARNING:** The screenshot uses a restrained white/page-blue palette, and CSS centralizes the palette in custom properties ([src/style.css:6](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:6)). The primary accent is concentrated in the brand mark and main action rather than spread through decorative UI, which supports a sensible low-accent distribution.
- **WARNING:** Error/attention is visually reduced to `--danger` ([src/style.css:17](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:17)) and a 9 px unread indicator ([src/style.css:372](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:372)). Since operation failures and skipped routes are housed in a closed dialog, this color cue is too easy to miss on a desktop canvas.
- **WARNING:** Hard-coded colors occur only in the token definitions plus the canvas dot pattern ([src/style.css:272](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:272)); there is no evidence of uncontrolled per-component color drift.

### Pillar 4: Typography (2/4)

- **WARNING.** Seven declared desktop text sizes exceed the abstract standard of four. Tooltip and metadata use 12 px, controls use 13 px, and headings use 15, 17, or 21 px. The document name uses 16 px, and empty-state and dialog copy use 14 px. The BPMN palette also uses 25 px glyphs. [Document name](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:72) · [Controls](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:101) · [Tooltip](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:203) · [Panel heading](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:241) · [Empty state](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:325) · [Dialog](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:403)
- **WARNING:** Weights also vary between normal inherited text, `620` controls, and `720` document name ([src/style.css:73](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:73), [src/style.css:104](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:104)). The rendering is legible, but token consolidation would make task hierarchy more deliberate.

### Pillar 5: Spacing (3/4)

- **WARNING:** The core desktop spacing scale is defined as 4/8/12/16/24 px ([src/style.css:18](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:18)) and is consistently used for the header, toolbar, editor gap, and panel padding ([src/style.css:46](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:46), [src/style.css:78](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:78), [src/style.css:209](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:209)). The screenshot reflects clean panel separation.
- **WARNING.** Several standalone spacings bypass the tokens, including the 7 px empty-state gap, 14 px dialog padding, and 3 px offsets on the unread dot. Use scale tokens for text layout and document optical exceptions such as the dot. [Empty state](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:332) · [Dialog](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:422) · [Unread dot](/Users/korso/Documents/projects/bpmn-forge-web/src/style.css:372)

### Pillar 6: Experience Design (2/4)

- **WARNING:** The implementation handles loading/busy state, disables inappropriate actions, marks the workspace busy, and preserves a live status announcement ([src/main.js:44](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:44), [src/main.js:59](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:59)). Import/save/alignment failure messages are also provided ([src/main.js:115](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:115), [src/main.js:227](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:227)).
- **WARNING.** The Messages dialog contains the visible pool and message-flow counts. The live region announces the same result for assistive technology. The closed desktop dialog leaves sighted users without a visible success confirmation near the canvas. [Result handler](/Users/korso/Documents/projects/bpmn-forge-web/src/footer.js:37) · [Live region and dialog](/Users/korso/Documents/projects/bpmn-forge-web/index.html:148)
- **WARNING.** When the dialog is closed, an unread dot signals a failed or skipped alignment. Provide a visible notice with the reason or skipped count and a direct link to details. [Unread state](/Users/korso/Documents/projects/bpmn-forge-web/src/footer.js:10) · [Alignment reporting](/Users/korso/Documents/projects/bpmn-forge-web/src/footer.js:37)
- **WARNING:** `Выровнять выделение` is represented by `aria-disabled` rather than native `disabled` ([index.html:79](/Users/korso/Documents/projects/bpmn-forge-web/index.html:79)); a JavaScript guard prevents execution ([src/main.js:233](/Users/korso/Documents/projects/bpmn-forge-web/src/main.js:233)), but the desktop visual does not itself explain why it is inactive until hover/focus. This finding is code-derived because interaction capture was disabled.

---

## Files Audited

- `index.html`
- `src/style.css`
- `src/main.js`
- `src/toolbar.js`
- `src/footer.js`
- `src/auto-align.js`
- `src/alignment-plan.js`
- `.planning/quick/261122-2rl-align-collaboration-pools-and-message-fl/PLAN.md`
- `.planning/quick/261122-2rl-align-collaboration-pools-and-message-fl/SUMMARY.md`
- `.planning/quick/261122-1ii-compact-bpmn-forge-toolbar/PLAN.md`

## Audit Limits

- No `UI-SPEC.md` exists, so this review uses abstract standards rather than project-specific tokens or copy contracts.
- Only the desktop 1440×900 first paint was captured and assessed by explicit request.
- Interaction capture was configured off; no hover, focus, dialog, selection, alignment, undo/redo, or post-alignment visual state was claimed as captured.
- `components.json` is absent, so the conditional shadcn/third-party registry audit was not applicable.
