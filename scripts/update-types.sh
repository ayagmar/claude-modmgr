#!/usr/bin/env bash
# Vendors the installed Claude Code's API declarations under
# vendor/claude-code-types/<version>/. The engine lays them beside a
# --plugin-dir mod at load, but only in an interactive session (a `-p` run lays
# nothing since 2.1.296), so this starts one on a pseudo-terminal (util-linux
# `script`) with a throwaway mod and config dir, onboarded and trusting a
# throwaway folder, lets it load for a few seconds, and copies what was laid.
#
#   scripts/update-types.sh            # vendors `claude --version`
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
version="$(claude --version | cut -d' ' -f1)"
dest="$repo/vendor/claude-code-types/$version"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mod="$work/types-probe"
mkdir -p "$mod/.claude-plugin" "$mod/hooks"
echo '{ "name": "types-probe", "version": "0.0.0", "description": "lays types" }' > "$mod/.claude-plugin/plugin.json"
echo '{ "modules": ["./register.ts"] }' > "$mod/hooks/hooks.json"
echo 'export const register = on => { on("session.start", ($, e, next) => next(e)) }' > "$mod/hooks/register.ts"

mkdir -p "$work/config" "$work/cwd"
printf '{"hasCompletedOnboarding":true,"projects":{"%s":{"hasTrustDialogAccepted":true}}}' \
  "$work/cwd" > "$work/config/.claude.json"
(
  cd "$work/cwd"
  CLAUDE_CONFIG_DIR="$work/config" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    timeout 10 script -qc "claude --plugin-dir '$mod'" /dev/null </dev/null >/dev/null 2>&1 || true
)

laid="$mod/.claude-plugin/types/claude-code/index.d.ts"
if [[ ! -f "$laid" ]]; then
  echo "the engine laid no types at $laid" >&2
  exit 1
fi
head -1 "$laid" | grep -q "Claude Code $version" || {
  echo "laid types are not for $version: $(head -1 "$laid")" >&2
  exit 1
}

tools="$mod/.claude-plugin/types/claude-code-tools/index.d.ts"
mkdir -p "$dest"
# One file, as the plugin-authoring skill writes it: the API, then this build's built-in tools.
# The tools part reflects the tools a headless session registers; only the API part matters here.
if [[ -f "$tools" ]]; then
  cat "$laid" "$tools" > "$dest/claude-code.d.ts"
else
  cp "$laid" "$dest/claude-code.d.ts"
fi
echo "vendored $version → ${dest#"$repo/"}/claude-code.d.ts"
echo "next: diff against the previous version, update tsconfig includes, CI's CLAUDE_CODE_VERSION, and"
echo "      the version in scripts/gen-explanations.ts; then run node scripts/gen-explanations.ts, and"
echo "      git rm the previous version's folder once nothing refers to it"
