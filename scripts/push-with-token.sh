#!/usr/bin/env bash
# Usage: GITHUB_TOKEN=ghp_xxxx ./scripts/push-with-token.sh
# Or:    ./scripts/push-with-token.sh ghp_xxxx
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${GITHUB_TOKEN:-${1:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Set GITHUB_TOKEN or pass token as first argument (classic PAT with repo scope)." >&2
  exit 1
fi
export GIT_ASKPASS= SSH_ASKPASS=
git push "https://x-access-token:${TOKEN}@github.com/Jpaaaaa/LM-App.git" main
