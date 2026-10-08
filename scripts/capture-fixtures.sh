#!/usr/bin/env bash
# Captures real `claude plugin … --json` output into test/domain/fixtures/*.ts.
#
# Everything runs against a throwaway CLAUDE_CONFIG_DIR and a throwaway project
# folder; the person's real config is never read or written.
#
#   scripts/capture-fixtures.sh            # fixture marketplace only (offline)
#   scripts/capture-fixtures.sh --official # also add claude-plugins-official (network)
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export CLAUDE_CONFIG_DIR="$work/config"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
mkdir -p "$CLAUDE_CONFIG_DIR" "$work/raw" "$work/project"
git -C "$work/project" init -q

# A writable copy of the fixture marketplace, so versions can be bumped for `update`.
cp -r "$repo/test/fixture-mods" "$work/mkt"

# A marketplace whose one plugin is installed by a declared command.
mkdir -p "$work/cmdmkt/.claude-plugin"
cat > "$work/emit.sh" <<EOF
#!/bin/sh
echo "$work/mkt/turn-band"
EOF
chmod +x "$work/emit.sh"
cat > "$work/cmdmkt/.claude-plugin/marketplace.json" <<EOF
{ "name": "cmdmkt", "owner": { "name": "fixtures" }, "description": "declared command",
  "plugins": [{ "name": "cmdmod", "description": "installed by a command",
                "source": { "source": "command", "command": "$work/emit.sh" } }] }
EOF

n=0
# run <case-name> <cwd> <args…>: records argv, exit code, stdout and stderr.
run() {
  local name="$1" cwd="$2"
  shift 2
  n=$((n + 1))
  local base
  base="$work/raw/$(printf '%03d' "$n")-$name"
  printf '%s\n' "$@" > "$base.argv"
  set +e
  (cd "$cwd" && claude plugin "$@" </dev/null >"$base.stdout" 2>"$base.stderr")
  echo $? > "$base.exit"
  set -e
}

h="$work"
run marketplace-add-ok "$h" marketplace add "$work/mkt" --json
run marketplace-add-missing "$h" marketplace add "$work/nope" --json
run marketplace-add-cmd "$h" marketplace add "$work/cmdmkt" --json
if [[ "${1:-}" == "--official" ]]; then
  unset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  run marketplace-add-official "$h" marketplace add anthropics/claude-plugins-official --json
  export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
fi
run marketplace-list "$h" marketplace list --json
run marketplace-update-ok "$h" marketplace update fixtures --json
run marketplace-update-unknown "$h" marketplace update nosuch --json

run install-ok-user "$h" install turn-band@fixtures --json
run install-ok-project "$work/project" install redactor@fixtures --scope project --json
run install-ok-local "$work/project" install spawner@fixtures --scope local --json
run install-ok-plain "$h" install plain-skill@fixtures --json
run install-ok-broken "$h" install broken@fixtures --json
run install-again "$h" install turn-band@fixtures --json
run install-not-found "$h" install nosuch@fixtures --json
run install-bad-marketplace "$h" install turn-band@nosuch --json
run install-bad-scope "$h" install quiet-bash@fixtures --scope galaxy --json
run install-command-refused "$h" install cmdmod@cmdmkt --json
run install-command-wrong-sha "$h" install cmdmod@cmdmkt --json --accept-command 0000000000000000000000000000000000000000000000000000000000000000
run install-quiet-bash "$h" install quiet-bash@fixtures --json

run list "$work/project" list --json
run list-data-size "$work/project" list --json --data-size
run list-available "$work/project" list --json --available

run disable-ok "$h" disable turn-band@fixtures --json
run disable-again "$h" disable turn-band@fixtures --json
run disable-project "$work/project" disable redactor@fixtures --scope project --json
run enable-ok "$h" enable turn-band@fixtures --json
run enable-again "$h" enable turn-band@fixtures --json
run enable-not-installed "$h" enable nosuch@fixtures --json
run list-after-toggles "$work/project" list --json

run update-current "$h" update turn-band@fixtures --json
sed -i 's/"version": "0.2.0"/"version": "0.3.0"/' "$work/mkt/quiet-bash/.claude-plugin/plugin.json" "$work/mkt/.claude-plugin/marketplace.json"
run marketplace-update-bumped "$h" marketplace update fixtures --json
run update-bumped "$h" update quiet-bash@fixtures --json
run update-not-installed "$h" update nosuch@fixtures --json

run uninstall-ok "$h" uninstall quiet-bash@fixtures --json
run uninstall-not-installed "$h" uninstall quiet-bash@fixtures --json
run uninstall-project "$work/project" uninstall redactor@fixtures --scope project --json

for mod in turn-band redactor quiet-bash spawner plain-skill broken; do
  run "validate-$mod" "$h" validate --json "$work/mkt/$mod"
  run "validate-strict-$mod" "$h" validate --strict --json "$work/mkt/$mod"
done
run validate-marketplace "$h" validate --json "$work/mkt"
run details-turn-band "$h" details turn-band@fixtures
run details-plain-skill "$h" details plain-skill@fixtures

node "$repo/scripts/fixtures-to-ts.mjs" "$work/raw" "$repo/test/domain/fixtures" "$work" "$HOME" "$(claude --version | cut -d' ' -f1)"
pnpm exec biome format --write "$repo/test/domain/fixtures" >/dev/null
