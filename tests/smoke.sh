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
grep -q "Skill problem reporting contract" "$ROOT/SKILL.md"
grep -Fq 'run `$PROJECT_WIKI_BOOTSTRAP --issue-draft --issue-title' "$ROOT/SKILL.md"
grep -q "Do not manually recreate bootstrap or migration output as a fallback" "$ROOT/SKILL.md"

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
grep -q "# Report project-wiki-bootstrap problem or side effect" issue-draft-git.md
grep -q "git local changes:" issue-draft-git.md
grep -q "git core.hooksPath: <absolute-path>" issue-draft-git.md
grep -q "## Diagnostics To Attach" issue-draft-git.md
if grep -q "$TMPDIR" issue-draft-git.md; then
  echo "issue draft leaked an absolute git hooks path" >&2
  exit 1
fi
node "$CLI" --issue-draft --title "Capture title should not apply" > issue-draft-title-fallback.md
grep -q "# Report project-wiki-bootstrap problem or side effect" issue-draft-title-fallback.md
node "$CLI" --issue-draft --issue-title $'Problem title\nInjected heading' > issue-draft-sanitized-title.md
grep -q "# Problem title Injected heading" issue-draft-sanitized-title.md
if grep -q "^Injected heading$" issue-draft-sanitized-title.md; then
  echo "issue draft title preserved an unsafe newline" >&2
  exit 1
fi

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
node "$CLI"
grep -q "Custom content before the wiki section." AGENTS.md
grep -q "Custom content after a heading that matches the bootstrap fallback heading." AGENTS.md
grep -q "PROJECT-WIKI-FIRST:START" AGENTS.md
grep -q "Custom Claude content before the compatibility section." CLAUDE.md
grep -q "Custom Claude content after a heading that matches the bootstrap fallback heading." CLAUDE.md
grep -q "PROJECT-WIKI-CLAUDE:START" CLAUDE.md
node -e 'const c=require("./.codex/hooks.json"); if (!JSON.stringify(c).includes("node custom-codex-hook.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!JSON.stringify(c).includes("node custom-claude-hook.js")) process.exit(1)'
node -e 'const c=require("./.codex/hooks.json"); if (c.mcpServers.existing.command !== "node existing-mcp.js") process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-post-tool-use.js") process.exit(1); const starts = c.hooks.SessionStart.filter(e => e.matcher === "startup|resume|clear"); if (starts.length !== 1) process.exit(1); const commands = starts[0].hooks.map(h => h.command); if (!commands.includes("node custom-codex-hook.js") || !commands.includes("node .codex/hooks/wiki-session-start.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!c.permissions.allow.includes("Bash(npm test)")) process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-claude-post-tool-use.js") process.exit(1); const startup = c.hooks.SessionStart.filter(e => e.matcher === "startup"); if (startup.length !== 1) process.exit(1); const commands = startup[0].hooks.map(h => h.command); if (!commands.includes("node custom-claude-hook.js") || !commands.includes("node .claude/hooks/wiki-session-start.js")) process.exit(1); const ms = new Set(c.hooks.SessionStart.filter(e => (e.hooks || []).some(h => h.command === "node .claude/hooks/wiki-session-start.js")).map(e => e.matcher)); for (const m of ["startup","resume","clear","compact"]) if (!ms.has(m)) process.exit(1)'
node -e 'const c=require("./.codex/settings.json"); if (c.sandbox !== "workspace-write") process.exit(1)'

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
node "$CLI" --code-index --code-scope src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > code-index.log
test -f .project-wiki/code-evidence.sqlite
grep -q "files: 4" code-index.log
node "$CLI" --code-query "select path from files order by path" > code-query.json
grep -q "src/app.js" code-query.json
grep -q "src/server.go" code-query.json
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
node "$CLI" --code-report > code-report.json
node -e 'const r=require("./code-report.json"); if (r.schema_version !== 1) process.exit(1); if (!r.report_sections.includes("ownership_summary")) process.exit(1); if (!r.evidence_coverage || r.evidence_coverage.files !== 4 || r.evidence_coverage.routes < 1) process.exit(1); if (!r.language_profile_summary.some((row) => row.language === "go" && row.profile === "go-light")) process.exit(1); if (!r.ownership_summary.some((row) => row.owner === "src" && row.routes >= 1)) process.exit(1); if (!r.route_inventory.some((row) => row.route === "/health")) process.exit(1); if (!r.dependency_hotspots.package_dependencies.some((row) => row.package === "express")) process.exit(1); if (!r.edge_summary.by_kind.some((row) => row.kind === "route_to_handler")) process.exit(1)'
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
node "$CLI" --code-index --code-scope src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > incremental-code-index.log
grep -q "mode: incremental" incremental-code-index.log
grep -q "files: 4" incremental-code-index.log
grep -q "reindexed_files: 2" incremental-code-index.log
grep -q "deleted_files: 1" incremental-code-index.log
node "$CLI" --code-status > fresh-status.json
node -e 'const rows = require("./fresh-status.json"); const metric = Object.fromEntries(rows.map((row) => [row.metric, row.value])); if (metric.stale_files !== 0 || metric.files !== 4) process.exit(1)'
node "$CLI" --code-search-symbol newHandler > incremental-symbols.json
grep -q "newHandler" incremental-symbols.json
node "$CLI" --code-files > fresh-files.json
! grep -q ".env.example" fresh-files.json
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
HOME="$TMPDIR/home" node "$CLI" install-skill --scope user --agents codex,claude > user-skill-install.log
grep -q "install-skill only installs the reusable skill files" user-skill-install.log
grep -q "agents should run the installed local project-wiki-bootstrap runner" user-skill-install.log
test -f "$TMPDIR/home/.codex/skills/project-wiki-bootstrap/SKILL.md"
test -x "$TMPDIR/home/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.claude/skills/project-wiki-bootstrap/SKILL.md"
test -x "$TMPDIR/home/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js"

node "$CLI" install-skill --scope project --agents both > project-skill-install.log
grep -q "install-skill only installs the reusable skill files" project-skill-install.log
grep -q "agents should run the installed local project-wiki-bootstrap runner" project-skill-install.log
test -f .codex/skills/project-wiki-bootstrap/SKILL.md
test -x .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js
test -f .claude/skills/project-wiki-bootstrap/SKILL.md
test -x .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js

mkdir "$TMPDIR/benchmark"
cd "$TMPDIR/benchmark"
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --out benchmark.json > benchmark.stdout.json
test -f benchmark.json
node -e 'const m=require("./benchmark.json"); if (m.schema_version !== 7 || m.scale !== "quick") process.exit(1); if (!m.environment || !m.environment.node || !m.environment.v8 || !m.environment.os_release || !m.environment.cpu_model || m.environment.cpu_count < 1 || m.environment.total_memory_mb < 1) process.exit(1); if (!m.source_control || m.source_control.available !== true || !m.source_control.commit || !m.source_control.short_commit || typeof m.source_control.dirty !== "boolean") process.exit(1); if (!m.benchmark_configuration || m.benchmark_configuration.sample_repo_count !== 3 || m.benchmark_configuration.measurement_protocol !== "median" || !Array.isArray(m.benchmark_configuration.sample_repo_fingerprints) || m.benchmark_configuration.sample_repo_fingerprints.length !== 3 || !m.benchmark_configuration.sample_repo_fingerprints.every((item)=>item.algorithm==="sha256" && item.value && item.file_count > 0)) process.exit(1); if (m.measurement.runs !== 1 || m.measurement.warmup_runs !== 0 || m.measurement.measurement_protocol !== "median" || m.measurement.timing_status !== "single-run") process.exit(1); if (!Array.isArray(m.measurement.claims) || !m.measurement.claims.some((claim) => claim.id === "code.architecture_report_ms") || !m.measurement.claims.some((claim) => claim.id === "docs.targeted_context.avg_read_ms") || m.measurement.claims.filter((claim) => claim.id.startsWith("sample_repo.")).length !== 6) process.exit(1); if (!Array.isArray(m.measurement.claimable_metrics) || !Array.isArray(m.measurement.unstable_metrics)) process.exit(1); if (m.scenarios.length !== 6) process.exit(1); if (!m.scenarios.every((s) => Array.isArray(s.validations) && s.validations.every((v) => v.status === "passed"))) process.exit(1); if (!m.scenarios.every((s) => s.measurement && s.measurement.runs === 1)) process.exit(1); if (m.large_project_assumptions.monorepo_workspaces < 5 || m.large_project_assumptions.sample_repo_paths.length !== 3) process.exit(1); for (const kind of ["tsx","go","python","package-lock"]) if (!m.large_project_assumptions.code_heavy_mixed_file_kinds.includes(kind)) process.exit(1); if (m.summary.min_estimated_token_avoidance_percent <= 0 || m.summary.retrieval_correctness_checks < 2 || m.summary.retrieval_correctness_passed !== m.summary.retrieval_correctness_checks || m.summary.targeted_context_evidence_missing !== 0 || m.summary.startup_index_only_evidence_missing <= 0 || m.summary.code_evidence_correctness_passed !== 1) process.exit(1); const docs=m.scenarios.find((s)=>s.fixture_kind==="docs-heavy-large-project"); if (!docs || docs.savings.basis !== "targeted_context_vs_full_wiki_scan" || !docs.targeted_context || docs.targeted_context.file_count !== 3 || docs.targeted_context.estimated_tokens <= docs.compact_context.estimated_tokens || docs.startup_index_only_upper_bound.estimated_token_avoidance_percent <= docs.savings.estimated_token_avoidance_percent) process.exit(1); if (!docs.retrieval_correctness || docs.retrieval_correctness.correctness_status !== "passed" || docs.retrieval_correctness.query_returned_expected_file !== true || !Array.isArray(docs.retrieval_strategy_comparison)) process.exit(1); const docsStartup=docs.retrieval_strategy_comparison.find((item)=>item.strategy==="startup_index_only"); const docsTargeted=docs.retrieval_strategy_comparison.find((item)=>item.strategy==="targeted_query_result"); if (!docsStartup || docsStartup.correctness_status !== "evidence-missing-without-followup" || docsStartup.expected_evidence_files_missing < 1 || !docsTargeted || docsTargeted.correctness_status !== "evidence-present" || docsTargeted.expected_evidence_files_missing !== 0) process.exit(1); if (m.summary.code_index_ms <= 0 || m.summary.code_index_files <= 0 || m.summary.code_index_files_per_second <= 0) process.exit(1); if (typeof m.summary.code_index_incremental_reindexed_files !== "number" || m.summary.code_index_incremental_ms <= 0) process.exit(1); if (m.summary.architecture_report_ms <= 0 || m.summary.architecture_report_sections < 7 || m.summary.architecture_report_evidence_tables < 6 || m.summary.architecture_report_routes <= 0 || m.summary.architecture_report_dependencies <= 0) process.exit(1); if (m.summary.sample_repo_count !== 3 || m.summary.sample_repo_code_files <= 1 || m.summary.sample_repo_code_index_ms <= 0 || m.summary.sample_repo_architecture_report_ms <= 0 || m.summary.sample_repo_architecture_report_routes <= 0 || m.summary.sample_repo_architecture_report_dependencies <= 0 || !Array.isArray(m.summary.sample_repo_profiles) || m.summary.sample_repo_profiles.length !== 3) process.exit(1); const code=m.scenarios.find((s)=>s.fixture_kind==="code-heavy-large-project"); if (!code || code.incremental_index_mode !== "incremental" || !code.assumptions.generated_js_files || !code.assumptions.generated_tsx_files || !code.assumptions.generated_config_files || !code.assumptions.generated_go_files || !code.assumptions.generated_python_files || !code.assumptions.generated_ignored_files) process.exit(1); if (code.architecture_report_schema_version !== 1 || code.architecture_report_stale_files !== 0 || code.architecture_report_language_profiles < 3 || code.node_subprocess_overhead_ms <= 0 || code.code_index_operation_estimated_ms < 0 || code.architecture_report_operation_estimated_ms < 0) process.exit(1); if (!code.evidence_correctness || code.evidence_correctness.correctness_status !== "passed" || code.evidence_correctness.route_query_returned_expected_file !== true || code.evidence_correctness.dependency_query_returned_expected_file !== true) process.exit(1); const samples=m.scenarios.filter((s)=>s.fixture_kind.startsWith("sample-repo-validation-")); if (samples.length !== 3 || !samples.every((s)=>s.confidence === "observational-for-the-explicit-local-repo-only" && s.sample_repo_id && s.sample_repo_profile && s.sample_repo_fingerprint && s.sample_repo_fingerprint_algorithm === "sha256" && Array.isArray(s.sample_repo_profile_traits) && s.sample_repo_architecture_report_stale_files === 0 && s.node_subprocess_overhead_ms > 0 && s.sample_repo_code_index_operation_estimated_ms >= 0 && s.sample_repo_architecture_report_operation_estimated_ms >= 0)) process.exit(1); if (!samples.some((s)=>s.sample_repo_profile_traits.includes("web-routes")) || !samples.some((s)=>s.sample_repo_profile_traits.includes("library-or-tooling")) || !samples.some((s)=>s.sample_repo_profile_traits.includes("monorepo-shaped"))) process.exit(1); if (!m.notes.some((note) => note.includes("release evidence")) || !m.notes.some((note) => note.includes("repeated --sample-repo")) || !m.notes.some((note) => note.includes("benchmarks/samples")) || !m.notes.some((note) => note.includes("allow-dirty-baseline")) || !m.notes.some((note) => note.includes("not a model-tokenizer measurement"))) process.exit(1)'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline benchmark.json --out benchmark-comparison.json > benchmark-comparison.stdout.json
node -e 'const m=require("./benchmark-comparison.json"); if (!m.comparison) process.exit(1); if (m.comparison.baseline_package_version !== m.package_version) process.exit(1); if (typeof m.comparison.summary_min_estimated_token_avoidance_delta_percent !== "number") process.exit(1); if (!["passed","failed","unstable","not_comparable"].includes(m.comparison.regression_status)) process.exit(1); if (!m.comparison.compatibility || !m.comparison.compatibility.comparable) process.exit(1); if (!m.comparison.regression_thresholds) process.exit(1)'
if node "$ROOT/benchmarks/project-metrics.js" --quick --fail-on-regression --out missing-baseline-gate.json > missing-baseline-gate.log 2>&1; then
  echo "benchmark release gate should require --baseline" >&2
  exit 1
fi
grep -q "requires --baseline" missing-baseline-gate.log
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); m.measurement.runs=2; fs.writeFileSync("not-comparable-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline not-comparable-baseline.json --out not-comparable-comparison.json > not-comparable-comparison.stdout.json
node -e 'const m=require("./not-comparable-comparison.json"); if (m.comparison.regression_status !== "not_comparable") process.exit(1); if (!m.comparison.compatibility.issues.includes("benchmark.runs")) process.exit(1)'
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const sample=m.scenarios.find((s)=>s.fixture_kind==="sample-repo-validation-01"); sample.sample_repo_fingerprint="changed"; fs.writeFileSync("sample-mismatch-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline sample-mismatch-baseline.json --out sample-mismatch-comparison.json > sample-mismatch-comparison.stdout.json
node -e 'const m=require("./sample-mismatch-comparison.json"); if (m.comparison.regression_status !== "not_comparable") process.exit(1); if (!m.comparison.compatibility.issues.includes("benchmark.scenarios")) process.exit(1)'
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const sample=m.scenarios.find((s)=>s.fixture_kind==="sample-repo-validation-01"); sample.sample_repo_code_index_ms=sample.sample_repo_code_index_ms / 10; sample.sample_repo_architecture_report_ms=sample.sample_repo_architecture_report_ms / 10; fs.writeFileSync("sample-masked-regression-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline sample-masked-regression-baseline.json --out sample-masked-regression-comparison.json > sample-masked-regression-comparison.stdout.json
node -e 'const m=require("./sample-masked-regression-comparison.json"); if (m.comparison.regression_status !== "failed") process.exit(1); if (!Array.isArray(m.comparison.sample_repo_deltas) || m.comparison.sample_repo_deltas.length !== 3) process.exit(1); if (!m.comparison.regressions.some((item)=>item.metric==="sample_repo_worst_code_index_ms_delta_percent")) process.exit(1)'
node -e 'const fs=require("fs"); const m=require("./benchmark.json"); const docs=m.scenarios.find((s)=>s.fixture_kind==="docs-heavy-large-project"); const monorepo=m.scenarios.find((s)=>s.fixture_kind==="monorepo-large-project"); const code=m.scenarios.find((s)=>s.fixture_kind==="code-heavy-large-project"); docs.query_ms=100000; monorepo.doctor_ms=100000; code.code_index_ms=100000; code.incremental_index_ms=100000; code.architecture_report_ms=100000; code.code_index_files_per_second=1; for (const sample of m.scenarios.filter((s)=>s.fixture_kind.startsWith("sample-repo-validation-"))) { sample.sample_repo_code_index_ms=100000; sample.sample_repo_architecture_report_ms=100000; } m.summary.sample_repo_code_index_ms=100000; m.summary.sample_repo_architecture_report_ms=100000; m.summary.min_estimated_token_avoidance_percent=0; fs.writeFileSync("unstable-gate-baseline.json", `${JSON.stringify(m,null,2)}\n`);'
if node "$ROOT/benchmarks/project-metrics.js" --quick --sample-repo "$ROOT/benchmarks/samples/web-service" --sample-repo "$ROOT/benchmarks/samples/python-cli" --sample-repo "$ROOT/benchmarks/samples/mixed-monorepo" --baseline unstable-gate-baseline.json --fail-on-regression --out unstable-gate-comparison.json > unstable-gate-comparison.log 2>&1; then
  echo "benchmark release gate should reject single-run unstable timing" >&2
  exit 1
fi
grep -q "benchmark release gate failed: unstable" unstable-gate-comparison.log
if node "$ROOT/benchmarks/project-metrics.js" --quick --save-baseline dirty-baseline.json > dirty-baseline.log 2>&1; then
  echo "benchmark baseline save should reject dirty worktrees by default" >&2
  exit 1
fi
grep -q "allow-dirty-baseline" dirty-baseline.log
node "$ROOT/benchmarks/project-metrics.js" --quick --save-baseline saved-baseline.json --allow-dirty-baseline --markdown release-summary.md > benchmark-release.stdout.json
test -f saved-baseline.json
test -f release-summary.md
grep -q "Project Wiki Bootstrap Benchmark" release-summary.md
grep -q "Claim Boundaries" release-summary.md
node "$ROOT/benchmarks/project-metrics.js" --trend benchmark.json --trend benchmark-comparison.json --trend-out trend.json --trend-markdown trend.md > trend.stdout.json
test -f trend.json
test -f trend.md
grep -q "Benchmark Trend" trend.md
node -e 'const t=require("./trend.json"); if (t.schema_version !== 1 || t.benchmark_schema_version !== 7 || t.report_count !== 2 || !t.baseline_input.endsWith("benchmark.json") || !t.metrics || !t.metrics.code_index_ms || !Array.isArray(t.points) || t.points.length !== 2 || t.points[0].order !== 1) process.exit(1)'
node "$ROOT/benchmarks/project-metrics.js" --trend benchmark.json --trend sample-mismatch-baseline.json --trend-out incompatible-trend.json > incompatible-trend.stdout.json
node -e 'const t=require("./incompatible-trend.json"); if (t.report_count !== 2 || t.comparable_report_count !== 1 || t.metrics.code_index_ms.status !== "n/a") process.exit(1)'
