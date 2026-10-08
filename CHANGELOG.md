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
