# Response to the Fable 5.1 M0 review

Review: `2026-10-07-fable-5.1-m0-review.md`. Every finding was read against the code and, where it made a factual
claim, re-tested. Dispositions:

| # | Disposition | Where |
|---|---|---|
| M1 | Adopted. Builders are top-level functions in `register.tsx`. | PLAN C2, F40 |
| M2 | Adopted. `.catch` handlers never touch `$`; the layering test asserts it. | PLAN C2, `test/layering.test.ts` |
| M3 | Adopted. One hook per event with an ordered fan-out in `services/lifecycle.ts`. | PLAN C2 |
| M4 | Adopted. The runner owns the `session.start` port set; press handlers enqueue and kick. | PLAN C2 |
| M5 | Adopted: reload marked `running` before `$.command.run`, `shape` tags on atoms, `userConfig` reload as a resume path. | PLAN C3 |
| M6 | Fixed by a rerun with one raw log per run and every `/probe` answer logged. The earlier unexplained re-registration was an edit of the folder-marketplace probe. The rerun also found **F38** (a reload < ~1 s after a CLI write reads stale settings) and **F39**. | `docs/spikes/rerun-2026-10-07/`, PLAN F38, F39, C3 |
| M7 | Fixed: both revisions captured. | `docs/spikes/s2/catalog-revision-moves-sha.txt` |
| M8 | Fixed: catalogue summary and a `--data-size` capture. | `docs/spikes/s6/catalogue-summary.json`, `s8-s9-s11-s12/list-data-size.json` |
| M9 | **Tested and refuted.** From a clean shell, an SDK-style (`stream-json`) session's mod child has no `CLAUDECODE` and `--accept-command` works (command ran once, after acceptance). The earlier env difference came from launching those runs from the agent's shell. The `rejected` handling stays for a Claude Code launched from inside another's tool; the confirm stays on every surface. | `rerun-2026-10-07/sdk.log`, PLAN F27, C4 |
| M10 | Adopted. Cascade only while `isFocused`. | PLAN §5.2, C8 |
| M11 | Adopted. Re-open without `holdToasts` while jobs stream. | PLAN C8 |
| M12 | Adopted. "Reload queued" copy and echo of the result. | PLAN C8 |
| M13 | Resolved by M1's code: `domain/` now has 13 modules, and `test/layering.test.ts` fails if the sources vanish. | — |
| M14 | Noted in CONTRIBUTING; handled in M7 if the site needs a TypeScript API. | `CONTRIBUTING.md` |
| M15 | Noted in CONTRIBUTING (pnpm added the exact exclusions itself). | `CONTRIBUTING.md` |
| M16 | Fixed: CONTRIBUTING and PLAN §3/§9 describe the C2 layering. | — |
| M17 | The person delegated design decisions on 2026-10-07; this review served as the check. | PLAN C9 |
| M18 | Fixed: `pnpm validate` and `pnpm test:plugin` use a throwaway config dir. | `package.json` |
| M19 | Fixed: §1 heading, the `unload` clause. | PLAN §1, §5.2 |
| M20 | Fixed: `@types/node` pinned. | `package.json` |
| M21 | Fixed: the probe's `registers` atom is gone; `gen` is the measure. | `docs/spikes/probe/` |
| M22 | Fixed: F19 says it is narrowed by F30/F31. | PLAN §1 |
