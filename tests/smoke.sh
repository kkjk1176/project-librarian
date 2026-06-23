#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/init-project-wiki.js"
TMPDIR="$(mktemp -d)"
ROOT_DIRTY_PROBE="$ROOT/benchmarks/reports/dirty-baseline-smoke.tmp"
TODAY="$(date +%F)"

cleanup() {
  cd "$ROOT" 2>/dev/null || cd /
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
grep -Fq "project-librarian [init|update] [options]" help.log
grep -Fq "project-librarian install [--scope user|project]" help.log
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
if node "$CLI" update --migrate > update-migrate.log 2>&1; then
  echo "expected update --migrate to fail" >&2
  exit 1
fi
grep -q "update cannot be combined with --migrate or --adopt-existing" update-migrate.log
test ! -e AGENTS.md
test ! -e wiki
test ! -e wiki_legacy
if node "$CLI" update --adopt-existing > update-adopt-existing.log 2>&1; then
  echo "expected update --adopt-existing to fail" >&2
  exit 1
fi
grep -q "update cannot be combined with --migrate or --adopt-existing" update-adopt-existing.log
test ! -e AGENTS.md
test ! -e wiki
test ! -e wiki_legacy
grep -q -- "--issue-draft" help.log
grep -q -- "--issue-create" help.log
grep -q -- "--issue-body-file" help.log
grep -q -- "--dry-run" help.log
grep -q -- "--incremental" help.log
grep -q -- "--acknowledge-small-repo" help.log
grep -q -- "--code-index-full" help.log
grep -q -- "--code-index-engine" help.log
grep -q -- "--code-impact" help.log
grep -q -- "--code-context-pack" help.log
grep -q -- "--code-parser" help.log
grep -q -- "--code-report-section" help.log
grep -q -- "--handoff-save" help.log
grep -q -- "--handoff-show" help.log
grep -q -- "--handoff-status" help.log
grep -q -- "--handoff-clear" help.log
grep -q -- "--handoff-promote-inbox" help.log
grep -q -- "--handoff-injection-enable" help.log
grep -q -- "--handoff-injection-disable" help.log
grep -q -- "--handoff-injection-status" help.log
grep -q "project-librarian mcp" help.log
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
if node "$CLI" --code-context-pack > missing-code-context-pack.log 2>&1; then
  echo "expected missing --code-context-pack value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-context-pack" missing-code-context-pack.log
if node "$CLI" --code-parser > missing-code-parser.log 2>&1; then
  echo "expected missing --code-parser value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-parser" missing-code-parser.log
if node "$CLI" --code-index-engine > missing-code-index-engine.log 2>&1; then
  echo "expected missing --code-index-engine value to fail" >&2
  exit 1
fi
grep -q "missing value for option: --code-index-engine" missing-code-index-engine.log
if node "$CLI" --code-index-engine native-rust > lone-code-index-engine.log 2>&1; then
  echo "expected --code-index-engine without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--code-index-engine is only supported with --code-index" lone-code-index-engine.log
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
if node "$CLI" --acknowledge-small-repo > lone-acknowledge-small-repo.log 2>&1; then
  echo "expected --acknowledge-small-repo without --code-index to fail" >&2
  exit 1
fi
grep -q -- "--acknowledge-small-repo is only supported with --code-index" lone-acknowledge-small-repo.log
if node "$CLI" --goal "No handoff mode" > lone-handoff-input.log 2>&1; then
  echo "expected handoff input without --handoff-save to fail" >&2
  exit 1
fi
grep -q -- "only supported with --handoff-save" lone-handoff-input.log
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
test -f .cursor/hooks/wiki-session-start.js
test -f .cursor/hooks.json
test -f .gemini/hooks/wiki-session-start.js
test -f .gemini/settings.json
test ! -e wiki/canonical/project-brief.md
test ! -e wiki/canonical/open-questions.md
test ! -e wiki/canonical/assumptions.md
test ! -e wiki/canonical/risks.md
test ! -e wiki/decisions/decision-pack-template.md
test ! -e wiki/decisions/full-adr-template.md

node "$CLI" > rerun.log
grep -q "exists  AGENTS.md" rerun.log
grep -q "exists  CLAUDE.md" rerun.log
grep -q "exists  GEMINI.md" rerun.log
grep -q "exists  wiki/AGENTS.md" rerun.log

node "$CLI" update --no-git-config > update-rerun.log
grep -q "Project Librarian + no-git-config complete." update-rerun.log
grep -q "exists  AGENTS.md" update-rerun.log
grep -q "exists  wiki/AGENTS.md" update-rerun.log
test ! -e wiki_legacy
if node "$CLI" update --migrate > update-migrate-existing.log 2>&1; then
  echo "expected update --migrate in an initialized project to fail" >&2
  exit 1
fi
grep -q "update cannot be combined with --migrate or --adopt-existing" update-migrate-existing.log
test -d wiki
test ! -e wiki_legacy

node "$CLI" --lint
node "$CLI" init --lint

mkdir "$TMPDIR/agent-aware-lint"
cd "$TMPDIR/agent-aware-lint"
node "$CLI" --no-git-config > agent-aware-init.log
rm -rf GEMINI.md .cursor .gemini
node "$CLI" --lint > codex-claude-only-lint.log
grep -q "passed:" codex-claude-only-lint.log
mkdir -p .cursor
printf '{"version":1,"hooks":{}}\n' > .cursor/hooks.json
if node "$CLI" --lint > partial-cursor-lint.log 2>&1; then
  echo "expected partial Cursor surface to fail lint" >&2
  exit 1
fi
grep -q "missing required file: .cursor/rules/project-librarian.mdc" partial-cursor-lint.log
grep -q "missing required file: .cursor/hooks/wiki-session-start.js" partial-cursor-lint.log
cd "$TMPDIR"

node .codex/hooks/wiki-session-start.js > hook.json
node .claude/hooks/wiki-session-start.js > claude-hook.json
node .cursor/hooks/wiki-session-start.js > cursor-hook.json
GEMINI_PROJECT_DIR="$PWD" node .gemini/hooks/wiki-session-start.js > gemini-hook.json
grep -q "wiki/startup.md" hook.json
grep -q "wiki/index.md" hook.json
grep -q "wiki/startup.md" claude-hook.json
grep -q "wiki/index.md" claude-hook.json
grep -q "wiki/startup.md" cursor-hook.json
grep -q "wiki/index.md" cursor-hook.json
grep -q "additional_context" cursor-hook.json
grep -q "wiki/startup.md" gemini-hook.json
grep -q "wiki/index.md" gemini-hook.json
grep -q "hookSpecificOutput" gemini-hook.json
grep -q "node .claude/hooks/wiki-session-start.js" .claude/settings.json
node -e 'const s=require("./.claude/settings.json"); const ms=new Set((s.hooks.SessionStart||[]).filter(e=>(e.hooks||[]).some(h=>h.command==="node .claude/hooks/wiki-session-start.js")).map(e=>e.matcher)); for (const m of ["startup","resume","clear","compact"]) if (!ms.has(m)) process.exit(1)'
grep -q "node .cursor/hooks/wiki-session-start.js" .cursor/hooks.json
node -e 'const s=require("./.cursor/hooks.json"); if (!Array.isArray(s.hooks.sessionStart) || !s.hooks.sessionStart.some(h=>h.command==="node .cursor/hooks/wiki-session-start.js")) process.exit(1)'
node -e 'const s=require("./.gemini/settings.json"); const command="node \"$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js\""; const ms=new Set((s.hooks.SessionStart||[]).filter(e=>(e.hooks||[]).some(h=>h.command===command)).map(e=>e.matcher)); for (const m of ["startup","resume","clear"]) if (!ms.has(m)) process.exit(1)'
grep -q "Read On Demand" wiki/startup.md
grep -q "Language Policy" wiki/index.md
grep -q "Project canonical content language" wiki/startup.md
grep -q "@AGENTS.md" CLAUDE.md
grep -q "@AGENTS.md" GEMINI.md
grep -q "alwaysApply: true" .cursor/rules/project-librarian.mdc
grep -q "@AGENTS.md" .cursor/rules/project-librarian.mdc
# B1 fallback: managed AGENTS.md carries the auto-synced startup TL;DR sub-block,
# and the synced bullets match the startup.md TL;DR (first TL;DR bullet sample).
grep -q "Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)" AGENTS.md
grep -q "This project is in an initial planning state unless the canonical wiki says otherwise." AGENTS.md
# B4 trust contract: single authoritative-wiki sentence, gated on B2 (shipped together).
grep -q "Wiki decision documents are authoritative for project decisions" AGENTS.md
grep -q -- "--doctor\` router-truth rule guards against stale routers" AGENTS.md
# B3: SessionStart hook payload carries the injected-context marker and no-duplicate-read instruction.
grep -q "ALREADY included" hook.json
grep -q "Do not re-read these two files this session" hook.json
grep -q "ALREADY included" claude-hook.json
grep -q "ALREADY included" cursor-hook.json
grep -q "ALREADY included" gemini-hook.json
# B3 budgets: startup/index file budgets are unchanged by the marker text.
grep -q '"wiki/startup.md", 3500' .codex/hooks/wiki-session-start.js
grep -q '"wiki/index.md", 4500' .codex/hooks/wiki-session-start.js
# Code-evidence trust contract (B4 analogue) in the managed AGENTS.md block.
grep -q "Code-evidence tool and report outputs" AGENTS.md
grep -q -- "\`--code-status\`/\`code_status\` reports staleness" AGENTS.md
# Guidance-refinement claims stay scoped to measured local evidence.
grep -q "Guidance-refinement claims are evidence-scoped" AGENTS.md
grep -q "passed claim gate with complete measured pairs" AGENTS.md
# Bootstrap-managed MCP registration is scale-gated: this fixture sits below the
# small-repo threshold with no code-evidence index, so bootstrap reports the skip
# reason and writes no MCP config.
node "$CLI" --no-git-config > mcp-skip.log
grep -q "skipped-small-repo" mcp-skip.log
grep -q -- "--code-index --acknowledge-small-repo" mcp-skip.log
test ! -e .mcp.json
test ! -e .cursor/mcp.json
node -e 'const c=require("./.gemini/settings.json"); if (c.mcpServers) process.exit(1)'
# The same scale gate halts a sub-threshold --code-index without the acknowledge
# flag, before any .project-wiki write, citing the benchmark evidence.
if node "$CLI" --code-index > code-index-gate.log 2>&1; then
  echo "expected sub-threshold --code-index without --acknowledge-small-repo to fail" >&2
  exit 1
fi
grep -q "scale threshold" code-index-gate.log
grep -q "stageR1" code-index-gate.log
grep -q "Not measured, so not disproven" code-index-gate.log
grep -q -- "--acknowledge-small-repo" code-index-gate.log
test ! -e .project-wiki
# Acknowledged index build is standing consent: the next bootstrap registers the
# MCP server in Claude .mcp.json, Cursor .cursor/mcp.json, and Gemini mcpServers
# inside .gemini/settings.json regardless of scale.
node "$CLI" --code-index --acknowledge-small-repo > code-index-acknowledged.log
grep -q "Project wiki code evidence index complete." code-index-acknowledged.log
node "$CLI" --no-git-config > mcp-register.log
grep -q "created .mcp.json" mcp-register.log
test -f .mcp.json
test -f .cursor/mcp.json
node -e 'const c=require("./.mcp.json"); const e=c.mcpServers&&c.mcpServers["project-librarian"]; if (!e||e.args[e.args.length-1]!=="mcp") process.exit(1)'
node -e 'const c=require("./.cursor/mcp.json"); const e=c.mcpServers&&c.mcpServers["project-librarian"]; if (!e||e.args[e.args.length-1]!=="mcp") process.exit(1)'
node -e 'const c=require("./.gemini/settings.json"); const e=c.mcpServers&&c.mcpServers["project-librarian"]; if (!e||e.args[e.args.length-1]!=="mcp") process.exit(1); if (!Array.isArray(c.hooks&&c.hooks.SessionStart)) process.exit(1)'
# Second registering run reports the registrations as idempotent.
node "$CLI" --no-git-config > mcp-rerun.log
grep -q "exists  .mcp.json" mcp-rerun.log
grep -q "exists  .cursor/mcp.json" mcp-rerun.log
grep -q "exists  .gemini/settings.json mcpServers" mcp-rerun.log
# One stdio MCP handshake against the built server: initialize + tools/list +
# resources/list + prompts/list.
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list"}' \
  '{"jsonrpc":"2.0","id":4,"method":"prompts/list"}' \
  | node "$CLI" mcp 2>/dev/null > mcp-handshake.ndjson
node -e 'const fs=require("fs"); const lines=fs.readFileSync("mcp-handshake.ndjson","utf8").trim().split(/\n/).map((l)=>JSON.parse(l)); const init=lines.find((m)=>m.id===1); if (!init||init.result.protocolVersion!=="2025-06-18"||!init.result.capabilities.tools||!init.result.capabilities.resources||!init.result.capabilities.prompts) process.exit(1); if (init.result.serverInfo.name!=="project-librarian") process.exit(1); const list=lines.find((m)=>m.id===2); const names=list.result.tools.map((t)=>t.name).sort().join(","); if (names!=="code_context_pack,code_impact,code_ownership,code_search,code_status,code_workspace_graph") process.exit(1); for (const t of list.result.tools) if (!t.description.includes("do not re-verify with repo-wide greps unless `code_status` reports staleness")) process.exit(1); const resources=lines.find((m)=>m.id===3).result.resources.map((r)=>r.uri).sort().join(","); if (resources!=="project-librarian://code/status,project-librarian://wiki/index,project-librarian://wiki/startup") process.exit(1); const prompts=lines.find((m)=>m.id===4).result.prompts.map((p)=>p.name).sort().join(","); if (prompts!=="code_impact_trace,maintenance_improvement_review,retrieval_quality_review,wiki_taxonomy_update") process.exit(1)'

node "$CLI" --handoff-save --goal "Smoke handoff sk-test1234567890abcdef" --state "Smoke state should stay out of startup" --next "Inspect handoff" --decision "Pointer only" > handoff-save.log
grep -q "Project Librarian handoff written" handoff-save.log
test -f .project-wiki/session/last-handoff.md
grep -q "\[REDACTED_OPENAI_KEY\]" .project-wiki/session/last-handoff.md
node .codex/hooks/wiki-session-start.js > hook-with-handoff.json
grep -q ".project-wiki/session/last-handoff.md" hook-with-handoff.json
grep -q "project-librarian --handoff-show" hook-with-handoff.json
if grep -q "Smoke state should stay out of startup" hook-with-handoff.json; then
  echo "expected startup hook to point to handoff without injecting full handoff" >&2
  exit 1
fi
node "$CLI" --handoff-show > handoff-show.log
grep -q "Project Librarian handoff: updated" handoff-show.log
node "$CLI" --handoff-status > handoff-status.json
node -e 'const s=require("./handoff-status.json"); if (!s.exists || !s.safeToInject || s.path!==".project-wiki/session/last-handoff.md") process.exit(1)'
node "$CLI" --handoff-promote-inbox > handoff-promote.log
grep -q "promoted to wiki inbox" handoff-promote.log
grep -q "session-handoff" wiki/inbox/project-candidates.md
node "$CLI" --handoff-injection-status > handoff-injection-before.json
node -e 'const s=require("./handoff-injection-before.json"); if (s.enabled || s.safeToInject) process.exit(1)'
node "$CLI" --handoff-injection-enable > handoff-injection-enable.log
grep -q "full injection enabled" handoff-injection-enable.log
node .codex/hooks/wiki-session-start.js > hook-with-full-handoff.json
grep -q "Full Session Handoff" hook-with-full-handoff.json
grep -q "Smoke handoff" hook-with-full-handoff.json
node "$CLI" --handoff-injection-disable > handoff-injection-disable.log
grep -q "injection-state.json=removed" handoff-injection-disable.log
node "$CLI" --handoff-clear > handoff-clear.log
grep -q "last-handoff.md=removed" handoff-clear.log

node "$CLI" --glossary-init
test -f wiki/canonical/glossary.md
node "$CLI" --refresh-index
node "$CLI" --capture-inbox --title "Smoke" --content "Candidate content"
node "$CLI" --capture-inbox > capture-inbox-empty-rerun.log
grep -q "exists  wiki/inbox/project-candidates.md" capture-inbox-empty-rerun.log
node "$CLI" --query Smoke > query-smoke.log
grep -q "Project wiki query \"Smoke\": best match" query-smoke.log
node "$CLI" --prune-check
node "$CLI" --prune-check --prune-check-strict
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
mkdir -p wiki/canonical
cat > wiki/canonical/project-brief.md <<EOF
---
status: active
updated: $TODAY
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: smoke diagnostics fixture
---

# Project Brief

## TL;DR

- Smoke fixture project truth.

Image asset probe: ![diagram](assets/diagram.png)
PDF asset probe: [spec](assets/spec.pdf)
Angle markdown probe: [decisions](<../decisions/README.md>)
Root wiki probe: [startup](/wiki/startup.md)
EOF
node "$CLI" --refresh-index > refresh-project-brief.log
node "$CLI" --link-check > link-check-assets-ok.log
grep -q "Project wiki link-check" link-check-assets-ok.log
grep -q "passed:" link-check-assets-ok.log
node "$CLI" --quality-check > quality-check.log
grep -q "Project wiki quality-check" quality-check.log
grep -q "0 warnings" quality-check.log
node "$CLI" --doctor > doctor.log
grep -q "Project wiki link-check" doctor.log
grep -q "Project wiki quality-check" doctor.log
grep -q "Project wiki router-truth check" doctor.log
grep -q "Project wiki lint" doctor.log
# B2 router-truth rule: a fresh bootstrap wiki (log has no dated entry) passes the rule.
if grep -q "router-truth-contradiction" doctor.log; then
  echo "expected fresh bootstrap to pass the router-truth rule" >&2
  exit 1
fi
if node "$CLI" --fix > bad-fix.log 2>&1; then
  echo "expected --fix without --doctor to fail" >&2
  exit 1
fi
grep -q -- "--fix is only supported with --doctor" bad-fix.log
# Wiki impact: answer-first backlink/decision_ref/routing envelope for a page.
node "$CLI" --wiki-impact canonical/project-brief > wiki-impact.log
grep -q "Wiki impact \"canonical/project-brief\":" wiki-impact.log
grep -q "incoming links" wiki-impact.log
grep -q "router: reachable at depth" wiki-impact.log
# Router reachability (A1 promoted to the real wiki): a linked-but-disconnected
# island warns router-unreachable while link-check still passes (warn severity).
cat > wiki/canonical/island-a.md <<'EOF'
# Island A

Linked island probe: [[canonical/island-b]]
EOF
cat > wiki/canonical/island-b.md <<'EOF'
# Island B

Linked island probe: [[canonical/island-a]]
EOF
node "$CLI" --link-check > island-link-check.log
grep -q "router-unreachable wiki/canonical/island-a.md" island-link-check.log
grep -q "router-unreachable wiki/canonical/island-b.md" island-link-check.log
grep -q "passed:" island-link-check.log
rm wiki/canonical/island-a.md wiki/canonical/island-b.md
# B2 router-truth rule: a dated decision-log entry while startup/recent still say
# "None yet." is an error-level contradiction that fails --doctor and names both sides.
node -e 'const fs=require("fs"); const f="wiki/decisions/log.md"; fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace("No project decisions yet.", "- 2026-06-10 | metrics | benchmark evidence policy adopted | canonical: [[canonical/project-brief]]"));'
if node "$CLI" --doctor > doctor-router-truth.log 2>&1; then
  echo "expected --doctor to fail on a router-truth contradiction" >&2
  exit 1
fi
grep -q "router-truth-contradiction" doctor-router-truth.log
grep -q "wiki/decisions/recent.md" doctor-router-truth.log
grep -q "wiki/startup.md" doctor-router-truth.log
grep -q "wiki/decisions/log.md holds a dated decision entry" doctor-router-truth.log
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

Decision: preserve a source path containing a pipe, a legacy-only [[missing-legacy-target]] wikilink, and a [legacy markdown link](legacy-only.md) inside generated migration ledgers.
EOF
node "$CLI" --migrate
test -f wiki/migration/unit-map.md
test -f wiki/migration/split-plan.md
test -f wiki/migration/review.md
test -f wiki/migration/bulk-review.md
grep -q 'spec\\|decision.md' wiki/migration/verification.md
grep -q 'spec\\|decision.md#u' wiki/migration/coverage.md
grep -q 'spec\\|decision.md#u' wiki/migration/unit-map.md
grep -q 'spec\\|decision.md#u' wiki/migration/split-plan.md
grep -Fq "[[migration/coverage]]" wiki/index.md
grep -Fq "[[migration/unit-map]]" wiki/index.md
grep -Fq "[[migration/split-plan]]" wiki/index.md
grep -Fq "[[migration/bulk-review]]" wiki/index.md
grep -q "Completion Scope" wiki/migration/verification.md
grep -q "Bulk Review Summary" wiki/migration/review.md
grep -q "Human-Review Triage" wiki/migration/bulk-review.md
grep -q "Content-Bearing Human-Review Batches" wiki/migration/bulk-review.md
grep -q "High-confidence target batches" wiki/migration/bulk-review.md
grep -q "For a fresh rebuild request" wiki/migration/verification.md
grep -q "future fresh rebuild request" wiki/startup.md
grep -q "fresh rebuild procedure" wiki/index.md
node -e 'const fs=require("fs"); if (fs.readFileSync("wiki/index.md","utf8").length > 4500) process.exit(1)'
grep -q "&#91;&#91;missing-legacy-target&#93;&#93;" wiki/migration/coverage.md
grep -q "&#91;legacy markdown link&#93;(legacy-only.md)" wiki/migration/coverage.md
node "$CLI" --link-check > migration-link-check.log
grep -q "passed:" migration-link-check.log
node "$CLI" --migration-lint > migration-lint-pipe.log
grep -q "migration-pending-unit" migration-lint-pipe.log
mkdir wiki_legacy_stale
cat > wiki_legacy_stale/stale.md <<'EOF'
# Stale Legacy Root

Feature content from an older migration batch should not be required by the current verification root.
EOF
node "$CLI" --migration-lint > migration-active-root.log
if grep -q "stale.md" migration-active-root.log; then
  echo "expected migration lint to scope expected units to the current verification legacy root" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const file="wiki/decisions/migration-inbox.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace("| pending |", "| adopted |"));'
node "$CLI" --review-migration > review-migration-pipe.log
grep -Eq "semantic migration complete: yes, for the .* migration batch.* only" wiki/migration/verification.md
grep -Eq "semantic migration complete: yes, for the .* migration batch.* only" wiki/migration/review.md
grep -q "Open rows: 0" wiki/migration/bulk-review.md
grep -q "Content-bearing low rows | 0 | 0" wiki/migration/bulk-review.md
grep -q "For a fresh rebuild request" wiki/migration/review.md
grep -q 'spec\\|decision.md' wiki/migration/review.md
test ! -e wiki/canonical/migration-inbox.md
test ! -e wiki/decisions/migration-inbox.md
test ! -e wiki/sources/migration-inbox.md
test -e wiki_legacy
test -e wiki/migration/coverage.md
if grep -Fq "[[decisions/migration-inbox]]" wiki/index.md; then
  echo "expected completed migration cleanup to remove pruned inbox links" >&2
  exit 1
fi
grep -q "Generated file-level migration inboxes were pruned" wiki/index.md
node "$CLI" --link-check > migration-complete-link-check.log
grep -q "passed:" migration-complete-link-check.log
node "$CLI" --migration-doctor > migration-complete-doctor.log
grep -q "passed:" migration-complete-doctor.log
node -e 'const fs=require("fs"); const file="wiki/migration/coverage.md"; const lines=fs.readFileSync(file,"utf8").split(/\n/); let removed=false; const kept=lines.filter((line)=>{ if (!removed && /^\| spec\\\|decision\.md#u/.test(line)) { removed=true; return false; } return true; }); fs.writeFileSync(file, kept.join("\n"));'
if node "$CLI" --migration-lint > migration-lint-missing-unit.log 2>&1; then
  echo "expected --migration-lint to fail when coverage ledger drops a legacy meaning unit" >&2
  exit 1
fi
grep -q "migration-unaccounted-unit" migration-lint-missing-unit.log

mkdir "$TMPDIR/migration-mixed-split"
cd "$TMPDIR/migration-mixed-split"
mkdir wiki
cat > wiki/mixed-page.md <<'EOF'
# Checkout Mixed Spec

## Feature

Feature: customers can save checkout drafts before payment.

## UX

User flow: customer reviews the cart, chooses a payment method, then confirms the order.

## API

API endpoint POST /checkout accepts a request body and returns a response with order_id.

## QA

Test cases cover expired coupons, duplicate submissions, and payment retry regression.
EOF
node "$CLI" --migrate > migration-mixed.log
grep -q "product-requirements" wiki/migration/split-plan.md
grep -q "user-flows" wiki/migration/split-plan.md
grep -q "api-contracts" wiki/migration/split-plan.md
grep -q "qa-test-plan" wiki/migration/split-plan.md
grep -q "API Contract" wiki/migration/unit-map.md
grep -q "User Flow / Journey" wiki/migration/unit-map.md
node "$CLI" --migration-lint > migration-mixed-lint.log
grep -q "migration-pending-unit" migration-mixed-lint.log
node -e 'const fs=require("fs"); const file="wiki/migration/coverage.md"; const lines=fs.readFileSync(file,"utf8").split(/\n/); let changed=false; const next=lines.map((line)=>{ if (!changed && /^\| mixed-page\.md#u/.test(line) && line.includes("| pending |")) { changed=true; const cells=line.slice(1,-1).split(" | ").map((cell)=>cell.trim()); cells[6]="wiki/canonical/reviewed-retarget-product-requirements.md"; cells[7]="reviewed low-confidence content; retargeted for semantic rewrite"; cells[10]="reviewed source context; taxonomy target assigned"; return `| ${cells.join(" | ")} |`; } return line; }); if (!changed) process.exit(1); fs.writeFileSync(file, next.join("\n"));'
node "$CLI" --migration-lint > migration-reviewed-retarget.log
if grep -q "migration-pending-target-drift" migration-reviewed-retarget.log; then
  echo "expected --migration-lint to allow reviewed pending retargets" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const file="wiki/canonical/migration-inbox.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace("| pending |", "| adopted |"));'
node "$CLI" --review-migration > migration-mixed-review-file-level.log
grep -q "semantic migration complete: no" wiki/migration/verification.md
grep -q "file-level inbox row ignored for mixed-target legacy source" wiki/migration/review.md
node -e 'const fs=require("fs"); const file="wiki/migration/coverage.md"; const lines=fs.readFileSync(file,"utf8").split(/\n/).map((line)=>/^\| mixed-page\.md#u/.test(line) ? line.replace("| pending |", "| adopted |").replace("| needs-human-review |", "| adopted |") : line); fs.writeFileSync(file, lines.join("\n"));'
node "$CLI" --review-migration > migration-mixed-review-coverage.log
grep -Eq "semantic migration complete: yes, for the .* migration batch.* only" wiki/migration/verification.md
node -e 'const fs=require("fs"); const file="wiki/migration/split-plan.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace(/\| ([0-9]+) \| mixed-page\.md#u/, "| 99 | mixed-page.md#u"));'
if node "$CLI" --migration-lint > migration-split-plan-bad-count.log 2>&1; then
  echo "expected --migration-lint to fail when split-plan unit count drifts" >&2
  exit 1
fi
grep -q "migration-split-plan-count-mismatch" migration-split-plan-bad-count.log
node -e 'const fs=require("fs"); const file="wiki/migration/unit-map.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace(/\| (high|medium|low) \| wiki\//, "| impossible | wiki/"));'
if node "$CLI" --migration-lint > migration-unit-map-bad-confidence.log 2>&1; then
  echo "expected --migration-lint to fail when unit-map confidence is invalid" >&2
  exit 1
fi
grep -q "migration-unit-map-invalid-confidence" migration-unit-map-bad-confidence.log

mkdir "$TMPDIR/migration-junk-protection"
cd "$TMPDIR/migration-junk-protection"
mkdir wiki
cat > wiki/decision.md <<'EOF'
# Durable Decision

Decision: the migration cleanup must keep manually repurposed pages even when their filename is migration-inbox.md.
EOF
node "$CLI" --migrate > migration-junk-protection.log
cat > wiki/canonical/migration-inbox.md <<EOF
---
status: active
updated: $TODAY
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: retained migrated project content changes
---

# Migration Inbox

## TL;DR

- This page has been manually repurposed into project content and must not be pruned as generated migration scaffolding.
EOF
node -e 'const fs=require("fs"); const file="wiki/decisions/migration-inbox.md"; fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace("| pending |", "| adopted |"));'
node "$CLI" --review-migration > migration-junk-protection-review.log
grep -Eq "semantic migration complete: yes, for the .* migration batch.* only" wiki/migration/verification.md
test -e wiki/canonical/migration-inbox.md
test ! -e wiki/decisions/migration-inbox.md
test ! -e wiki/sources/migration-inbox.md
grep -Fq "[[canonical/migration-inbox]]" wiki/index.md
node "$CLI" --link-check > migration-junk-protection-link-check.log
grep -q "passed:" migration-junk-protection-link-check.log

mkdir "$TMPDIR/migration-copy-policy"
cd "$TMPDIR/migration-copy-policy"
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
- It intentionally contains enough repeated content to prove direct copy is allowed when policy-compliant.

## Details

Legacy Project Alpha serves billing administrators who reconcile imported invoices, approve payouts, and export financial reports. Its success criteria, domain terms, workflows, and release constraints belong to the current migration batch. A migration reviewer must verify useful meaning against the current wiki policy and structure before keeping this file in the new canonical wiki. The copied text includes specific roles, workflow names, product promises, and operational constraints that are still accepted as current project truth.
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
- It intentionally contains enough repeated content to prove direct copy is allowed when policy-compliant.

## Details

Legacy Project Alpha serves billing administrators who reconcile imported invoices, approve payouts, and export financial reports. Its success criteria, domain terms, workflows, and release constraints belong to the current migration batch. A migration reviewer must verify useful meaning against the current wiki policy and structure before keeping this file in the new canonical wiki. The copied text includes specific roles, workflow names, product promises, and operational constraints that are still accepted as current project truth.
EOF
node "$CLI" --quality-check > migration-copy-policy-normal.log
if grep -q "migration-copy-risk" migration-copy-policy-normal.log; then
  echo "expected normal --quality-check to ignore legacy copy similarity" >&2
  exit 1
fi
node "$CLI" --migration-quality-check > migration-copy-policy.log
if grep -Eq "migration-copy-risk|migration-filename-reuse" migration-copy-policy.log; then
  echo "expected --migration-quality-check to ignore copy and filename reuse by themselves" >&2
  exit 1
fi
grep -q "passed: .* 0 warnings" migration-copy-policy.log
node "$CLI" --migration-doctor > migration-doctor.log
grep -q "Project wiki migration lint" migration-doctor.log
grep -q "Project wiki migration quality-check" migration-doctor.log

mkdir "$TMPDIR/migration-retained-wording"
cd "$TMPDIR/migration-retained-wording"
mkdir -p wiki/canonical
cat > wiki/canonical/operations-reference.md <<'EOF'
---
status: active
updated: 2026-06-01
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: legacy operations changes
---

# Operations Reference

## TL;DR

- This legacy document contains valid project rules that should not be lost.

## Rules

- Alpha intake confirms requester identity before creating any tracked project planning record.
- Bravo review keeps unresolved scope questions visible until a maintainer closes them.
- Charlie routing sends security sensitive notes to the risk register instead of startup.
- Delta evidence records the current code path beside every code proven behavior claim.
- Echo glossary updates happen before names enter public commands, database fields, or policy text.
- Foxtrot migration keeps useful meaning while adapting it to the current topic structure.
- Golf decisions capture rejected alternatives when future agents might otherwise retry them.
- Hotel source notes retain external reference links when the summary depends on outside material.
- India startup context stays compact and routes detailed planning files on demand only.
- Juliet verification marks ambiguous legacy material for human review instead of dropping it.
EOF
node "$CLI" --migrate > migration-retained-wording-bootstrap.log
cat > wiki/canonical/operations-rules.md <<'EOF'
---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: operations rules change
---

# Operations Rules

## TL;DR

- Valid legacy wording is retained where it remains current truth.
- The rules are reorganized by current operating concern instead of copied as a legacy file.

## Evidence And Naming

- Delta evidence records the current code path beside every code proven behavior claim.
- Echo glossary updates happen before names enter public commands, database fields, or policy text.
- Hotel source notes retain external reference links when the summary depends on outside material.

## Migration And Review

- Foxtrot migration keeps useful meaning while adapting it to the current topic structure.
- Juliet verification marks ambiguous legacy material for human review instead of dropping it.
- Bravo review keeps unresolved scope questions visible until a maintainer closes them.

## Routing And Risk

- Alpha intake confirms requester identity before creating any tracked project planning record.
- Charlie routing sends security sensitive notes to the risk register instead of startup.
- Golf decisions capture rejected alternatives when future agents might otherwise retry them.
- India startup context stays compact and routes detailed planning files on demand only.
EOF
node "$CLI" --migration-quality-check > migration-retained-wording.log
if grep -q "migration-copy-risk" migration-retained-wording.log; then
  echo "expected retained valid wording in a restructured page to avoid copy-risk diagnostics" >&2
  exit 1
fi

mkdir "$TMPDIR/migration-legacy-reference"
cd "$TMPDIR/migration-legacy-reference"
mkdir -p wiki/canonical
cat > wiki/canonical/reference-source.md <<'EOF'
---
status: active
updated: 2026-06-01
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: legacy source changes
---

# Reference Source

## TL;DR

- This file gives migration mode a legacy wiki root.

## Details

Current project truth should be migrated into the new wiki instead of requiring readers to inspect preserved legacy files.
EOF
node "$CLI" --migrate > migration-legacy-reference-bootstrap.log
cat > wiki/canonical/bad-reference.md <<'EOF'
---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: migrated reference changes
---

# Bad Reference

## TL;DR

- This page incorrectly depends on preserved legacy files.

## Details

Read wiki_legacy/canonical/reference-source.md for the real source of truth.
EOF
node "$CLI" --quality-check > migration-legacy-reference-normal.log
if grep -q "migration-legacy-reference" migration-legacy-reference-normal.log; then
  echo "expected normal --quality-check to omit migration-legacy-reference" >&2
  exit 1
fi
if node "$CLI" --migration-quality-check > migration-legacy-reference.log 2>&1; then
  echo "expected --migration-quality-check to fail when active truth cites wiki_legacy" >&2
  exit 1
fi
grep -q "migration-legacy-reference" migration-legacy-reference.log

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
mkdir -p .codex .claude .cursor .gemini
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
cat > .cursor/hooks.json <<'EOF'
{
  "version": 1,
  "hooks": {
    "preToolCall": [
      { "command": "node custom-cursor-pre-tool-call.js" }
    ],
    "sessionStart": [
      { "command": "node .cursor/hooks/wiki-session-start.js" },
      { "command": "node custom-cursor-session-start.js" }
    ]
  }
}
EOF
cat > .gemini/settings.json <<'EOF'
{
  "theme": "custom",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "WriteFile",
        "hooks": [
          { "type": "command", "command": "node custom-gemini-post-tool-use.js" }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "node \"$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js\"" },
          { "type": "command", "command": "node custom-gemini-hook.js" }
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
node -e 'const c=require("./.cursor/hooks.json"); if (!JSON.stringify(c).includes("node custom-cursor-session-start.js")) process.exit(1)'
node -e 'const c=require("./.gemini/settings.json"); if (!JSON.stringify(c).includes("node custom-gemini-hook.js")) process.exit(1)'
node -e 'const c=require("./.codex/hooks.json"); if (c.mcpServers.existing.command !== "node existing-mcp.js") process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-post-tool-use.js") process.exit(1); const starts = c.hooks.SessionStart.filter(e => e.matcher === "startup|resume|clear"); if (starts.length !== 1) process.exit(1); const commands = starts[0].hooks.map(h => h.command); if (!commands.includes("node custom-codex-hook.js") || !commands.includes("node .codex/hooks/wiki-session-start.js")) process.exit(1)'
node -e 'const c=require("./.claude/settings.json"); if (!c.permissions.allow.includes("Bash(npm test)")) process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-claude-post-tool-use.js") process.exit(1); const startup = c.hooks.SessionStart.filter(e => e.matcher === "startup"); if (startup.length !== 1) process.exit(1); const commands = startup[0].hooks.map(h => h.command); if (!commands.includes("node custom-claude-hook.js") || !commands.includes("node .claude/hooks/wiki-session-start.js")) process.exit(1); const ms = new Set(c.hooks.SessionStart.filter(e => (e.hooks || []).some(h => h.command === "node .claude/hooks/wiki-session-start.js")).map(e => e.matcher)); for (const m of ["startup","resume","clear","compact"]) if (!ms.has(m)) process.exit(1)'
node -e 'const c=require("./.cursor/hooks.json"); if (c.version !== 1) process.exit(1); if (c.hooks.preToolCall?.[0]?.command !== "node custom-cursor-pre-tool-call.js") process.exit(1); const commands = (c.hooks.sessionStart || []).map(h => h.command); if (!commands.includes("node custom-cursor-session-start.js") || !commands.includes("node .cursor/hooks/wiki-session-start.js")) process.exit(1); if (commands.filter(command => command === "node .cursor/hooks/wiki-session-start.js").length !== 1) process.exit(1)'
node -e 'const c=require("./.gemini/settings.json"); const command="node \"$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js\""; if (c.theme !== "custom") process.exit(1); const post = c.hooks.PostToolUse?.[0]?.hooks?.[0]?.command; if (post !== "node custom-gemini-post-tool-use.js") process.exit(1); const startup = c.hooks.SessionStart.filter(e => e.matcher === "startup"); if (startup.length !== 1) process.exit(1); const commands = startup[0].hooks.map(h => h.command); if (!commands.includes("node custom-gemini-hook.js") || !commands.includes(command)) process.exit(1); const ms = new Set(c.hooks.SessionStart.filter(e => (e.hooks || []).some(h => h.command === command)).map(e => e.matcher)); for (const m of ["startup","resume","clear"]) if (!ms.has(m)) process.exit(1)'
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
# This fixture sits below the small-repo scale gate, so every --code-index run
# here carries --acknowledge-small-repo; the gate's own halt path is covered in
# the bootstrap section above.
if node "$CLI" --code-index --acknowledge-small-repo --incremental --code-scope src --code-scope package.json > missing-incremental-code-index.log 2>&1; then
  echo "expected --code-index --incremental without existing index to fail" >&2
  exit 1
fi
grep -q -- "--incremental requires an existing compatible code evidence index" missing-incremental-code-index.log
test ! -f .project-wiki/code-evidence.sqlite
node "$CLI" --code-index --acknowledge-small-repo --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > code-index.log
test -f .project-wiki/code-evidence.sqlite
grep -q "files: 6" code-index.log
if node "$CLI" --code-index --acknowledge-small-repo --incremental --code-scope package.json > mismatched-incremental-code-index.log 2>&1; then
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
node "$CLI" --code-index --acknowledge-small-repo --code-index-out .project-wiki/all.sqlite > all-code-index.log
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
node "$CLI" --code-context-pack healthHandler > code-context-pack-health.txt
grep -q '^Code context pack "healthHandler":' code-context-pack-health.txt
grep -q "Evidence is structural only" code-context-pack-health.txt
grep -q "symbol-match src/app.js" code-context-pack-health.txt
grep -q "route-match GET /health -> healthHandler" code-context-pack-health.txt
grep -q "edge-in route_to_handler" code-context-pack-health.txt
grep -q "owner src" code-context-pack-health.txt
! grep -q "res.json" code-context-pack-health.txt
# MCP server over the built index: one code_ownership call returns the
# answer-shaped response (first-line answer + grouped CODEOWNERS evidence).
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"code_ownership","arguments":{"path":"src/app.js"}}}' \
  | node "$CLI" mcp 2>/dev/null > mcp-ownership.ndjson
node -e 'const fs=require("fs"); const lines=fs.readFileSync("mcp-ownership.ndjson","utf8").trim().split(/\n/).map((l)=>JSON.parse(l)); const r=lines.find((m)=>m.id===2); if (!r||r.result.isError) process.exit(1); const text=r.result.content[0].text; const first=text.split("\n")[0]; if (!/^Owner of src\/app\.js is @platform-team /.test(first)) process.exit(1); if (!/last match/.test(first)) process.exit(1)'
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
if node "$CLI" --code-index --code-index-engine made-up --code-scope src > bad-code-index-engine.log 2>&1; then
  echo "expected invalid --code-index-engine to fail" >&2
  exit 1
fi
grep -q "invalid --code-index-engine" bad-code-index-engine.log
if PROJECT_LIBRARIAN_NATIVE_INDEXER= node "$CLI" --code-index --acknowledge-small-repo --code-index-engine native-rust --code-scope src > native-rust-missing-helper.log 2>&1; then
  echo "expected native-rust engine without helper to fail" >&2
  exit 1
fi
grep -q "requires PROJECT_LIBRARIAN_NATIVE_INDEXER" native-rust-missing-helper.log
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
node "$CLI" --code-index --acknowledge-small-repo --code-parser tree-sitter --code-index-out .project-wiki/tree-sitter.sqlite --code-scope src --code-scope apps/web --code-scope tree-sitter-src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > tree-sitter-code-index.log
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
if node "$CLI" --code-index --acknowledge-small-repo --incremental --code-parser default --code-index-out .project-wiki/tree-sitter.sqlite --code-scope src --code-scope apps/web --code-scope tree-sitter-src --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > mismatched-parser-mode-code-index.log 2>&1; then
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
node "$CLI" --code-index --acknowledge-small-repo --incremental --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > incremental-code-index.log
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
node "$CLI" --code-index --acknowledge-small-repo --code-index-full --code-scope src --code-scope apps/web --code-scope package.json --code-scope .env.example --code-scope secrets.json --code-scope service-token.yaml > full-code-index.log
grep -q "mode: full" full-code-index.log
grep -q "files: 6" full-code-index.log
grep -q "reindexed_files: 6" full-code-index.log
grep -q "unchanged_files: 0" full-code-index.log
printf "not sqlite" > .project-wiki/broken.sqlite
node "$CLI" --code-index --acknowledge-small-repo --code-index-full --code-index-out .project-wiki/broken.sqlite --code-scope src > broken-full-code-index.log
grep -q "mode: full" broken-full-code-index.log
grep -q "files: 3" broken-full-code-index.log
node "$CLI" --code-index --acknowledge-small-repo --code-index-out .project-wiki/custom.sqlite --code-scope src > custom-code-index.log
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
HOME="$TMPDIR/home" node "$CLI" install --scope user --agents codex,claude,cursor,gemini > user-skill-install.log
grep -q "install only installs the reusable skill files" user-skill-install.log
grep -q "install-skill remains supported as an alias" user-skill-install.log
grep -q "ask your agent to use Project Librarian" user-skill-install.log
test -f "$TMPDIR/home/.codex/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.codex/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.claude/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.claude/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.cursor/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.cursor/skills/project-librarian/dist/init-project-wiki.js"
test -f "$TMPDIR/home/.gemini/skills/project-librarian/SKILL.md"
test -x "$TMPDIR/home/.gemini/skills/project-librarian/dist/init-project-wiki.js"

node "$CLI" install --scope project --agents all > project-skill-install.log
grep -q "install only installs the reusable skill files" project-skill-install.log
grep -q "ask your agent to use Project Librarian" project-skill-install.log
test -f .codex/skills/project-librarian/SKILL.md
test -x .codex/skills/project-librarian/dist/init-project-wiki.js
test -f .claude/skills/project-librarian/SKILL.md
test -x .claude/skills/project-librarian/dist/init-project-wiki.js
test -f .cursor/skills/project-librarian/SKILL.md
test -x .cursor/skills/project-librarian/dist/init-project-wiki.js
test -f .gemini/skills/project-librarian/SKILL.md
test -x .gemini/skills/project-librarian/dist/init-project-wiki.js
if node "$CLI" install --scope project --agents both --dry-run > removed-both-skill-install.log 2>&1; then
  echo "expected removed --agents both alias to fail" >&2
  exit 1
fi
grep -q "invalid --agents entry: both" removed-both-skill-install.log
grep -q "expected codex, claude, cursor, gemini, or all" removed-both-skill-install.log
node "$CLI" install-skill --scope project --agents codex --dry-run > legacy-install-skill.log
grep -q "install-skill remains supported as an alias" legacy-install-skill.log

mkdir "$TMPDIR/benchmark"
cd "$TMPDIR/benchmark"
node "$ROOT/benchmarks/codex-llm-metrics.js" --dry-run --out "$PWD/llm-manifest.json" > llm-manifest.stdout.json
test -f llm-manifest.json
node "$ROOT/tests/validators/codex-llm-benchmark-smoke.js" llm-manifest.json
node "$ROOT/tests/validators/codex-llm-benchmark-smoke.js" "$ROOT/benchmarks/llm/samples/codex-measured-report.json"
if node "$ROOT/benchmarks/codex-llm-metrics.js" --scales small --tasks decision_lookup --max-scenarios 2 --runs 1 --warmup-runs 0 > missing-allow-codex-run.log 2>&1; then
  echo "measured Codex benchmark should require --allow-codex-run" >&2
  exit 1
fi
grep -q "requires --allow-codex-run" missing-allow-codex-run.log
