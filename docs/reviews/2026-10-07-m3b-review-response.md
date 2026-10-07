# Response to the Fable 5.1 M3b review

Review: `2026-10-07-fable-5.1-m3b-review.md`. Both MAJOR findings were reproduced first with the project's fakes,
then fixed with a test that failed before the fix. R-M3b-7's live check ran with the dialog inline at 64 columns
(PLAN F53, debug log quoted there). Dispositions:

| # | Disposition | Where |
|---|---|---|
| R-M3b-1 | Adopted, first option: when the runner cancels a batch's reload as useless and the batch has `ok` work, it echoes the batch's `doneText` ("already up to date") through `attention.lastReload` with the same 8 s clear, so the band, the pane's batch line and its redraw behave as after a reload. The Jobs overlay also draws an `unchanged` job's tail. | `services/job-runner.ts`, `domain/view.ts`, `ui/overlays.tsx` |
| R-M3b-2 | Adopted as proposed: `enqueue` takes a `when(queue)` guard checked in the same versioned write; `z` queues only while `stillUndoes(queue, plan.batch)`. `Promise.all([undo(), undo()])` now queues one inverse batch. | `services/job-runner.ts`, `services/actions.ts`, `domain/jobs.ts` |
| R-M3b-3 | Adopted: `summaryOf` reads `attention.dismissed`; when the dismissed band line said all of the news (updates, what an update added), `newsDismissed` keeps it out of the status line and the title until it changes. "Applying", "reloading" and "reload to apply" are never quieted. `dismiss` schedules the chrome. | `domain/view.ts`, `services/actions.ts` |
| R-M3b-4 | Adopted: `pending` counts changes (`NEEDS_RELOAD` kinds); a running marketplace refresh or test is named instead; `isWork` is shared by the batch line and the summary. | `domain/view.ts` |
| R-M3b-5 | Adopted both: the data key is `w` ("wipe its data too" / "keep its data"), and `y` reads "remove and wipe its data" once wiping is chosen. Keeping stays the default. | `domain/keymap.ts`, `ui/overlays.tsx` |
| R-M3b-6 | Adopted: `parseOpResult` reads `keptData`; the runner records it on the finished job; the undo review says "its data was kept" or "went with it" only from it, and nothing when the CLI said nothing. Both fake CLIs now answer as asked. | `domain/cli-results.ts`, `services/job-runner.ts`, `domain/view.ts`, tests |
| R-M3b-7 | Adopted: the retitle reads `UiOpenResult` and logs an unplaced answer. Live, with the dialog inline at 64 columns, a retitle from the runner's refresh logged `ui.open modmgr modmgr (unasked, 64 columns): placed` (F53 amended): the floor is for placing a pane, not retitling it, so no width gate. | `services/chrome.ts`, PLAN F53 |
| R-M3b-8 | Adopted both: a confirmed remove moves the selection (and the split's detail) to the next row shown, else the one before (`neighbourOf`); an undo review carries `undoes` and its confirm is guarded like R-M3b-2, saying "The last batch changed since this undo was shown; nothing was queued". | `domain/view.ts`, `services/actions.ts` |
| R-M3b-9 | Adopted: tests for R-M3b-1 to -8 at the domain and service level, `w` and the confirm label and `a` in the footer on terminal and desktop, a retitle answered unplaced, the job log holding no toasts. `reviewRows` is exercised through the drawn review; its wrap count stays a plain sum of `ceil(len / columns)`. | `test/**`, `plugin/tests/m3b.test.tsx` |
| R-M3b-10 | Adopted: the undo review sanitises the name it builds a notable line from. | `domain/view.ts` |
| R-M3b-11 | Adopted in part: an update batch that changed nothing says "changed nothing to undo"; the update review says "if a newer version exists". "installed" after an undo's reinstall stays: it is true, and an M4 install says the same. | `domain/jobs.ts`, `ui/overlays.tsx` |
| R-M3b-12 | Adopted: `queueBatch`, `reload` and `dismiss` call `rt.chrome.schedule()` (actions write through the dispatch's ports, which aren't observed). | `services/actions.ts` |
| R-M3b-13 | Adopted: the comment on `recordCaps` says why a reorder alone writes nothing. | `domain/caps-history.ts` |
| §3 | Taken into M4: the install review fills `declaredCommand`/`headersHelper`, carries the sha into `args.acceptSha`, re-runs the pre-check right before queueing and guards `confirm` like R-M3b-2; "not inspected yet" for a mod with no capability record; a status-line budget before M5b makes `updates` live. | M4, M5b |
