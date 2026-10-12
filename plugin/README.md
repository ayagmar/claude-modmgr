# modmgr

A mod manager for Claude Code. Mods are plugins that run code in your session: they can run programs, read the
conversation and change what the model sees. Type `/mods` to search the mods published on GitHub and in your
marketplaces, see what each one can reach before you install it, and install, switch off, update or remove mods
without leaving the session. Every change is reviewed first, and toggles, installs and removals can be undone.

- **Installed**: every mod with its state, version and notable capabilities. Changes are staged, applied together
  with one plugin reload, and the last batch of toggles, installs or removals can be undone.
- **Discover**: the mods in every marketplace you have added and thousands found on public GitHub, searchable, each
  installed through a review that says what will run and where.
- **Dev**: the mods you are writing (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, your skills folder, folder
  marketplaces): validate, test, reload, share.
- **Health**: what needs you, worst first, each with a fix one key away.

`/mods list`, `info`, `doctor`, `export` and the write commands answer as text for scripts and `-p` runs.

## What it runs, reads and fetches

- **Runs** the `claude` CLI (`claude plugin list`, `install`, `enable`, `disable`, `update`, `uninstall`,
  `marketplace add`/`update`, `validate`, `test`) for the changes you confirm, and Claude Code's plugin reload. It
  never writes a settings file and never passes `-y`; a command a marketplace declares runs only after you confirm
  that exact command (its sha256).
- **Fetches**, without credentials, only from `https://raw.githubusercontent.com/`: two indexes from
  `ayagmar/claude-modmgr`, branch `catalog-index` (`v1.json` for catalogue entries, `mods-v2.json` for community
  mods, about once a session and at most every 12 hours within one) and, for a catalogue entry, its
  `hooks/hooks.json` and `.claude-plugin/plugin.json` at the entry's pinned commit. These reads are off under
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or with the `detectRemote` option off. Update checks
  (`updateCheckHours`, default 6, `0` turns them off) ask the CLI to refresh your marketplaces.
- **Reads** plugin manifests in your marketplaces' folders and where mods under development live, and, in a session
  started with `--debug`, its own debug log for failed hooks. It never reads your settings or the CLI's own files.
- **Stores** preferences, capability analyses and the last 50 finished jobs (no output) in its plugin store under
  your Claude Code config directory. No conversation text, secrets or environment values.
- **Sends** nothing else anywhere, and has no telemetry.

The full threat model is in [docs/SECURITY.md](https://github.com/ayagmar/claude-modmgr/blob/main/docs/SECURITY.md).

Needs a session on Claude Code 2.1.284 or newer (the desktop app runs its own pinned one) and the `claude` CLI on
your path at 2.1.292 or newer. MIT licensed. Source, issues and the landing page:
[github.com/ayagmar/claude-modmgr](https://github.com/ayagmar/claude-modmgr) ·
[ayagmar.github.io/claude-modmgr](https://ayagmar.github.io/claude-modmgr/).
