# Contributing

## Layout

- `plugin/`: the shipped plugin. It has no `package.json` and imports no packages.
  - `hooks/domain/`: pure TypeScript, no `$`, no I/O. Tested with vitest under Node.
  - `hooks/services/`: the only code that calls `$` (besides `ui/` drawing and reading state).
  - `hooks/ui/`: render hooks.
  - `tests/`: `claude plugin test` files for services and UI.
- `test/`: vitest tests (domain, layering, keymap, benchmarks) and fixtures as `.ts` modules.
- `vendor/claude-code-types/<version>/`: the Claude Code API declarations modmgr is built against.
- `docs/`: plan, spikes, reviews, security and performance notes.

## Setup

```sh
pnpm install
```

## The gate

Run before every push; CI runs the same steps.

```sh
pnpm biome ci .
pnpm tsc -p plugin --noEmit
pnpm vitest run --coverage
claude plugin validate --strict --json plugin
claude plugin validate .
claude plugin test plugin
```

## Rules

- Never touch your real Claude Code config while developing. Any command that installs, enables,
  disables or adds a marketplace runs with `CLAUDE_CONFIG_DIR=$(mktemp -d)`.
- Load modmgr in a real session with `claude --plugin-dir ./plugin`.
- TypeScript is `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no `any`.
- Errors are `Result` values with typed kinds, never thrown across layers.
- Commits follow Conventional Commits.
