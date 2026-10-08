# Security

modmgr manages **mods**: Claude Code plugins that ship a hooks module and run inside your session. This page says what
modmgr protects you from, what it can't, and how it's built to keep that promise.

## What modmgr is, and isn't

modmgr is a **lens, not a sandbox**. It shows what a mod can do before you install, enable or update it, and makes those
changes deliberately. Once a mod is enabled it runs with the full power the Claude Code engine gives a hooks module:
modmgr can't contain it, watch it, or stop it mid-session. The only ways to stop a mod are to disable or remove it and
reload, or to stop launching it.

## Threat model

| Threat | Example | What modmgr does |
|---|---|---|
| **A hostile catalogue entry** | A look-alike name, a description with terminal escapes or bidi overrides, a plugin id shaped like a flag | Every id is checked against a strict pattern before it reaches a process (below). All untrusted text is sanitised and drawn as plain text, never Markdown. Names are always shown with their marketplace. |
| **A malicious mod** | A mod that reads your conversation and posts it somewhere, runs programs, or rewrites what the model reads | In every detail view, and **before install for an entry whose files are on disk** (a folder in its marketplace or its clone), modmgr shows the mod's **capabilities as facts** from `claude plugin validate --json` (what it hooks, what it calls, which environment variables it reads), grouped by reach, with the dangerous combinations called out ("Can read your conversation and send data out"). A remote entry is read once installed, and the install review says so. After an update it shows what was **added**. It does not block anything: you decide. |
| **A compromised marketplace** | A marketplace changes the command it declares for an install, or its `headersHelper` | An install runs without acceptance first; when the marketplace declares a command, nothing runs (the CLI enforces this) and the job stops. modmgr then shows the command **line for line with its sha256** (and says when sanitising removed hidden or control characters) on a review whose confirm key reads "run it and install". Confirming passes `--accept-command <sha256>`: the CLI runs the command only while it is still that very command, and otherwise shows the new one, which modmgr reviews again. modmgr never passes `-y`. |
| **modmgr's own bugs** | A crash in a hook, a corrupt store, an unreadable CLI answer | Every hook has a `.catch` that passes through, so a failing modmgr never blocks a session event. Errors are values, never thrown across layers. The store is shape-checked on every read and starts a key empty when it's unreadable. A CLI answer modmgr can't parse is reported, never guessed. |

## Trust boundaries worth knowing

- **modmgr's review screen is the only gate for a declared command.** When you confirm, modmgr passes
  `--accept-command <sha256>` for exactly the command you saw. The CLI binds the acceptance to that command, plugin and
  catalogue revision; any change refuses the install. If Claude Code refuses the acceptance from inside a session
  ("ignored inside a Claude Code session"), modmgr says so and offers to copy the terminal command instead. It never
  works around the refusal.
- **A plugin's `name`, `version` and `provenance` are its own word.** A plugin chooses the name and version in its own
  manifest; they prove nothing about who wrote it. modmgr keys everything by the `pluginId` the CLI reports
  (`<name>@<marketplace>`), shows the marketplace beside every name, and treats the marketplace you added as the root
  of trust.
- **Capabilities come from static analysis.** `claude plugin validate` lists every engine call a module's source
  spells, and refuses the forms that would hide one (`$` passed across files, stored, or used as a value). Read the
  list as what the validated code says it does, not as a proof of what it can't do, and only for that version.
  Updated code is re-validated; a dev folder edited without a version bump is re-validated when you press `v` in Dev.
- **Mods loaded by your launch command** (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`) load before any installed plugin
  and can't be toggled from inside a session. modmgr shows how they were loaded and how to stop loading them.

## How it's built

**Processes.** modmgr runs only the `claude` CLI, by argument vector, never through a shell
(`plugin/hooks/domain/argv.ts`). Every value in an argv has been checked by `plugin/hooks/domain/ids.ts`:

- plugin ids match `^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$` (so never a leading `-`), and loader ids
  (`@inline`, `@builtin`) are refused for CLI changes;
- scopes come from an enum; `managed` is never changed;
- paths are absolute, with no NUL, CR, LF or `..` segment;
- a sha256 is 64 lowercase hex characters;
- a marketplace source is `owner/repo`, an `https://` URL without hidden characters, or an absolute path.

Queued jobs live in `$.state` (so they survive a reload of modmgr). Because another version of modmgr may have written
them, each job is **checked again** when it becomes a command. Every run has a timeout. Children inherit the session's
environment untouched: modmgr never sets or strips variables for them (stripping `CLAUDECODE` to get around Claude
Code's acceptance check is exactly what modmgr must not do). Project and local scope changes run with the session's
project root as the working directory, and the review screen says when a change edits `.claude/settings.json` in your
repository.

**Text commands.** `/mods install | remove | update | enable | disable | apply` change nothing without `--yes`;
without it they print the CLI lines they would run. With it they run the same checked jobs as the dialog (the runner's
own `runJob`), record them in the job log and the history, and never reload. A declared install command is printed whole with its sha256 and runs only when `--accept-command <that sha>`
is given (the CLI binds the acceptance to that command); modmgr never passes `-y`. `apply <file>` reads the file
you name (a relative path is under the session's directory, an absolute one is read as given; at most 4 MiB, 100
entries) and accepts only plugin ids and scopes. A write is refused while another job is running.

**Settings.** modmgr never writes a settings file. Every change goes through `claude plugin …`, which owns those files.

**No `plugin.register` hook.** modmgr doesn't judge or refuse other plugins in v1. (A hook there would make every
module reload with modmgr, and would only see modules loaded after it.)

**Untrusted text.** Names, descriptions, CLI messages, validate issues and test output pass through
`plugin/hooks/domain/sanitize.ts`: ANSI and other escape sequences, C0/C1 controls, bidi embeddings, overrides and
isolates, and zero-width characters are removed, and lengths are capped. The text is drawn as `Text`, never
`Markdown`, so a link or image in a description stays inert. The source tree itself is checked for raw control, bidi
and zero-width characters (`test/layering.test.ts`).

**Network and files.** modmgr makes no network requests of its own except the mod detector's reads of
`https://raw.githubusercontent.com/`: the catalogue index (`ayagmar/modmgr`, branch `catalog-index`, `v1.json`, at
most every 12 hours) and a catalogue entry's `hooks/hooks.json` and `.claude-plugin/plugin.json` at the entry's pinned
commit (at most 600 a session, only while no turn runs), without credentials, with response sizes checked and JSON
shape-checked. Asking for the index tells GitHub, as any of these reads does, that this address runs modmgr; it
carries nothing about the person's catalogues or mods. The index only classifies: a kind is taken for an entry only
when the index's key (the pinned commit, or the version of a local entry) is the entry's own, a malformed file is
refused whole, and installing still goes through the review of what the entry can do. A wrong or hostile index can
at worst mislabel an entry's kind, which changes Discover's order and its "mods only" filter. They are off when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (to anything but
empty, `0` or `false`) or `detectRemote` is off. For an entry whose files are on disk, the detector reads the same two
files with `$.fs.read`, at paths inside that marketplace's folder (checked segment by segment: no `..`, no absolute
part); a symbolic link there is read where it leads, and what is read only decides the entry's kind. Dev reads
plugin manifests (`.claude-plugin/plugin.json`, `marketplace.json`) and lists folders (`$.fs.list`) where mods under
development live: this session's mods folder (under `CLAUDE_CONFIG_DIR`, or `~/.claude` from `HOME`, the only reason
modmgr reads those two variables), where the session runs, and a folder a failure notice named. It never writes a
file: `p` (share) shows the marketplace file to write and copies the install line. `v` and `t` run `claude plugin
validate` and `claude plugin test` on a dev mod's folder, which runs that mod's own tests: the person's code, on
their key press. The CLI's own fetches (`marketplace add/update`, installs) are the CLI's. Because modmgr both reads
files and fetches, its own capability list (as modmgr would show it) carries "Can read your conversation or files and
send data out": what it reads is plugin manifests, and what it fetches is the same manifests by URL; nothing it reads
is sent.

**Update checks and Health.** Every `updateCheckHours` (off at `0` and under the traffic switch), while no turn runs,
modmgr asks the CLI to refresh the marketplaces your installed mods come from (`claude plugin marketplace update
<name>`, the CLI's fetch), then reads each one's `.claude-plugin/marketplace.json` under its install location. Health
lists `<config dir>/debug` and, when this session runs with `--debug`, reads its own log (`<session id>.txt`, not
another session's) for `hook failed closed` lines, keeping only the plugin's name, the event and the error kind (the
engine logs no error text). modmgr never reads
the CLI's internal files (`installed_plugins.json`, settings) or the project's settings.

**Notices.** modmgr hooks `session.append` for notices only (`door: 'notice'`, the dim lines the model never reads),
to count a hot-reloaded plugin's failures for Dev. A failure notice that names a module's file (`reload failed`, `did not load`) gives a folder; modmgr reads that
folder's `plugin.json` once and lists it in Dev only when the manifest names the same plugin. The hook calls `next`
first and returns the row the
session stored, unchanged; its `.catch` passes through. The validator still reports it as a gating hook (any
`session.append` hook is one), and a capability list built from event names, modmgr's own included, places it under
"what the model sees": that is the event's reach, not what this hook does with it. `scripts/validate-plugin.ts` allows
this gate with exactly that matcher and no other.

**No telemetry.** modmgr never calls `$.telemetry`; `node scripts/validate-plugin.ts` fails the build if it does.

**What modmgr stores.** `$.store` (a JSON file under your Claude Code config directory) holds preferences, the
detector's per-entry verdicts, per-version capability analyses, the notable capabilities each installed mod had at its
last version, the last 50 finished jobs (kind, target, outcome; no output), and when the catalogue index was last
asked for and built. It never holds the catalogue, secrets,
environment values or conversation text. It stays under 1 MiB; past 3 MiB modmgr stops writing and offers to clear its
cache.

**State.** `$.state` values are readable by every plugin in the session (the engine's rule). modmgr keeps nothing there
that isn't already visible to plugins: the installed list, job progress, the current view.

## Reporting a vulnerability

Please report security issues privately through
[GitHub security advisories](https://github.com/ayagmar/modmgr/security/advisories/new), not in a public issue.
Include the Claude Code version (`claude --version`), modmgr's version, and the steps to reproduce.
