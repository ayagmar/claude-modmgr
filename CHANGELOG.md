# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Repository scaffold: tooling, CI, vendored Claude Code types, an empty `/mods` command.
- `/mods` opens a dialog: installed mods with their state and notable capabilities, a detail of what each one can
  do, staged enable/disable applied as one reviewed batch followed by an automatic plugin reload, undo, help, a job
  log, and a band above the prompt while work runs or a reload is owed.
- Update one mod (`u`) or every mod (`a`), and remove one (`x`, keeping its data unless `w` says otherwise), each
  through a review; undo (`z`) reverses the last batch, reinstalling through a review. After an update, what a mod
  can newly do shows on its row, its detail, the band, the status line and the pane's title until its detail is
  opened.
- Discover (`2`): every marketplace's catalogue, searchable and sortable, with a detector that finds which entries
  are mods (local entries read on disk, GitHub entries at their pinned commit, idle-only and within a request
  budget). Local entries show what they can do before install. Install (`i`) through a review with a scope picker;
  a marketplace-declared install command is shown verbatim with its sha256 and accepted only from that review. Add
  a marketplace (`m`).
- Dev (`3`): the mods this session runs from a folder you edit (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, this
  session's mods folder, your skills folder, folder marketplaces), with `v` validate (strict), `t` test (streamed into
  the job log, `q` cancels), `l` reload, `c` copy the path, `p` share (the install line and the marketplace file it
  needs), and the failures the session reports while it hot-reloads one.
- Health (`4`): what needs you, by mod and worst first (validate errors, what an update added, updates found,
  failures while reloading, hook failures in a `--debug` log), hook-order notes, and modmgr's own state (reload owed,
  cache, update checks, the detector), each with a one-press fix.
- Update checks every `updateCheckHours` (default 6, `0` turns them off; off under
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), while no turn runs: marketplaces are refreshed and mods with a newer
  version get `↑`. The status line under the prompt says one thing at a time.
- `/mods` as text for scripts and `-p` runs: `list`, `info`, `doctor [--json]`, `export`, and `install`, `remove`,
  `update`, `enable`, `disable`, `apply <file>`, which need `--yes` and say how to apply what they changed.
- A welcome on the first run; the tab, sort and filter kind are remembered between sessions.
- `debugTimings` writes how long each step took to the debug log; `docs/PERF.md` has the measurements.
