# Spikes

S1–S7 ran on Claude Code 2.1.291; their answers are in PLAN.md §1 (F1–F24). The M0 spikes (S2, S6, S8–S12) ran on
**2.1.292** on 2026-10-07, every one with an isolated `CLAUDE_CONFIG_DIR`. Their answers are F25–F37 in PLAN.md §1, and
the plan changes they cause are in PLAN.md "Changes during build".

- `gate/`: a `plugin.register` hook that logs every module it sees and refuses `aaa-mod`. Its `session.start` lists reload commands.
  (The scripts write to a hard-coded scratch path; change `OUT` before rerunning.)
- `aaa/`: the target mod. Its `session.start` writes a marker file.
- `mkt/`: a directory marketplace with zzz-gate, aaa-mod and mmm-mod, used with an isolated `CLAUDE_CONFIG_DIR` to test load order for installed plugins.
- `validate-json-sample.json`: real `claude plugin validate --json` output.
- `probe/`: the M0 probe mod (S8, S9, S11, S12, and S2 from a mod's child process). Logs to `$PROBE_OUT`.
- `s2/`, `s6/`, `s8-s9-s11-s12/`: raw evidence for the M0 spikes.
- `rerun-2026-10-07/`: the rerun after the Fable 5.1 M0 review (M6–M9): one raw log per run, the probe logging its own
  command answers, launched from a clean shell. This is the primary evidence for S8, S9, F38 and the S2/M9 question.

Reproduce F2:
    claude -p --plugin-dir ./gate --plugin-dir ./aaa "ok"   # aaa refused
    claude -p --plugin-dir ./aaa --plugin-dir ./gate "ok"   # aaa loads, the gate never sees it

Reproduce F3 (no login needed: plugin.register and session.start run before the model call):
    export CLAUDE_CONFIG_DIR=$(mktemp -d)
    claude plugin marketplace add ./mkt
    claude plugin install mmm-mod@spikemkt; claude plugin install zzz-gate@spikemkt; claude plugin install aaa-mod@spikemkt
    claude -p "ok" </dev/null   # the gate sees only aaa-mod; reorder enabledPlugins to put zzz-gate first → it sees both

An interactive session needs no login either for slash commands. Seed the isolated config so it skips onboarding and
the trust dialog (both would otherwise write to the real `~/.claude.json`):

    export CLAUDE_CONFIG_DIR=$(mktemp -d)
    echo '{"hasCompletedOnboarding":true,"projects":{"'$PWD'":{"hasTrustDialogAccepted":true}}}' > $CLAUDE_CONFIG_DIR/.claude.json
    PROBE_OUT=/tmp/probe.log claude --plugin-dir ./docs/spikes/probe

## Version check: 2.1.291 → 2.1.292 (M0)

`claude --version` was 2.1.292. The new build's `claude-code.d.ts`, `reference.md` and examples are vendored under
`vendor/claude-code-types/2.1.292/`; the full diff is 21,215 vs 20,741 lines and **additive** for every API the plan uses:

- New: `prompt.autocomplete` event, `ModelTextBlock` (cacheable blocks for `$.model.complete`), `ModelCompleteInput`,
  workflow-agent fields on `agent.spawn`, a `re-entry` kind on `HookFailure` (a `.catch` handler is asked in a hook's place
  when the event re-enters beneath the hook's own call; its own `$` calls reject then).
- Changed wording: a `{ deny }` returned after `next(e)` was answered now fails the hook (config.set, state.set, agent.spawn).
- `command.run` is now listed among gating sites. A `command.run` hook whose matcher names only commands the module
  registers by a literal name, and whose hook and `.catch` never read `next`, is reported as "answers its own command"
  and is **not** a gate. modmgr's `/mods` hook is written that way.
- The `$.audio.speak` text limit is now "its first 4096 characters are spoken" rather than a refusal.

Nothing the plan relies on was removed or renamed. CI pins 2.1.292.

## S2: the `--accept-command` flow (answered: yes, with two surprises)

**Question.** What does `install --json` print when a marketplace declares a command, does anything run before
acceptance, and does `--accept-command <sha>` work from modmgr?

**Method.** A folder marketplace (`s2/marketplace.json`) with one entry whose source is
`{ "source": "command", "command": "<abs>/emit.sh" }` (schema read from the CLI: `command`, optional `timeout` seconds,
optional `mode: copy | link`; the command prints the plugin's directory). `emit.sh` appends to a marker file, so any run
is visible. Installs ran without acceptance, with a wrong sha, after a catalogue edit, and with the right sha, from (a)
the agent's Bash tool and (b) a mod's `$.process.run` in an interactive session (`probe` → `/probe exec install …`).

**Raw output.** `s2/install-*.txt`, `s2/install-accept-from-mod-process-run.log`. The failure line:

```json
{"command":"install","outcome":"failed","plugin":"cmdmod@s2mkt","scope":"user","message":"cmdmod@s2mkt is installed by running a command on this machine (`…/emit.sh`) that has not been reviewed yet, so it was not run. …","failureCode":"command_source_refused","shownCommand":{"kind":"command_source","pluginId":"cmdmod@s2mkt","command":"…/emit.sh","mode":"copy","catalogRevision":"sha256:68d9…a37","sha256":"a472…5905"}}
```

**Answers.**
- `shownCommand` = `{ kind: 'command_source', pluginId, command, mode, catalogRevision, sha256 }`; for a `headersHelper`
  it is `{ kind: 'entry_helper', pluginId, command, archiveUrl, catalogRevision, sha256 }` (read from the CLI source:
  the sha is `sha256(json([kind, pluginId, command, mode|archiveUrl, catalogRevision]))`). With `--accept-command` the
  object also carries `acceptCommandMatched: boolean`. `failureCode` is `command_source_refused`.
- **Nothing runs before acceptance.** The marker file stayed absent through every refused run.
- The sha is stable across runs and **changes on any catalogue revision**, even a description-only edit followed by
  `marketplace update` (`catalogRevision` is the marketplace's git HEAD or a content hash).
- Evidence for the revision rule: `s2/catalog-revision-moves-sha.txt` (a description-only edit moved
  `catalogRevision` and so the sha).
- `-y` and `--accept-command` conflict (`error: option '--accept-command <sha256>' cannot be used with option '-y, --yes'`).
- **Surprise 1: stdout is not one JSON line.** The human lines (the command, "Not an interactive terminal…") go to
  **stdout** ahead of the JSON line, and the message goes to stderr too. Parse the **last** stdout line that parses as JSON.
- **Surprise 2: the launching environment matters.** From the agent's Bash tool the CLI answered "`--accept-command is
  ignored inside a Claude Code session: run this in your own terminal`" even with `acceptCommandMatched: true`. From a
  mod's `$.process.run` child it **worked** (`outcome: ok`, the command ran exactly once, after acceptance), both in an
  interactive session and in an SDK-style `stream-json` session (`rerun-2026-10-07/sdk.log`). The review (M9) inferred
  that SDK hosts would be refused because the first `-p`/SDK children carried `CLAUDECODE`; the rerun shows that was a
  confound: those runs were launched from the agent's shell, which carries `CLAUDECODE`, and `$.process.run` children
  inherit the session's environment. Launched from a clean shell, the SDK child has no `CLAUDECODE` and acceptance
  works. modmgr still maps the "ignored" refusal to `rejected` (a Claude Code started from inside another one's tool).
- A command-sourced install records a content-hashed version: `0.1.0-585e53f58487`.

**Impact.** The §2.3 install review stands. `cli-results.ts` takes the last JSON line of stdout. A new error sentence
for "acceptance refused in this context". F25–F27.

## S6: detector latency (answered)

**Method.** `s6/probe-latency.mjs` over the live catalogue (`list --json --available` on an isolated config with
`claude-plugins-official`): 50 random remote entries, concurrency 6, `hooks/hooks.json` at `<sha>/<path>`, then
`.claude-plugin/plugin.json` on 404. Two seeds. Node `fetch` from this machine (Europe); `$.http.fetch` adds a host hop.

**Raw output.** `s6/run-seed1.json`, `s6/run-seed7.json`.

| run | wall | p50 per entry | p95 | max | mod | hooks | plain | unknown |
|---|---|---|---|---|---|---|---|---|
| seed 1 | 4.1 s | 505 ms | 581 ms | 712 ms | 2 | 7 | 41 | 0 |
| seed 7 | 3.9 s | 473 ms | 569 ms | 629 ms | 0 | 9 | 39 | 2 |

Catalogue counts: `s6/catalogue-summary.json`.

**Answers.** About 12 entries/s at concurrency 6, so the 600-probe session budget is ≈ 50 s of idle time and full
coverage of 3,545 entries ≈ 5 min across sessions. Most entries cost two requests (404 then `plugin.json`). 2 of 100
sampled entries had a 404 on both files (no manifest at the root): `unknown`, as planned. **Mods already exist in the
official catalogue** (2 in the first sample), so F15's "no mods yet" is stale. Catalogue today: 3,545 entries,
2.10 MB, 2,568 `url`, 924 `git-subdir`, 53 relative, 3,071 with `version`, 3,492 with a sha.

**Impact.** No design change; numbers updated (F28).

## S8: `$.command.run({ command: 'reload-plugins' })` from four places (answered; raw rerun in `rerun-2026-10-07/`)

**Method.** `probe/` calls it from (a) a pane Button's `onPress`, (b) a `command.run` hook (awaited and unawaited),
(c) a `$.clock.after` callback, (d) `claude -p "/probe reload-cmd"`. Logs in `s8-s9-s11-s12/`.

| from | result |
|---|---|
| (a) Button press handler | **resolves** `{ text: "Reloaded: 1 plugin · …" }` |
| (b) `command.run` hook, awaited or not | **rejects** at once: `HooksError: probe: command.run: called from a command.run hook, it would wait on the turn this hook is holding; answer { text } instead, or run it from a later event (turn.complete) (host check)` |
| (c) `$.clock.after` callback | **resolves**; the transcript shows a `/reload-plugins` row |
| (d) `claude -p` | **rejects** as (b) |

**Impact.** The job runner never runs inside a `command.run` hook: `/mods` (UI) opens the pane and returns; jobs and
the reload run from press handlers or `$.clock.after(0, …)`. Non-UI `/mods` never reloads (as planned). F29.

## S9: what survives `/reload-plugins` for modmgr itself (answered, and it changes F19; raw rerun in `rerun-2026-10-07/`)

The first run's interactive log was overwritten (its lines are transcribed in `s8-s9-s11-s12/interactive-plugin-dir.log`),
and the review (M6) rightly noted the `/probe` answers were never logged. The rerun logs every answer
(`rerun-2026-10-07/installed.log`, `transcript-full.txt`): three unchanged `/reload-plugins` kept `gen=4uailj`; editing
the folder-marketplace copy then reloading gave `gen=tmiv49` with the folder "re-read" line (which explains the earlier
unexplained re-registration: the probe folder had been edited to add `exec`); with the pane open, a button-pressed reload
after an edit gave `gen=f3vge6`, `starts=3`, `$.ui.panes()` listing the pane, and the pane redrawn by the new module
(`pane-after.txt`). The old module's press handler finished *after* the new module's `session.start` and its `$` calls
still worked (F39).

**F38, found in the rerun: a reload right after a CLI write reads stale settings.** `settle.log`: `enable`/`disable`
followed by `/reload-plugins` within 0–0.5 s applied nothing (5 of 5 trials); after ≥ 1 s it applied every time
(4 of 4). The CLI's settings write reaches the session through a watcher, so the batch's reload must wait for it.

**Method.** The probe with an open pane, then (1) `/reload-plugins` with nothing changed, (2) an edit of its module
(hot reload of a watched `--plugin-dir`), (3) as an installed folder-marketplace plugin: `/reload-plugins` unchanged,
after a CLI install of another plugin, and after a CLI disable.

**Answers.**
- `/reload-plugins` **does not re-register an unchanged module**, installed or `--plugin-dir`: the probe's module-level
  generation id stayed the same across three reloads. It re-reads what changed: a CLI-installed plugin became active
  ("Reloaded: 2 plugins", `/aaa` answered) and a CLI-disabled one went away ("Unknown command: /aaa"), while the probe
  kept running untouched. This confirms F6.
- When the module **is** reloaded (its files changed: hot reload, or an update of modmgr itself): `register` runs again,
  **`session.start` fires again** (so it must be idempotent), `$.state` is intact (`starts` went 1 → 2), and **an open
  pane stays open and is redrawn by the new module**; `$.ui.panes()` at the new `session.start` lists it.

**Impact.** F19 is narrowed: modmgr is reloaded only when its own files change (an update of modmgr, or dev
hot-reload). The `$.state` job queue and resume-on-register stay (they cover modmgr updating itself), but a batch's
closing reload no longer kills the runner. F30, F31.

## S10: a `types` contract with only `PluginState` (answered: yes)

`claude plugin validate --strict --json plugin` passes. Notes: "`types ./types/index.d.ts declares on $: nothing (no
EngineInterface member)`" and "`declares state: modmgr.mods, …`". The validator holds every `$.state` key the module
names to that contract. No change.

## S11: `$` on hosted sessions (partly answered)

**Method.** The probe in an SDK-hosted session (`claude -p --input-format stream-json --output-format stream-json`,
which is how the desktop app and SDK hosts run the engine), interactive terminal, and `-p`.

**Answers.**
- `$.process.run` works in all three: the engine is always the CLI on the host ("CLI only" in the d.ts means the
  engine, not the surface). `surfaces` is `[]` headless and `["terminal"]` interactive.
- **`'process' in $` cannot be used to feature-detect:** `claude plugin validate` refuses it ("`$ itself is used in a
  BinaryExpression`"), and `typeof $.process` too ("`$.process is used as a value`"). Detection is by calling
  (`$.process.run(['claude', '--version'])`) and catching.
- Not tested: the desktop app's GUI and the VS Code panel (they need settings changes in the real config to load a
  `--plugin-dir`-style mod). The design keeps the try-and-degrade probe.

**Impact.** `capability-probe` calls and catches. F32.

## S12: baselines (answered)

- `list --data-size --json` adds **`dataDirSize: { bytes, human }`** (`s8-s9-s11-s12/list-data-size.json`) only to plugins whose data directory exists
  (`$CLAUDE_CONFIG_DIR/plugins/data/<name>-<marketplace>`); others have no field. `list --json` entries for
  `@skills-dir` have no `installedAt`, `lastUpdated` or `projectEnabled`.
- `CLAUDE_CODE_PLUGIN_DIRS` folders appear in a child's `list --json` as **`<name>@inline` with `scope: "session"`**
  (the env var is inherited). **`--plugin-dir` folders do not appear** in a child's `list --json` (the flag is not
  inherited), and no `$` noun lists the session's loaded plugins (`$.command.list()` only names plugins that registered
  commands). So `--plugin-dir` mods are invisible to modmgr except through their commands.
- The debug log is written **only with `--debug`** (or `--debug-file`): `$CLAUDE_CONFIG_DIR/debug/<sessionId>.txt`
  plus a `latest` symlink. Lines are `<ISO time> [DEBUG|WARN|…] <text>`. A failed hook logs
  `[WARN] hook failed closed: <plugin>: errorKind=Error errorChars=24 (command.run; its .catch answered)`: the error's
  **length, not its text**. A load logs `hooks module <name>@inline loaded (worker, environment 1, tier user); events: …`
  and `plugin.register: <name> (user, <provenance>), judged by core alone: admitted`.
- A headless `-p` command's text is prefixed with the plugin name (`probe: …`).

**Impact.** Dev shows `--plugin-dir` mods only by inference (commands whose plugin isn't installed). The
"last logged reason" pointer is reduced to "run with `--debug`" plus, when `latest` exists, the last
`hook failed closed: <plugin>` line with its event. F33–F35.

## Validator call-site rules (found in M0, not a planned spike)

While writing the probe, `claude plugin validate` refused forms the architecture relied on. Tested one by one in a
scratch mod:

| form | result |
|---|---|
| `helper($, …)` where `helper` is declared in the **same file** | ok; notes say `calls: $.ui.log (via helper)` |
| `helper($, …)` where `helper` is **imported** (named or namespace import) | **refused**: "`$ is followed only into a function declared in this same file, never across an import`" |
| `new S($)`, storing `$` in an object, `'x' in $`, `typeof $.x`, `const p = $.process` | **refused** |
| a closure created in a hook (`wake = () => drain($)`), stored in module scope and called later | ok |
| a ports object built in the hook's file (`{ run: argv => $.process.run(argv) }`) passed to an imported function | ok; notes say `calls: $.process.run (via portsOf)` |
| passing `on` to an imported `registerX(on)` that registers its own hooks | ok |
| the same event hooked twice without a matcher (across files) | **refused**: "`on("session.start") is registered twice without a matcher`" |
| `update($, atom, fn)` / `read($, atom)` from `claude-code` | ok |

**Impact.** `$` never crosses a file boundary. See PLAN.md "Changes during build" C2. F36, F37.

## S7: gate visibility across load sources (answered: PLAN F17, F18)

- `inline-a/` (`--plugin-dir`), `env-b/` (`CLAUDE_CODE_PLUGIN_DIRS`), `skills-c/` (`$CLAUDE_CONFIG_DIR/skills/skills-c`).
- With `zzz-gate@spikemkt` installed first in `enabledPlugins` and refusing everything but itself, the gate saw and refused `mmm-mod`, `aaa-mod` and `skills-c@skills-dir`. It never saw `inline-a` or `env-b`, which loaded.
- `claude plugin disable skills-c@skills-dir --json` works (`enabledPlugins["skills-c@skills-dir"] = false`).
- Conclusion: v1 toggles everything through the CLI and has no gate.

## S3: update detection (answered: PLAN §2.6)
Folder marketplaces: `version` vs `folderVersion` in `list --json`, though these have no updates as such since they're read from the folder. Others: run `marketplace update`, then compare with the catalogue entry's `version`.
