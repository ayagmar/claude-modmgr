# modmgr

A mod manager for [Claude Code](https://claude.com/claude-code). Mods are plugins that hook into a Claude Code
session: they can run programs, read the conversation, change what the model sees. modmgr shows which ones you have
and what each one can do, and lets you find, install, switch off, update or remove them without leaving the session.

```
/plugin install modmgr --marketplace ayagmar/modmgr
```

Then type `/mods`. Needs Claude Code 2.1.292 or newer, with the `claude` CLI on your path.

## What you get

**Installed** lists every mod with its state, version, scope and what it can do. Changes are staged and applied
together, with one plugin reload after, and the last batch can be undone.

```
Installed   2: Discover   3: Dev   4: Health ▲1                                       r: refresh
5 of 5 mods on
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⌕ Filter 5 mods                                                                    f: filter │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
  ● broken             ▲1              │ redactor 2.1.0
  ● quiet-bash         ◆1              │ ● on · project · fixtures
❯ ● redactor           ◆3              │ e: disable  x: remove  c: copy id
  ● spawner            ◆2              │ ↑ runs from its marketplace folder: no updates
  ● turn-band          ◆2 new          │ Notable
                                       │ ◆ Can read your conversation or files and send data out
                                       │ ◆ Reads environment variables that look like secrets
                                       │ ◆ Can change what the model reads
                                       │ What it can do
                                       │ Network http.fetch
                                       │ Session content env.get session.messages
                                       │ What the model sees session.append
                                       │ Display only session.end
────────────────────────────────────────────────────────────────────────────────────────────────
z: undo                                                              j: jobs  h: keys  esc close
```

**A mod's detail** says what it hooks and calls, grouped by what that reaches (your machine, the network, the
conversation, the model's input, other plugins), and calls out what's worth a second look. When an update adds
something notable, it says so until you have seen it:

```
Installed   2: Discover   3: Dev   4: Health ▲1
5 of 5 mods on
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⌕ Filter 5 mods                                                                    f: filter │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
  ● broken             ▲1              │ turn-band 0.4.0
  ● quiet-bash         ◆1              │ ● on · user · fixtures
  ● redactor           ◆3              │ e: disable  x: remove  c: copy id
  ● spawner            ◆2              │ ↑ runs from its marketplace folder: no updates
❯ ● turn-band          ◆2              │ New since 0.3.1
                                       │ ◆ Can run programs or change files on your machine
                                       │ Notable
                                       │ ◆ Can change what the model reads
                                       │ What it can do
                                       │ Your machine process.run
                                       │ What the model sees prompt.submit
                                       │ Display only turn.complete ui.render clock.now state.s…
                                       │ ✓ validates
────────────────────────────────────────────────────────────────────────────────────────────────
                                                                      j: jobs  h: keys  esc back
```

**Discover** searches every marketplace you have added, mods first. The official catalogues' mods are known at once
from an index modmgr's CI rebuilds daily; anything else is checked a little at a time while you work, what you're
looking at first. Installing goes through a review that says what will run and where; a command a marketplace declares is
shown whole, with its sha256, and runs only when you confirm that exact command.

```
1: Installed   Discover   3: Dev   4: Health ▲1
201 plugins · 0 mods so far · checking 0 of 200                                      1–13 of 201
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⌕ Search 201 plugins                                                               f: search │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
❯   frontend-design               1.2M │ Install aws-serverless from claude-plugins-official
    code-review                   492k │ y: confirm  n: cancel
    context7                      458k │ scope: user: every project ▾
    security-guidance             273k │ ● install   aws-serverless claude-plugins-official · u…
    telegram                      110k │ modmgr reads what it can do once it is installed,
    plugin-dev                     73k │ and shows it in its detail then.
    agent-sdk-dev                  70k │ Takes effect after the reload modmgr runs.
    gopls-lsp                      45k │ Runs
    discord                        36k │   claude plugin install aws-serverless@claude-plugins-…
    php-lsp                        35k │
    clangd-lsp                     32k │
    claude-security                23k │
    laravel-boost                  23k │
────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                        esc back
```

**Dev** lists the mods you are writing (loaded with `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, your skills folder or
a folder marketplace): validate them, run their tests, reload, and get the line someone else needs to install yours.

**Health** lists what needs you, worst first, each with a fix one key away:

```
1: Installed   2: Discover   3: Dev   Health ▲2                                       r: refresh
2 problems to look at
❯ ▲ broken     validate finds 1 error… │ broken
  ▲ redactor   1 failure while it rel… │ validate finds 1 error in it
    modmgr     5 enabled               │ → see it
               updates checked never,… │
               detector: 50 of 200 ch… │
               cache: 194 B            │
               A hook that fails is l… │
                                       │
                                       │
                                       │
                                       │
                                       │
                                       │
                                       │
                                       │
                                       │
────────────────────────────────────────────────────────────────────────────────────────────────
l: reload                                                            j: jobs  h: keys  esc close
```

Updates are checked every few hours while no turn is running (`updateCheckHours`, 0 turns them off).

## As text

For scripts and `claude -p`:

```
/mods list | info <id> | doctor [--json] | export
/mods install <id> [--scope user|project|local] [--accept-command <sha256>] --yes
/mods remove <id> [--wipe-data] --yes
/mods update [<id>] --yes
/mods enable <id> --yes | disable <id> --yes
/mods apply <file> --yes
```

Writes need `--yes` (without it they print what they would run) and never reload: run `/reload-plugins` after.
Exit codes: 0 done, 1 refused or failed, 2 usage. Under `-p`, Claude Code prefixes the answer with `modmgr: `.

## Options

Set them with `claude plugin configure modmgr`:

| Option | Default | |
|---|---|---|
| `updateCheckHours` | 6 | Hours between update checks; 0 turns them off. |
| `detectRemote` | on | Read the daily catalogue index, and catalogue entries' `hooks.json`, from raw.githubusercontent.com to tell mods apart. |
| `debugTimings` | off | Write how long each step took to the debug log (`--debug`). |

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off everything modmgr fetches. modmgr sends no telemetry.

## Safety

modmgr is a lens, not a sandbox: once a mod runs, it runs with your session's power. It tells you what a mod can do
and asks before anything new runs. [docs/SECURITY.md](docs/SECURITY.md) says what it reads, fetches and stores.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/PLAN.md](docs/PLAN.md) (the design and every change made while
building it) and [docs/PERF.md](docs/PERF.md). The landing page is in `site/` (`pnpm site`).

## License

MIT
