# Handoff prompt: build modmgr

Paste everything below the line into a new Claude Code session started in `~/projects/modmgr`. It's written for a strong model at high effort, for example `claude --model opus --effort high`.

---

You're building **modmgr**, a Claude Code plugin that manages *mods* (function-hook plugins). Your job is to implement it end to end, milestone by milestone, to a production standard: maintainable, robust, correct and secure.

## Read first, in this order
1. `docs/PLAN.md`: the approved plan (revision 2). It's the spec. §1 lists verified facts (F1–F24) and open spikes. §10 lists the milestones.
2. `docs/reviews/2026-10-06-fable-5.1-plan-review.md`: the review the plan already absorbed (findings R1–R25). Read it to understand *why* the plan looks the way it does.
3. `docs/spikes/README.md` and the spike folders: real evidence and reproduction steps.
4. `vendor/claude-code-types/2.1.291/reference.md` in full, then the examples. `claude-code.d.ts` (~20k lines) is the API's source of truth: grep it, never guess an API.
5. Run `claude --version`. If it isn't 2.1.291, load the `plugin-authoring` skill (it writes the current build's `claude-code.d.ts` and names its path), diff it against the vendored copy for every API the plan uses, and vendor the new version under `vendor/claude-code-types/<version>/` before writing code. Record any differences in `docs/spikes/README.md`.

## Ground rules
- **The plan is the spec.** If a spike or the API contradicts it, stop and write the contradiction plus your proposed change into `docs/PLAN.md` under a "Changes during build" section. Proceed only if the change is local and clearly better; otherwise ask me.
- **Never touch my real Claude Code config.** Every command that installs, uninstalls, enables, disables or adds a marketplace runs with an isolated `CLAUDE_CONFIG_DIR=$(mktemp -d)` (see `docs/spikes/README.md`; `plugin.register` and `session.start` run before the model call, so `claude -p` works there without a login). Load modmgr in a real session only with `claude --plugin-dir ./plugin`.
- **Never write to `~/.claude/settings.json`** or any settings file directly, from code or from your own commands.
- **Git:** `git init` here on `main`, then make one branch per milestone (`m0-scaffold`, `m1-domain`, …), Conventional Commits, small coherent commits, and merge to `main` locally when the milestone's done-criteria pass. **Ask me before creating the GitHub repo or pushing anything.** No AI attribution lines in commits.
- **Quality bar:** TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; no `any` (use `unknown` + narrowing); no non-null `!` without a comment proving it. Every exported function in `domain/` is pure and tested. Every `$` call lives in `services/` (or `ui/` for drawing and state reads). Every hook registration gets a `.catch`. Errors are `Result` values with typed kinds, never thrown across layers.
- **Security:** argv arrays only; ids, scopes and paths validated by `domain/ids.ts` before they reach a process; all untrusted text through `domain/sanitize.ts`; never pass `-y`; re-verify the declared-command sha right before `--accept-command`; no telemetry; honour `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- **Verify, don't assume.** After each milestone, run the full gate (`pnpm biome ci`, `pnpm tsc -p plugin --noEmit`, `pnpm vitest run --coverage`, `claude plugin validate --strict --json plugin`, `claude plugin validate .`, `claude plugin test plugin`). Paste the actual results into the milestone summary. If something fails, say so; don't paper over it.
- **UI work:** test every view on `terminal` and `desktop` through `ui.mount`. Then load it for real (`claude --plugin-dir ./plugin` in a Herdr pane, if one is available) and check the layout at 64 and 120 columns. Report what you saw, including anything that looked wrong.

## Step-by-step

### M0: scaffold and spikes
1. Create the repo layout from PLAN §3 exactly: root `package.json` (dev tooling only: typescript, @biomejs/biome, vitest, @vitest/coverage-v8, astro under `site/`), `pnpm-workspace.yaml` (root + `site`), `biome.json`, `tsconfig.base.json`, `plugin/tsconfig.json` (`jsx: react`, `jsxFactory: h`, `jsxFragmentFactory: Fragment`, `types: []`, includes the vendored d.ts), `vitest.config.ts` (only `plugin/hooks/domain/**` + `test/**`), `.gitignore` (`node_modules`, `plugin/.claude-plugin/types/`, `site/dist`), `LICENSE` (MIT, ayagmar), `README.md` stub, `CHANGELOG.md`, `CONTRIBUTING.md`.
2. Root `.claude-plugin/marketplace.json` (`name: modmgr`, `source: "./plugin"`, with `version`). `plugin/.claude-plugin/plugin.json` with full metadata and `userConfig` (`updateCheckHours` number default 6, `detectRemote` boolean default true, `debugTimings` boolean default false). `plugin/hooks/hooks.json`, and a minimal `register.tsx` that registers `/mods` and answers "modmgr scaffold".
3. `types/index.d.ts` from PLAN §4. Check S10 (does a `PluginState`-only `types` contract pass `validate --strict`?); if not, follow what `validate` asks for and record it.
4. `.github/workflows/ci.yml` with the full gate from PLAN §9; it installs the **pinned** Claude Code version.
5. Run spikes **S2, S6, S8, S9, S10, S11, S12** as throwaway mods under `docs/spikes/<id>/` with isolated config dirs. Write each one up in `docs/spikes/README.md` (question, method, raw output, yes/no, impact on the plan). Update `docs/PLAN.md` where an answer changes the design.
6. Done when: CI config passes locally, the empty plugin validates and tests, and every spike is answered. **Stop and send me a short summary of the spike answers and any plan changes before M1.**

### M1: domain (pure)
Implement every `plugin/hooks/domain/*.ts` module in PLAN §3, with vitest tests in `test/domain/`. Capture real fixtures with `scripts/capture-fixtures.sh` (isolated config dir; `list --json`, `list --json --available` trimmed to ~200 representative entries plus synthetic edge cases, `validate --json` of the spike mods, every CLI `--json` result shape including failures) and save them as `.ts` modules. Write `scripts/gen-explanations.ts` (reads the vendored d.ts, emits `domain/explanations.ts`; commit the output; CI checks it's fresh). Also add the layering test, the keymap-collision test (views + overlays mounted together) and the 3.5k/10k-entry search benchmark. Done when coverage is ≥ 95 % lines and branches.

### M2: services + SECURITY.md
`cli.ts`, `store.ts` (versioned, migrations, size guard, LRU caps, batched writes), `registry.ts`, `job-runner.ts` (state in `$.state`, resume/interrupt on `register`, batch → single reload rule, S8 fallback), `capability-probe.ts`. Tests use `claude plugin test` with a fake CLI (a `process.run` hook beneath the plugin) covering timeouts, malformed JSON, non-zero exits, rejected reloads and a store over the cap. Write `docs/SECURITY.md` (threat model from PLAN §7).

### M3a → M8
Follow PLAN §10 in order: M3a (pane shell, Installed, Detail, staged toggles, Review, reload, band), M3b (update/remove/undo, capability diff, status line and title badge), M4 (Discover + detector + install review), M5a (Dev), M5b (Health + update scheduler), M6 (non-UI `/mods`, first-run, empty and degraded states, perf measurement → `docs/PERF.md`), M7 (landing page in `site/`, PLAN §8 quality bar, demo data rendered from test fixtures by `scripts/render-demo.ts`), M8 (README with screenshots/GIFs, release workflow, `claude plugin tag plugin`).

UI rules to hold throughout (PLAN §5): `/mods` is a **dialog** (`focus`, `closeOnEscape`, `holdToasts`); stacked layout first, split at ≥ 100 `bodyColumns`; rows are `plain` Buttons; window with `e.props.scroll.bodyRows`; the Esc cascade via a `ui.close` hook that never denies on `unload`; hotkeys only from `domain/keymap.ts`; theme keys only (`claude`, `subtle`, `success`, `warning`, `error`); glyphs `● ○ ↑ ▲ ◆ ✓ ✗ ⊘`; untrusted text as `Text`, never `Markdown`.

## After each milestone
Reply with: what was built (files), the gate results (actual output, summarised), what you verified by loading it for real, deviations from the plan and why, open risks, and what's next. Then continue to the next milestone, **except** after M0 (wait for me) and before any push or GitHub action (ask me).
