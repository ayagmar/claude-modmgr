# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Claude Code users who run, or are about to try, mods: plugins with a hooks module that run inside their session. They
reach the page from the repository, a marketplace listing or a link, and decide in a minute whether to paste the install
line. Mod authors are a secondary audience (the Dev tab), not the page's focus.

## Product Purpose

modmgr is a mod manager for Claude Code, opened with `/mods` inside a session. It shows which mods are installed, what
each one can do (grouped by what it reaches: your machine, the network, the conversation, the model's input, other
plugins), and lets the person find, install, switch off, update or remove them without leaving the session. Success for
the page: a visitor understands what `/mods` shows and copies the install line.

## Positioning

It reads each mod's capabilities from Claude Code's own validator (`claude plugin validate --json`) and says, in plain
words, what an update added ("turn-band can now run programs"). A declared install command is shown whole with its
sha256 and runs only when the person confirms that exact command. It is a lens, not a sandbox: it never claims to
contain a running mod.

## Operating Context

Used inside a Claude Code terminal session, usually docked fullscreen beside the transcript, driven by keys (every
control is also clickable). Also usable as text (`/mods list | info | doctor | export`, writes behind `--yes`) for
scripts and `claude -p`.

## Capabilities and Constraints

- Tabs: Installed, Discover (mods only), Dev, Health. Staged changes, one reload, undo of the last batch.
- Needs Claude Code at the version in `plugin/hooks/domain/version.ts` (`MIN_CLAUDE_VERSION`), with the `claude` CLI on
  the path.
- Network: the CLI's marketplace refresh, plus reads of the catalogue index and entries' manifests from
  raw.githubusercontent.com; all off under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. No telemetry.
- Install line, verbatim: `/plugin install modmgr --marketplace ayagmar/claude-mods`.
- The site is static Astro, base `/claude-modmgr`, no client framework, Lighthouse 100 in all four categories, first
  visit under 100 KB fonts aside, self-hosted fonts.

## Brand Commitments

- Name: modmgr, lowercase.
- Voice: plain, specific, literal; every claim traceable to README.md or docs/SECURITY.md. No marketing fluff.

## Evidence on Hand

- `site/src/data/demo.ts`: five real frames (Installed, Detail, Discover, Review, Health) rendered from the dialog over
  the fixture world by `test/demo`. Generated; never edited by hand. The fixture mods (broken, quiet-bash, redactor,
  spawner, turn-band, secret-scrub…) are test fixtures, not real catalogue entries.
- `plugin/hooks/domain/keymap.ts` (keys) and `capabilities.ts` (`notableText`) feed the page directly.
- No users, testimonials, install counts or benchmarks exist; none may be invented.

## Product Principles

- Show the dialog itself; the frames are the proof.
- Say what modmgr cannot do as clearly as what it can.
- Facts come from the plugin's own sources so the page can't drift.

## Accessibility & Inclusion

Lighthouse accessibility 100 in CI; keyboard and no-script paths must work; reduced motion respected.
