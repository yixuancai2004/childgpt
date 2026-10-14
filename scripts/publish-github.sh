#!/usr/bin/env bash
# Create-only PUBLIC project repository; never modifies the existing personal homepage.
# Run on your own machine with GitHub CLI already authenticated. Never paste a token into chat.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OWNER="${1:-yixuancai2004}"
REPO="${2:-childgpt}"
[[ "$OWNER" =~ ^[A-Za-z0-9-]+$ && "$REPO" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid owner or repository name.' >&2; exit 1; }
[[ "$REPO" != *.github.io && "$REPO" != '.' && "$REPO" != '..' ]] || { echo 'Refusing to modify a personal-homepage repository.' >&2; exit 1; }
for tool in gh git node npm; do command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }; done
gh auth status >/dev/null 2>&1 || { echo 'Authenticate through GitHub CLI on your own machine: gh auth login' >&2; exit 1; }
LOGIN="$(gh api user --jq .login)"
[[ "$(printf '%s' "$LOGIN" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')" ]] || { echo "Authenticated as $LOGIN, not $OWNER. Switch accounts first." >&2; exit 1; }
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Repository $OWNER/$REPO already exists. This create-only script will not overwrite it." >&2
  echo 'Review the existing repository before pushing an update, or use a new project name.' >&2
  exit 1
fi
if [[ -e .git ]]; then
  if git remote get-url origin >/dev/null 2>&1; then echo 'This directory already has an origin remote; refusing to replace it.' >&2; exit 1; fi
  [[ "$(git branch --show-current)" == 'main' ]] || { echo 'Use a main branch in this project directory.' >&2; exit 1; }
else
  git init -b main
fi
npm run check
# Explicit allowlist; .env, data/, local tokens and transient browser storage are never staged.
git add .github .env.example .gitignore package.json package-lock.json README.md server.mjs "Start ChildGPT.command" src web scripts tests docs results ChildGPT-demo.html
if git ls-files --cached | grep -Eq '(^|/)(\.env$|data/|node_modules/)'; then echo 'Sensitive path staged; publication stopped.' >&2; exit 1; fi
if ! git diff --cached --quiet; then
  USER_ID="$(gh api user --jq .id)"
  git -c user.name="$LOGIN" -c user.email="$USER_ID+$LOGIN@users.noreply.github.com" commit -m 'Implement ChildGPT cognitive harness, frontend and synthetic evaluation'
fi
gh auth setup-git
gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push --description='GP8001 ChildGPT: interactive cognitive harness and reproducible synthetic evaluation'
gh api --method POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null
# First push can race with enabling Pages. Request a new run after Pages is configured.
TRIGGERED=false
for _ in 1 2 3 4 5; do
  if gh workflow run pages.yml --repo "$OWNER/$REPO" --ref main; then TRIGGERED=true; break; fi
  sleep 2
done
[[ "$TRIGGERED" == true ]] || { echo 'Repository is public, but Pages workflow was not triggered. Check Actions and Pages settings.' >&2; exit 1; }
echo "Public source: https://github.com/$OWNER/$REPO"
echo "Expected site after a SUCCESSFUL Pages run: https://$OWNER.github.io/$REPO/"
echo 'Deployment requested, not yet verified. Check the Pages workflow result before sharing the site.'
echo "Existing personal homepage https://$OWNER.github.io/ was not modified."
