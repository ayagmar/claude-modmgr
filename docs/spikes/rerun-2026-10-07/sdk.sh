#!/bin/sh
# Runs one /probe command in an SDK-style session (stream-json in and out), as a desktop host would.
cd /home/ayagmar/projects/modmgr
printf '%s\n' "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"/probe $1\"}}" | CLAUDE_CONFIG_DIR=/tmp/scratch/rerun/cfg PROBE_OUT=/tmp/scratch/rerun/sdk.log claude -p --input-format stream-json --output-format stream-json --verbose > /tmp/scratch/rerun/sdk-$2.out 2>&1
echo done-$2
