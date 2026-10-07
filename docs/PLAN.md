# modmgr: plan (v1, revision 2)

A Claude Code **mod** manager: discover, install, inspect, toggle, update and debug **mods**, the function-hook plugins that run inside a Claude Code session. It's the Claude Code counterpart to [pi-extmgr](https://github.com/ayagmar/pi-extmgr).

- Plugin `modmgr`, command `/mods`, repo `ayagmar/modmgr`, marketplace `modmgr`, so the id is `modmgr@modmgr`.
- Install line (README, landing page): `/plugin install modmgr --marketplace ayagmar/modmgr`
- Scope: **mods only**. Generic plugin management stays with `/plugin`. modmgr shows every plugin that ships a hooks module, including mixed plugins, and says when a plugin carries more than a mod.
- Built against Claude Code **2.1.292** (planned on 2.1.291; see "Changes during build" C1). The function-hooks API is early access, so all `$` access is isolated (§3).
- Revision 2 folds in the Fable 5.1 review (`docs/reviews/2026-10-06-fable-5.1-plan-review.md`, findings referenced as R1–R25) and spike S7.

### What changed since revision 1
- **No `plugin.register` gate in v1** (S7, R1, R10). Every mod a gate could see can be toggled through the CLI; every mod it can't see is controlled by how the session is launched. That removes the load-first fix and modmgr's only direct settings write.
- **`/mods` is a dialog, not a sidebar** (R7). Background state goes to the band, the status line and the pane title.
- **The catalogue is never persisted**, and `$.state` holds only the visible page (R2, R11).
- **The risk score is replaced by capability facts and "notable" combinations** (R4).
- **Conflicts are cut to chain-order notes for two events** (R5). **Runtime-failure health is scoped to dev mods** (R6).
- **The job queue lives in `$.state` and survives `/reload-plugins`**, which reloads modmgr itself (R3).
- **Two test runners** (R9). The keymap, glyphs and theme keys are fixed (R17, R18). Milestones are re-cut (R24).

---

## 1. Verified facts (2.1.291, run on this machine)

Spike scripts and outputs live in `docs/spikes/`. The engine types are vendored at `vendor/claude-code-types/2.1.291/` (`claude-code.d.ts`, `reference.md`, `examples/`). Line numbers below refer to that `.d.ts`.

| # | Fact | Evidence |
|---|---|---|
| F1 | A `plugin.register` hook can refuse a module with `{ refuse }`: no hooks, tools or commands from it load. | spike `gate` refused `aaa-mod` |
| F2 | A gate only judges modules admitted **after** it. | `--plugin-dir` order swap |
| F3 | Installed plugins load in **`enabledPlugins` key order** (≈ install order); `disable/enable` keep the key in place. | isolated `CLAUDE_CONFIG_DIR` |
| F4 | `plugin.register` input: `name, tier, root, version, provenance (<n>@<mkt> \| @inline \| @skills-dir \| @builtin), uses {events, calls, env?, state?}`. | `gate-seen.txt` |
| F5 | `claude plugin validate --json <root>` gives a mod's hooks and calls statically (`contents[].notes`: `"<module> hooks: …"`, `"<module> calls: $.x.y, …"`; `gatingHooks[]`) in about 0.5 s. | `validate-json-sample.json` |
| F6 | A `claude plugin install/update/enable/disable` **child process does not change the running session**. The session picks changes up through `/reload-plugins` (reference §Developing one). "Plugin is now active" applies only to the in-session `/plugin install` flow. (corrected per R3) | reference |
| F7 | `reload-plugins` and `reload-skills` are in `$.command.list()`. `$.command.run` queues until the session is idle and **rejects inside a hook the turn is waiting on** (d.ts 2999–3003). | `gate-start.txt` |
| F8 | `install/update/uninstall/enable/disable --json` print one result line `{command, outcome, plugin, pluginId, scope, message, …}`; `update` adds `updateOutcome, oldVersion, newVersion`. `list --json [--available] [--data-size]`, `validate --json [--strict]`, `marketplace list --json`. | runs |
| F9 | `claude plugin details` shows "Hooks (0)" for a mod. Use it only for token cost and the skills/agents/MCP inventory. | run |
| F10 | `list --json` per plugin: `id, version, scope, enabled, installPath, readFromFolder?, folderVersion?, installedAt, lastUpdated, projectEnabled`. `list --available` returns `{installed, available}`, and `available` **excludes installed** plugins; its entries have `pluginId, name, description, marketplaceName, source, installCount, version?`. | runs |
| F11 | An install can need acceptance of a **marketplace-declared command** (`--accept-command <sha256>`, bound to that command, plugin and catalogue; a refreshed catalogue invalidates it) and of a `headersHelper` command. npm sources exist (`--registry`). | `install --help` |
| F12 | Button `hotkey` is one digit or one lowercase letter; Shift+w is `w`; "two clash, later wins". A bare digit in an empty composer presses a **band** Button. | d.ts 1031–1037 |
| F13 | `Color = ThemeKey \| string`. The ThemeKeys have no `accent`/`muted`: use `claude`/`permission` and `subtle`/`inactive`, plus `success`/`warning`/`error`. | d.ts 12255 |
| F14 | A gating hook without `.catch` makes the validator warn. | validate |
| F15 | Catalogue today: **3,544** entries, **2.09 MB** JSON, `list --available` **0.97 s**, `list --json` 0.56 s. 3,491 entries have a GitHub `sha` (2,568 `url` whole-repo `.git`; 923 `git-subdir` with `path, ref, sha`); 53 are relative-path local; 3,070 carry `version`. No mods in the official marketplace yet. | R-table |
| F16 | `$.store` holds at most **4 MiB of JSON in all**; `set` rejects past it, and each `set` rewrites the file. | d.ts 3296 |
| F17 | **S7:** an installed plugin's gate sees installed and `@skills-dir` modules (it refused a skills-dir mod). It **never** sees `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` modules, which load first. | spikes `inline-a`, `env-b`, `skills-c` |
| F18 | `claude plugin disable/enable <name>@skills-dir --json` works and persists in `enabledPlugins`. | run |
| F19 | A reload of modmgr re-runs `register`, drops its timers (`$.clock`) and kills its `$.process.spawn` loops. **`$.state` survives**, and so does `$.store`. A plugin that hooks `plugin.register` makes **every** module reload with it. | reference, d.ts 3310, 3355, 3453, 4178 |
| F20 | The dim "`<plugin>: … failed/refused`" transcript lines appear only while a session hot-reloads a plugin folder; otherwise they go to the debug log alone. So **runtime failures of installed mods aren't observable** (S4 closed). | reference |
| F21 | `$.ui.panes()` lists only this plugin's panes. `uses.events` carries event names, not matchers. | d.ts 2448, 7486 |
| F22 | Pane: `PaneOpenArgs {id, title, focus, closeOnEscape, holdToasts, rows, columns}`. `holdToasts` is for a dialog the person answers and leaves. `closeOnEscape` also closes on Esc at an idle empty prompt. `focus` is refused while the composer has text. `columns` is a request. A docked pane gets its share (~40–70 cells); inline gets a third of the rows. Window rows with `e.props.scroll.bodyRows`, not `viewport.rows`. Re-opening an open id retitles it. Esc raises `ui.close` (`origin.kind: 'person'`), and a hook can keep the pane open. | d.ts 7111–7218, 9992–10016, 2414 |
| F23 | `$.process` is documented "CLI only". | d.ts 3425 |
| F24 | `claude plugin test` runs in the hooks environment: no Node, fs, network, process or coverage. Only `.ts/.tsx/.js/…` files load (no `.json` imports). The test `on` sits beneath the plugin, so a test can answer `process.run`. `mock` has clock, store and env. `ui.mount … press({key})` acts by element key and never paints. | d.ts header, 6917, 14478, 14983, 15118 |
| F25 | **S2:** a declared command makes `install --json` fail with `failureCode: command_source_refused` and `shownCommand: { kind: 'command_source', pluginId, command, mode, catalogRevision, sha256 }` (`kind: 'entry_helper'` with `archiveUrl` for a `headersHelper`); with `--accept-command` it adds `acceptCommandMatched`. Nothing runs before acceptance. The sha changes on **any** catalogue revision (a description edit plus `marketplace update` was enough). `-y` and `--accept-command` conflict. | `docs/spikes/s2/` |
| F26 | `install --json` prints **human lines on stdout before the JSON line** (and the message on stderr). The result is the last stdout line that parses as JSON. | `s2/install-no-accept.stdout.txt` |
| F27 | `--accept-command` **works from a mod's `$.process.run`** child of an interactive session (installed, command ran once). From the agent's Bash tool the CLI answers "`--accept-command is ignored inside a Claude Code session`". | `s2/install-accept-from-mod-process-run.log` |
| F28 | **S6:** detector p50 ≈ 490 ms, p95 ≈ 575 ms per entry (usually two requests), ≈ 12 entries/s at concurrency 6: the 600-probe budget is ≈ 50 s idle. Catalogue: 3,545 entries, 2.10 MB, 3,071 with `version`, 3,492 with a sha. **Mods already exist in the official catalogue** (2 of 100 sampled). | `docs/spikes/s6/` |
| F29 | **S8:** `$.command.run({command:'reload-plugins'})` resolves from a Button `onPress` and a `$.clock.after` callback; it **rejects at once** from any `command.run` hook (awaited or not, interactive or `-p`): "called from a command.run hook, it would wait on the turn this hook is holding". | `s8-s9-s11-s12/` |
| F30 | **S9:** `/reload-plugins` re-reads what changed (a CLI install becomes active, a CLI disable goes away) and **does not re-register an unchanged module**, installed or `--plugin-dir`. | `interactive-installed.log` |
| F31 | When modmgr's module **is** reloaded (its files changed): `register` and **`session.start` run again**, `$.state` is intact, and an **open pane stays open and is redrawn by the new module** (`$.ui.panes()` lists it). | `interactive-plugin-dir.log` |
| F32 | **S11:** `$.process.run` works interactive, under `-p` and in an SDK host (`--input-format stream-json`, how the desktop app runs the engine). Feature detection can't use `'process' in $` or `typeof $.process` (the validator refuses both); detect by calling and catching. GUI hosts not tested. | `sdk-stream-json.log` |
| F33 | **S12:** `list --data-size --json` adds `dataDirSize: { bytes, human }` only where `plugins/data/<name>-<marketplace>` exists. `@skills-dir` entries lack `installedAt`, `lastUpdated`, `projectEnabled`. | run |
| F34 | `CLAUDE_CODE_PLUGIN_DIRS` folders show in a child `list --json` as `<name>@inline`, `scope: "session"`. **`--plugin-dir` folders don't** (not inherited), and no `$` noun lists loaded plugins; `$.command.list()` names only plugins that registered commands. | `headless-p.log` |
| F35 | The debug log exists **only with `--debug`**: `$CLAUDE_CONFIG_DIR/debug/<sessionId>.txt` + `latest` symlink, lines `<ISO> [LEVEL] <text>`. A failed hook logs `hook failed closed: <plugin>: errorKind=… errorChars=n (<event>; …)`: the error's length, not its text. | debug log |
| F36 | **Validator call-site rule:** `$` is spelled `$.noun.method(…)` at the call site. It may be passed to a function **declared in the same file**, never across an import; it can't be stored, spread, `in`-tested or read as a value. Closures over `$` created in a hook (a ports object, a stored wake-up callback) may be passed anywhere. `on` may be passed to imported registrars. | `spikes/README.md` §Validator |
| F37 | One module may hook an event only **once without a matcher** (across all its files). | same |

### M0 spikes (answered 2026-10-07 on 2.1.292; write-ups in `docs/spikes/README.md`)

- **S2** `--accept-command`: F25–F27. **S6** detector latency: F28. **S8** reload from a mod: F29. **S9** reload survival: F30, F31.
- **S10** a `PluginState`-only `types` contract passes `validate --strict` (with a note "declares on $: nothing"). **S11** hosted `$`: F32.
- **S12** baselines: F33–F35. Found on the way: the validator's call-site rules, F36, F37.
- F15's "No mods in the official marketplace yet" and F19's "A reload of modmgr re-runs `register`" are superseded by F28 and F30/F31.

---

## 2. Product design

### 2.1 Toggling
| Mod origin | On/off | Applies |
|---|---|---|
| Marketplace (`<n>@<mkt>`), user/project/local scope | `claude plugin disable/enable <id> --scope <scope> --json` | after `/reload-plugins` (modmgr queues it; §2.8) |
| Skills dir (`<n>@skills-dir`) | same CLI (F18) | same |
| Managed scope | not toggleable: lock glyph, "managed by your organisation" | — |
| `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, session dev-mods | **not toggleable** from inside a session (F17). The row says how it was loaded and how to stop loading it ("remove `--plugin-dir …` from your launch command" / "unset `CLAUDE_CODE_PLUGIN_DIRS` entry"). | next launch |

- `projectEnabled` is shown: "off in this project".
- **Mixed plugins:** the confirm says "also disables 3 skills, 1 MCP server" (counts from `details`).
- **Project/local scope:** the confirm says "this changes `.claude/settings.json` in this repository"; the CLI runs with `cwd: await $.session.root()` (R22).
- Toggles are **staged** and applied as one batch, followed by one reload. `z` undoes the last batch (it replays the inverse CLI calls).
- *Deferred to v2:* a `plugin.register` gate for "quarantine" policies (for example, "refuse new mods that call `process.*` until approved"). It would make every module reload with modmgr (F19) and only sees modules after it (F2), so it needs its own design.

### 2.2 Capabilities (trust view)
Source: `validate --json` on the mod's root, cached by `root@version` (F5). No load-order dependence.

Capabilities are shown as **facts**, grouped by **reach**, with one plain-English line per call. The explanations are generated at build time from the d.ts doc comment for each `noun.method` and kept in `domain/explanations.ts`.

| Reach | Calls / events |
|---|---|
| **Your machine** | `process.run`, `process.spawn`, `fs.write`, `env.set` |
| **Network** | `http.fetch`, `mcp.call` (uses the session's MCP credentials, no prompt) |
| **Session content** | `session.messages`, `settings.read` (every key, unfiltered), `env.get` (names listed: flag `*KEY*`, `*TOKEN*`, `*SECRET*`), `prompt.read`, `ui.selection` |
| **What the model sees** | events `prompt.submit`, `prompt.compose`, `prompt.context`, `session.append`, `tool.describe`; call `prompt.fill`, `session.append` |
| **Tools and turns** | event `tool.call`, `tool.check`; calls `tool.register`, `agent.spawn`, `model.complete`, `model.fork` (cost money), `command.run` |
| **Other plugins** | event `plugin.register`, `engine.create`, `classic.*` |
| **Display only** | `ui.*`, `state.*`, `store.*`, `clock.*`, `audio.*`, `command.register` |

**Notable** (a short list shown at the top of the detail and in the install review; computed in `domain/capabilities.ts` from combinations):
- "Can run programs on your machine": any of machine reach.
- "Can read your conversation **and** send data out": session content plus network.
- "Reads environment variables that look like secrets": `env.get` names matching the patterns.
- "Can change what the model reads": what-the-model-sees events.
- "Judges other plugins": `plugin.register` / `engine.create`.
- "Starts model calls (costs tokens)": `model.*`, `agent.spawn`.

**Capability diff:** after every update (all sources), compare the old and new capability sets. New *notable* items show in the band and in Health ("turn-band 0.4 can now run programs"), with `[x remove]` and `[z undo]` (reinstall the previous version where the source pins it). Pre-update diffs are a v1.1 item (R15: fetch `hooks.json` + modules at the new sha, write a temp copy with `$.fs.write`, run `validate`).

### 2.3 Discover
- Data: `list --json --available` (F10, F15). It's **never persisted**. Loaded into **module memory** at first open of Discover (≈ 1 s, a skeleton shown) and refreshed at most every 6 h in-session.
- **Search index** in module memory: per entry, a lowercased `name + ' ' + description` and a precomputed sort key. `$.state` gets only the **visible page** (≤ 50 rows) plus counts (R11).
- **Mod detector** (`kind: mod | hooks | plain | unknown`):
  1. Local relative sources: read `hooks/hooks.json` and `.claude-plugin/plugin.json` (its `hooks` field) via `$.fs`.
  2. GitHub sources: `url` → `<owner>/<repo>` from the `.git` URL, files at the repo root; `git-subdir` → `path` (each segment `encodeURIComponent`'d; reject `..`, absolute and empty segments). Fetch `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/hooks/hooks.json`; on 404, fetch `.claude-plugin/plugin.json` to check its `hooks` field before concluding `plain` (R14).
  3. Anything else: `unknown`, and resolved after install via `validate`.
  - Cache: `$.store` `detect` holds `{ [pluginId]: [sha, kind] }`, compact, LRU-capped at 6,000, written in **batches of 50** (R2). Concurrency 6, backoff on 429/5xx, budget 600 probes per session, idle-only (paused while a turn runs), off when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set or `userConfig.detectRemote = false`. Full first coverage takes several sessions; the UI shows `mods found: 12 · checked 1,804/3,544`.
- Filters: `mods` (default) · `hooks` · `all`. Sorts: installs · name · marketplace. The search filters as you type.
- **Install flow:** Enter on a row → detail → `i` → **review screen**: notable capabilities (when known), scope `Select` (user · project · local), any declared command or `headersHelper` **verbatim** with its sha → `y`. Just before the install runs, modmgr runs `install --json` without acceptance again and compares the sha; on a mismatch it shows the new text and asks again (R12). It never passes `-y`. While a review is open, background catalogue refreshes are paused.
- Empty state: "No mods found in your marketplaces yet. `[k show plugins with hooks]` `[m add a marketplace]`" (the latter prompts for a source and runs `claude plugin marketplace add`).

### 2.4 Dev
Sources: `~/.claude/dev-mods/*/*`, `CLAUDE_CODE_PLUGIN_DIRS` (via `$.env.get('CLAUDE_CODE_PLUGIN_DIRS')`), `--plugin-dir` folders, which appear in `list --json` as `@inline` (check in S12; otherwise discovered through `readFromFolder`), `@skills-dir` mods, and folder-marketplace installs (`readFromFolder`).
- A row shows the path, how it's loaded, last validate (✓ / ✗ n errors, warnings), and last test result.
- Actions: `v` validate (`validate --json --strict`), `t` test (`claude plugin test <dir>`, streamed into the job log), `l` reload plugins, `c` copy path, `p` share (copies the install line and shows the `marketplace.json` snippet from reference §Sharing a mod).
- Runtime failures (F20): available **here only** for hot-reloaded folders, by observing `session.append` rows with `door: 'notice'` whose text starts with `<plugin>:`. Count, last reason, last seen.

### 2.5 Health
- **Load state** for each mod: enabled, disabled, off in this project, managed, or loaded from the launch command.
- **Validate errors** for every installed or dev mod.
- **Capability changes since the last update** (§2.2).
- **Chain-order notes** (R5): when two or more enabled mods hook `prompt.compose` or `session.append`, list them in load order ("A then B rewrite what the model reads"). Informational.
- **Last logged reason** (best-effort, S12): for a mod that's enabled but looks inactive, show how to run with `--debug` and, if S12 finds the log, the last `<plugin>:` line.
- Each item has a one-press fix where one exists (disable, update, remove, copy command).

### 2.6 Updates
- Every `userConfig.updateCheckHours` hours (default 6; `0` = off; off under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`): run `claude plugin marketplace update` (a network fetch; the FAQ says so), then compare each installed mod's `version` with its catalogue entry's `version` (3,070/3,544 carry one). Folder-marketplace mods have no updates (they read from the folder).
- Results go to the band, the status line (`mods: 2 updates`) and the pane title (`mods · 2 updates`, F22).
- `u` updates one, `a` updates all. Updates run serially through the job queue, followed by one reload, then the capability diff.

### 2.7 Non-UI `/mods`
`/mods list | info <id> | install <id> [--scope s] | remove <id> | update [id] | enable <id> | disable <id> | doctor [--json] | export | apply <file>`.
- Write subcommands need `--yes`. A declared install command also needs `--accept-command <sha>`, and modmgr refuses if it doesn't match.
- They return `{ text }` and set a non-zero `exitCode` on failure. They **never** try to reload (S8); they end with "run /reload-plugins (or restart) to apply".
- `export` prints `{ mods: [{ id, scope, version }] }`; `apply <file>` installs and enables what's missing, going through the same confirms (pi-extmgr "profiles", minimal).

### 2.8 Jobs and reload
- Every mutation is a `Job` in **`$.state` `jobs`** (survives reloads, F19). A module-level runner picks up `queued` jobs. On `register`, a job left `running` by a previous module is marked `interrupted`, with `[retry]`.
- Jobs run one at a time. A batch ends with a single `reload` job, which **only runs when no other job is queued or running**. It calls `$.command.run({ command: 'reload-plugins' })`; if that rejects (S8), the band shows `[l reload]` and "or restart".
- `claude plugin test` and other streamed jobs keep only the last 20 lines (`tail`). Progress writes to `$.state` are throttled to 10/s.

---

## 3. Architecture

```
modmgr/                                   repo root = marketplace
├─ .claude-plugin/marketplace.json        { name: "modmgr", owner, plugins: [{ name: "modmgr", source: "./plugin", version }] }
├─ plugin/                                ← the shipped plugin. No package.json here.
│  ├─ .claude-plugin/plugin.json          name, version, description, author, homepage, repository, license, keywords,
│  │                                      types (if S10 passes), userConfig { updateCheckHours, detectRemote }
│  ├─ hooks/hooks.json                    { "modules": ["./register.tsx"] }
│  ├─ hooks/register.tsx                  wiring only
│  ├─ hooks/domain/        PURE TS. No `$`, no `claude-code` imports, no I/O. Runs under Node (vitest) AND the engine.
│  │   ids.ts               PluginId/scope/path validation (strict regexes, absolute paths, no leading '-', no NUL/newline)
│  │   sanitize.ts          strip C0/C1, ANSI escapes, bidi controls (U+202A–202E, U+2066–2069); length caps
│  │   validate-report.ts   parse `validate --json` → Capabilities
│  │   capabilities.ts      reach grouping, notable combos, diff
│  │   explanations.ts      generated: noun.method → one line (scripts/gen-explanations.ts reads the vendored d.ts)
│  │   catalog.ts           normalise `list --available`, index, search, sort, paginate
│  │   detector.ts          source → probe plan (local | raw URLs | unknown); hooks.json/plugin.json → kind
│  │   chain.ts             chain-order notes
│  │   cli-results.ts       parse every CLI `--json` shape → Result<T, CliError>
│  │   jobs.ts              pure job-queue reducer (enqueue, start, finish, interrupt, batch→reload rule)
│  │   keymap.ts            per-view hotkey table + collision check
│  │   result.ts            Result/Err types, error kinds → human sentences
│  ├─ hooks/services/      the ONLY code that calls `$` besides ui/ reading state
│  │   cli.ts               argv builder from domain/ids only; `$.process.run/spawn`; timeouts; signal; JSON parse via domain
│  │   store.ts             typed, versioned `$.store` with migrations, size guard (< 3 MiB, evict LRU), batched writes
│  │   registry.ts          installed (list --json) + validate cache + dev sources → Mod[] in $.state
│  │   catalog-service.ts   module-memory index, page projection into $.state
│  │   detector-runner.ts   bounded concurrency, budget, backoff, idle-only, batched store writes
│  │   job-runner.ts        drives domain/jobs.ts against $.state; reload rule; resume on register
│  │   updates.ts           scheduler ($.clock.every), re-armed on every register
│  │   capability-probe.ts  feature-detect `$` nouns (S11) → degraded modes
│  │   dev-watch.ts         session.append notice observer (dev folders only)
│  ├─ hooks/ui/
│  │   Pane.tsx            shell: title/tabs, stacked|split, footer hints, overlays, ui.close interception
│  │   views/Installed.tsx Discover.tsx Dev.tsx Health.tsx
│  │   Detail.tsx  Review.tsx (install/remove/toggle confirm)  Help.tsx  JobLog.tsx  FirstRun.tsx
│  │   Band.tsx
│  │   kit/                Row (plain Button), Chip, Section, Empty, Pager, KeyHint
│  │   theme.ts            ThemeKey map: accent→'claude', muted→'subtle', ok→'success', warn→'warning', bad→'error'
│  ├─ hooks/commands.ts    /mods subcommands; shares services with the UI
│  ├─ types/index.d.ts     PluginState contract
│  └─ tests/               *.test.ts(x) for `claude plugin test` (services + ui)
├─ test/domain/            *.test.ts for vitest (domain only) + fixtures/*.ts (captured CLI JSON as TS modules)
├─ scripts/                gen-explanations.ts, update-types.sh, capture-fixtures.sh, render-demo.ts
├─ site/                   landing page (§8)
├─ vendor/claude-code-types/2.1.291/
├─ docs/  PLAN.md  ARCHITECTURE.md  SECURITY.md  PERF.md  spikes/  reviews/
├─ .github/workflows/      ci.yml  pages.yml  release.yml
├─ package.json (root, dev tooling only)  pnpm-lock.yaml  biome.json  tsconfig.base.json  vitest.config.ts
├─ CHANGELOG.md  LICENSE (MIT)  README.md  CONTRIBUTING.md
```

**Layering** (enforced by a vitest test that parses imports):
- `domain/` imports only `domain/`.
- `services/` imports `domain/` and `claude-code` types.
- `ui/` imports `domain/` and state refs, and dispatches jobs. It never calls `$.process`, `$.http` or `$.fs`.

Errors: services return `Result<T, ModmgrError>` (`cli-failed | timeout | parse | network | rate-limited | rejected | unavailable | conflict | store-full`). The UI maps each kind to one sentence plus a next step. Nothing throws across a layer boundary. Every hook has a `.catch` that logs through `$.ui.log` and falls through to `next(e)`.

**tsconfig** for `plugin/`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `jsx: "react"`, `jsxFactory: "h"`, `jsxFragmentFactory: "Fragment"`, `types: []`, `lib: ["ES2023"]`. It includes the vendored d.ts in CI, or extends `plugin/.claude-plugin/types/tsconfig.json` locally when the engine has laid it (git-ignored).

---

## 4. State

### `$.state` (session-scoped, drives rendering, survives reloads): `types/index.d.ts`

```ts
export type PluginId = string                         // validated by domain/ids.ts
export type Scope = 'user' | 'project' | 'local' | 'managed'
export type Origin = 'marketplace' | 'skills-dir' | 'folder-marketplace' | 'plugin-dir' | 'env-dir' | 'dev-session'
export type Reach = 'machine' | 'network' | 'session' | 'model' | 'tools' | 'plugins' | 'display'
export type Capabilities = { events: string[]; calls: string[]; envReads: string[]; reach: Reach[]; notable: string[] }

export type ModRow = {                                // what lists render: small and flat
  id: PluginId; name: string; version?: string; origin: Origin; scope?: Scope
  enabled: boolean; projectEnabled?: boolean; toggleable: boolean
  notableCount: number; updateTo?: string; problems: number; mixed: boolean
}
export type ModDetail = ModRow & {
  description?: string; root?: string; caps?: Capabilities
  mixedCounts?: { skills: number; agents: number; mcp: number }; tokens?: number; dataBytes?: number
  validate?: { errors: number; warnings: number; at: number }
  capsAdded?: string[]                                // notable items added by the last update
  dev?: { failures: number; lastReason?: string; lastAt?: number; test?: 'pass' | 'fail' }
}
export type CatalogRow = { id: PluginId; name: string; marketplace: string; installs: number; kind: 'mod'|'hooks'|'plain'|'unknown'; blurb: string }
export type Job = {
  id: string; batch?: string
  kind: 'install'|'update'|'remove'|'enable'|'disable'|'validate'|'test'|'reload'|'marketplace-add'|'marketplace-update'
  target?: PluginId; args?: { scope?: Scope; acceptSha?: string }
  state: 'queued'|'running'|'ok'|'failed'|'cancelled'|'interrupted'
  startedAt?: number; endedAt?: number; tail: string[]; error?: { kind: string; message: string }
}
export type View = {
  tab: 'installed'|'discover'|'dev'|'health'; selected?: PluginId; layout: 'stacked'|'split'
  stack: Array<'detail'|'review'|'help'|'jobs'>     // overlays, top = last
  query: string; kind: 'mods'|'hooks'|'all'; sort: 'installs'|'name'|'marketplace'
  page: number; staged: Record<PluginId, boolean>
}

declare module 'claude-code' {
  interface PluginState {
    modmgr: {
      mods: ModRow[]                                  // ≤ ~200
      detail: ModDetail | null                        // the selected one only
      catalogPage: { rows: CatalogRow[]; total: number; matched: number; loading: boolean }
      detect: { checked: number; total: number; found: number; running: boolean }
      jobs: Job[]                                     // last 50; tails ≤ 20 lines
      view: View
      review: ReviewRequest | null                    // one confirm at a time (plain value, R19)
      attention: { updates: number; problems: number; reloadPending: boolean; capsChanged: number; dismissedAt?: number }
      degraded: { process: boolean; network: boolean; reason?: string }
    }
  }
}
```

### `$.store` (persists; versioned `{ v: 1, … }`; total budget **< 1 MiB**, hard guard at 3 MiB)

| key | content | cap |
|---|---|---|
| `prefs` | `{ tab, sort, kind, firstRunDone }` | tiny |
| `detect` | `{ [pluginId]: [sha, kind] }` | 6,000 entries LRU (≈ 300 KB) |
| `validate` | `{ [root@version]: { events, calls, envReads, errors, warnings } }` | 300 entries LRU |
| `capsHistory` | `{ [pluginId]: { version, notable[] } }` (for diffs) | per installed mod |
| `history` | last 50 finished jobs, without tails | 50 |

The catalogue is never stored. On `store-full`, Health shows "modmgr's cache is full; `[clear cache]`".

---

## 5. UX/UI

### 5.1 Principles
1. **Instant.** `/mods` paints from `$.state`. Stale data shows a quiet `↻` in the title, never a blank spinner. Discover's first load shows skeleton rows.
2. **Honest.** Every action says when it takes effect: *after reload (automatic)*, *next launch*, or *not possible here, and why*.
3. **Safe by default.** Code-running and destructive actions go through a review screen that shows exactly what will happen. Toggles are staged, with undo.
4. **Never colour alone.** Glyph + word + theme colour: `●` on, `○` off, `↑` update, `▲` problem, `◆` notable, `✓` / `✗`, `⊘` locked. No East-Asian-ambiguous glyphs (R18).
5. **One home.** `/mods` is a dialog you open, act in and leave. The band, status line and title point back to it.
6. **Keyboard-first, mouse-friendly.** Every row and action is a `Button`: rows are `plain` Buttons, so they take focus and Enter.

### 5.2 Opening and layout
- `/mods` → `$.ui.open({ id: 'modmgr', title, focus: true, closeOnEscape: true, holdToasts: true, rows })`. As a dialog, Tab and the arrows walk the Buttons (F22). If `focus` is refused (text in the composer), the footer says "ctrl+x tab to focus".
- **Stacked layout (primary, 40–99 body columns):** title/tabs, list, footer. Enter pushes the detail.
- **Split (≥ 100 body columns):** list 45 % | detail 55 %.
- Rows are windowed with `e.props.scroll.bodyRows`. A `Pager` shows `21–40 of 312` with `g` (first page) and `b` (last page).
- **Esc** (`ui.close` hook, origin `person`): first pops the top overlay, or clears a non-empty query; otherwise it lets the close through. It never denies on `unload` (R8).
- Mobile: read-only Installed and Detail. VS Code and desktop: full if S11 shows `$.process`; otherwise read-only with "managing mods needs the terminal CLI" (R13).

### 5.3 Views (stacked, 64 columns)

```
 mods · Installed 4 │ Discover │ Dev 2 │ Health ▲1         ↻
 filter: ___________________________   sort: name
 ● turn-band         0.3.1 ↑0.4.0   ◆1
 ● tool-calls        1.0.0
 ○ quiet-bash        0.2.0          off
 ● redactor          2.1.0 ▲        ◆2
 staged: 1 change    [s apply] [z undo]
 enter open · e toggle · u update · x remove · h help
```

Detail (pushed on Enter):
```
 turn-band 0.3.1 → 0.4.0            user · claude-plugins-official
 Shows last-turn duration above the prompt.
 Notable
  ◆ Can change what the model reads      (prompt.submit)
 Reach
   model     prompt.submit — runs before each prompt you send …
   display   ui.render ui.toast state.set
 Also contains: 2 skills     Cost ~120 tok/session     Data 12 KB
 [e disable] [u update] [x remove] [c copy id]
```

- **Discover** rows: `name · ★1.5k · marketplace · mod|hooks|?`. Title progress: `mods found 12 · checked 1,804/3,544`.
- **Review** screen (install / remove / toggle batch): what will run (the CLI command in words), scope, notable capabilities, declared commands verbatim, "takes effect after reload (automatic)", `[y confirm] [n cancel]`.
- **Dev**: sections *Session dev-mods · Plugin dirs · Skills dir · Folder marketplaces*.
- **Health**: grouped by mod, each with a fix button.
- **Job log** (`j`): running and recent jobs, the running one's tail, `[q cancel]`.
- **Help** (`h`): the keymap for the current view, generated from `domain/keymap.ts`.
- **First run**: one screen with three bullets ("see what each mod can do · find mods across your marketplaces · toggle and update safely") and `[enter start]`.
- **Empty states** for each tab, each with one next action.

### 5.4 Band (`AbovePrompt`)
- One line, shown only when `attention` has something actionable and it hasn't been dismissed since it last changed.
- `mods · 2 updates · 1 can now run programs · reload to apply   [m open] [l reload] [d dismiss]`. Letters only (F12).
- It returns `next(e)` while `e.props.hasSurvey` is set.

### 5.5 Keymap (one table in `domain/keymap.ts`; a vitest test asserts no collisions per view *including* overlays that can be mounted together)

| Key | Where | Action |
|---|---|---|
| `/mods` | prompt | open (dialog) |
| `1` `2` `3` `4` | pane | Installed · Discover · Dev · Health |
| `↑↓` `Tab` | pane | move focus (engine) |
| `enter` | row | open detail |
| `esc` | pane | pop overlay → clear filter → close |
| `f` | lists | focus filter |
| `o` | lists | cycle sort |
| `k` | Discover | cycle kind filter |
| `g` / `b` | lists | first / last page |
| `e` | Installed, Detail | stage toggle |
| `s` / `z` | Installed | apply staged / undo last batch |
| `u` / `a` | Installed, Detail | update / update all |
| `x` | Installed, Detail | remove |
| `i` | Discover detail | install |
| `m` | Discover empty, band | add marketplace / open modmgr |
| `v` / `t` | Dev | validate / test |
| `c` | Detail, Dev | copy id or path |
| `p` | Dev | share |
| `l` | Dev, band, Health | reload plugins |
| `r` | lists | refresh data |
| `j` | pane | job log |
| `q` | job log | cancel running job |
| `h` | pane | help |
| `y` / `n` | Review | confirm / cancel |
| `d` | band | dismiss |

### 5.6 Visual language
- Theme keys only (F13). One accent (`claude`) for focus, the primary action and notable chips. Metadata uses `dimColor`.
- Fixed column widths per layout; names use `wrap: 'truncate-end'`; versions right-aligned; nothing reflows while typing.
- All untrusted text (names, descriptions, validate messages, test output) goes through `domain/sanitize.ts` and renders as `Text`, never `Markdown`.

---

## 6. Performance budget

| Operation | Budget | How |
|---|---|---|
| `session.start` blocking | **< 5 ms** | `$.command.register` + read `prefs`; everything else via `$.clock.after(0…)` |
| `/mods` → first paint | **< 50 ms** | render from `$.state` (rows ≤ 200, detail only for the selected mod) |
| Row move / tab switch | **< 16 ms** | ≤ 3 small state reads per render; rows windowed |
| Filter keystroke over 3.5k entries | **< 16 ms** compute + one state write | module-memory index, single pass, page of ≤ 50 written once; input debounced 30 ms |
| Installed refresh | ≤ 1.5 s, background | `list --json` (0.56 s) + `validate --json` only for `root@version` cache misses, 3 concurrent |
| Catalogue load | ≤ 1.5 s, on first Discover open | `list --json --available` (0.97 s, 2.09 MB) + index build |
| Detector | ≤ 600 probes/session, idle only | 6 concurrent, batched store writes |
| Job progress | ≤ 10 state writes/s | throttled tail |
| `$.store` | < 1 MiB steady state | §4 caps + guard |

**Measuring** (M6, recorded in `docs/PERF.md`): `$.clock.now()` around render hooks and service steps, logged with `$.ui.log({to:'debug'})` behind `userConfig.debugTimings`; plus a 3.5k-entry synthetic catalogue benchmark in vitest for the domain index.

---

## 7. Security (detail in `docs/SECURITY.md`, written in M2)

- **Threat model:** a malicious catalogue entry (spoofed name, hostile text), a malicious mod (once installed it runs with session power: modmgr is a **lens, not a sandbox**), a compromised marketplace (a changed declared command), and modmgr's own bugs (it must not brick sessions).
- **Process:** argv arrays only, never a shell. Every id, scope and path comes from `domain/ids.ts` validators: ids `^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$`, scopes from an enum, paths absolute with no NUL, newline or leading `-`. Project/local scope runs with `cwd = $.session.root()`.
- **Declared commands:** shown verbatim with the sha, re-verified right before running (§2.3). Never `-y`. `headersHelper` is handled the same way.
- **Untrusted text:** sanitised (C0/C1, ANSI, bidi controls), length-capped, rendered as `Text`. Names are shown with their marketplace to reduce look-alike spoofing.
- **Network:** only `https://raw.githubusercontent.com/` (detector) and the CLI's own fetches. No auth headers. Response size is checked after the read (`$.http.fetch` reads the whole body). JSON is shape-checked. All of it is off under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- **No direct settings writes; no `plugin.register` hook** in v1.
- **No telemetry.** modmgr never calls `$.telemetry.*`. The FAQ is explicit that update checks fetch marketplaces.
- **Identity caveat:** `name`, `version` and `provenance` are the plugin's own word; modmgr keys everything by `pluginId` from the CLI, and SECURITY.md says so.

---

## 8. Landing page (`site/`)

- **Goal:** install in under 30 seconds; the entry point to the docs.
- **Stack:** Astro (static, zero JS by default), plain CSS with custom properties, self-hosted subset fonts (Inter, JetBrains Mono). Deployed to GitHub Pages at `ayagmar.github.io/modmgr` by `pages.yml`.
- **Sections:**
  1. Hero: pitch, install line with a copy button, and an HTML/CSS **terminal mock** of `/mods` cycling Installed → Discover → install review (CSS only, `prefers-reduced-motion` respected).
  2. Three "why" cards.
  3. Trust showcase: notable items and "turn-band 0.4 can now run programs".
  4. Feature grid.
  5. Keymap (**generated from `domain/keymap.ts`**).
  6. FAQ (vs `/plugin`, safety, network use, requirements: Claude Code ≥ 2.1.291).
  7. Footer.
- **Demo data:** `site/src/data/demo.ts` comes from the same fixture modules the UI tests assert against, rendered to text by `scripts/render-demo.ts`, which walks the drawn tree from a test mount (R23), so the site can't drift from the UI.
- **Quality bar:** Lighthouse 100 ×4, < 100 KB transferred excluding fonts, works without JS, light/dark via `prefers-color-scheme` + toggle, 320 px minimum, AA contrast, focus-visible, semantic landmarks, OG image generated at build, sitemap, link check in CI.

---

## 9. Quality

- **Toolchain (root, dev only):** pnpm, TypeScript ≥ 5.6, Biome (lint + format), vitest + `@vitest/coverage-v8`. `plugin/` has **no** `package.json` and imports no packages.
- **Two test runners (R9):**
  - **vitest (Node)** for `plugin/hooks/domain/**`: table-driven, fixtures as `.ts` modules from real CLI output (`scripts/capture-fixtures.sh` regenerates them), coverage gate ≥ 95 % lines and branches. Also the layering test, the keymap-collision test, and the 3.5k-entry search benchmark.
  - **`claude plugin test plugin`** for `services/` and `ui/`: a fake CLI via a `process.run` hook beneath the plugin (F24); `mock.clock/store/env`; UI mounted on `terminal` and `desktop` in a loop, with fallback assertions on `mobile` and `vscode`; acts by element `key`; review flows require `y`; reload-rule tests; job resume after a simulated reload.
- **CI (`ci.yml`, PRs + main):** pnpm install → `biome ci` → `tsc -p plugin --noEmit` (vendored types) → vitest with coverage → install the pinned Claude Code → `claude plugin validate --strict --json plugin` → `claude plugin validate .` → `claude plugin test plugin` → site build, link check, Lighthouse CI budget.
- **Release (`release.yml`, on tag):** Conventional Commits, `CHANGELOG.md`, versions bumped in `plugin.json` **and** the marketplace entry, `claude plugin tag plugin`, GitHub release. `pages.yml` deploys the site on main.
- **Types upgrades:** `scripts/update-types.sh <version>` vendors a new d.ts. A CI job on a schedule runs the suite against the latest Claude Code and opens an issue on failure.

---

## 10. Milestones (one PR each, green CI, a short demo note in the PR)

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Repo scaffold: tooling, CI skeleton, vendored types, empty plugin that validates and tests; spikes S2, S6, S8–S12 written up; this plan adjusted to the answers | CI green; every spike has a yes/no answer + evidence |
| **M1** | `domain/` complete: ids, sanitize, validate-report, capabilities (+ generated explanations), catalog, detector, chain, cli-results, jobs, keymap, result | vitest coverage ≥ 95 %; layering, keymap and benchmark tests green |
| **M2** | Services: cli, store (+migrations, guard), registry, job-runner (+resume), capability-probe; `docs/SECURITY.md` | services tests green with the fake CLI; store caps proven |
| **M3a** | Pane shell (dialog, stacked/split, Esc rules, overlays) + Installed + Detail + staged toggle + review + reload rule + band | `/mods` paints < 50 ms; toggle → reload round trip in tests on terminal + desktop |
| **M3b** | Update / update all / remove / undo + capability diff + status line + title badge | diff shown after a fixture update |
| **M4** | Discover: catalogue service, search/sort/kind, detector runner, install review (scope, declared command re-verify), add marketplace | installs a local fixture mod end to end; detector honours budget and idle rule |
| **M5a** | Dev: sources, validate/test runners, share, dev failure observer | dev mods of this session appear and validate |
| **M5b** | Health: load states, validate errors, caps changes, chain notes, debug pointer; updates scheduler | seeded problems show with fixes; scheduler re-arms after reload |
| **M6** | Non-UI `/mods` (incl. `doctor --json`, `export`/`apply`), first-run, empty states, degraded modes, perf measurement → `docs/PERF.md` | every budget measured and recorded |
| **M7** | Landing page | Lighthouse 100, < 100 KB, deployed |
| **M8** | 0.1.0: README with GIFs, CONTRIBUTING, tag, release, submit to community marketplaces | `/plugin install modmgr --marketplace ayagmar/modmgr` works on a clean `CLAUDE_CONFIG_DIR` |

## 11. Risks

| Risk | Mitigation |
|---|---|
| API churn (2.1.288 → 2.1.291 during planning) | `$` only in services/ui; vendored types per version; scheduled CI against latest; minimum version in README |
| S8: reload can't be triggered from a mod | band `[l reload]` + "or restart"; all copy says "after reload" |
| S11: no `$.process` on hosted surfaces | read-only degraded mode with a reason |
| Few mods in catalogues early on | `hooks` filter, add-marketplace empty state, the site promotes "share a mod" |
| Catalogue growth (2.7k → 3.5k in two days) | nothing persisted; module-memory index; benchmark at 10k entries in CI |
| CLI output changes | all parsing in `domain/cli-results.ts` with fixtures; parse failure → `unknown`, never a crash |

## 12. Later (v1.1+)
Pre-update capability diff (temp-copy validate); a `plugin.register` quarantine policy; `Client`-based raw key handling for vim-style navigation; favourites and saved views; history view; i18n.

---

## Changes during build

Recorded as the build finds them. Each says what contradicted the plan, the change, and its status.

**C1. Claude Code 2.1.292 (M0, applied).** The machine runs 2.1.292. Its types are vendored beside 2.1.291's; the diff
is additive for every API this plan uses (`docs/spikes/README.md` §Version check). CI pins 2.1.292, and the README's
minimum version is 2.1.292. One relevant detail: `command.run` is now a gating site unless the hook answers a command
the module registers by literal name and never reads `next`; `/mods` is written that way.

**C2. `$` lives in one file; services and UI take ports (M0, proposed: needs approval).** F36/F37 make §3's layering
("every `$` call lives in `services/`") impossible: `$` can't be passed into an imported function, and each event can be
hooked once per module. Proposed shape:
- `hooks/register.tsx` is the **only file that spells `$`**. It registers every hook (one line each, delegating) and
  builds typed **ports** per dispatch: `portsOf($)` → `{ process: { run, spawn }, store, state, clock, http, fs, ui, … }`,
  closures over that dispatch's `$`. The validator traces them (`calls: $.process.run (via portsOf)`).
- `services/*` are `$`-free: they export functions that take `Ports` (an interface in `services/ports.ts`). `ui/*` export
  render functions that take `{ el, read, act }` (the surface's element table, state reads through the ports, and
  handlers that dispatch through ports).
- Wins: services become **vitest-testable with fake ports** (real coverage), and the fake-CLI tests no longer need the
  engine. `claude plugin test` still covers the wiring, the UI on `terminal`/`desktop`, and the reload/resume flows.
- The layering test changes to: only `hooks/register.tsx` may contain `$.`; `domain/` imports only `domain/`;
  `services/` imports `domain/` and `services/ports.ts`; `ui/` imports `domain/`, `ui/`, and port *types*.

**C3. Reload and the job runner (M0, applied to the design).** F29: jobs and the batch's reload never run inside a
`command.run` hook. `/mods` opens the pane and returns; the runner is kicked from press handlers and
`$.clock.after(0, …)`. F30: a batch's closing `/reload-plugins` does **not** reload modmgr (unless modmgr itself was
updated), so the runner normally survives it; the `$.state` queue and resume-on-`register` stay for modmgr's own updates
and dev hot reloads. F31: `session.start` runs again on a module reload, so it must be idempotent (re-register `/mods`,
re-arm timers, re-attach to an open pane without reopening it).

**C4. CLI result parsing (M0, applied to the design).** F26: `cli-results.ts` takes the last stdout line that parses as
a JSON object, never the whole stdout. F25/F27: `shownCommand` is typed per `kind`; "`--accept-command is ignored inside
a Claude Code session`" (or `acceptCommandMatched: true` with a failed outcome) maps to error kind `rejected` with the
sentence "Claude Code refused to accept the command from here; accept it in `/plugin` → the plugin's details, or run
the install in a terminal."

**C5. Capability probe (M0, applied to the design).** F32: `capability-probe` runs `claude --version` through
`$.process.run` once per load and catches; failure → degraded read-only mode with the reason.

**C6. Dev sources and the debug pointer (M0, applied to the design).** F34: Dev lists `CLAUDE_CODE_PLUGIN_DIRS` mods
(child `list --json`, `@inline`, scope `session`), `~/.claude/dev-mods/*/*`, `@skills-dir` and folder-marketplace
installs. `--plugin-dir` mods are shown only when inferred from `$.command.list()` (a command whose `plugin` isn't in
`list --json`), labelled "loaded with --plugin-dir (inferred)". F35: Health's "last logged reason" becomes "run with
`--debug`" plus, when `$CLAUDE_CONFIG_DIR/debug/latest` exists, the last `hook failed closed: <plugin>` line (event and
error kind only; the engine logs no message text).

**C7. Numbers (M0, applied).** F15 → F28 (3,545 entries, mods exist). The detector's first full coverage is ≈ 5 min of
idle probing, spread over sessions by the 600-probe budget.
