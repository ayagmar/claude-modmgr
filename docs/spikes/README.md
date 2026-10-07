# Spikes

Run on Claude Code 2.1.291. The answers are recorded in PLAN.md §1 (F1–F15).

- `gate/`: a `plugin.register` hook that logs every module it sees and refuses `aaa-mod`. Its `session.start` lists reload commands.
  (The scripts write to a hard-coded scratch path; change `OUT` before rerunning.)
- `aaa/`: the target mod. Its `session.start` writes a marker file.
- `mkt/`: a directory marketplace with zzz-gate, aaa-mod and mmm-mod, used with an isolated `CLAUDE_CONFIG_DIR` to test load order for installed plugins.
- `validate-json-sample.json`: real `claude plugin validate --json` output.

Reproduce F2:
    claude -p --plugin-dir ./gate --plugin-dir ./aaa "ok"   # aaa refused
    claude -p --plugin-dir ./aaa --plugin-dir ./gate "ok"   # aaa loads, the gate never sees it

Reproduce F3 (no login needed: plugin.register and session.start run before the model call):
    export CLAUDE_CONFIG_DIR=$(mktemp -d)
    claude plugin marketplace add ./mkt
    claude plugin install mmm-mod@spikemkt; claude plugin install zzz-gate@spikemkt; claude plugin install aaa-mod@spikemkt
    claude -p "ok" </dev/null   # the gate sees only aaa-mod; reorder enabledPlugins to put zzz-gate first → it sees both

## Open: S2, S6, S8–S12 (see PLAN.md §1)

## S7: gate visibility across load sources (answered: PLAN F17, F18)

- `inline-a/` (`--plugin-dir`), `env-b/` (`CLAUDE_CODE_PLUGIN_DIRS`), `skills-c/` (`$CLAUDE_CONFIG_DIR/skills/skills-c`).
- With `zzz-gate@spikemkt` installed first in `enabledPlugins` and refusing everything but itself, the gate saw and refused `mmm-mod`, `aaa-mod` and `skills-c@skills-dir`. It never saw `inline-a` or `env-b`, which loaded.
- `claude plugin disable skills-c@skills-dir --json` works (`enabledPlugins["skills-c@skills-dir"] = false`).
- Conclusion: v1 toggles everything through the CLI and has no gate.

## S3: update detection (answered: PLAN §2.6)
Folder marketplaces: `version` vs `folderVersion` in `list --json`, though these have no updates as such since they're read from the folder. Others: run `marketplace update`, then compare with the catalogue entry's `version`.
