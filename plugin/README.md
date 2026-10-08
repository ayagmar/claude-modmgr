# modmgr

A mod manager for Claude Code. Mods are plugins that hook into a Claude Code session: they can run programs, read
the conversation, change what the model sees. Type `/mods` to see the mods you have and what each one can do, find
new ones across your marketplaces, and install, switch off, update or remove them without leaving the session, each
change reviewed first and undoable.

- **Installed**: every mod with its state, version and notable capabilities; changes are staged, applied together
  with one plugin reload, and the last batch can be undone.
- **Discover**: the mods in every marketplace you have added, searchable, each installed through a review that says
  what will run and where.
- **Dev**: the mods you are writing (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, your skills folder, folder
  marketplaces): validate, test, reload, share.
- **Health**: what needs you, worst first, each with a fix one key away.

`/mods list`, `info`, `doctor`, `export` and friends answer as text for scripts and `-p` runs.

## What it runs, reads and fetches

- **Runs** the `claude` CLI (`claude plugin list`, `install`, `enable`, `disable`, `update`, `uninstall`,
  `marketplace add`/`update`, `validate`, `test`) for the changes you confirm, and Claude Code's plugin reload. It
  never writes a settings file and never passes `-y`; a command a marketplace declares runs only after you confirm
  that exact command (its sha256).
- **Fetches**, without credentials, only from `https://raw.githubusercontent.com/`: a catalogue index
  (`ayagmar/claude-modmgr`, branch `catalog-index`, at most every 12 hours) and, for a catalogue entry, its
  `hooks/hooks.json` and `.claude-plugin/plugin.json` at the entry's pinned commit. These reads are off under
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or with the `detectRemote` option off. Update checks
  (`updateCheckHours`, default 6, `0` turns them off) ask the CLI to refresh your marketplaces.
- **Reads** plugin manifests in your marketplaces' folders and where mods under development live, and, in a session
  started with `--debug`, its own debug log for failed hooks. It never reads your settings or the CLI's own files.
- **Stores** preferences, capability analyses and the last 50 finished jobs (no output) in its plugin store under
  your Claude Code config directory. No conversation text, secrets or environment values.
- **Sends** nothing else anywhere, and has no telemetry.

The full threat model is in [docs/SECURITY.md](https://github.com/ayagmar/claude-modmgr/blob/main/docs/SECURITY.md).

Needs Claude Code 2.1.292 or newer. MIT licensed. Source, issues and the landing page:
[github.com/ayagmar/claude-modmgr](https://github.com/ayagmar/claude-modmgr) ·
[ayagmar.github.io/claude-modmgr](https://ayagmar.github.io/claude-modmgr/).
