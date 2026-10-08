# Contributing

## Layout

- `plugin/`: the shipped plugin. It has no `package.json` and imports no packages.
  - `hooks/register.tsx`: the **only** file that spells `$` (the validator refuses `$` across an import). It holds
    top-level port builders, one `on(...)` per event, and delegates.
  - `hooks/ports.ts`: port interfaces, types only.
  - `hooks/domain/`: pure TypeScript, no `$`, no I/O. Tested with vitest under Node.
  - `hooks/services/`: `$`-free logic over ports. Tested with vitest and fake ports.
  - `hooks/ui/`: render functions over `ViewPorts` (elements, state reads, actions).
  - `tests/`: `claude plugin test` files for wiring, dispatch rules and UI on surfaces.
- `test/`: vitest tests (domain, services, layering, keymap, benchmarks), fixtures as `.ts` modules
  (`scripts/capture-fixtures.sh` regenerates them from the real CLI), and `fixture-mods/`, a small marketplace of mods.
- `vendor/claude-code-types/<version>/`: the Claude Code API declarations modmgr is built against.
- `site/`: the landing page (Astro, static). Its demo frames (`site/src/data/demo.ts`) are drawn by `ui/Pane.tsx`.
- `docs/`: security and performance notes.

## Setup

```sh
pnpm install
```

## The gate

Run before every push; CI runs the same steps.

```sh
pnpm biome ci .
pnpm tsc -p plugin --noEmit && pnpm tsc -p tsconfig.json --noEmit
pnpm vitest run --coverage   # domain + services, ≥ 95 % lines and branches
pnpm validate                # validate --strict with modmgr's expected verdicts, then the marketplace
pnpm test:plugin             # claude plugin test: wiring, dispatch rules, UI on surfaces
```

`pnpm gate` runs all of it. `pnpm validate` and `pnpm test:plugin` use a throwaway `CLAUDE_CONFIG_DIR`.

## Tests

- **Domain** (`test/domain/`): pure functions, table-driven, fixtures from the real CLI.
- **Services** (`test/services/`): vitest over fake ports (`fakes.ts`: a clock that moves only when told, a store with
  the engine's 4 MiB limit, in-memory state, and a scripted CLI; `cli-world.ts` answers from the captured fixtures).
- **Plugin** (`plugin/tests/`): `claude plugin test` against the real engine. Every `$` call needs an answer beneath the
  plugin; `harness.ts` plays that host (state with versions, a fake CLI, `mock.clock`/`store`/`env`). A test makes a
  call reject with `{ deny }` (a throwing test hook is skipped), and observes store writes through `h.stored(key)`.

## Generated files

- `plugin/hooks/domain/explanations.ts`: `pnpm explanations` (from the vendored d.ts; a test fails when stale).
- `test/domain/fixtures/cli-runs.ts`: `scripts/capture-fixtures.sh --official` (isolated config dir; needs network).
- `plugin/tests/fixtures.ts`: `pnpm fixtures:plugin-tests` (the subset plugin tests use; a test fails when stale).
- `site/src/data/demo.ts`: `pnpm demo` (the dialog's frames for the site and the README; a test fails when stale).
- The catalogue index (not in the tree): `node scripts/build-index.ts <out.json>` on a throwaway config dir;
  `.github/workflows/index.yml` runs it daily and force-pushes it to the `catalog-index` branch. To try one before
  it is published, serve it and point modmgr at it:

  ```sh
  node scripts/build-index.ts /tmp/index/v1.json   # a few minutes, needs network
  python3 -m http.server 8765 --directory /tmp/index &
  MODMGR_INDEX_URL=http://127.0.0.1:8765/v1.json claude --plugin-dir ./plugin
  ```
- A new Claude Code build: `scripts/update-types.sh`, then follow what it prints.

## Toolchain notes

- TypeScript 7 has no compiler API. `tsc --noEmit` is all the repo needs; a tool that imports `typescript` (an Astro
  check, an editor plugin) needs TypeScript 6 in its own package.
- pnpm ≥ 11 waits a day before installing a fresh release (`minimumReleaseAge`). `pnpm-workspace.yaml` lists exact
  exceptions; prefer waiting a day over adding more.

## The site

```sh
pnpm site                    # build site/ and check its links and weight
pnpm --filter modmgr-site dev
```

## Releasing

1. Move `CHANGELOG.md`'s `[Unreleased]` entries under `## [x.y.z] - <date>`.
2. Set the same `version` in `plugin/.claude-plugin/plugin.json` and the marketplace entry in
   `.claude-plugin/marketplace.json` (a test checks they agree), and commit.
3. `claude plugin tag plugin --dry-run`, then `claude plugin tag plugin --push`: the tag is `modmgr--v<version>`.
4. The tag runs `.github/workflows/release.yml`: the gate again, then a GitHub release with that CHANGELOG section.

The repository protects `main` and `modmgr--v*` tags with a ruleset that GitHub Actions can't bypass, so a workflow's
token can push only where it is meant to (the index workflow to `catalog-index`).

## Rules

- Never write source text with raw control, bidi or zero-width characters; write them as `\u` escapes (a test
  enforces it).
- Never touch your real Claude Code config while developing. Any command that installs, enables,
  disables or adds a marketplace runs with `CLAUDE_CONFIG_DIR=$(mktemp -d)`.
- Load modmgr in a real session with `claude --plugin-dir ./plugin`.
- TypeScript is `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no `any`.
- Errors are `Result` values with typed kinds, never thrown across layers.
- Commits follow Conventional Commits.
