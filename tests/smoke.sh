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

mkdir "$TMPDIR/help-and-errors"
cd "$TMPDIR/help-and-errors"
node "$CLI" --help > help.log
grep -q "Usage:" help.log
test ! -e AGENTS.md
if node "$CLI" unknown-command > unknown-command.log 2>&1; then
  echo "expected unknown command to fail" >&2
  exit 1
fi
grep -q "unknown command: unknown-command" unknown-command.log
test ! -e AGENTS.md
if node "$CLI" --definitely-unknown > unknown-option.log 2>&1; then
  echo "expected unknown option to fail" >&2
  exit 1
fi
grep -q "unknown option: --definitely-unknown" unknown-option.log
test ! -e AGENTS.md

cd "$TMPDIR"
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

mkdir "$TMPDIR/existing-hooks-path"
cd "$TMPDIR/existing-hooks-path"
git init >/dev/null
mkdir custom-hooks
git config core.hooksPath custom-hooks
node "$CLI" > existing-hooks-path.log
grep -q "skipped-existing-hooksPath custom-hooks" existing-hooks-path.log
test "$(git config --get core.hooksPath)" = "custom-hooks"

mkdir "$TMPDIR/existing-instructions"
cd "$TMPDIR/existing-instructions"
mkdir -p .codex .claude
cat > .codex/hooks.json <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          { "type": "command", "command": "node .codex/hooks/wiki-session-start.js", "timeout": 10 },
          { "type": "command", "command": "node custom-codex-hook.js" }
        ]
      }
    ]
  }
}
EOF
cat > .claude/settings.json <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/wiki-session-start.js" },
          { "type": "command", "command": "node custom-claude-hook.js" }
        ]
      }
    ]
  }
}
EOF
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
node -e 'const c=require("./.codex/hooks.json"); if (!JSON.stringify(c).includes("node custom-codex-hook.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!JSON.stringify(c).includes("node custom-claude-hook.js")) process.exit(1)'

mkdir "$TMPDIR/code-index"
cd "$TMPDIR/code-index"
git init -q
mkdir -p src
mkdir -p ignored
printf "ignored/\n.env\n.env.local\n" > .gitignore
cat > package.json <<'EOF'
{
  "scripts": {
    "dev": "node src/app.js"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}
EOF
cat > src/app.js <<'EOF'
const express = require("express");
const app = express();

function healthHandler(req, res) {
  res.json({ ok: true });
}

app.get("/health", healthHandler);
EOF
cat > ignored/ignored.js <<'EOF'
function ignoredHandler() {}
EOF
cat > .env <<'EOF'
SECRET_TOKEN=do-not-index
EOF
cat > .env.local <<'EOF'
LOCAL_SECRET=do-not-index
EOF
cat > .env.example <<'EOF'
PUBLIC_EXAMPLE=placeholder
EOF
node "$CLI" --code-index --code-scope src --code-scope package.json --code-scope .env.example > code-index.log
test -f .project-wiki/code-evidence.sqlite
grep -q "files: 3" code-index.log
node "$CLI" --code-query "select path from files order by path" > code-query.json
grep -q "src/app.js" code-query.json
node "$CLI" --code-files > code-files.json
grep -q "typescript-ast" code-files.json
! grep -q "ignored/ignored.js" code-files.json
grep -q ".env.example" code-files.json
! grep -q ".env.local" code-files.json
! grep -q "SECRET_TOKEN" code-files.json
! grep -q "LOCAL_SECRET" code-files.json
node "$CLI" --code-status > code-status.json
grep -q "edges" code-status.json
grep -q "stale_files" code-status.json
node "$CLI" --code-search-symbol healthHandler > code-symbols.json
grep -q "healthHandler" code-symbols.json
node "$CLI" --code-query "select route from routes where route = '/health'" > code-routes.json
grep -q "/health" code-routes.json
node "$CLI" --code-query "select kind from edges where kind = 'route_to_handler'" > code-edges.json
grep -q "route_to_handler" code-edges.json
if node "$CLI" --code-query "with changed as (delete from files returning path) select path from changed" > bad-code-query.log 2>&1; then
  echo "expected writable-looking --code-query to fail" >&2
  exit 1
fi
grep -q "code queries must be read-only SQL" bad-code-query.log
cat >> src/app.js <<'EOF'
export const staleSignal = true;
EOF
cat > src/new.js <<'EOF'
export function newHandler() {}
EOF
rm .env.example
node "$CLI" --code-status > stale-status.json
node -e 'const rows = require("./stale-status.json"); const metric = Object.fromEntries(rows.map((row) => [row.metric, row.value])); if (metric.stale_files !== 3 || metric.stale_changed_files !== 1 || metric.stale_added_files !== 1 || metric.stale_deleted_files !== 1) process.exit(1)'
node "$CLI" --code-files > stale-files.json 2> stale-warning.log
grep -q "code evidence index may be stale" stale-warning.log
node "$CLI" --code-index --code-index-out .project-wiki/custom.sqlite --code-scope src > custom-code-index.log
test -f .project-wiki/custom.sqlite
if node "$CLI" --code-index --code-index-out ../outside.sqlite > bad-code-index-out.log 2>&1; then
  echo "expected --code-index-out outside project-wiki to fail" >&2
  exit 1
fi
test ! -f ../outside.sqlite
grep -q "must stay inside .project-wiki/" bad-code-index-out.log
if node "$CLI" --code-index --code-scope ../outside > bad-code-scope.log 2>&1; then
  echo "expected --code-scope outside project root to fail" >&2
  exit 1
fi
grep -q "must stay inside the project root" bad-code-scope.log
if node "$CLI" --code-index --code-status > bad-code-mode.log 2>&1; then
  echo "expected mixed code evidence modes to fail" >&2
  exit 1
fi
grep -q "Use one code evidence mode" bad-code-mode.log

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
