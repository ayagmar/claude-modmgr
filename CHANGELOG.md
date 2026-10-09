# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Discover lists mods published anywhere on public GitHub, not only those in your marketplaces: about 3,100 today,
  from a community index CI rebuilds daily (GitHub code and repository search, the candidate list of
  awesome-claude-code-mods, each repository cloned and checked with `claude plugin validate`). What a mod can do is
  shown before you install it. One whose repository has a marketplace installs from it, the review saying the
  marketplace is added to your user settings first; one without offers its link (`c`).

### Changed
- Discover sorts by popularity by default (installs for your marketplaces' entries, then community mods by stars,
  one per repository before any repository's second); `o` also sorts by stars, name or source, and `k` lists only
  your own marketplaces' entries.

## [0.1.1] - 2026-10-08

### Fixed
- In a list longer than the dialog (Discover's mods, a long Installed list, Health), moving past the first screen no
  longer skips entries or lets the highlighted row drift away from the selection; the row's mark and its detail
  now move with the highlight.

## [0.1.0] - 2026-10-08

Install with `/plugin install modmgr --marketplace ayagmar/claude-mods` (the marketplace `ayagmar`).

### Added
- Repository scaffold: tooling, CI, vendored Claude Code types, an empty `/mods` command.
- `/mods` opens a dialog: installed mods with their state and notable capabilities, a detail of what each one can
  do, staged enable/disable applied as one reviewed batch followed by an automatic plugin reload, undo, help, a job
  log, and a band above the prompt while work runs or a reload is owed.
- Update one mod (`u`) or every mod (`a`), and remove one (`x`, keeping its data unless `w` says otherwise), each
  through a review; undo (`z`) reverses the last batch, reinstalling through a review. After an update, what a mod
  can newly do shows on its row, its detail, the band, the status line and the pane's title until its detail is
  opened.
- Discover (`2`): the mods in every marketplace you have added, searchable and sortable. The official catalogues'
  mods are known at once from a catalogue index CI rebuilds daily (`.github/workflows/index.yml`,
  `scripts/build-index.ts`); the detector checks the rest (local entries on disk, GitHub entries at their pinned
  commit, search matches first, idle-only and within a request budget). Local entries show what they can do before
  install. A command-source entry can't be checked before install: `/mods install` takes it. Install (`i`) through a review with a scope picker;
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
- The dialog fills its room with the keys of the moment in a footer pinned to the bottom; from 80 columns the
  selected entry's detail sits beside the list with its own keys, and a docked dialog asks for 96 columns. Details
  read in sections a blank row apart; Discover's rows say what each mod does; Health names each mod above its
  items; Esc from a key brings the ring back to the list before it closes.
- A welcome on the first run; the tab and sort are remembered between sessions.
- `debugTimings` writes how long each step took to the debug log; `docs/PERF.md` has the measurements.
- A landing page (`site/`): the install line, the dialog as it draws, what modmgr calls out, the keys, and answers
  about network use and safety.
