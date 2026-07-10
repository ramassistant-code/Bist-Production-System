#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Keep the project's pre-commit hook active after every merge
bash scripts/install-hooks.sh
