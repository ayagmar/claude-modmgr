# Performance

Measured on 2026-10-08 on the build machine (Arch Linux, Node 24.21.0, Claude Code 2.1.293), in an isolated
`CLAUDE_CONFIG_DIR` with two marketplaces added (`claude-plugins-official` and a folder marketplace of the fixture
mods) plus the plugin directory the CLI lists by itself: 3,538 catalogue entries (3,224 + 312 + 2), seven installed
plugins (four of them mods), the dialog inline at 116 body columns. Two sources:

- **Live**, with `userConfig.debugTimings` on (`pluginConfigs.modmgr.options.debugTimings: true` in that config's
  `settings.json`) and `--debug`: each measured step writes `modmgr: timing <step> <n> ms` to the debug log
  (`services/timing.ts`, `performance.now()`, no host round trip to measure). Steps: `session.start` blocking, each
  pane and band draw, the installed list's refresh, the catalogue's load and window, Dev's refresh, Health's facts.
- **Pure computation**, `node scripts/measure-perf.ts` (warm, median and p95): the catalogue index and a keystroke
  at 3.5k and 10k entries, a row move and Health's items over 200 mods. The vitest benchmark
  (`test/domain/catalog.bench.test.ts`) keeps the keystroke under budget in CI.

## Budgets

| Operation | Budget | Measured | Verdict |
|---|---|---|---|
| `session.start` blocking | < 5 ms | 4.8, 4.8, 11.2 ms over three cold starts (was 8.9 ms before registering `/mods` and taking the queue over side by side) | ≈ 5 ms, round-trip bound: three host calls two deep (`clock.now` then `state.update`, beside `command.register`); the 11.2 ms start is unexplained (not measured further) |
| `/mods` → first paint | < 50 ms | pane draw 0.5–7.5 ms (12 state reads and Health's items included); live redraws settle in 2–3 ms (Claude Code 2.1.294, 2026-10-08). The test harness's first mount of 200 rows, which also loads the module, took 76–175 ms locally both before and after every row became a ring stop, so it is not asserted | met for draws |
| Row move / tab switch | < 16 ms | pane draw 0.5–1.2 ms per move; tab switches 0.7–4.8 ms; the pure part of a move over 200 mods 0.01 ms | met |
| Filter keystroke over 3.5k entries | < 16 ms compute + one state write | catalogue window (match, window, one write) 2.6–6.3 ms live; match + window alone 0.16 ms (mods) / 0.30 ms (all), 0.45 / 0.89 ms at 10k | met |
| Installed refresh | ≤ 1.5 s, background | warm 0.30–0.37 s (`list --json --data-size` alone 0.36 s); cold 1.7 s, the first ever, which validates every plugin once (three at a time) | met warm; the cold one is once per install or version |
| Catalogue load | ≤ 1.5 s, on first Discover open | 0.60 s (was 1.8 s with its two CLI reads one after the other and start-up validations still running); `list --available` alone 0.51 s, `marketplace list` 0.29 s; index build 17 ms at 3.5k, 46 ms at 10k | met |
| Detector | ≤ 600 probes a session, idle only | bounded by construction (`DETECT_BUDGET`, six workers, `rt.turns`), proven in `test/services/discover.test.ts` and `discover-edges.test.ts`; ≈ 12 entries/s | met |
| Job progress | ≤ 10 state writes/s | streamed output flushed at most every 100 ms (`TAIL_FLUSH_MS`), proven in `test/services/job-runner.test.ts` | met |
| `$.store` | < 1 MiB steady state | 83 KB after a session with Discover open (detector cache 60 KB, analyses 2 KB); at its cap (6,000 entries) the detector cache is ≈ 300 KB | met |
| Dev refresh, Health's facts | (none set) | 2.9–4.0 ms, 1.0 ms | |

## What changed to meet them

- The catalogue's `list --json --available` and `marketplace list --json` run side by side (`services/catalog.ts`).
- The catalogue is read behind the first tab the open dialog shows (`services/runtime.ts`), so Discover usually opens
  on it; on 2026-10-09 that read was bound by `list --json --available` (0.71–0.77 s, 2 MB) beside the community index
  (0.54 s, 2 MB).
- `session.start` registers `/mods` and takes the job queue over side by side (`services/lifecycle.ts`).
- `store.update` writes nothing when the change returns its input (each `$.store.set` rewrites the file).

## Watch

- `drawPane` reads 12 state keys and computes Health's items on every draw of every tab (the tab label shows Health's
  count). Live it stays at 0.5–7.5 ms; Health's items over 200 mods cost 0.06 ms. If draws grow, Health's count is
  the first thing to cache.
- `session.start` is three host calls, two deep; its budget leaves no room for more.
- A cold installed refresh (1.7 s for seven plugins) is what a text command waits for when start-up hasn't read the
  list yet; it runs on the command hook's own ports, so it doesn't meter the hook's 10 s budget.

## Reproduce

```sh
node scripts/measure-perf.ts
# live: in an isolated config, set pluginConfigs.modmgr.options.debugTimings true, then
CLAUDE_CONFIG_DIR=<config> claude --debug --plugin-dir ./plugin
grep 'modmgr: timing' <config>/debug/latest
```
