# Handoff prompt: modmgr from M2 onward

Paste everything below the line into a new Claude Code session started in `~/projects/modmgr`
(for example `claude --model opus --effort high`).

---

You're continuing **modmgr**, a Claude Code plugin that manages *mods* (function-hook plugins). M0 (scaffold + spikes)
and M1 (the pure domain layer) are done and merged to `main` locally. Your job is M2 onward, milestone by milestone, to a
production standard: maintainable, robust, correct, secure, with state-of-the-art UX.

## Read first, in this order

1. `docs/HANDOFF.md`: the original handoff. Its ground rules, step list for M2–M8 and "after each milestone" reporting
   format still apply, except where this file overrides them.
2. `docs/PLAN.md`: the spec. §1 facts **F1–F40** (F25+ were found on 2.1.292), §10 milestones, and above all the
   **"Changes during build" section C1–C9 at the end**, which overrides earlier sections where they disagree.
3. `docs/reviews/2026-10-07-fable-5.1-m0-review.md` and `docs/reviews/2026-10-07-m0-review-response.md`: the M0 review
   and what was adopted. §4 of the review sketches the ports interface and `register.tsx` shape to build in M2.
4. `docs/spikes/README.md` (and `docs/spikes/rerun-2026-10-07/` for raw evidence).
5. The code: `plugin/hooks/domain/*.ts` (13 modules), `plugin/types/index.d.ts`, `plugin/hooks/register.tsx`,
   `test/layering.test.ts`, `test/domain/*`, `scripts/*`, `CONTRIBUTING.md`.
6. `vendor/claude-code-types/2.1.292/claude-code.d.ts` is the API's source of truth: grep it, never guess.
   Run `claude --version`; if it isn't 2.1.292, run `scripts/update-types.sh` and follow what it prints.

## Decisions already made (don't re-litigate)

- **The person delegated design decisions** ("decide what's best: state of the art, maintainability, UX/UI"). Decide,
  record each change in PLAN.md "Changes during build" as applied, and move on. Still **ask before creating the GitHub
  repo or pushing anything**, and never add AI attribution to commits.
- **External reviews:** at risky milestone boundaries (next one: **after M3a**, the first UI milestone), start a Fable 5.1
  reviewer yourself: `herdr pane split --current --direction right --cwd "$PWD" --no-focus`, then
  `herdr agent start fable-review --kind claude --pane <id> -- --model fable` (accept the folder-trust prompt with
  `down enter`; it's the person's own repo). Tell it to edit nothing but its review file in `docs/reviews/`. Read the
  review, fold it in, write a response file like the M0 one, then close the pane.
- **C2 architecture (validator-forced, F36/F37/F40):** `plugin/hooks/register.tsx` is the **only** file that spells `$`.
  It holds top-level per-noun port builders (`processPorts($)`, `statePorts($)`, … composed by `portsOf($)`), exactly
  one `on(...)` per event (matchers distinguish `ui.render` sites and `command.run{command:'mods'}`), and delegates.
  `.catch` handlers never touch `$`: pass-through `(_$, e, next) => next(e)` or a pure answer like `{ text }`.
  `plugin/hooks/ports.ts` is types only (per-noun interfaces). `services/` are `$`-free functions over
  `Pick<Ports, …>`, tested in **vitest with fake ports**; `ui/` are render functions over `ViewPorts` (`el`, `read`,
  `act`), no process/http/fs. Sequencing for shared events lives in `services/lifecycle.ts`. The job runner owns the
  port set built in `session.start` (module-scope `runtime`, rebuilt on every `register`); press handlers only `update`
  the jobs atom and `runtime.kick()`.
- **Reload rules (C3, F29–F31, F38, F39):** never run a job or reload inside a `command.run` hook (it rejects). The
  batch's reload job is written `running` to `$.state` before `$.command.run({command:'reload-plugins'})` and starts
  **≥ 1.5 s after the batch's last CLI write** (a faster reload reads stale settings and applies nothing).
  `/reload-plugins` doesn't re-register an unchanged modmgr; when modmgr's files do change, `session.start` runs again
  (make it idempotent), `$.state` survives, an open pane stays open. Give every atom a `shape` tag.
- **CLI parsing (C4):** results come from `domain/cli-results.ts` (last JSON line of stdout). `enable` of a
  non-installed id reports success: only enable ids seen in `list --json`. `--accept-command` works from
  `$.process.run`; a "ignored inside a Claude Code session" answer maps to `rejected`. Never pass `-y`; never strip
  `CLAUDECODE` from a child env.
- **UX (C8):** `/mods` is a dialog (`focus`, `closeOnEscape`, `holdToasts`), re-opened without `holdToasts` while jobs
  stream; Esc cascade only while the pane `isFocused`; "reload queued" copy when pressed mid-turn; split degraded flags
  (`process`, `network`, `acceptCommand`, already in `types/index.d.ts`).

## Gotchas learned the hard way

- **Your tool inputs decode `\uXXXX`.** Writing `'‮'` in a Write/Edit call puts the raw character in the file. Use
  `String.fromCharCode(0x202e)` or write `\\u202e` via a script. `test/layering.test.ts` fails on any raw control, bidi
  or zero-width character, so you'll find out.
- **Never touch the real Claude Code config.** Every install/enable/disable/marketplace/validate/test command runs with
  `CLAUDE_CONFIG_DIR=$(mktemp -d)` (`pnpm validate` and `pnpm test:plugin` already do). For a live interactive session,
  seed an isolated config to skip onboarding and the trust dialog (both would write `~/.claude.json`):
  `echo '{"hasCompletedOnboarding":true,"projects":{"/home/ayagmar/projects/modmgr":{"hasTrustDialogAccepted":true}}}' > $CFG/.claude.json`,
  then `CLAUDE_CONFIG_DIR=$CFG claude --plugin-dir ./plugin`. Slash commands work without a login.
- **Launch live sessions from a Herdr pane, not your Bash tool.** Your shell carries `CLAUDECODE` and other session
  vars that children inherit and that change CLI behaviour (that confound produced a wrong conclusion once).
  Drive the pane with `herdr pane run <id> "/mods"`, `herdr pane send-keys <id> <key>`, and read with
  `herdr pane read <id> --source recent-unwrapped --lines N`. Close panes you create.
- **Validator rules:** `$` only as `$.noun.method(...)`; no `'x' in $`, `typeof $.x`, storing `$`, or `new X($)`;
  builders top-level; each event once without a matcher. A module with `import()` doesn't load. No `.json` imports in
  plugin code or plugin tests.
- **`claude plugin test`:** the test `$` has one noun per event (`$.session.start(...)`, `$.command.run(...)`), not
  `$.command.list()`; the test's `on` sits beneath the plugin and the bottom throws, so answer the ops your code calls
  (e.g. `on('command.register', (_$, e) => ({ value: { command: e.name } }))`). See `plugin/tests/scaffold.test.ts`.
- **Biome:** `pnpm biome check --write .` reformats; generated `domain/explanations.ts` is excluded (a test checks it is
  fresh: `pnpm explanations` regenerates). `test/fixture-mods/` and `docs/spikes/` are excluded too.
- **TypeScript 7** (`tsc --noEmit` only; no compiler API). **pnpm 12** (`allowBuilds`, a one-day `minimumReleaseAge`).
- `scripts/capture-fixtures.sh --official` re-captures CLI fixtures (network); `test/fixture-mods/` is a small
  marketplace of mods (turn-band, redactor, quiet-bash, spawner, plain-skill, broken) for end-to-end tests.

## Gate (run after each milestone; paste actual results)

```sh
pnpm biome ci . && pnpm tsc -p plugin --noEmit && pnpm tsc -p tsconfig.json --noEmit
pnpm vitest run --coverage        # ≥ 95 % lines and branches; extend coverage.include to services/ in M2
pnpm validate && pnpm test:plugin # both use a throwaway CLAUDE_CONFIG_DIR
```

State at handoff: 247 vitest tests, 100 % lines / 98.7 % branches on `domain/`, validate and plugin test green.

## Next steps

1. **M2** on branch `m2-services`: `hooks/ports.ts`; `register.tsx` with the builders and fan-out; `services/`
   `lifecycle.ts`, `cli.ts` (argv only from `domain/ids.ts` values, timeouts, `cwd: session.root()` for project/local
   scope), `store.ts` (versioned `{ v: 1 }`, migrations, < 1 MiB budget, 3 MiB guard, LRU caps from PLAN §4, batched
   writes), `registry.ts`, `job-runner.ts` (C3 rules above, resume/interrupt on `register`), `capability-probe.ts`
   (call `claude --version` and catch). Vitest with fake ports for logic (extend `vitest.config.ts` coverage to
   `plugin/hooks/services/**`); `claude plugin test` for wiring, re-entry and reload/resume flows, with a fake CLI via
   a `process.run` hook beneath the plugin (timeouts, malformed JSON, non-zero exits, rejected reloads, a store over
   the cap). Extend `test/layering.test.ts` as files appear. Write `docs/SECURITY.md` (PLAN §7 threat model, plus:
   modmgr's review screen is the only gate for declared commands; `name`/`version`/`provenance` are a plugin's own word).
2. **M3a** (pane shell, Installed, Detail, staged toggles, Review, reload, band). Test every view on `terminal` and
   `desktop` through `ui.mount`, then load it for real in a Herdr pane at 64 and 120 columns and report what you saw.
   Then the Fable review.
3. M3b → M8 per PLAN §10 and the original handoff.

After each milestone, merge to `main` locally, reply with the summary format from `docs/HANDOFF.md`, and continue,
except: ask before any push or GitHub action.
