#!/usr/bin/env bash
# Configures git to use the project's committed hooks directory.
# Run once after cloning:  bash scripts/install-hooks.sh

set -euo pipefail

HOOKS_DIR="scripts/hooks"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "ERROR: hooks directory '$HOOKS_DIR' not found. Run this script from the repo root."
  exit 1
fi

chmod +x "$HOOKS_DIR"/*

git config core.hooksPath "$HOOKS_DIR"

echo "Git hooks installed. Hooks directory: $HOOKS_DIR"
echo "Active hooks:"
ls -1 "$HOOKS_DIR" | grep -v '\.sample$' | sed 's/^/  - /'
