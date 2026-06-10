#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/init-project-wiki.js"
TMPDIR="$(mktemp -d)"
ROOT_DIRTY_PROBE="$ROOT/benchmarks/reports/dirty-baseline-smoke.tmp"

cleanup() {
  rm -f "$ROOT_DIRTY_PROBE"
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
if node "$CLI" --lint=true > boolean-value.log 2>&1; then
  echo "expected boolean flag value to fail" >&2
  exit 1
fi
grep -q "option does not take a value: --lint" boolean-value.log
test ! -e AGENTS.md
if node "$CLI" --query > missing-query.log 2>&1; then
  echo "expected missing --query value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --query" missing-query.log
test ! -e AGENTS.md
if node "$CLI" --code-query --code-status > missing-code-query.log 2>&1; then
  echo "expected missing --code-query value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-query" missing-code-query.log
test ! -e AGENTS.md
grep -q -- "--issue-draft" help.log
grep -q -- "--issue-create" help.log
grep -q -- "--issue-body-file" help.log
grep -q -- "--incremental" help.log
grep -q -- "--code-index-full" help.log
grep -q -- "--code-impact" help.log
grep -q -- "--code-parser" help.log
grep -q -- "--code-report-section" help.log
grep -q "Skill problem reporting contract" "$ROOT/SKILL.md"
grep -Fq 'run `$PROJECT_LIBRARIAN --issue-draft --issue-title' "$ROOT/SKILL.md"
grep -q "Do not manually recreate bootstrap or migration output as a fallback" "$ROOT/SKILL.md"
if node "$CLI" --incremental > lone-incremental.log 2>&1; then
  echo "expected --incremental without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--incremental is only supported with --code-index" lone-incremental.log
if node "$CLI" --code-index-full > lone-code-index-full.log 2>&1; then
  echo "expected --code-index-full without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--code-index-full is only supported with --code-index" lone-code-index-full.log
if node "$CLI" --code-index --incremental --code-index-full > mixed-code-index-update-mode.log 2>&1; then
  echo "expected mixed code index update modes to fail" >&2
  exit 1
fi
grep -q "Use one code index update mode" mixed-code-index-update-mode.log
if node "$CLI" --code-impact > missing-code-impact.log 2>&1; then
  echo "expected missing --code-impact value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-impact" missing-code-impact.log
if node "$CLI" --code-parser > missing-code-parser.log 2>&1; then
  echo "expected missing --code-parser value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-parser" missing-code-parser.log
if node "$CLI" --code-parser tree-sitter > lone-code-parser.log 2>&1; then
  echo "expected --code-parser without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--code-parser is only supported with --code-index" lone-code-parser.log
if node "$CLI" --code-parser default > lone-default-code-parser.log 2>&1; then
  echo "expected --code-parser default without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--code-parser is only supported with --code-index" lone-default-code-parser.log
if node "$CLI" --code-report --code-report-section > missing-code-report-section.log 2>&1; then
  echo "expected missing --code-report-section value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-report-section" missing-code-report-section.log
if node "$CLI" --code-report-section routes > lone-code-report-section.log 2>&1; then
  echo "expected --code-report-section without --code-report to fail" >&2
  exit 1
fi
grep -q -- "--code-report-section is only supported with --code-report" lone-code-report-section.log
test ! -e AGENTS.md

cd "$TMPDIR"
node "$CLI"
test -f AGENTS.md
test -f CLAUDE.md
test -f GEMINI.md
test -f wiki/AGENTS.md
test -f wiki/startup.md
test -f wiki/index.md
test -f .codex/hooks/wiki-session-start.js
test -f .claude/hooks/wiki-session-start.js
test -f .claude/settings.json
test -f .cursor/rules/project-librarian.mdc

node "$CLI" > rerun.log
grep -q "exists  AGENTS.md" rerun.log
grep -q "exists  CLAUDE.md" rerun.log
grep -q "exists  GEMINI.md" rerun.log
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
grep -q "@AGENTS.md" GEMINI.md
grep -q "alwaysApply: true" .cursor/rules/project-librarian.mdc
grep -q "@AGENTS.md" .cursor/rules/project-librarian.mdc

node "$CLI" --glossary-init
test -f wiki/canonical/glossary.md
node "$CLI" --refresh-index
node "$CLI" --capture-inbox --title "Smoke" --content "Candidate content"
node "$CLI" --capture-inbox > capture-inbox-empty-rerun.log
grep -q "exists  wiki/inbox/project-candidates.md" capture-inbox-empty-rerun.log
node "$CLI" --query Smoke
node "$CLI" --prune-check
node "$CLI" --lint

mkdir "$TMPDIR/scoped-index"
cd "$TMPDIR/scoped-index"
node "$CLI"
for app in 0 1 2; do
  for page in $(seq 1 18); do
    cat > "wiki/canonical/apps-app-${app}-topic-${page}.md" <<EOF
---
status: active
updated: $(date +%F)
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: smoke scoped route
---

# App ${app} Topic ${page}

## TL;DR

- Scoped route smoke page.
EOF
  done
done
node "$CLI" --refresh-index > scoped-refresh.log
grep -q "wiki/index.md auto-discovered pages" scoped-refresh.log
test -f wiki/indexes/auto-apps-app-0.md
test -f wiki/indexes/auto-apps-app-1.md
test -f wiki/indexes/auto-apps-app-2.md
grep -q "\[\[indexes/auto-apps-app-0\]\]" wiki/index.md
grep -q "\[\[canonical/apps-app-0-topic-1\]\]" wiki/indexes/auto-apps-app-0.md
node -e 'const fs=require("fs"); if (fs.readFileSync("wiki/index.md","utf8").length > 4500) process.exit(1)'
node "$CLI" --link-check > scoped-link-check.log
grep -q "0 warnings" scoped-link-check.log

mkdir "$TMPDIR/issue-draft"
cd "$TMPDIR/issue-draft"
node "$CLI"
node "$CLI" --issue-draft --issue-title "Report unexpected wiki hook behavior" > issue-draft.md
grep -q "# Report unexpected wiki hook behavior" issue-draft.md
grep -q "## What You Were Trying To Do" issue-draft.md
grep -q "## What Happened Instead" issue-draft.md
grep -q "## Side Effects Or Risk" issue-draft.md
grep -q "## Affected Generated Files" issue-draft.md
grep -q "AGENTS.md" issue-draft.md
grep -q "git branch: not a git repository" issue-draft.md
grep -q "working directory: <absolute-path>" issue-draft.md
if grep -q "$TMPDIR" issue-draft.md; then
  echo "issue draft leaked an absolute temp path" >&2
  exit 1
fi
git init >/dev/null
mkdir "$TMPDIR/custom-hooks"
git config core.hooksPath "$TMPDIR/custom-hooks"
node "$CLI" --issue-draft > issue-draft-git.md
grep -q "# Report project-librarian problem or side effect" issue-draft-git.md
grep -q "git local changes:" issue-draft-git.md
grep -q "git core.hooksPath: <absolute-path>" issue-draft-git.md
grep -q "## Diagnostics To Attach" issue-draft-git.md
if grep -q "$TMPDIR" issue-draft-git.md; then
  echo "issue draft leaked an absolute git hooks path" >&2
  exit 1
fi
node "$CLI" --issue-draft --title "Capture title should not apply" > issue-draft-title-fallback.md
grep -q "# Report project-librarian problem or side effect" issue-draft-title-fallback.md
node "$CLI" --issue-draft --issue-title $'Problem title\nInjected heading' > issue-draft-sanitized-title.md
grep -q "# Problem title Injected heading" issue-draft-sanitized-title.md
if grep -q "^Injected heading$" issue-draft-sanitized-title.md; then
  echo "issue draft title preserved an unsafe newline" >&2
  exit 1
fi
if node "$CLI" --issue-create --issue-draft > issue-mode-conflict.log 2>&1; then
  echo "expected conflicting issue modes to fail" >&2
  exit 1
fi
grep -q "Use one issue mode at a time" issue-mode-conflict.log
mkdir "$TMPDIR/issue-create"
cd "$TMPDIR/issue-create"
node "$CLI"
if node "$CLI" --issue-create > issue-create-no-git.log 2>&1; then
  echo "expected issue create without git repository to fail" >&2
  exit 1
fi
grep -q "requires a git repository with a GitHub remote" issue-create-no-git.log
git init >/dev/null
git remote add origin https://github.com/example/project-librarian.git
mkdir bin
cat > bin/gh <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$GH_LOG"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--body-file" ]; then
      test -f "$2" || exit 3
      cp "$2" "$GH_BODY_COPY"
    fi
    shift
  done
  echo "https://github.com/example/project-librarian/issues/1"
  exit 0
fi
exit 2
EOF
chmod +x bin/gh
GH_LOG="$PWD/gh.log" GH_BODY_COPY="$PWD/body.md" PATH="$PWD/bin:$PATH" node "$CLI" --issue-create --issue-title "Report created issue" > issue-create.log
grep -q "https://github.com/example/project-librarian/issues/1" issue-create.log
grep -q "auth status" gh.log
grep -q "issue create --title Report created issue --body-file" gh.log
grep -q "## Reproduction Steps" body.md

mkdir "$TMPDIR/wiki-diagnostics"
cd "$TMPDIR/wiki-diagnostics"
node "$CLI"
node "$CLI" --link-check > link-check-ok.log
grep -q "Project wiki link-check" link-check-ok.log
grep -q "passed:" link-check-ok.log
cat >> wiki/canonical/project-brief.md <<'EOF'

Image asset probe: ![diagram](assets/diagram.png)
PDF asset probe: [spec](assets/spec.pdf)
Angle markdown probe: [assumptions](<assumptions.md>)
Root wiki probe: [startup](/wiki/startup.md)
EOF
node "$CLI" --link-check > link-check-assets-ok.log
grep -q "Project wiki link-check" link-check-assets-ok.log
grep -q "passed:" link-check-assets-ok.log
node "$CLI" --quality-check > quality-check.log
grep -q "Project wiki quality-check" quality-check.log
grep -q "0 warnings" quality-check.log
node "$CLI" --doctor > doctor.log
grep -q "Project wiki link-check" doctor.log
grep -q "Project wiki quality-check" doctor.log
grep -q "Project wiki lint" doctor.log
if node "$CLI" --fix > bad-fix.log 2>&1; then
  echo "expected --fix without --doctor to fail" >&2
  exit 1
fi
grep -q -- "--fix is only supported with --doctor" bad-fix.log
cat >> wiki/canonical/project-brief.md <<'EOF'

Broken route probe: [[canonical/missing-page]]
EOF
if node "$CLI" --link-check > broken-link.log 2>&1; then
  echo "expected --link-check to fail on broken wiki links" >&2
  exit 1
fi
grep -q "broken-link" broken-link.log
grep -q "wiki/canonical/missing-page.md" broken-link.log

mkdir "$TMPDIR/wiki-diagnostics-fix"
cd "$TMPDIR/wiki-diagnostics-fix"
node "$CLI"
cat > wiki/canonical/custom-quality.md <<'EOF'
---
status: active
updated: 2026-06-08
scope: project-canonical
read_budget: short
decision_ref: none
review_trigger: custom quality page changes
---

# Custom Quality Page

This intentionally lacks a TL;DR for quality-check coverage.
EOF
node "$CLI" --doctor --fix > doctor-fix.log
grep -q "updated wiki/index.md auto-discovered pages" doctor-fix.log
grep -q "\[\[canonical/custom-quality\]\]" wiki/index.md
grep -q "missing-tldr" doctor-fix.log
cat >> wiki/index.md <<'EOF'

Duplicate route probe: [[canonical/custom-quality]]
EOF
node "$CLI" --link-check > duplicate-route.log
grep -q "duplicate-route" duplicate-route.log

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

mkdir "$TMPDIR/malformed-managed-section"
cd "$TMPDIR/malformed-managed-section"
cat > AGENTS.md <<'EOF'
# Existing Agent Instructions

<!-- PROJECT-WIKI-FIRST:START -->
broken managed section without an end marker
EOF
if node "$CLI" > malformed-managed-section.log 2>&1; then
  echo "expected malformed managed section to fail" >&2
  exit 1
fi
grep -q "malformed managed section" malformed-managed-section.log

mkdir "$TMPDIR/migration-pipe"
cd "$TMPDIR/migration-pipe"
mkdir wiki
cat > 'wiki/spec|decision.md' <<'EOF'
# Pipe Decision

Decision: preserve a source path containing a pipe.
EOF
node "$CLI" --migrate
grep -q 'spec\\|decision.md' wiki/migration/verification.md
node -e 'const fs=require("fs"); const file="wiki/decisions/migration-inbox.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace("| pending |", "| adopted |"));'
node "$CLI" --review-migration > review-migration-pipe.log
grep -q "semantic migration complete: yes" wiki/migration/verification.md
grep -q 'spec\\|decision.md' wiki/migration/review.md

mkdir "$TMPDIR/migration-copy-risk"
cd "$TMPDIR/migration-copy-risk"
mkdir -p wiki/canonical
cat > wiki/canonical/product-plan.md <<'EOF'
---
status: active
updated: 2026-06-01
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: legacy product plan changes
---

# Product Plan

## TL;DR

- This is legacy project truth from a different project.
- It intentionally contains enough repeated content to make a direct copy detectable.

## Details

Legacy Project Alpha serves billing administrators who reconcile imported invoices, approve payouts, and export financial reports. Its success criteria, domain terms, workflows, and release constraints belong to that old project. A migration reviewer must rewrite useful meaning for the current project instead of copying this file into the new canonical wiki. The copied text includes specific roles, workflow names, old product promises, and old operational constraints so direct file reuse is unsafe.
EOF
node "$CLI" --migrate > migration-copy-bootstrap.log
cat > wiki/canonical/product-plan.md <<'EOF'
---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: migrated product plan changes
---

# Product Plan

## TL;DR

- This is legacy project truth from a different project.
- It intentionally contains enough repeated content to make a direct copy detectable.

## Details

Legacy Project Alpha serves billing administrators who reconcile imported invoices, approve payouts, and export financial reports. Its success criteria, domain terms, workflows, and release constraints belong to that old project. A migration reviewer must rewrite useful meaning for the current project instead of copying this file into the new canonical wiki. The copied text includes specific roles, workflow names, old product promises, and old operational constraints so direct file reuse is unsafe.
EOF
if node "$CLI" --quality-check > migration-copy-risk.log 2>&1; then
  echo "expected --quality-check to fail on copied legacy wiki content" >&2
  exit 1
fi
grep -q "migration-copy-risk" migration-copy-risk.log
grep -q "wiki_legacy/canonical/product-plan.md" migration-copy-risk.log

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
  "mcpServers": {
    "existing": {
      "command": "node existing-mcp.js"
    }
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node custom-post-tool-use.js" }
        ]
      }
    ],
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
cat > .codex/settings.json <<'EOF'
{
  "sandbox": "workspace-write"
}
EOF
cat > .claude/settings.json <<'EOF'
{
  "permissions": {
    "allow": [
      "Bash(npm test)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node custom-claude-post-tool-use.js" }
        ]
      }
    ],
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
cat > GEMINI.md <<'EOF'
# Existing Gemini Instructions

Custom Gemini content before the compatibility section.

# Gemini CLI Project Instructions

Custom Gemini content after a heading that matches the bootstrap fallback heading.
EOF
node "$CLI"
grep -q "Custom content before the wiki section." AGENTS.md
grep -q "Custom content after a heading that matches the bootstrap fallback heading." AGENTS.md
grep -q "PROJECT-WIKI-FIRST:START" AGENTS.md
grep -q "Custom Claude content before the compatibility section." CLAUDE.md
grep -q "Custom Claude content after a heading that matches the bootstrap fallback heading." CLAUDE.md
grep -q "PROJECT-WIKI-CLAUDE:START" CLAUDE.md
grep -q "Custom Gemini content before the compatibility section." GEMINI.md
grep -q "Custom Gemini content after a heading that matches the bootstrap fallback heading." GEMINI.md
grep -q "PROJECT-WIKI-GEMINI:START" GEMINI.md
grep -q "@AGENTS.md" .cursor/rules/project-librarian.mdc
node -e 'const c=require("./.codex/hooks.json"); if (!JSON.stringify(c).includes("node custom-codex-hook.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!JSON.stringify(c).includes("node custom-claude-hook.js")) process.exit(1)'
node -e 'const c=require("./.codex/hooks.json"); if (c.mcpServers.existing.command !== "node existing-mcp.js") process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-post-tool-use.js") process.exit(1); const starts = c.hooks.SessionStart.filter(e => e.matcher === "startup|resume|clear"); if (starts.length !== 1) process.exit(1); const commands = starts[0].hooks.map(h => h.command); if (!commands.includes("node custom-codex-hook.js") || !commands.includes("node .codex/hooks/wiki-session-start.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!c.permissions.allow.includes("Bash(npm test)")) process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-claude-post-tool-use.js") process.exit(1); const startup = c.hooks.SessionStart.filter(e => e.matcher === "startup"); if (startup.length !== 1) process.exit(1); const commands = startup[0].hooks.map(h => h.command); if (!commands.includes("node custom-claude-hook.js") || !commands.includes("node .claude/hooks/wiki-session-start.js")) process.exit(1); const ms = new Set(c.hooks.SessionStart.filter(e => (e.hooks || []).some(h => h.command === "node .claude/hooks/wiki-session-start.js")).map(e => e.matcher)); for (const m of ["startup","resume","clear","compact"]) if (!ms.has(m)) process.exit(1)'
node -e 'const c=require("./.codex/settings.json"); if (c.sandbox !== "workspace-write") process.exit(1)'

mkdir "$TMPDIR/code-index"
cd "$TMPDIR/code-index"
git init -q
mkdir -p src
mkdir -p apps/web
mkdir -p .github
mkdir -p dist
mkdir -p ignored
mkdir -p vendor
printf "ignored/\n.env\n.env.local\n" > .gitignore
cat > package.json <<'EOF'
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "node src/app.js"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}
EOF
cat > package-lock.json <<'EOF'
{
  "name": "code-index-smoke",
  "lockfileVersion": 3,
  "packages": {}
}
EOF
cat > .github/CODEOWNERS <<'EOF'
src/ @platform-team
*.go @go-team
/apps/web/ @web-team
EOF
cat > apps/web/package.json <<'EOF'
{
  "name": "@example/web",
  "dependencies": {
    "@example/api": "workspace:*",
    "express": "^4.18.0"
  },
  "scripts": {
    "dev": "node route.js"
  }
}
EOF
mkdir -p packages/api
cat > packages/api/package.json <<'EOF'
{
  "name": "@example/api",
  "dependencies": {
    "zod": "^3.22.0"
  }
}
EOF
cat > apps/web/route.js <<'EOF'
export function webRoute() {
  return "ok";
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
cat > src/server.go <<'EOF'
package service

import (
  "context"
  httpalias "net/http"
)

type GoServer struct{}

func GoHandler(ctx context.Context) error {
  return nil
}

func (s *GoServer) ServeHTTP(w httpalias.ResponseWriter, r *httpalias.Request) {}
EOF
cat > ignored/ignored.js <<'EOF'
function ignoredHandler() {}
EOF
cat > dist/built.js <<'EOF'
export const builtArtifact = true;
EOF
cat > vendor/vendor.js <<'EOF'
export const vendoredArtifact = true;
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
cat > secrets.json <<'EOF'
{
  "TOP_SECRET": "do-not-index"
}
EOF
cat > service-token.yaml <<'EOF'
SERVICE_TOKEN: do-not-index
EOF
if node "$CLI" --code-index --incremental --code-scope src --code-scope package.json > missing-incremental-code-index.log 2>&1; then
  echo "expected --code-index --incremental without existing index to fail" >&2
  exit 1
fi
grep -q -- "--incremental requires an existing compatible code evidence index" missing-incremental-code-index.log
test ! -f .project-wiki/code-evidence.sqlite
node "$CLI" --code-index --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > code-index.log
test -f .project-wiki/code-evidence.sqlite
grep -q "files: 6" code-index.log
if node "$CLI" --code-index --incremental --code-scope package.json > mismatched-incremental-code-index.log 2>&1; then
  echo "expected --code-index --incremental with mismatched scopes to fail" >&2
  exit 1
fi
grep -q "indexed scopes do not match requested scopes" mismatched-incremental-code-index.log
node "$CLI" --code-query "select path from files order by path" > code-query.json
grep -q "src/app.js" code-query.json
grep -q "src/server.go" code-query.json
grep -q "apps/web/route.js" code-query.json
node "$CLI" --code-files > code-files.json
grep -q "typescript-ast" code-files.json
grep -q "go-light" code-files.json
! grep -q "ignored/ignored.js" code-files.json
grep -q ".env.example" code-files.json
! grep -q ".env.local" code-files.json
! grep -q "secrets.json" code-files.json
! grep -q "service-token.yaml" code-files.json
! grep -q "SECRET_TOKEN" code-files.json
! grep -q "LOCAL_SECRET" code-files.json
! grep -q "TOP_SECRET" code-files.json
! grep -q "SERVICE_TOKEN" code-files.json
node "$CLI" --code-index --code-index-out .project-wiki/all.sqlite > all-code-index.log
node "$CLI" --code-files --code-index-out .project-wiki/all.sqlite > all-code-files.json
! grep -q "dist/built.js" all-code-files.json
! grep -q "vendor/vendor.js" all-code-files.json
node "$CLI" --code-status > code-status.json
grep -q "edges" code-status.json
grep -q "stale_files" code-status.json
node "$CLI" --code-search-symbol healthHandler > code-symbols.json
grep -q "healthHandler" code-symbols.json
node "$CLI" --code-search-symbol GoHandler > go-symbols.json
grep -q "GoHandler" go-symbols.json
node "$CLI" --code-query "select to_ref from imports where to_ref = 'net/http'" > go-imports.json
grep -q "net/http" go-imports.json
node "$CLI" --code-query "select route from routes where route = '/health'" > code-routes.json
grep -q "/health" code-routes.json
node "$CLI" --code-query "select kind from edges where kind = 'route_to_handler'" > code-edges.json
grep -q "route_to_handler" code-edges.json
node "$CLI" --code-impact healthHandler > code-impact-health.json
node -e 'const r=require("./code-impact-health.json"); if (r.target !== "healthHandler") process.exit(1); if (!r.matches.symbols.some((row) => row.name === "healthHandler")) process.exit(1); if (!r.matches.routes.some((row) => row.route === "/health")) process.exit(1); if (!r.edges.incoming.some((row) => row.kind === "route_to_handler" && row.target === "healthHandler")) process.exit(1); if (!r.impacted_owners.some((row) => row.owner === "src" && row.codeowners.includes("@platform-team"))) process.exit(1)'
node "$CLI" --code-impact express > code-impact-express.json
node -e 'const r=require("./code-impact-express.json"); if (r.target !== "express") process.exit(1); if (!r.matches.imports.some((row) => row.to_ref === "express")) process.exit(1); if (!r.edges.incoming.some((row) => row.kind === "import" && row.target === "express")) process.exit(1)'
node "$CLI" --code-report > code-report.json
node -e 'const r=require("./code-report.json"); if (r.schema_version !== 1) process.exit(1); if (!r.report_sections.includes("ownership_summary") || !r.report_sections.includes("parser_backend_summary") || !r.report_sections.includes("workspace_summary") || !r.report_sections.includes("workspace_dependency_graph")) process.exit(1); if (!r.evidence_coverage || r.evidence_coverage.files !== 6 || r.evidence_coverage.routes < 1) process.exit(1); if (!r.language_profile_summary.some((row) => row.language === "go" && row.profile === "go-light")) process.exit(1); if (!r.parser_backend_summary.some((row) => row.profile === "typescript-ast" && row.backend === "typescript-compiler" && row.extraction_strength === "structural")) process.exit(1); if (!r.parser_backend_summary.some((row) => row.profile === "go-light" && row.backend === "regex-light")) process.exit(1); if (!r.workspace_summary.workspace_packages.some((row) => row.root === "apps/web" && row.name === "@example/web" && row.files === 2)) process.exit(1); if (!r.workspace_summary.codeowners.some((row) => row.pattern === "/apps/web/" && row.owners === "@web-team")) process.exit(1); if (!r.workspace_dependency_graph.workspaces.some((row) => row.root === "apps/web" && row.name === "@example/web")) process.exit(1); if (!r.workspace_dependency_graph.lockfiles.some((row) => row.file_path === "package-lock.json" && row.package_manager === "npm")) process.exit(1); if (!r.workspace_dependency_graph.internal_dependencies.some((row) => row.from_package === "@example/web" && row.to_package === "@example/api")) process.exit(1); if (!r.workspace_dependency_graph.external_dependency_hotspots.some((row) => row.dependency === "express" && row.workspace_count >= 1)) process.exit(1); if (!r.ownership_summary.some((row) => row.owner === "apps/web" && row.owner_source === "workspace" && row.codeowners.includes("@web-team"))) process.exit(1); if (!r.ownership_summary.some((row) => row.owner === "src" && row.routes >= 1 && row.codeowners.includes("@platform-team"))) process.exit(1); if (!r.route_inventory.some((row) => row.route === "/health")) process.exit(1); if (!r.dependency_hotspots.package_dependencies.some((row) => row.package === "express")) process.exit(1); if (!r.edge_summary.by_kind.some((row) => row.kind === "route_to_handler")) process.exit(1)'
node "$CLI" --code-report --code-report-section routes > code-report-routes.json
node -e 'const r=require("./code-report-routes.json"); if (r.schema_version !== 1 || r.section !== "routes") process.exit(1); if (!Array.isArray(r.data) || !r.data.some((row) => row.route === "/health")) process.exit(1); if ("ownership_summary" in r || "dependency_hotspots" in r) process.exit(1)'
node "$CLI" --code-report --code-report-section dependency_hotspots > code-report-hotspots.json
node -e 'const r=require("./code-report-hotspots.json"); if (r.section !== "hotspots") process.exit(1); if (!r.data.package_dependencies.some((row) => row.package === "express")) process.exit(1)'
node "$CLI" --code-report --code-report-section evidence_coverage > code-report-coverage.json
node -e 'const r=require("./code-report-coverage.json"); if (r.section !== "coverage" || r.data.files !== 6 || r.data.routes < 1) process.exit(1)'
node "$CLI" --code-report --code-report-section parsers > code-report-parsers.json
node -e 'const r=require("./code-report-parsers.json"); if (r.section !== "parsers") process.exit(1); if (!r.data.some((row) => row.profile === "typescript-ast" && row.backend === "typescript-compiler")) process.exit(1); if (!r.data.some((row) => row.profile === "go-light" && row.backend === "regex-light" && row.extraction_strength === "light")) process.exit(1); if (!r.data.some((row) => row.profile === "config" && row.backend === "config-key-value")) process.exit(1)'
node "$CLI" --code-report --code-report-section workspaces > code-report-workspaces.json
node -e 'const r=require("./code-report-workspaces.json"); if (r.section !== "workspaces") process.exit(1); if (!r.data.workspace_packages.some((row) => row.root === "apps/web" && row.files === 2)) process.exit(1); if (!r.data.codeowners.some((row) => row.pattern === "*.go" && row.owners === "@go-team")) process.exit(1)'
node "$CLI" --code-report --code-report-section workspace-graph > code-report-workspace-graph.json
node -e 'const r=require("./code-report-workspace-graph.json"); if (r.section !== "workspace-graph") process.exit(1); if (!r.data.workspaces.some((row) => row.root === "apps/web" && row.name === "@example/web")) process.exit(1); if (!r.data.internal_dependencies.some((row) => row.from_workspace === "apps/web" && row.to_workspace === "packages/api")) process.exit(1); if (!r.data.external_dependency_hotspots.some((row) => row.dependency === "express")) process.exit(1)'
if node "$CLI" --code-report --code-report-section everything > bad-code-report-section.log 2>&1; then
  echo "expected invalid --code-report-section to fail" >&2
  exit 1
fi
grep -q "invalid --code-report-section" bad-code-report-section.log
if node "$CLI" --code-index --code-parser made-up --code-scope src > bad-code-parser.log 2>&1; then
  echo "expected invalid --code-parser to fail" >&2
  exit 1
fi
grep -q "invalid --code-parser" bad-code-parser.log
if node "$CLI" --code-query "with changed as (delete from files returning path) select path from changed" > bad-code-query.log 2>&1; then
  echo "expected writable-looking --code-query to fail" >&2
  exit 1
fi
grep -q "code queries must be read-only SQL" bad-code-query.log
mkdir -p tree-sitter-src
cat > tree-sitter-src/task.py <<'EOF'
import os

def py_handler():
  return os.getcwd()
EOF
cat > tree-sitter-src/types.ts <<'EOF'
export interface RouteConfig {
  path: string;
}

export const typedRoute = () => true;
EOF
cat > tree-sitter-src/worker.rs <<'EOF'
use std::collections::HashMap;

pub struct RustWorker {
    pub id: String,
}

pub fn rust_health() -> HashMap<String, String> {
    HashMap::new()
}
EOF
cat > tree-sitter-src/Controller.java <<'EOF'
package smoke;

import java.util.Map;

public class SmokeController {
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }
}
EOF
cat > tree-sitter-src/Action.php <<'EOF'
<?php
namespace Smoke;

use DateTimeImmutable;

class SmokeAction {
  public function handle(): DateTimeImmutable {
    return new DateTimeImmutable();
  }
}
EOF
cat > tree-sitter-src/Job.kt <<'EOF'
package smoke

import java.time.Instant

class SmokeJob {
  fun run(): Instant {
    return Instant.now()
  }
}
EOF
cat > tree-sitter-src/Event.swift <<'EOF'
import Foundation

struct SmokeEvent {
  let id: String
}

func smokeEvent() -> SmokeEvent {
  return SmokeEvent(id: "ok")
}
EOF
cat > tree-sitter-src/health.c <<'EOF'
#include <stdio.h>

struct smoke_state {
  int ready;
};

int smoke_health(void) {
  return 1;
}
EOF
cat > tree-sitter-src/engine.cpp <<'EOF'
#include <string>

namespace smoke {
class SmokeEngine {
 public:
  std::string health() const {
    return "ok";
  }
};
}
EOF
cat > tree-sitter-src/Service.cs <<'EOF'
using System;

namespace Smoke;

public class SmokeService
{
    public string Health()
    {
        return "ok";
    }
}
EOF
node "$CLI" --code-index --code-parser tree-sitter --code-index-out .project-wiki/tree-sitter.sqlite --code-scope src --code-scope apps/web --code-scope tree-sitter-src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > tree-sitter-code-index.log
grep -q "parser_mode: tree-sitter" tree-sitter-code-index.log
node "$CLI" --code-files --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-files.json
grep -q "tree-sitter-c" tree-sitter-files.json
grep -q "tree-sitter-cpp" tree-sitter-files.json
grep -q "tree-sitter-csharp" tree-sitter-files.json
grep -q "tree-sitter-javascript" tree-sitter-files.json
grep -q "tree-sitter-go" tree-sitter-files.json
grep -q "tree-sitter-java" tree-sitter-files.json
grep -q "tree-sitter-kotlin" tree-sitter-files.json
grep -q "tree-sitter-php" tree-sitter-files.json
grep -q "tree-sitter-python" tree-sitter-files.json
grep -q "tree-sitter-rust" tree-sitter-files.json
grep -q "tree-sitter-swift" tree-sitter-files.json
grep -q "tree-sitter-typescript" tree-sitter-files.json
node "$CLI" --code-search-symbol healthHandler --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-symbols.json
grep -q "healthHandler" tree-sitter-symbols.json
node "$CLI" --code-search-symbol GoHandler --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-go-symbols.json
grep -q "GoHandler" tree-sitter-go-symbols.json
node "$CLI" --code-search-symbol py_handler --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-python-symbols.json
grep -q "py_handler" tree-sitter-python-symbols.json
node "$CLI" --code-search-symbol typedRoute --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-typescript-symbols.json
grep -q "typedRoute" tree-sitter-typescript-symbols.json
node "$CLI" --code-search-symbol RustWorker --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-rust-symbols.json
grep -q "RustWorker" tree-sitter-rust-symbols.json
node "$CLI" --code-search-symbol SmokeController --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-java-symbols.json
grep -q "SmokeController" tree-sitter-java-symbols.json
node "$CLI" --code-search-symbol SmokeAction --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-php-symbols.json
grep -q "SmokeAction" tree-sitter-php-symbols.json
node "$CLI" --code-search-symbol SmokeJob --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-kotlin-symbols.json
grep -q "SmokeJob" tree-sitter-kotlin-symbols.json
node "$CLI" --code-search-symbol SmokeEvent --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-swift-symbols.json
grep -q "SmokeEvent" tree-sitter-swift-symbols.json
node "$CLI" --code-search-symbol smoke_state --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-c-symbols.json
grep -q "smoke_state" tree-sitter-c-symbols.json
node "$CLI" --code-search-symbol SmokeEngine --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-cpp-symbols.json
grep -q "SmokeEngine" tree-sitter-cpp-symbols.json
node "$CLI" --code-search-symbol SmokeService --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-csharp-symbols.json
grep -q "SmokeService" tree-sitter-csharp-symbols.json
node "$CLI" --code-query "select route from routes where route = '/health'" --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-routes.json
grep -q "/health" tree-sitter-routes.json
node "$CLI" --code-query "select to_ref from imports where to_ref = 'net/http'" --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-go-imports.json
grep -q "net/http" tree-sitter-go-imports.json
node "$CLI" --code-report --code-report-section parsers --code-index-out .project-wiki/tree-sitter.sqlite > tree-sitter-parsers.json
node -e 'const r=require("./tree-sitter-parsers.json"); if (r.parser_mode !== "tree-sitter" || r.section !== "parsers") process.exit(1); for (const profile of ["tree-sitter-c", "tree-sitter-cpp", "tree-sitter-csharp", "tree-sitter-javascript", "tree-sitter-go", "tree-sitter-java", "tree-sitter-kotlin", "tree-sitter-php", "tree-sitter-python", "tree-sitter-rust", "tree-sitter-swift", "tree-sitter-typescript"]) if (!r.data.some((row) => row.profile === profile && row.backend === profile && row.extraction_strength === "structural")) process.exit(1)'
if node "$CLI" --code-index --incremental --code-parser default --code-index-out .project-wiki/tree-sitter.sqlite --code-scope src --code-scope apps/web --code-scope tree-sitter-src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > mismatched-parser-mode-code-index.log 2>&1; then
  echo "expected --code-index --incremental with mismatched parser mode to fail" >&2
  exit 1
fi
grep -q "indexed parser mode tree-sitter does not match requested parser mode default" mismatched-parser-mode-code-index.log
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
node "$CLI" --code-index --incremental --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > incremental-code-index.log
grep -q "mode: incremental" incremental-code-index.log
grep -q "files: 6" incremental-code-index.log
grep -q "reindexed_files: 2" incremental-code-index.log
grep -q "deleted_files: 1" incremental-code-index.log
node "$CLI" --code-status > fresh-status.json
node -e 'const rows = require("./fresh-status.json"); const metric = Object.fromEntries(rows.map((row) => [row.metric, row.value])); if (metric.stale_files !== 0 || metric.files !== 6) process.exit(1)'
node "$CLI" --code-search-symbol newHandler > incremental-symbols.json
grep -q "newHandler" incremental-symbols.json
node "$CLI" --code-files > fresh-files.json
! grep -q ".env.example" fresh-files.json
node "$CLI" --code-index --code-index-full --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > full-code-index.log
grep -q "mode: full" full-code-index.log
grep -q "files: 6" full-code-index.log
grep -q "reindexed_files: 6" full-code-index.log
grep -q "unchanged_files: 0" full-code-index.log
printf "not sqlite" > .project-wiki/broken.sqlite
node "$CLI" --code-index --code-index-full --code-index-out .project-wiki/broken.sqlite --code-scope src > broken-full-code-index.log
grep -q "mode: full" broken-full-code-index.log
grep -q "files: 3" broken-full-code-index.log
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
if node "$CLI" --code-index --code-report > bad-code-mode.log 2>&1; then
  echo "expected mixed code evidence modes to fail" >&2
  exit 1
fi
grep -q "Use one code evidence mode" bad-code-mode.log

mkdir "$TMPDIR/skill-install"
cd "$TMPDIR/skill-install"
HOME="$TMPDIR/home" node "$CLI" install-skill --scope user --agents codex,claude,cursor,gemini > user-skill-install.log
grep -q "install-skill only installs the reusable skill files" user-skill-install.log
grep -q "agents should run the installed local project-librarian runner" user-skill-install.log
test -f "$TMPDIR/home/.codex/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.codex/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.claude/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.claude/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.cursor/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.cursor/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.gemini/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.gemini/skills/project-librarian/dist/init-project-wiki.js"

node "$CLI" install-skill --scope project --agents all > project-skill-install.log
grep -q "install-skill only installs the reusable skill files" project-skill-install.log
grep -q "agents should run the installed local project-librarian runner" project-skill-install.log
test -f .codex/skills/project-librarian/SKILL.md
test -x .codex/skills/project-librarian/dist/init-project-wiki.js
test -f .claude/skills/project-librarian/SKILL.md
test -x .claude/skills/project-librarian/dist/init-project-wiki.js
test -f .cursor/skills/project-librarian/SKILL.md
test -x .cursor/skills/project-librarian/dist/init-project-wiki.js
test -f .gemini/skills/project-librarian/SKILL.md
test -x .gemini/skills/project-librarian/dist/init-project-wiki.js
node "$CLI" install-skill --scope project --agents both --dry-run > legacy-both-skill-install.log
grep -q "agents: codex, claude" legacy-both-skill-install.log

mkdir "$TMPDIR/benchmark"
cd "$TMPDIR/benchmark"
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --out benchmark.json > benchmark.stdout.json
test -f benchmark.json
node "$ROOT/tests/validators/benchmark-smoke.js" full benchmark.json
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline benchmark.json --out benchmark-comparison.json > benchmark-comparison.stdout.json
node "$ROOT/tests/validators/benchmark-smoke.js" comparison benchmark-comparison.json
if node "$ROOT/benchmarks/project-metrics.js" --quick --fail-on-regression --out missing-baseline-gate.json > missing-baseline-gate.log 2>&1; then
  echo "benchmark release gate should require --baseline" >&2
  exit 1
fi
grep -q "requires --baseline" missing-baseline-gate.log
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); m.measurement.runs=2; fs.writeFileSync("not-comparable-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline not-comparable-baseline.json --out not-comparable-comparison.json > not-comparable-comparison.stdout.json
node "$ROOT/tests/validators/benchmark-smoke.js" status not-comparable-comparison.json not_comparable benchmark.runs
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const sample=m.scenarios.find((s)=>s.fixture_kind==="sample-repo-validation-01"); sample.sample_repo_fingerprint="changed"; fs.writeFileSync("sample-mismatch-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline sample-mismatch-baseline.json --out sample-mismatch-comparison.json > sample-mismatch-comparison.stdout.json
node "$ROOT/tests/validators/benchmark-smoke.js" status sample-mismatch-comparison.json not_comparable benchmark.scenarios
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const sample=m.scenarios.find((s)=>s.fixture_kind==="sample-repo-validation-01"); sample.sample_repo_code_index_ms=sample.sample_repo_code_index_ms / 10; sample.sample_repo_architecture_report_ms=sample.sample_repo_architecture_report_ms / 10; fs.writeFileSync("sample-masked-regression-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline sample-masked-regression-baseline.json --out sample-masked-regression-comparison.json > sample-masked-regression-comparison.stdout.json
node "$ROOT/tests/validators/benchmark-smoke.js" masked-regression sample-masked-regression-comparison.json
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const docs=m.scenarios.find((s)=>s.fixture_kind==="docs-heavy-large-project"); const monorepo=m.scenarios.find((s)=>s.fixture_kind==="monorepo-large-project"); const scoped=m.scenarios.find((s)=>s.fixture_kind==="scoped-routing-large-project"); if (!scoped || scoped.scoped_router_count < 1 || scoped.main_index_chars > 4500 || scoped.refresh_index_ms <= 0 || scoped.link_check_ms <= 0 || scoped.targeted_context.file_count !== 4 || scoped.retrieval_correctness.correctness_status !== "passed" || !scoped.scoped_router_files.some((file)=>file==="wiki/indexes/auto-apps-app-0.md")) process.exit(1); const code=m.scenarios.find((s)=>s.fixture_kind==="code-heavy-large-project"); docs.query_ms=100000; monorepo.doctor_ms=100000; code.code_index_ms=100000; code.incremental_index_ms=100000; code.architecture_report_ms=100000; code.code_index_files_per_second=1; for (const sample of m.scenarios.filter((s)=>s.fixture_kind.startsWith("sample-repo-validation-"))) { sample.sample_repo_code_index_ms=100000; sample.sample_repo_architecture_report_ms=100000; } m.summary.sample_repo_code_index_ms=100000; m.summary.sample_repo_architecture_report_ms=100000; m.summary.min_estimated_token_avoidance_percent=0; fs.writeFileSync("unstable-gate-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
if node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline unstable-gate-baseline.json --fail-on-regression --out unstable-gate-comparison.json > unstable-gate-comparison.log 2>&1; then
  echo "benchmark release gate should reject single-run unstable timing" >&2
  exit 1
fi
grep -q "benchmark release gate failed: unstable" unstable-gate-comparison.log
printf "dirty baseline smoke\n" > "$ROOT_DIRTY_PROBE"
if node "$ROOT/benchmarks/project-metrics.js" --quick --save-baseline dirty-baseline.json > dirty-baseline.log 2>&1; then
  echo "benchmark baseline save should reject dirty worktrees by default" >&2
  exit 1
fi
grep -q "allow-dirty-baseline" dirty-baseline.log
node "$ROOT/benchmarks/project-metrics.js" --quick --save-baseline saved-baseline.json --allow-dirty-baseline --markdown release-summary.md > benchmark-release.stdout.json
test -f saved-baseline.json
test -f release-summary.md
grep -q "Project Librarian Benchmark" release-summary.md
grep -q "Claim Boundaries" release-summary.md
node "$ROOT/benchmarks/project-metrics.js" --trend benchmark.json --trend benchmark-comparison.json --trend-out trend.json --trend-markdown trend.md > trend.stdout.json
test -f trend.json
test -f trend.md
grep -q "Benchmark Trend" trend.md
node "$ROOT/tests/validators/benchmark-smoke.js" trend trend.json
node "$ROOT/benchmarks/project-metrics.js" --trend benchmark.json --trend sample-mismatch-baseline.json --trend-out incompatible-trend.json > incompatible-trend.stdout.json
node "$ROOT/tests/validators/benchmark-smoke.js" incompatible-trend incompatible-trend.json
