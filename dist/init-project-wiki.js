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
const wiki_files_1 = require("./wiki-files");
function codeIndex() {
    return require("./code-index");
}
function printUsage() {
    console.log(`Usage:
  project-wiki-bootstrap [init] [options]
  project-wiki-bootstrap install-skill [--scope user|project] [--agents codex|claude|both]

Options:
  --migrate, --adopt-existing      Preserve an existing wiki as wiki_legacy and create migration inboxes.
  --lint                           Validate the generated project wiki setup without editing files.
  --link-check                     Report broken wiki links, duplicate routes, and orphan pages.
  --quality-check                  Report stale, conflicting, and low-quality wiki document signals.
  --doctor                         Run lint, link-check, and quality-check together.
  --fix                            With --doctor, safely refresh generated index routing.
  --issue-draft                    Print a problem/side-effect GitHub issue body draft.
  --issue-title <title>            Override the generated issue draft title.
  --query <terms>                  Search wiki paths, metadata, titles, and bodies.
  --refresh-index                  Update the managed auto-discovered wiki index block.
  --capture-inbox                  Append a candidate note with --title, --content, and optional --category.
  --glossary-init                  Create and route the optional glossary page.
  --prune-check                    Report active pages with stale or unresolved signals.
  --review-migration               Sync migration inbox statuses into migration review files.
  --no-git-config                  Install hook files without changing git core.hooksPath.
  --code-index                     Build the disposable .project-wiki code evidence index.
  --code-query <sql>               Run conservative read-only SQL over the code evidence index.
  --code-status, --code-files      Inspect the code evidence index.
  --code-search-symbol <term>      Search indexed symbols.
  --help                           Show this help.`);
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
if (args_1.missingValueOptions.length > 0) {
    console.error(`missing value for option${args_1.missingValueOptions.length === 1 ? "" : "s"}: ${args_1.missingValueOptions.join(", ")}`);
    printUsage();
    process.exit(1);
}
if (args_1.fixMode && !args_1.doctorMode) {
    console.error("--fix is only supported with --doctor.");
    process.exit(1);
}
if (args_1.command === "install-skill") {
    (0, install_skill_1.runInstallSkillMode)();
    process.exit(0);
}
const activeCodeModes = [args_1.codeQueryMode, args_1.codeStatusMode, args_1.codeFilesMode, args_1.codeSearchSymbolMode, args_1.codeIndexMode].filter(Boolean).length;
if (activeCodeModes > 1) {
    console.error("Use one code evidence mode at a time: --code-index, --code-query, --code-status, --code-files, or --code-search-symbol.");
    process.exit(1);
}
if (args_1.codeQueryMode) {
    codeIndex().runCodeQueryMode();
    process.exit(0);
}
if (args_1.codeStatusMode) {
    codeIndex().runCodeStatusMode();
    process.exit(0);
}
if (args_1.codeFilesMode) {
    codeIndex().runCodeFilesMode();
    process.exit(0);
}
if (args_1.codeSearchSymbolMode) {
    codeIndex().runCodeSearchSymbolMode();
    process.exit(0);
}
if (args_1.codeIndexMode) {
    codeIndex().runCodeIndexMode();
    process.exit(0);
}
if (args_1.queryTerm) {
    (0, modes_1.runQueryMode)();
    process.exit(0);
}
if (args_1.issueDraftMode) {
    (0, modes_1.runIssueDraftMode)();
    process.exit(0);
}
if (args_1.pruneCheckMode) {
    (0, modes_1.runPruneCheckMode)();
    process.exit(0);
}
if (args_1.reviewMigrationMode) {
    (0, migration_1.runReviewMigrationMode)();
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
(0, workspace_1.mkdirp)(".githooks");
results.push(["AGENTS.md", (0, workspace_1.upsertMarkedSection)("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", templates_1.agentsSection)]);
results.push(["CLAUDE.md", (0, workspace_1.upsertMarkedSection)("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", templates_1.claudeSection)]);
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
results.push(["wiki/startup.md", (0, workspace_1.writeManaged)("wiki/startup.md", (0, wiki_files_1.withPreservedMarkedSections)("wiki/startup.md", templates_1.startup, [["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"]]))]);
results.push(["wiki/index.md", (0, workspace_1.writeManaged)("wiki/index.md", (0, wiki_files_1.withPreservedMarkedSections)("wiki/index.md", templates_1.index, [
        ["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"],
        ["<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->"],
        ["<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->"],
        ["<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->"],
    ]))]);
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
console.log(modes.length > 0 ? `Project wiki bootstrap + ${modes.join(" + ")} complete.` : "Project wiki bootstrap complete.");
for (const [relativePath, status] of results) {
    console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
