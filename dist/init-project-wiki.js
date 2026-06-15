#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const args_1 = require("./args");
const hooks_1 = require("./hooks");
const install_skill_1 = require("./install-skill");
const modes_1 = require("./modes");
const migration_1 = require("./migration");
const templates_1 = require("./templates");
const workspace_1 = require("./workspace");
function codeIndex() {
    return require("./code-index");
}
function printUsage() {
    console.log(`Usage:
  project-librarian [init] [options]
  project-librarian install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all]
  project-librarian mcp

Options:
  --migrate, --adopt-existing      Preserve an existing wiki as wiki_legacy and create migration inboxes.
  --lint                           Validate the generated project wiki setup without editing files.
  --link-check                     Report broken wiki links, duplicate routes, and orphan pages.
  --quality-check                  Report stale, conflicting, and low-quality wiki document signals.
  --doctor                         Run lint, link-check, and quality-check together.
  --fix                            With --doctor, safely refresh generated index routing.
  --migration-lint                 Validate migration review scaffolding separately from normal lint.
  --migration-quality-check        Report migration policy/structure signals separately from normal quality-check.
  --migration-doctor               Run migration-lint and migration-quality-check together.
  --issue-create                   Create a GitHub issue with gh issue create after explicit user approval.
  --issue-draft                    Print a problem/side-effect GitHub issue body draft.
  --issue-body-file <path>         With --issue-create, use an existing Markdown body file.
  --issue-title <title>            Override the generated issue draft title.
  --query <terms>                  Search wiki paths, metadata, titles, and bodies (answer-shaped, capped output).
  --wiki-impact <page-or-term>     Show wiki backlinks, decision_ref citations, and router depth for matching pages.
  --refresh-index                  Update the managed auto-discovered wiki index block.
  --capture-inbox                  Append a candidate note with --title, --content, and optional --category.
  --glossary-init                  Create and route the optional glossary page.
  --prune-check                    Report active pages with stale or unresolved signals.
  --review-migration               Sync migration inbox statuses into migration review files.
  --no-git-config                  Install hook files without changing git core.hooksPath.
  --code-index                     Build the disposable .project-wiki code evidence index.
  --acknowledge-small-repo         With --code-index, proceed below the small-repo scale gate after its cost warning.
  --incremental                    With --code-index, require an existing compatible index and update only changes.
  --code-index-full                With --code-index, force a full rebuild even when incremental update is possible.
  --code-parser <mode>             With --code-index, use parser mode default or tree-sitter.
  --code-query <sql>               Run conservative read-only SQL over the code evidence index.
  --code-status, --code-files      Inspect the code evidence index.
  --code-report                    Print architecture and ownership summaries from the code evidence index.
  --code-report-section <section>  With --code-report, print one section: coverage, ownership, languages, parsers, workspaces, workspace-graph, routes, hotspots, configs, or edges.
  --code-impact <term>             Show file, symbol, route, import, and edge impact evidence for a term.
  --code-search-symbol <term>      Search indexed symbols.

Commands:
  mcp                              Run the stdio MCP server exposing answer-shaped code-evidence tools (code_impact, code_ownership, code_workspace_graph, code_search, code_status) over the existing .project-wiki index.

  --help                           Show this help.`);
}
// console.log queues asynchronously on pipes; an immediate process.exit() discards
// anything past the first ~64KB pipe chunk (observed truncating a large
// --code-report on an 11k-file repo). Exiting from a zero-length write callback
// guarantees everything queued before it has drained.
function exitAfterStdoutDrain(code) {
    process.stdout.write("", () => process.exit(code));
}
if (args_1.helpMode) {
    printUsage();
    process.exit(0);
}
if (args_1.unknownCommand) {
    console.error(`unknown command: ${args_1.unknownCommand}`);
    printUsage();
    process.exit(1);
}
if (args_1.unknownOptions.length > 0) {
    console.error(`unknown option${args_1.unknownOptions.length === 1 ? "" : "s"}: ${args_1.unknownOptions.join(", ")}`);
    printUsage();
    process.exit(1);
}
if (args_1.unexpectedValueOptions.length > 0) {
    console.error(`option${args_1.unexpectedValueOptions.length === 1 ? "" : "s"} do${args_1.unexpectedValueOptions.length === 1 ? "es" : ""} not take a value: ${args_1.unexpectedValueOptions.join(", ")}`);
    printUsage();
    process.exit(1);
}
if (args_1.missingValueOptions.length > 0) {
    console.error(`missing value for option${args_1.missingValueOptions.length === 1 ? "" : "s"}: ${args_1.missingValueOptions.join(", ")}`);
    printUsage();
    process.exit(1);
}
if (args_1.fixMode && !args_1.doctorMode) {
    console.error("--fix is only supported with --doctor.");
    process.exit(1);
}
if (args_1.issueCreateMode && args_1.issueDraftMode) {
    console.error("Use one issue mode at a time: --issue-draft or --issue-create.");
    process.exit(1);
}
if (args_1.codeReportSection && !args_1.codeReportMode) {
    console.error("--code-report-section is only supported with --code-report.");
    process.exit(1);
}
if (args_1.codeIndexIncrementalMode && !args_1.codeIndexMode) {
    console.error("--incremental is only supported with --code-index.");
    process.exit(1);
}
if (args_1.acknowledgeSmallRepoMode && !args_1.codeIndexMode) {
    console.error("--acknowledge-small-repo is only supported with --code-index.");
    process.exit(1);
}
if (args_1.codeIndexFullMode && !args_1.codeIndexMode) {
    console.error("--code-index-full is only supported with --code-index.");
    process.exit(1);
}
if (args_1.codeParserMode && !args_1.codeIndexMode) {
    console.error("--code-parser is only supported with --code-index.");
    process.exit(1);
}
if (args_1.codeIndexIncrementalMode && args_1.codeIndexFullMode) {
    console.error("Use one code index update mode at a time: --incremental or --code-index-full.");
    process.exit(1);
}
if (args_1.command === "install-skill") {
    (0, install_skill_1.runInstallSkillMode)();
    process.exit(0);
}
if (args_1.command === "mcp") {
    // Hand-rolled stdio MCP server over the existing code-evidence index. Lazy
    // require keeps the server (and its node:sqlite dependency) out of the normal
    // bootstrap path. The server roots at process.cwd() and runs until stdin ends,
    // exiting from inside runMcpServerMode; the init flow below must not run.
    require("./mcp-server").runMcpServerMode();
}
else {
    runInitCommand();
}
function runInitCommand() {
    const activeCodeModes = [args_1.codeQueryMode, args_1.codeReportMode, args_1.codeStatusMode, args_1.codeFilesMode, args_1.codeImpactMode, args_1.codeSearchSymbolMode, args_1.codeIndexMode].filter(Boolean).length;
    if (activeCodeModes > 1) {
        console.error("Use one code evidence mode at a time: --code-index, --code-query, --code-report, --code-status, --code-files, --code-impact, or --code-search-symbol.");
        process.exit(1);
    }
    if (args_1.codeQueryMode) {
        codeIndex().runCodeQueryMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeReportMode) {
        codeIndex().runCodeReportMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeStatusMode) {
        codeIndex().runCodeStatusMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeFilesMode) {
        codeIndex().runCodeFilesMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeImpactMode) {
        codeIndex().runCodeImpactMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeSearchSymbolMode) {
        codeIndex().runCodeSearchSymbolMode();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.codeIndexMode) {
        codeIndex().runCodeIndexMode();
        process.exit(0);
    }
    if (args_1.wikiImpactMode) {
        (0, modes_1.runWikiImpactMode)();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.queryTerm) {
        (0, modes_1.runQueryMode)();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.issueCreateMode) {
        (0, modes_1.runIssueCreateMode)();
        process.exit(0);
    }
    if (args_1.issueDraftMode) {
        (0, modes_1.runIssueDraftMode)();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.pruneCheckMode) {
        (0, modes_1.runPruneCheckMode)();
        process.exit(0);
    }
    if (args_1.reviewMigrationMode) {
        (0, migration_1.runReviewMigrationMode)();
        process.exit(0);
    }
    if (args_1.migrationDoctorMode) {
        (0, modes_1.runMigrationDoctorMode)();
        process.exit(0);
    }
    if (args_1.migrationQualityCheckMode) {
        (0, modes_1.runMigrationQualityCheckMode)();
        process.exit(0);
    }
    if (args_1.migrationLintMode) {
        (0, modes_1.runMigrationLintMode)();
        process.exit(0);
    }
    if (args_1.doctorMode) {
        (0, modes_1.runDoctorMode)(args_1.fixMode);
        process.exit(0);
    }
    if (args_1.linkCheckMode) {
        (0, modes_1.runLinkCheckMode)();
        process.exit(0);
    }
    if (args_1.qualityCheckMode) {
        (0, modes_1.runQualityCheckMode)();
        process.exit(0);
    }
    if (args_1.lintMode) {
        (0, modes_1.runLintMode)();
        process.exit(0);
    }
    const migrationState = args_1.migrateMode ? (0, migration_1.prepareMigrationMode)() : null;
    const results = [];
    if (migrationState)
        results.push(["migration prepare", migrationState.note]);
    (0, workspace_1.mkdirp)("wiki/canonical");
    (0, workspace_1.mkdirp)("wiki/decisions");
    (0, workspace_1.mkdirp)("wiki/inbox");
    (0, workspace_1.mkdirp)("wiki/meta");
    (0, workspace_1.mkdirp)("wiki/sources");
    (0, workspace_1.mkdirp)(".codex/hooks");
    (0, workspace_1.mkdirp)(".claude/hooks");
    (0, workspace_1.mkdirp)(".cursor/hooks");
    (0, workspace_1.mkdirp)(".cursor/rules");
    (0, workspace_1.mkdirp)(".gemini/hooks");
    (0, workspace_1.mkdirp)(".githooks");
    // B1 fallback: sync the CURRENT startup.md TL;DR into the managed AGENTS.md block
    // so non-interactive `codex exec` (which does not run SessionStart hooks) still
    // gets compact startup context. Routers are starter files written later in this
    // flow, so on a fresh bootstrap startup.md does not exist yet; fall back to the
    // template TL;DR that bootstrap is about to write. A missing "## TL;DR" section in
    // an existing startup.md fails loudly inside extractStartupTldr (no fallback).
    const startupForSync = (0, workspace_1.exists)("wiki/startup.md") ? (0, workspace_1.read)("wiki/startup.md") : templates_1.startup;
    const startupTldrForAgents = (0, templates_1.extractStartupTldr)(startupForSync);
    results.push(["AGENTS.md", (0, workspace_1.upsertMarkedSection)("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", (0, templates_1.agentsSection)(startupTldrForAgents))]);
    results.push(["CLAUDE.md", (0, workspace_1.upsertMarkedSection)("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", templates_1.claudeSection)]);
    results.push(["GEMINI.md", (0, workspace_1.upsertMarkedSection)("GEMINI.md", "<!-- PROJECT-WIKI-GEMINI:START -->", "<!-- PROJECT-WIKI-GEMINI:END -->", templates_1.geminiSection)]);
    results.push([".cursor/rules/project-librarian.mdc", (0, workspace_1.writeManaged)(".cursor/rules/project-librarian.mdc", templates_1.cursorRule)]);
    results.push(["wiki/AGENTS.md", (0, workspace_1.upsertMarkedSection)("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", templates_1.wikiAgentsSection)]);
    results.push([".githooks/prepare-commit-msg", (0, workspace_1.writeManaged)(".githooks/prepare-commit-msg", hooks_1.gitPrepareCommitMsgHook)]);
    (0, workspace_1.makeExecutable)(".githooks/prepare-commit-msg");
    results.push([".githooks/wiki-commit-trailers.js", (0, workspace_1.writeManaged)(".githooks/wiki-commit-trailers.js", hooks_1.gitWikiCommitTrailersScript)]);
    (0, workspace_1.makeExecutable)(".githooks/wiki-commit-trailers.js");
    results.push(["git core.hooksPath", (0, hooks_1.upsertGitHooksPath)()]);
    results.push([".codex/hooks.json", (0, hooks_1.upsertHookConfig)()]);
    results.push([".codex/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".codex/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    results.push([".claude/settings.json", (0, hooks_1.upsertClaudeHookConfig)()]);
    results.push([".claude/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".claude/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    results.push([".cursor/hooks.json", (0, hooks_1.upsertCursorHookConfig)()]);
    results.push([".cursor/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".cursor/hooks/wiki-session-start.js", hooks_1.cursorHookScript)]);
    results.push([".gemini/settings.json", (0, hooks_1.upsertGeminiHookConfig)()]);
    results.push([".gemini/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".gemini/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    // Bootstrap-managed MCP registration (preservation-first, idempotent). Claude
    // Code reads `.mcp.json`, Cursor reads `.cursor/mcp.json`, and Gemini reads
    // `mcpServers` inside `.gemini/settings.json`. Codex only supports user-level MCP
    // config (`codex mcp add` -> ~/.codex/config.toml), so it is intentionally not
    // registered at project level; the README documents the manual user-level step.
    // Registration is scale-gated (2026-06-12 decision): below the measured
    // file-count threshold with no existing .project-wiki index, the rows report the
    // skip reason instead of writing config; an existing index registers regardless.
    const mcpGate = (0, hooks_1.mcpRegistrationGate)();
    if (mcpGate.register) {
        results.push([".mcp.json", (0, hooks_1.upsertClaudeMcpConfig)()]);
        results.push([".cursor/mcp.json", (0, hooks_1.upsertCursorMcpConfig)()]);
        results.push([".gemini/settings.json mcpServers", (0, hooks_1.upsertGeminiMcpConfig)()]);
    }
    else {
        results.push([".mcp.json", mcpGate.reason]);
        results.push([".cursor/mcp.json", mcpGate.reason]);
        results.push([".gemini/settings.json mcpServers", mcpGate.reason]);
    }
    // Routers accumulate user-maintained project state after bootstrap, so they are
    // starter files: templates are written only when the file is absent, never rebuilt.
    results.push(["wiki/startup.md", (0, workspace_1.writeStarter)("wiki/startup.md", templates_1.startup)]);
    results.push(["wiki/index.md", (0, workspace_1.writeStarter)("wiki/index.md", templates_1.index)]);
    results.push(["wiki/meta/operating-model.md", (0, workspace_1.writeManaged)("wiki/meta/operating-model.md", templates_1.wikiOperatingModel)]);
    results.push(["wiki/meta/decision-policy.md", (0, workspace_1.writeManaged)("wiki/meta/decision-policy.md", templates_1.decisionPolicy)]);
    results.push(["wiki/canonical/wiki-operating-model.md", (0, workspace_1.deleteIfGenerated)("wiki/canonical/wiki-operating-model.md", ["# Wiki Operating Model"])]);
    results.push(["wiki/canonical/decision-policy.md", (0, workspace_1.deleteIfGenerated)("wiki/canonical/decision-policy.md", ["# Decision Policy"])]);
    results.push(["wiki/decisions/wiki-v1-decisions.md", (0, workspace_1.deleteIfGenerated)("wiki/decisions/wiki-v1-decisions.md", ["# Wiki v1 Decisions", "# Wiki Operations v1 Decisions"])]);
    for (const [relativePath, content] of Object.entries(templates_1.starterFiles)) {
        results.push([relativePath, (0, workspace_1.writeStarter)(relativePath, content)]);
    }
    results.push(["wiki/meta/wiki-ops-v1-decisions.md", (0, workspace_1.writeManaged)("wiki/meta/wiki-ops-v1-decisions.md", templates_1.starterFiles["wiki/meta/wiki-ops-v1-decisions.md"])]);
    if (args_1.glossaryMode) {
        results.push(["wiki/canonical/glossary.md", (0, workspace_1.writeStarter)("wiki/canonical/glossary.md", templates_1.glossary)]);
        results.push(["wiki/index.md glossary router", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", templates_1.glossaryIndexBlock)]);
    }
    if (args_1.captureInboxMode) {
        results.push(["wiki/inbox/project-candidates.md", (0, modes_1.appendCaptureInbox)()]);
        results.push(["wiki/index.md inbox router", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", templates_1.inboxIndexBlock)]);
    }
    if (args_1.refreshIndexMode) {
        results.push(["wiki/index.md auto-discovered pages", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", (0, modes_1.buildRefreshIndexBlock)())]);
    }
    if (args_1.migrateMode && migrationState) {
        const migration = (0, migration_1.runMigrationMode)(migrationState);
        for (const result of migration.results)
            results.push(result);
        results.push(["migration summary", `${migration.total} files from ${migration.legacyPath || "no legacy"}`]);
    }
    const modes = [];
    if (args_1.migrateMode)
        modes.push("migration");
    if (args_1.glossaryMode)
        modes.push("glossary");
    if (args_1.captureInboxMode)
        modes.push("capture-inbox");
    if (args_1.refreshIndexMode)
        modes.push("refresh-index");
    if (args_1.noGitConfigMode)
        modes.push("no-git-config");
    console.log(modes.length > 0 ? `Project Librarian + ${modes.join(" + ")} complete.` : "Project Librarian complete.");
    for (const [relativePath, status] of results) {
        console.log(`${String(status).padEnd(7)} ${relativePath}`);
    }
}
