#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/init-project-wiki.js"
SMOKE_TMP="$(mktemp -d)"

cleanup() {
  rm -rf "$SMOKE_TMP"
}
trap cleanup EXIT

test -x "$CLI"

mkdir -p "$SMOKE_TMP/help"
cd "$SMOKE_TMP/help"
node "$CLI" --help > help.log
grep -Fq "project-librarian [init|update] [options]" help.log
grep -Fq "project-librarian install " help.log
! grep -Fq "install-skill" help.log
grep -Fq -- "--wiki-neighborhood" help.log
grep -Fq -- "--quality-check" help.log
grep -Fq -- "--handoff-save" help.log
! grep -Eiq "code-index|code-evidence|project-librarian mcp|--migrate|benchmark" help.log
test ! -e AGENTS.md

for retired in mcp install-skill --code-index --migrate --migration-doctor; do
  if node "$CLI" "$retired" > retired.log 2>&1; then
    echo "expected retired input to fail: $retired" >&2
    exit 1
  fi
  grep -Eq "unknown command|unknown option" retired.log
  test ! -e AGENTS.md
done

if node "$CLI" --query > missing.log 2>&1; then
  echo "expected missing query value to fail" >&2
  exit 1
fi
grep -Fq "missing value for option: --query" missing.log
test ! -e AGENTS.md

cd "$SMOKE_TMP"
node "$CLI" init --no-git-config > init.log
grep -Fq "Project Librarian + no-git-config complete." init.log
for file in \
  AGENTS.md \
  CLAUDE.md \
  GEMINI.md \
  wiki/AGENTS.md \
  wiki/startup.md \
  wiki/index.md \
  wiki/00-index/service-map.md \
  wiki/00-index/prd-registry.md \
  wiki/10-services/README.md \
  wiki/20-shared/README.md \
  wiki/30-portfolio/README.md \
  wiki/90-archive/README.md \
  .codex/hooks/wiki-session-start.js \
  .claude/hooks/wiki-session-start.js \
  .cursor/hooks/wiki-session-start.js \
  .gemini/hooks/wiki-session-start.js
do
  test -f "$file"
done
test ! -e wiki/migration
test ! -e .project-wiki/code-evidence.sqlite
test ! -e .mcp.json
test ! -e .cursor/mcp.json

node "$CLI" --lint --no-git-config > lint.log
grep -Fq "passed:" lint.log
node "$CLI" --link-check > links.log
node "$CLI" --quality-check > quality.log
node "$CLI" --doctor --no-git-config > doctor.log

node "$CLI" --query "Language Policy" > query.log
grep -Fq "Project wiki query" query.log
grep -Fq "wiki/index.md" query.log
node "$CLI" --wiki-impact "wiki/index.md" > impact.log
grep -Fq "Wiki impact" impact.log
grep -Fq "incoming links" impact.log
node "$CLI" --wiki-neighborhood "wiki/index.md" > neighborhood.log
grep -Fq "Wiki neighborhood" neighborhood.log
grep -Fq "Read order:" neighborhood.log

node "$CLI" --glossary-init --no-git-config > glossary.log
test -f wiki/20-shared/glossary.md
grep -Fq "[[20-shared/glossary]]" wiki/index.md

node "$CLI" --capture-inbox \
  --title "Retry ownership" \
  --content "Confirm the service that owns retries." \
  --category open-question \
  --no-git-config > inbox.log
test -f wiki/inbox/project-candidates.md
grep -Fq "Retry ownership" wiki/inbox/project-candidates.md
grep -Fq "[[inbox/project-candidates]]" wiki/index.md

node "$CLI" --refresh-index > refresh.log
grep -Fq "Project Librarian refresh-index complete." refresh.log

node "$CLI" --handoff-save \
  --goal "Finish wiki cleanup" \
  --state "Core routes ready" \
  --next "Review ownership" \
  --decision "Keep startup compact" \
  --verification "project-librarian --doctor" > handoff-save.log
test -f .project-wiki/session/last-handoff.md
node "$CLI" --handoff-show > handoff-show.log
grep -Fq "Finish wiki cleanup" handoff-show.log
node "$CLI" --handoff-status > handoff-status.json
node -e 'const s=require(process.argv[1]); if (!s.exists || !s.safeToInject) process.exit(1)' "$SMOKE_TMP/handoff-status.json"
node "$CLI" --handoff-promote-inbox > handoff-promote.log
grep -Fq "Keep startup compact" wiki/inbox/project-candidates.md
node "$CLI" --handoff-clear > handoff-clear.log
test ! -e .project-wiki/session/last-handoff.md

printf '%s\n' "preserve me" > wiki/user-preserved.txt
node "$CLI" update --no-git-config > update.log
grep -Fq "Project Librarian + no-git-config complete." update.log
grep -Fq "preserve me" wiki/user-preserved.txt
test ! -e wiki/migration

mkdir -p "$SMOKE_TMP/install-preview"
cd "$SMOKE_TMP/install-preview"
node "$CLI" install --scope project --agents codex --dry-run > install.log
grep -Fq "dry-run" install.log
test ! -e .codex/skills/project-librarian

printf '%s\n' "smoke test passed"
