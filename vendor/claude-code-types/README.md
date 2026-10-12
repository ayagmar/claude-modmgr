# Claude Code's plugin API declarations

`<version>/claude-code.d.ts` is the TypeScript declaration file Claude Code writes beside a mod it loads from a
folder, copied here by `scripts/update-types.sh` so modmgr type-checks against a known version. Claude Code
generates it; it is Anthropic's work, kept here unchanged, and this repository's MIT license doesn't cover it.

Only the version in `tsconfig.json` and `plugin/tsconfig.json` is kept.
