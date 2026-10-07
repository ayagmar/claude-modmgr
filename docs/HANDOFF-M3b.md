# Handoff prompt: modmgr from M3b onward

Paste everything below the line into a new Claude Code session started in `~/projects/modmgr`
(for example `claude --model opus --effort high`).

---

You're continuing **modmgr**, a Claude Code plugin that manages *mods* (function-hook plugins). M0–M2 and **M3a**
(the `/mods` dialog: Installed, Detail, staged toggles, Review, reload, band) are done, reviewed by Fable 5.1, and
merged to `main` locally. Your job is **M3b**, then M4 onward, milestone by milestone, to a production standard:
maintainable, robust, correct, secure, with state-of-the-art UX.

## Read first, in this order

1. `docs/HANDOFF.md` (ground rules, the M3b–M8 step list, the "after each milestone" summary format),
   `docs/HANDOFF-M2.md` and `docs/HANDOFF-M3.md` (decisions and gotchas). All still apply except where this file
   overrides them.
2. `docs/PLAN.md`: §1 facts **F1–F50**, §2.1/§2.2/§2.6/§2.8, §5, §10, and **"Changes during build" C1–C11** (C11 is
   M3a as built, with its post-review amendment), which override earlier sections.
3. `docs/reviews/2026-10-07-fable-5.1-m3a-review.md` (§3 "Before M3b" is your brief's other half) and
   `docs/reviews/2026-10-07-m3a-review-response.md`.
4. The code, M3a first: `plugin/hooks/domain/view.ts`, `services/actions.ts`, `ui/{kit,Pane,Installed,Detail,
   overlays,Band}.tsx`, `register.tsx`; then `domain/{jobs,argv,cli-results,store-schema,capabilities,mods,keymap,
   state}.ts`, `services/{job-runner,registry,runtime,lifecycle,commands}.ts`, `plugin/types/index.d.ts`,
   `plugin/tests/{harness.ts,ui.test.tsx}`, `test/services/{fakes,actions.test}.ts`, `test/layering.test.ts`,
   `scripts/validate-plugin.ts`.
5. `vendor/claude-code-types/2.1.292/claude-code.d.ts` is the API's source of truth: grep it, never guess
   (`$.ui.status`, `PaneOpenArgs`, `UiOpenResult`, `Select`/`SelectProps` if you use one). Run `claude --version`;
   if it isn't 2.1.292, run `scripts/update-types.sh` and follow what it prints.

## Decisions already made (don't re-litigate)

- **Design decisions are delegated** to you ("decide what's best"). Decide, record each change in PLAN.md "Changes
  during build" (next is **C12**) as applied, and move on. **Ask before creating the GitHub repo or pushing
  anything**; never add AI attribution to commits.
- **Fable 5.1 review after M3b** (it adds destructive actions): `herdr pane split --current --direction right --cwd
  "$PWD" --no-focus`, then `herdr agent start fable-review --kind claude --pane <id> -- --model fable`. Tell it to
  edit nothing but `docs/reviews/<date>-fable-5.1-m3b-review.md`. Wait with `herdr agent wait fable-review` run in
  the background (not a sleep loop). Fold it in, write a response file like the M3a one, close the pane.
- **Architecture (C2, C10, C11):** only `register.tsx` spells `$`; one top-level builder per noun; one atom `const`
  per state key with a shape tag (bump it in `domain/state.ts` *and* `register.tsx`; a vitest checks they agree);
  one `on(...)` per event (matchers separate sites). `.catch` handlers never touch `$`. Pure logic in `domain/`
  (vitest), state changes in `services/actions.ts` over ports (vitest with fakes), drawing in `ui/` over `ViewPorts`.
  Press handlers only update state and `runtime.kick()`; jobs run on the runtime built at `session.start`.
- **M3a conventions to keep:** `selectedRow(view, mods)` is the one answer to "which mod" for every action
  (R-M3a-1); destructive or code-running actions go through the Review overlay, and a confirm takes its review by
  compare-and-set (R-M3a-2); every stack change places the focus ring with `ringTo(...)` on the overlay's safe
  default (`act:cancel` on a review); intermediate states of a multi-write action must draw like the final one
  (F50); hotkeys only from `domain/keymap.ts` via `KeyButton` (u, a, x are already bound on `installed`/`detail`);
  `Pane.tsx`'s `NOT_YET` set hides unbuilt keys from help: take `update`, `update-all`, `remove` out of it.

## M3b scope and the decisions for it

1. **Update (`u`) and update all (`a`)** on the selected mod / every updatable mod: `update` jobs (`domain/argv.ts`
   already builds `claude plugin update <id> [--scope]`) in one batch with one reload, through the review (it runs
   new code). `parseOpResult` gives `update: { outcome, from, to }`; an unchanged result reads "already up to
   date". Update *detection* (the `↑` badge, `attention.updates`) needs the M5b scheduler (`marketplace update`
   then compare versions): leave `attention.updates` at 0 and say so in C12, unless you find a cheap, verified source
   in M3b. Folder-marketplace mods have no updates (they read from the folder); say so instead of offering `u`.
2. **Remove (`x`)**: always through the review, which says what is removed, the scope, the repo-file change for
   project/local, the mod's other parts (skills, agents, MCP), and its data size. **Default: keep the data**
   (`uninstall --keep-data`, job `args.keepData: true`) so undo restores the mod as it was; offer deleting the data
   as an explicit, non-default choice in the review if you can do it safely. Managed/env-dir mods: locked, as
   toggles are.
3. **Undo (`z`)**: toggles stay direct; an undo whose batch contains an `install` (the inverse of a remove) goes
   through the review, with the declared-command pre-check (C10: a declared command fails the job as `conflict`;
   the full sha re-verify flow is M4's, but the review must not hide it). An update can't be undone (no version pin
   in the CLI): say so rather than offering it.
4. **Capability diff (PLAN §2.2)**: after a refresh, compare each mod's notable set with `capsHistory[id]`
   (`{ version, notable }`; first sight just records). When a version change adds notable items, keep them
   (extend `CapsRecord`, e.g. `added`, with a store-schema shape check and migration), count them in
   `attention.capsChanged`, show "new since 0.3.1" in the detail and "turn-band can now run programs" in the band;
   opening that mod's detail acknowledges it. Prove it with a fixture update (M3b's done criterion: "diff shown after
   a fixture update").
5. **Status line** (`$.ui.status`, one per plugin, `undefined` clears it): add `status(text | undefined)` to
   `UiPort`; drive it, the band and the title from **one pure summary** in `domain/view.ts` so they never disagree
   (e.g. `mods: applying 2…`, `mods: reload to apply`, `mods: 1 can now run programs`; nothing when idle).
6. **Title badge** (`mods · 2 updates`): a retitle is a `ui.open` with the same id and **resets the manners**
   (`closeOnEscape`, `holdToasts`, `rows`, F22): build it only through `paneOpen`, re-send the current manners
   (hold only when idle), never `focus`, and only when `$.ui.panes()` lists the pane as placed (an unasked open waits
   undrawn below 144 columns). Retitle only when the text changes.
7. **Contract hygiene**: drop the unused `View.layout` and `View.page` with a `view/3` bump (C11 says why).

Done when: update / update all / remove / undo work end to end against the fixture marketplace (terminal and desktop
in `claude plugin test`, plus vitest for the domain and actions), a fixture update shows its capability diff in the
detail, band and status line, and the live check below passes at 64 and 120 columns.

## Gotchas learned in M3a (in addition to the earlier handoffs')

- **Esc (F45, F49):** Esc and ctrl+x x hand the keys back to the prompt *before* `ui.close` reaches the hook, so
  `$.ui.panes()` already says `isFocused: false`. The cascade reads `paneHadKeys` (the last terminal draw's
  `isFocused`, module memory in `register.tsx`) and re-takes the keys when it keeps the pane. The close key can't be
  told from Esc: with an overlay up it pops it (accepted).
- **Focus ring (F46, F50):** a ring on a Button a redraw removes goes nowhere, and a ring set in an intermediate tree
  built differently from the final one lands on the first focusable element. Place it after every stack change;
  draw intermediate states like final ones (a review overlay whose review was taken draws as gone).
- **Ink layout (F48):** children shrink by default, vertically too inside a fixed `height`; give fixed columns
  `flexShrink={0}`, wrap a clipped column's content in a non-shrinking Box, use `columnGap` (not `gap`) on wrapping
  rows. Overlays taller than the body are clipped (`clipped` in `Pane.tsx`); keep action keys near the top.
- **`claude plugin test` (F47):** the harness answers `state.*`, so a write doesn't redraw a mount: call
  `ui.redraw()` after each act. `$.ui.focus` onto an element only the next redraw draws is denied there. A person's
  `ui.close` can't be raised (it's an op): test the cascade in vitest via `actions.closing`. Each event is hooked once
  per test module: never call `host(on)` twice in one test. Element queries take a string `key`, not a RegExp.
- **Fakes:** `FakeUi` has `opens`, `closes`, `focuses`, `copies`, `undrawn` (keys `focus` denies) and
  `keysToPrompt()` (F45). No fixture mod carries skills: pass a runtime whose `registry.facts` reports parts.
- **Live check:** the isolated config can be reset between sessions (onboarding lost, plugins gone). Rebuild it
  each time:
  ```sh
  L=<scratchpad>/live; rm -rf $L; mkdir -p $L/config; cp -r test/fixture-mods $L/mkt; export CLAUDE_CONFIG_DIR=$L/config; unset CLAUDECODE
  claude plugin marketplace add $L/mkt --json
  for m in turn-band redactor quiet-bash plain-skill; do claude plugin install $m@fixtures --json </dev/null; done
  echo '{"hasCompletedOnboarding":true,"projects":{"'$PWD'":{"hasTrustDialogAccepted":true}}}' > $L/config/.claude.json
  ```
  Launch from a Herdr pane (`herdr pane run <id> "CLAUDE_CONFIG_DIR=$L/config CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
  claude --debug --plugin-dir ./plugin"`), wait with `herdr pane wait-output <id> --match "Not logged in"`. Find
  the focus ring with `herdr pane read <id> --source visible --format ansi | cat -v | grep -n '\[7m'`. Width:
  `herdr pane split ... --ratio 0.45` gives ~122 columns (fullscreen docks the pane at ~49); `herdr pane resize`
  the neighbour to reach ~64 (inline) and ~106 (inline split). `--plugin-dir` hot-reloads on save (check
  `modmgr@inline reloaded` in `$L/config/debug/latest`). For a fixture *update*, bump a mod's version in `$L/mkt`
  (folder marketplace) and see what the CLI reports; close every pane you create.

## Gate (run after each milestone; paste actual results)

```sh
pnpm biome ci . && pnpm tsc -p plugin --noEmit && pnpm tsc -p tsconfig.json --noEmit
pnpm vitest run --coverage   # ≥ 95 % lines and branches over domain/ and services/
pnpm validate && pnpm test:plugin
```

State at handoff (`main` at `ea540ee`): 413 vitest tests (99.7 % lines / 96.5 % branches), validate green (the only
gates are `ui.focus` and `ui.close` on modmgr's own pane), 28 plugin tests green.

## Next steps

1. **M3b** on branch `m3b-update-remove`, per the scope above. Then the live check at 64 and 120 columns (report
   what you saw, including anything that looked wrong), then the Fable review, then merge to `main` locally.
2. M4 → M8 per PLAN §10 and `docs/HANDOFF.md`.

After each milestone, merge to `main` locally, reply with the summary format from `docs/HANDOFF.md`, and continue,
except: ask before any push or GitHub action.
