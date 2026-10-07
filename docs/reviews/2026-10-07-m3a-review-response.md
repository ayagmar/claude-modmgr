# Response to the Fable 5.1 M3a review

Review: `2026-10-07-fable-5.1-m3a-review.md`. Both MAJOR findings were reproduced first (the review's appendix B),
then fixed with a test that failed before the fix. The live checks R-M3a-6 asked for were run in a `--plugin-dir`
session (debug log lines quoted in PLAN F49/F50). Dispositions:

| # | Disposition | Where |
|---|---|---|
| R-M3a-1 | Adopted as proposed: `selectedRow(view, mods)` in `domain/view.ts` is the one resolver; `drawPane` draws it, `toggle()` acts on it, `filter()` loads its detail for the split. Tested at the domain, service and UI level (filter `red` after focusing turn-band stages redactor and draws `→ off`). | `domain/view.ts`, `services/actions.ts`, `ui/Pane.tsx` |
| R-M3a-2 | Adopted: `confirm` takes the review by compare-and-set and puts it back if nothing could be queued. `Promise.all([confirm(), confirm()])` now queues `disable, reload`. | `services/actions.ts` |
| R-M3a-3 | Adopted: `stagedIds` drives the rows' `→ off`, the detail's staged line and the count; `refresh()` prunes after the registry answers. | `domain/view.ts`, `ui/Installed.tsx`, `ui/Detail.tsx` |
| R-M3a-4 | Adopted, second option: `statusOf(queue, showDone)` shows "applied" while `attention.lastReload` is set; the pane reads `attention`, and the runner's 8 s clear is the redraw. The runner now always echoes a line ("Plugins reloaded" when the CLI says nothing). `now` is gone from `PaneFrame`. Checked live: the line and the band echo leave together. | `domain/view.ts`, `services/job-runner.ts`, `ui/Pane.tsx` |
| R-M3a-5 | Adopted: `ringTo(...keys)` tries each key and falls back on a denial; every stack change places the ring (review → `act:cancel`, detail → `act:toggle` else `act:copy`, help/jobs → their key, none → the row). Live, it also exposed F50 (below). | `services/actions.ts` |
| R-M3a-6 | Checked live (F49). (1) Losing the keys without a key press does redraw the pane, so the last draw's `isFocused` is current. (2) ctrl+x x hands the keys back before `ui.close` exactly as Esc does: indistinguishable, so with an overlay up it pops it; accepted and documented (Esc is the common path; the mouse mark could not be driven). The hook still closes when `$.ui.panes()` says the pane kept the keys. (3) Only terminal draws set the flag. | `register.tsx`, `services/actions.ts`, PLAN F49, C11 |
| R-M3a-7 | Adopted: an update's version is capped at 8 in the row; the flags group is one line, may shrink, and is clipped at the frame. | `ui/Installed.tsx` |
| R-M3a-8 | Adopted: overlays taller than the body are clipped to its rows (`clipped`); the detail switches to a compact form (notable items without their facts line, a reach group per line) when the full one doesn't fit, and its keys moved under the title so clipping never hides them; Jobs fits its lines to the rows and says how many older jobs it left out. | `ui/Pane.tsx`, `ui/Detail.tsx`, `ui/overlays.tsx` |
| R-M3a-9 | Adopted: tests for both MAJORs, the read-only dialog, a running test's tail and cancel label, the project-scope review lines, the split's compact list and help beside it, Esc re-taking the keys and placing the ring, the close key closing, and the ring's fallback. `paneHadKeys` wiring is covered by the live check (F47 keeps `ui.close` unraisable in tests). | `test/**`, `plugin/tests/ui.test.tsx` |
| R-M3a-10 | Measured, not changed: `ui.focus` settles in 3–11 ms live with both writes, inside the 16 ms budget. | debug log |
| R-M3a-11 | Adopted: `KeyButton` hands the press to `onPress`; copy targets `press.surface`. | `ui/kit.tsx`, `ui/Detail.tsx` |
| R-M3a-12 | Adopted: test wording fixed; the paint bound is 150 ms in the test (37 ms measured on the terminal's first draw, 3 ms on desktop), the 50 ms budget stays in PLAN §6 and is measured again in M6. | `test/domain/view.test.ts`, `plugin/tests/ui.test.tsx` |
| R-M3a-13 | Adopted: `close`/`back` off the terminal, the ctrl+x hint on the terminal only. | `ui/Pane.tsx` |
| §3 | Taken into M3b: undo containing an `install` goes through the review; `paneOpen` stays the one place that knows the manners, and a retitle happens only for a placed pane; `UiPort.status`; `view/3` drops `layout` and `page` when M3b touches the shape. | M3b |

Found while fixing (F50): after `confirm`, the ring jumped to the filter field. The review was taken before the
stack popped, so one draw showed the list through the overlay path (no filter field); the ring moved onto a row of
that tree and was lost when the real list replaced it. The pane now draws a review overlay whose review is gone as
absent, so the intermediate tree is the final one. A re-open without `holdToasts` was suspected first and ruled out
(removed, retested, restored).
