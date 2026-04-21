#!/usr/bin/env bash
# Push to GitHub over HTTPS (avoids Cursor/VS Code credential helper issues).
#
# 1) Create a classic PAT: https://github.com/settings/tokens (scope: repo)
# 2) Either:
#    GITHUB_TOKEN=ghp_xxx ./scripts/push-with-token.sh
#    ./scripts/push-with-token.sh ghp_xxx
#    echo 'ghp_xxx' > ~/.github-token && chmod 600 ~/.github-token && ./scripts/push-with-token.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${GITHUB_TOKEN:-${1:-}}"
if [[ -z "$TOKEN" && -f "${HOME}/.github-token" ]]; then
  TOKEN="$(head -1 "${HOME}/.github-token" | tr -d '\r\n[:space:]')"
fi
if [[ -z "$TOKEN" ]]; then
  echo "Need a PAT: export GITHUB_TOKEN=... or pass as arg, or create ~/.github-token (chmod 600)." >&2
  exit 1
fi
export GIT_ASKPASS= SSH_ASKPASS=
git push "https://x-access-token:${TOKEN}@github.com/Jpaaaaa/LM-App.git" main
