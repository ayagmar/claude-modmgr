# modmgr: find and manage Claude Code mods from inside your session

Mods are Claude Code plugins that run code in your session: they can run programs, read the conversation and change
what the model sees. Thousands of them are published across GitHub, with no store to search them and no quick way to
tell what one does before it runs. modmgr adds `/mods`, a dialog that searches them, says what each one can reach
before you install it, and installs, switches off, updates or removes them without leaving the session.

```
/plugin install modmgr --marketplace ayagmar/claude-mods
```

Type that at the Claude Code prompt, then `/mods`. [Search the same index in a browser](https://ayagmar.github.io/claude-modmgr/).

The Installed tab, with a mod's detail beside the list:

```
Installed   2: Discover   3: Dev   4: Health ▲1                                       r: refresh
5 of 5 mods on
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⌕ Filter 5 mods                                                                    f: filter │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
  ● broken             ▲1              │ redactor 2.1.0
  ● quiet-bash         ◆1              │ ● on · project · fixtures
❯ ● redactor           ◆3              │ e: disable  x: remove  c: copy id
  ● spawner            ◆2              │ runs from its marketplace folder: no updates
  ● turn-band          ◆2 new          │ Redacts secrets from what the model reads and posts a …
                                       │ Notable
                                       │ ◆ Can read your conversation or files and send data out
                                       │ ◆ Reads environment variables that look like secrets
                                       │ ◆ Can change what the model reads
                                       │ What it can do
                                       │ /mods info redactor@fixtures explains each one.
                                       │ Network             http.fetch
                                       │ Session content     env.get  session.messages
                                       │ What the model sees on session.append
                                       │ Display only        1 hook or call
                                       │ ✓ validates
────────────────────────────────────────────────────────────────────────────────────────────────
                                                                     q: jobs  0: keys  esc close
```

## What it does

- **Searches the mods published on GitHub.** Discover lists the mods in the marketplaces you have added and the
  thousands of community mods found on public GitHub. modmgr's CI rebuilds both indexes daily, so the list appears at
  once. Sort by popularity, stars, name or source with `o`; keep only your own marketplaces with `u`.
- **Shows what a mod can reach before you install it.** Each mod's detail groups what it hooks and calls by what that
  touches: your machine, the network, the conversation, the model's input, other plugins. Risky combinations get a
  line of their own, such as "Can read your conversation or files and send data out". This comes from
  `claude plugin validate`, which reads the source and runs none of it.
- **Reviews every install.** The review says what will run and where. A command a marketplace declares is shown in
  full with its sha256, and runs only when you confirm that exact command.
- **Says what an update added.** When an update adds something notable, such as running programs, the detail says so
  until you have seen it. Updates are checked every few hours while no turn is running.
- **Stages changes and undoes them.** Toggle, update or remove several mods and apply them with one plugin reload.
  `z` undoes your last batch of toggles, installs or removals; an update can't be undone.
- **Helps you write mods.** Dev lists the mods you load with `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, your skills
  folder or a folder marketplace: validate them, run their tests, reload, and copy the line someone else needs to
  install yours.
- **Lists what needs fixing.** Health lists what needs you, worst first, each with a fix one key away.

## Requirements

- A Claude Code session at 2.1.284 or newer, and the `claude` CLI on your path at 2.1.292 or newer. modmgr runs the
  CLI to install, update and switch mods.
- The one-line install needs a session at 2.1.292 or newer. On an older one, add the marketplace first:
  `/plugin marketplace add ayagmar/claude-mods`, then `/plugin install modmgr@ayagmar`.
- The desktop app runs its own pinned Claude Code, separate from the CLI on your path. If that is older than 2.1.284,
  modmgr loads there once the app updates.
- Linux or macOS. Windows paths aren't supported yet.

## As text

For scripts and `claude -p`:

```
/mods list | info <mod> | doctor [--json] | export
/mods install <id> [--scope user|project|local] [--accept-command <sha256>] --yes
/mods remove <mod> [--wipe-data] --yes
/mods update [<mod>] --yes
/mods enable <mod> --yes | disable <mod> --yes
/mods apply <file> --yes
```

`<id>` is `name@marketplace`, as `/mods list` prints it. `<mod>` is an installed mod's id, or its name alone when no
other installed mod shares it.

Without `--yes`, a write prints what it would run and exits 1. Writes never reload: run `/reload-plugins` after.
Exit codes: 0 done, 1 refused, failed or not confirmed, 2 usage. Under `-p`, Claude Code prefixes the answer with `modmgr: `.

## Options

Set them with `claude plugin configure modmgr`:

| Option | Default | |
|---|---|---|
| `updateCheckHours` | 6 | Hours between update checks; 0 turns them off. |
| `detectRemote` | on | Read the daily indexes, and catalogue entries' `hooks.json`, from raw.githubusercontent.com to find mods. |
| `debugTimings` | off | Write how long each step took to the debug log (`--debug`). |

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off everything modmgr fetches. modmgr sends no telemetry.

## Safety

modmgr shows you what a mod can do; it does not sandbox it. Once a mod runs, it runs with your session's power, and
the way to stop it is to disable or remove it and reload. Capabilities come from static analysis of the version you
install, and an update is read again. [docs/SECURITY.md](docs/SECURITY.md) has the threat model and lists everything
modmgr reads, fetches and stores.

## Troubleshooting

- **`/mods` isn't a command.** Run `/reload-plugins`, or start a new session. In the desktop app, check the version
  note under Requirements.
- **Installed or Health says the CLI failed or is too old.** Update the `claude` CLI on your path (`claude update`)
  to 2.1.292 or newer.
- **Discover lists only your marketplaces.** modmgr couldn't read the community index: you are offline,
  `detectRemote` is off, or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set. `r` tries again.
- **A mod's hooks fail without a word.** Start the session with `claude --debug`; Health then lists hook errors from
  that session's debug log.

## Uninstall

```
claude plugin uninstall modmgr@ayagmar
```

Its preferences and cache are in `plugins/store/modmgr_ayagmar-*.json` under your Claude Code config directory
(`~/.claude` unless `CLAUDE_CONFIG_DIR` says otherwise). Delete that file to remove them too.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/PERF.md](docs/PERF.md). The landing page is in `site/`
(`pnpm site`).

## Credits

The community index finds mods the way [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods)
(browse it at [mods.aidojo.si](https://mods.aidojo.si/)) does, and reads its list of candidate repositories (CC0) so a
mod GitHub's search hasn't indexed yet is still found.

## License

MIT
