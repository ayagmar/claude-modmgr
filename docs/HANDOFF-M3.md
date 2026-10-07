# Handoff prompt: modmgr from M3a onward

Paste everything below the line into a new Claude Code session started in `~/projects/modmgr`
(for example `claude --model opus --effort high`).

---

You're continuing **modmgr**, a Claude Code plugin that manages *mods* (function-hook plugins). M0 (scaffold + spikes),
M1 (pure domain) and M2 (services over ports, `register.tsx`, SECURITY.md) are done and merged to `main` locally.
Your job is M3a onward, milestone by milestone, to a production standard: maintainable, robust, correct, secure, with
state-of-the-art UX.

## Read first, in this order

1. `docs/HANDOFF.md` (ground rules, M3a–M8 steps, the "after each milestone" summary format) and `docs/HANDOFF-M2.md`
   (decisions, gotchas, the gate). Both still apply except where this file overrides them.
2. `docs/PLAN.md`: §1 facts **F1–F44**, §2.1 and §5 (the UX spec for M3a), §10 milestones, and **"Changes during
   build" C1–C10**, which override earlier sections. C10 describes M2 as built.
3. `docs/SECURITY.md`, `docs/reviews/2026-10-07-fable-5.1-m0-review.md` §5 (dialog UX) and the response file.
4. The code: `plugin/hooks/register.tsx`, `ports.ts`, `services/*` (start with `runtime.ts`, `lifecycle.ts`,
   `job-runner.ts`), `domain/{state,jobs,keymap,mods,capabilities}.ts`, `plugin/types/index.d.ts`,
   `plugin/tests/harness.ts`, `test/services/fakes.ts`, `test/layering.test.ts`, `scripts/validate-plugin.ts`.
5. `vendor/claude-code-types/2.1.292/claude-code.d.ts` is the API's source of truth: grep it, never guess. For M3a read
   `ui.render`, `Pane` props (`scroll.bodyRows`, `columns`), `Button`/`Text`/`Box`, `ui.open`/`ui.close`/`ui.panes`,
   `AbovePrompt`, `ui.mount` and `press` in `claude-code/testing`, and `reference.md` § Drawing. Run `claude --version`;
   if it isn't 2.1.292, run `scripts/update-types.sh` and follow what it prints.

## Decisions already made (don't re-litigate)

- **Design decisions are delegated** to you ("decide what's best"). Decide, record each change in PLAN.md "Changes
  during build" (next is C11) as applied, and move on. **Ask before creating the GitHub repo or pushing anything**;
  never add AI attribution to commits.
- **Fable 5.1 review after M3a** (the first UI milestone): `herdr pane split --current --direction right --cwd "$PWD"
  --no-focus`, then `herdr agent start fable-review --kind claude --pane <id> -- --model fable` (accept the
  folder-trust prompt with `down enter`). It edits nothing but its review file in `docs/reviews/`. Read it, fold it
  in, write a response file like the M0 one, close the pane.
- **Architecture (C2, C10):** only `register.tsx` spells `$`; one top-level builder per noun; one atom `const` per
  state key with a shape tag (`'<key>/1'`; bump it in `domain/state.ts` *and* `register.tsx` when a key's type
  changes); one `on(...)` per event (matchers separate `ui.render` sites and `command.run{command:'mods'}`).
  `.catch` handlers never touch `$`. `ui/` gets `ViewPorts` (`el`, `read`, `act`, props): no process, store, env or
  command ports (the layering test enforces it). Press handlers only `update` state and `runtime.kick()`; jobs run on
  the runtime built at `session.start`. Queue a batch with `services/job-runner.ts` `enqueue(...)` and job ids from
  `runtime.newJobId()`.
- **Reload (C3, F29, F38):** never run a job or reload inside a `command.run` hook; `/mods` opens the pane and returns.
  The runner already enforces the 1.5 s settle and marks the reload `running` first. "reload queued, runs when the turn
  ends" copy when pressed mid-turn (C8).
- **UX (PLAN §5, C8):** `/mods` is a dialog (`focus`, `closeOnEscape`, `holdToasts`), re-opened without `holdToasts`
  while jobs stream; stacked layout first, split at ≥ 100 body columns; rows are `plain` Buttons windowed by
  `e.props.scroll.bodyRows`; Esc cascade only while the pane `isFocused`; hotkeys only from `domain/keymap.ts`; theme
  keys only; glyphs `● ○ ↑ ▲ ◆ ✓ ✗ ⊘`; untrusted text as `Text`. On `session.start` re-attach to an open pane via
  `ui.panes()` (retitle at most; an unasked open waits undrawn below 144 columns).
- **Open from M2:** `projectEnabled` is *not* "off in this project" (C10); decide whether `$.settings.read({ source:
  'project' })` is worth that capability. Whether `x` keeps a mod's data (`--keep-data`, for a faithful undo) is M3b's.

## Gotchas learned the hard way (in addition to HANDOFF-M2's)

- **Validator (F41–F43):** the `types` contract may not `import` anything (`Shaped` resolves inside its `declare module`
  block); `read`/`update` need an atom named by a `const` (no `ATOMS[key]`); `/mods` stays "answers its own command"
  only while `register.tsx` spells `$.command.register({ name: 'mods', … })`. `node scripts/validate-plugin.ts`
  catches regressions; adding a new noun (e.g. `ui.open`, `ui.render`) means new builders and atoms in
  `register.tsx`, and possibly new expected verdicts there.
- **`claude plugin test` (F44):** every `$` call needs an answer beneath the plugin (extend `plugin/tests/harness.ts`
  for new nouns: `ui.open`, `ui.close`, `ui.panes`, …); a throwing test hook is skipped, so reject with `{ deny }`; the
  test `$` has no `store` noun (use `h.stored(key)`); a test module hooks each event once without a matcher, and
  `mock.*` already took clock/store/env events. Rejections reach the plugin as `<plugin>: $.<noun>.<method>: <reason>`.
- **Fake clock in vitest:** a drain started by `runner.kick()` needs `clock.advance(0)`; anything that sleeps on the
  clock needs advancing *before* `await runner.whenIdle()`, or the test hangs.
- **A live session lays `plugin/.claude-plugin/types/`** (git-ignored, the engine's); the hygiene scan skips it.
- **Live check recipe:** build an isolated config with the fixture marketplace, from your shell (installs are fine
  there):
  ```sh
  L=<scratchpad>/live; mkdir -p $L/config; cp -r test/fixture-mods $L/mkt; export CLAUDE_CONFIG_DIR=$L/config
  claude plugin marketplace add $L/mkt --json
  for m in turn-band redactor quiet-bash plain-skill; do claude plugin install $m@fixtures --json </dev/null; done
  echo '{"hasCompletedOnboarding":true,"projects":{"'$PWD'":{"hasTrustDialogAccepted":true}}}' > $L/config/.claude.json
  ```
  then launch from a Herdr pane, never your Bash tool: `herdr pane run <id> "CLAUDE_CONFIG_DIR=$L/config
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude --debug --plugin-dir ./plugin"`. Read with `herdr pane read <id>
  --source visible` (the `recent` sources missed fullscreen output). Resize for 64 and 120 columns (`herdr pane`
  has layout commands; or split narrower). The debug log is `$L/config/debug/latest`. Close panes you create.

## Gate (run after each milestone; paste actual results)

```sh
pnpm biome ci . && pnpm tsc -p plugin --noEmit && pnpm tsc -p tsconfig.json --noEmit
pnpm vitest run --coverage   # ≥ 95 % lines and branches over domain/ and services/
pnpm validate && pnpm test:plugin
```

State at handoff: 349 vitest tests (99.7 % lines / 96.9 % branches), validate green with expected verdicts, 10 plugin
tests green. `plugin/tests/fixtures.ts` is generated (`pnpm fixtures:plugin-tests`).

## Next steps

1. **M3a** on branch `m3a-pane`: `ui/` (Pane shell: title/tabs, stacked|split, footer hints, overlays; Installed;
   Detail; staged toggles with `s` apply / review; Review screen; Band in `AbovePrompt`), `ui.render`/`ui.close`
   hooks in `register.tsx`, `/mods` opening the dialog, Esc cascade, re-attach on `session.start`, toggle → batch →
   reload round trip. Test every view on `terminal` and `desktop` through `ui.mount` (loop over both), extend the
   harness for the UI nouns, extend `test/layering.test.ts` for `ui/`. Done when `/mods` paints < 50 ms and the toggle
   → reload round trip passes on both surfaces. Then load it for real at 64 and 120 columns and report what you saw,
   including anything that looked wrong. Then the Fable review.
2. M3b → M8 per PLAN §10 and `docs/HANDOFF.md`.

After each milestone, merge to `main` locally, reply with the summary format from `docs/HANDOFF.md`, and continue,
except: ask before any push or GitHub action.
