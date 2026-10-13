# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- `notifyUpdates` (off by default): when an update check finds a new mod version, modmgr sends a notification
  through your terminal, once per version, unless its dialog has your keys. Needs Claude Code 2.1.296 or newer;
  on an older one the option does nothing.

## [0.4.2] - 2026-10-13

### Fixed
- A mod's GitHub link opened `https://github.com/…`, a 404, in terminals that show links as plain text (inside
  Herdr or tmux, for example). The detail cut the line at the pane's edge, and the terminal took what was left as
  the URL. The detail now shows the whole URL, wrapped onto more lines when needed.
- In a narrow pane, the line under the tabs and a detail's facts line wrap between parts instead of cutting one
  short: `37k stars` moves to the next line rather than showing as `37k s…`, and Discover keeps `r tries again`
  whole.

## [0.4.1] - 2026-10-12

### Added
- Discover says when GitHub's mods couldn't be read, or when their index is days old because its daily builds
  stopped; `r` reads them again at once instead of waiting out the hour between tries.

### Changed
- Enter on a row beside its detail opens the detail over the whole body, in full, and it scrolls to its last line
  with its keys kept in view; beside the list a short pane still shows the compact form. On the desktop a click
  selects a row and a click on the selected row opens it, as Enter does in a terminal.
- Undo says what it would reverse before you press it (`z: turn redactor back on`, or `undo 2 changes`), and
  the notice says it again once queued.
- The first load of Installed shows each mod as soon as it is read, instead of after the slowest one, and its
  header says how many plugins are still being read.
- Plainer wording across the dialog and `/mods` text: "unchanged" and "nothing to change" replace "already so",
  and a refused command acceptance says Claude Code won't accept it from this session. The plugin's description no
  longer says "function-hook".
- A `claude` CLI on your path older than 2.1.292 is treated like a missing one: modmgr makes no changes, and the
  dialog, Health and `/mods` text say to run `claude update`.
- `/mods list` prints each mod's id (`name@marketplace`), and `info`, `enable`, `disable`, `remove` and `update`
  take a bare name when only one installed mod has it.
- A mod's detail says when an update is available (`↑ 2.2.0 available`); the line for a mod that can't update no
  longer uses the update arrow.
- Discover with no marketplaces says there is nothing to list yet and offers `m` to add one.
- The welcome says what undo covers: your last batch of toggles, installs or removals. `z` appears once you have changed a mod, and the review of an update says "run it and update".
- Two installed mods with the same name show their marketplace in their rows and get separate Health groups.
- Discover reads every community mod from a new file, `mods-v2.json`, which has no size limit. `mods-v1.json`
  stays for modmgr 0.4.0 and older, holding the most-starred mods that fit the 4 MiB they read.
- The daily index build reuses what it read in a repository nobody has pushed to since, so it clones only what
  changed; every repository is read again on Sundays.

### Fixed
- The landing page's daily rebuild no longer fails as the community index grows: its data budget is per mod.
- Undo survives the periodic update check and Dev's validate and test runs, which used to take its place.
- Prerelease versions get updates (`1.2.0-beta.1` to `1.2.0`), and a version written `v1.2.0` is read.
- Saving many catalogue entries at once (the first index sync) no longer blocks modmgr for seconds.
- Key hints name the right keys: `q` for the job log, `s` for reload.
- A job cancelled while a `/mods … --yes` batch waits no longer runs, and a batch that fails midway no longer leaves
  a job running until the next session.
- Changes made while modmgr's store was still loading are no longer lost.
- More invisible characters are stripped from names and descriptions, and `/mods` text no longer offers
  `--accept-command` for a declared command that holds hidden characters.
- The community index build refuses to publish when the last index can't be read, retries GitHub metadata
  requests, and keeps the previous entries of repositories it couldn't read. A failed download no longer drops the
  community index from the published branch, and a slow mods build no longer stops the catalogue index from
  publishing.
- The release workflow runs the gate without write access and refuses a tag that doesn't match `plugin.json`.
- A reload modmgr owed is no longer forgotten when modmgr alone starts again (an options change, a worker
  restart, a hot reload of its folder): only its own reload, or your `/reload-plugins` where only you can reload,
  counts as applied.
- When Claude Code won't accept a GitHub mod's declared command from the session, the terminal command the review
  copies adds the mod's marketplace (`--marketplace owner/repo`), so it works before you have added it.
- In a pane too narrow for the tabs, they wrap onto a second line instead of cutting off Health's problem count.
- A refresh that fails partway no longer leaves the `↻` marker up.
- A mod that fails validation shows its first errors in its detail and in `/mods info`, not only how many there are.
  modmgr reads such mods again once to keep them.
- Validate errors in Dev and the job log name files from the mod's folder and wrap instead of being cut off, and
  counts read "1 error", not "1 errors".
- Discover's default sort no longer puts a catalogue's mods with no install counts above every GitHub mod, in name
  order: those mods sort by stars among the rest.
- Enter in the search field moves to the selected result instead of staying in the field.
- The undo notice reads "Queued: undo 2 changes" instead of "Undo: undo 2 changes".
- Health's Discover line says its count is of your marketplaces' mods, so it doesn't read as the whole catalogue.
- In an install review a long name stays whole, and a blank line follows the list of what the mod can do.

## [0.4.0] - 2026-10-09

### Added
- Every list pages: `‹ prev` and `next ›` beside the pager, Page Up and Page Down, a page of items at a time; the
  selection opens the new page.
- Vim's keys: `j` and `k` step the selection as the arrows do, `h` and `l` move to the previous and next tab; the
  mouse wheel steps the selection on every tab, Health included.
- Dev lists modmgr itself when it runs from a folder (`--plugin-dir`) over an installed copy.
- Discover says what a remote catalogue entry can do before you install it when the community index read the same
  files, and at which commit; modmgr still reads the installed version again.
- A mod's detail in Discover links its page on GitHub, and a community mod's install review the repository it
  installs from: the desktop app opens it on a click, and terminals that support links (OSC 8) on a click too.
- An installed mod's detail and `/mods info` say what it is and link its page, as its `plugin.json` gives them
  (`description`, and `homepage` else `repository`).
- A marketplace's mod shows its repository's GitHub stars, as a community mod does, and sorts among them by stars;
  the count at a row's end is the one the list is sorted by.
- The community index reads every mod the official catalogues list, including those GitHub search hasn't found, so
  Discover knows their stars and what they can do.

### Changed
- Discover opens on its catalogue: the slowest read (about a second) starts when `/mods` first shows another tab.
- Keys moved to make room for vim's: jobs is `q`, the key list `0`, reload `s`, Discover's "yours only" `u`, and the
  job log cancels with `d`. The key list groups every key that moves apart from the actions.
- Health reads as a status page: each of modmgr's own rows is named (Mods, Updates, Discover, Cache, Hook errors) in
  plain words, and the line under the tabs says in color whether anything needs you.
- A mod's detail too short for every name and explanation counts the hooks and calls that only draw instead of
  listing every name, and names `/mods info <id>`, which explains each one.
- The terminal's "ctrl+x tab to use these keys" stands out while the prompt has the keys.
- A review shows each command it will run whole, wrapped, instead of cutting it at the dialog's edge; an install's
  review no longer repeats the mod's name before each thing it can do.
- The job log names each job in words (Refresh marketplace, Reload plugins) and says done, waiting or nothing to
  change instead of the job's internal kind and state.
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
- A review taller than the pane scrolls with the wheel and Page Up/Down, its heading and keys kept, instead of
  cutting off its last lines, where the commands it runs are; a declared command scrolls a row at a time, so a
  single line longer than the pane is read to its end before it can be accepted. The key list and the first
  session's welcome scroll the same way in a short pane, the welcome's start key always in view.
- A declared command holding hidden or control characters is accepted in a terminal, not in the review, which can't
  show it as it is.
- In Discover the ring stays on the selected row when moving it scrolls the list, instead of landing rows away from
  the selection and its detail.
- Installed lists every installed mod however many plugins modmgr has read before, instead of dropping the oldest
  from the list, their detail and the hook order once its cache filled; installed plugins it couldn't read are named
  on the tab and in Health, with a way to read them again, instead of reading "No mods installed yet".
- A change queued while another batch waits for its reload is applied by that one reload even when the first batch
  failed or changed nothing, instead of the reload being dropped and the change waiting for a reload by hand.
- A tab, sort or welcome choice made while modmgr is still reading its saved preferences at start-up is kept,
  instead of the older saved values replacing it.
- Dev's `t` stops a mod's tests still running after ten minutes and says they ran past their time, as every other
  command modmgr runs already did, instead of waiting on them until cancelled.

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
