# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

## [0.4.0] - 2026-10-09

### Added
- Every list pages: `‹ prev` and `next ›` beside the pager, Page Up and Page Down, a page of items at a time; the
  selection opens the new page.
- Vim's keys: `j` and `k` step the selection as the arrows do, `h` and `l` move to the previous and next tab; the
  mouse wheel steps the selection on every tab, Health included.
- Dev lists modmgr itself when it runs from a folder (`--plugin-dir`) over an installed copy.

### Changed
- Keys moved to make room for vim's: jobs is `q`, the key list `0`, reload `s`, Discover's "yours only" `u`, and the
  job log cancels with `d`. The key list groups every key that moves apart from the actions.
- Health reads as a status page: each of modmgr's own rows is named (Mods, Updates, Discover, Cache, Hook errors) in
  plain words, and the line under the tabs says in color whether anything needs you.
- A mod's detail counts the hooks and calls that only draw instead of listing every name; Enter still lists them.
- The terminal's "ctrl+x tab to use these keys" stands out while the prompt has the keys.
- A session on Claude Code 2.1.284 or newer loads modmgr (the desktop app runs its own pinned engine); the `claude`
  CLI it runs still needs 2.1.292 or newer.
- The desktop app draws the dialog as a desktop layout: the detail is a card beside the list instead of a column of
  `│`, the header no longer overlaps the rows under it, and names and rules wrap instead of being cut.
- In a fullscreen terminal the dock leaves the transcript about 72 columns, up to 96 for the dialog, instead of always
  asking for 96.
- Health is a full-width checklist: each item reads whole with its fix on the row, and Enter opens one.
- A tab with nothing to list (Dev with no mods under development) gives its text the whole body.
- A mod's detail wraps what it can do beside each reach instead of cutting the list at the edge.
- Discover's sort by stars takes one mod per repository first, as sorting by popularity does, so one repository's many
  mods no longer fill the first pages.
- modmgr no longer hooks the session's notice lines, so its own capability list no longer says it "can change what
  the model reads". Dev no longer counts a mod's reload failures as they happen; Health still names hook failures
  from the debug log (`--debug`), and `v` validates a mod under development.
- modmgr's own detail says why it needs what it can do: it runs only the `claude` CLI, and it reads plugin manifests
  and fetches the daily indexes, sending nothing it reads.

### Fixed
- After an install, update or toggle reloads the plugins, the dialog keeps the keys it held instead of leaving them
  to the prompt, where the next keys typed landed in the message box.
- In the desktop app a click on a row beside the detail selects it.
- The Installed detail loads for the first row when the selection never moved, instead of reading "Reading what it
  can do…" until a key is pressed.
- In the desktop app, whose sessions refuse a plugin's `/reload-plugins`, a batch says the reload failed and asks you
  to run `/reload-plugins`, instead of reporting the changes applied.

## [0.3.0] - 2026-10-09

### Added
- Discover's detail says when a community mod is kept in its repository's `.claude` folder: a mod that project uses
  itself, loaded from a clone. The landing page marks such mods Project mod.
- The landing page says up front that modmgr is a Claude Code plugin, with its install line to copy, above the search.
- The landing page shows 20, 40 or 100 mods a page (`per=` in the URL); changing it keeps the first mod in view on screen.
- A link can name a mod (`?mod=owner/repo/path`): the page opens on the page holding it, with it selected, and
  Copy link in its detail copies that link.

### Changed
- Lists move their highlight down a still list and scroll only at the edge, instead of keeping the selection centred
  and moving every row at each key.
- Discover's detail shows a mod's whole description, not the line the list draws.
- A mod's detail wraps what each hook and call does instead of cutting it, and a hook reads `on <event>`, so it is
  never taken for the call of the same name.
- The landing page shows 20 mods a page by default (was 40).

### Fixed
- Discover lists a plugin two catalogues share (Anthropic's official catalogue and its directory list about 250
  alike) once, from the catalogue that counts its installs.
- Link previews (Discord, Slack, X) show the current social card: its URL changes whenever the card does.

## [0.2.0] - 2026-10-09

### Added
- Discover lists mods published anywhere on public GitHub, not only those in your marketplaces: about 3,000 today,
  from a community index CI rebuilds daily (GitHub code and repository search, the candidate list of
  awesome-claude-code-mods, each repository cloned and checked with `claude plugin validate`). What a mod can do is
  shown before you install it. One whose repository has a marketplace installs from it, the review saying the
  marketplace is added to your user settings first; one without offers its link (`c`).

### Changed
- Discover sorts by popularity by default (installs for your marketplaces' entries, then community mods by stars,
  one per repository before any repository's second); `o` also sorts by stars, name or source, and `k` lists only
  your own marketplaces' entries.
- The landing page is a store for Claude Code mods: search every mod in the community index on the page, filter it
  by what a mod can reach, and copy its install line from the datasheet beside the results.

### Fixed
- `/mods` typed right after launch, with Discover the tab left open last time, no longer opens on an empty
  Discover that says your marketplaces list nothing.

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
