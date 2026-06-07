#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/init-project-wiki.js"
TMPDIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

cd "$TMPDIR"

test -x "$CLI"

node "$CLI"
test -f AGENTS.md
test -f CLAUDE.md
test -f wiki/AGENTS.md
test -f wiki/startup.md
test -f wiki/index.md
test -f .codex/hooks/wiki-session-start.js
test -f .claude/hooks/wiki-session-start.js
test -f .claude/settings.json

node "$CLI" > rerun.log
grep -q "exists  AGENTS.md" rerun.log
grep -q "exists  CLAUDE.md" rerun.log
grep -q "exists  wiki/AGENTS.md" rerun.log

node "$CLI" --lint
node "$CLI" init --lint
node .codex/hooks/wiki-session-start.js > hook.json
node .claude/hooks/wiki-session-start.js > claude-hook.json
grep -q "wiki/startup.md" hook.json
grep -q "wiki/index.md" hook.json
grep -q "wiki/startup.md" claude-hook.json
grep -q "wiki/index.md" claude-hook.json
grep -q "node .claude/hooks/wiki-session-start.js" .claude/settings.json
node -e 'const s=require("./.claude/settings.json"); const ms=new Set((s.hooks.SessionStart||[]).filter(e=>(e.hooks||[]).some(h=>h.command==="node .claude/hooks/wiki-session-start.js")).map(e=>e.matcher)); for (const m of ["startup","resume","clear","compact"]) if (!ms.has(m)) process.exit(1)'
grep -q "Read On Demand" wiki/startup.md
grep -q "Language Policy" wiki/index.md
grep -q "Project canonical content language" wiki/startup.md
grep -q "@AGENTS.md" CLAUDE.md

node "$CLI" --glossary-init
test -f wiki/canonical/glossary.md
node "$CLI" --refresh-index
node "$CLI" --capture-inbox --title "Smoke" --content "Candidate content"
node "$CLI" --query Smoke
node "$CLI" --prune-check
node "$CLI" --lint

mkdir "$TMPDIR/no-git-config"
cd "$TMPDIR/no-git-config"
git init >/dev/null
node "$CLI" --no-git-config
test -f CLAUDE.md
test -f .claude/settings.json
test -f .githooks/prepare-commit-msg
if [ "$(git config --get core.hooksPath || true)" = ".githooks" ]; then
  echo "--no-git-config configured core.hooksPath unexpectedly" >&2
  exit 1
fi

mkdir "$TMPDIR/existing-instructions"
cd "$TMPDIR/existing-instructions"
cat > AGENTS.md <<'EOF'
# Existing Agent Instructions

Custom content before the wiki section.

## Wiki-First Planning

Custom content after a heading that matches the bootstrap fallback heading.
EOF
cat > CLAUDE.md <<'EOF'
# Existing Claude Instructions

Custom Claude content before the compatibility section.

# Claude Code Project Instructions

Custom Claude content after a heading that matches the bootstrap fallback heading.
EOF
node "$CLI"
grep -q "Custom content before the wiki section." AGENTS.md
grep -q "Custom content after a heading that matches the bootstrap fallback heading." AGENTS.md
grep -q "PROJECT-WIKI-FIRST:START" AGENTS.md
grep -q "Custom Claude content before the compatibility section." CLAUDE.md
grep -q "Custom Claude content after a heading that matches the bootstrap fallback heading." CLAUDE.md
grep -q "PROJECT-WIKI-CLAUDE:START" CLAUDE.md

mkdir "$TMPDIR/skill-install"
cd "$TMPDIR/skill-install"
HOME="$TMPDIR/home" node "$CLI" install-skill --scope user --agents codex,claude
test -f "$TMPDIR/home/.codex/skills/project-wiki-bootstrap/SKILL.md"
test -x "$TMPDIR/home/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.claude/skills/project-wiki-bootstrap/SKILL.md"
test -x "$TMPDIR/home/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js"

node "$CLI" install-skill --scope project --agents both
test -f .codex/skills/project-wiki-bootstrap/SKILL.md
test -x .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js
test -f .claude/skills/project-wiki-bootstrap/SKILL.md
test -x .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js
