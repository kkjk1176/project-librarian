#!/usr/bin/env node

import { captureInboxMode, codeFilesMode, codeImpactMode, codeIndexFullMode, codeIndexIncrementalMode, codeIndexMode, codeParserMode, codeQueryMode, codeReportMode, codeReportSection, codeSearchSymbolMode, codeStatusMode, command, doctorMode, fixMode, glossaryMode, helpMode, issueCreateMode, issueDraftMode, linkCheckMode, lintMode, migrationDoctorMode, migrationLintMode, migrationQualityCheckMode, migrateMode, missingValueOptions, noGitConfigMode, pruneCheckMode, qualityCheckMode, queryTerm, refreshIndexMode, reviewMigrationMode, unexpectedValueOptions, unknownCommand, unknownOptions } from "./args";
import { cursorHookScript, hookScript, gitPrepareCommitMsgHook, gitWikiCommitTrailersScript, upsertClaudeHookConfig, upsertCursorHookConfig, upsertGeminiHookConfig, upsertGitHooksPath, upsertHookConfig } from "./hooks";
import { runInstallSkillMode } from "./install-skill";
import { appendCaptureInbox, buildRefreshIndexBlock, runDoctorMode, runIssueCreateMode, runIssueDraftMode, runLinkCheckMode, runLintMode, runMigrationDoctorMode, runMigrationLintMode, runMigrationQualityCheckMode, runPruneCheckMode, runQualityCheckMode, runQueryMode } from "./modes";
import { prepareMigrationMode, runMigrationMode, runReviewMigrationMode } from "./migration";
import { agentsSection, claudeSection, cursorRule, decisionPolicy, geminiSection, glossary, glossaryIndexBlock, inboxIndexBlock, index, starterFiles, startup, wikiAgentsSection, wikiOperatingModel } from "./templates";
import type { MigrationState, ResultRow } from "./types";
import { deleteIfGenerated, makeExecutable, mkdirp, upsertMarkedSection, writeManaged, writeStarter } from "./workspace";
import { withPreservedMarkedSections } from "./wiki-files";

type CodeIndexModule = typeof import("./code-index");

function codeIndex(): CodeIndexModule {
  return require("./code-index") as CodeIndexModule;
}

function printUsage(): void {
  console.log(`Usage:
  project-librarian [init] [options]
  project-librarian install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]

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
  --query <terms>                  Search wiki paths, metadata, titles, and bodies.
  --refresh-index                  Update the managed auto-discovered wiki index block.
  --capture-inbox                  Append a candidate note with --title, --content, and optional --category.
  --glossary-init                  Create and route the optional glossary page.
  --prune-check                    Report active pages with stale or unresolved signals.
  --review-migration               Sync migration inbox statuses into migration review files.
  --no-git-config                  Install hook files without changing git core.hooksPath.
  --code-index                     Build the disposable .project-wiki code evidence index.
  --incremental                    With --code-index, require an existing compatible index and update only changes.
  --code-index-full                With --code-index, force a full rebuild even when incremental update is possible.
  --code-parser <mode>             With --code-index, use parser mode default or tree-sitter.
  --code-query <sql>               Run conservative read-only SQL over the code evidence index.
  --code-status, --code-files      Inspect the code evidence index.
  --code-report                    Print architecture and ownership summaries from the code evidence index.
  --code-report-section <section>  With --code-report, print one section: coverage, ownership, languages, parsers, workspaces, workspace-graph, routes, hotspots, configs, or edges.
  --code-impact <term>             Show file, symbol, route, import, and edge impact evidence for a term.
  --code-search-symbol <term>      Search indexed symbols.
  --help                           Show this help.`);
}

if (helpMode) {
  printUsage();
  process.exit(0);
}

if (unknownCommand) {
  console.error(`unknown command: ${unknownCommand}`);
  printUsage();
  process.exit(1);
}

if (unknownOptions.length > 0) {
  console.error(`unknown option${unknownOptions.length === 1 ? "" : "s"}: ${unknownOptions.join(", ")}`);
  printUsage();
  process.exit(1);
}

if (unexpectedValueOptions.length > 0) {
  console.error(`option${unexpectedValueOptions.length === 1 ? "" : "s"} do${unexpectedValueOptions.length === 1 ? "es" : ""} not take a value: ${unexpectedValueOptions.join(", ")}`);
  printUsage();
  process.exit(1);
}

if (missingValueOptions.length > 0) {
  console.error(`missing value for option${missingValueOptions.length === 1 ? "" : "s"}: ${missingValueOptions.join(", ")}`);
  printUsage();
  process.exit(1);
}

if (fixMode && !doctorMode) {
  console.error("--fix is only supported with --doctor.");
  process.exit(1);
}

if (issueCreateMode && issueDraftMode) {
  console.error("Use one issue mode at a time: --issue-draft or --issue-create.");
  process.exit(1);
}

if (codeReportSection && !codeReportMode) {
  console.error("--code-report-section is only supported with --code-report.");
  process.exit(1);
}

if (codeIndexIncrementalMode && !codeIndexMode) {
  console.error("--incremental is only supported with --code-index.");
  process.exit(1);
}

if (codeIndexFullMode && !codeIndexMode) {
  console.error("--code-index-full is only supported with --code-index.");
  process.exit(1);
}

if (codeParserMode && !codeIndexMode) {
  console.error("--code-parser is only supported with --code-index.");
  process.exit(1);
}

if (codeIndexIncrementalMode && codeIndexFullMode) {
  console.error("Use one code index update mode at a time: --incremental or --code-index-full.");
  process.exit(1);
}

if (command === "install-skill") {
  runInstallSkillMode();
  process.exit(0);
}

const activeCodeModes = [codeQueryMode, codeReportMode, codeStatusMode, codeFilesMode, codeImpactMode, codeSearchSymbolMode, codeIndexMode].filter(Boolean).length;
if (activeCodeModes > 1) {
  console.error("Use one code evidence mode at a time: --code-index, --code-query, --code-report, --code-status, --code-files, --code-impact, or --code-search-symbol.");
  process.exit(1);
}

if (codeQueryMode) {
  codeIndex().runCodeQueryMode();
  process.exit(0);
}
if (codeReportMode) {
  codeIndex().runCodeReportMode();
  process.exit(0);
}
if (codeStatusMode) {
  codeIndex().runCodeStatusMode();
  process.exit(0);
}
if (codeFilesMode) {
  codeIndex().runCodeFilesMode();
  process.exit(0);
}
if (codeImpactMode) {
  codeIndex().runCodeImpactMode();
  process.exit(0);
}
if (codeSearchSymbolMode) {
  codeIndex().runCodeSearchSymbolMode();
  process.exit(0);
}
if (codeIndexMode) {
  codeIndex().runCodeIndexMode();
  process.exit(0);
}
if (queryTerm) {
  runQueryMode();
  process.exit(0);
}
if (issueCreateMode) {
  runIssueCreateMode();
  process.exit(0);
}
if (issueDraftMode) {
  runIssueDraftMode();
  process.exit(0);
}
if (pruneCheckMode) {
  runPruneCheckMode();
  process.exit(0);
}
if (reviewMigrationMode) {
  runReviewMigrationMode();
  process.exit(0);
}
if (migrationDoctorMode) {
  runMigrationDoctorMode();
  process.exit(0);
}
if (migrationQualityCheckMode) {
  runMigrationQualityCheckMode();
  process.exit(0);
}
if (migrationLintMode) {
  runMigrationLintMode();
  process.exit(0);
}
if (doctorMode) {
  runDoctorMode(fixMode);
  process.exit(0);
}
if (linkCheckMode) {
  runLinkCheckMode();
  process.exit(0);
}
if (qualityCheckMode) {
  runQualityCheckMode();
  process.exit(0);
}
if (lintMode) {
  runLintMode();
  process.exit(0);
}

const migrationState: MigrationState | null = migrateMode ? prepareMigrationMode() : null;
const results: ResultRow[] = [];
if (migrationState) results.push(["migration prepare", migrationState.note]);

mkdirp("wiki/canonical");
mkdirp("wiki/decisions");
mkdirp("wiki/inbox");
mkdirp("wiki/meta");
mkdirp("wiki/sources");
mkdirp(".codex/hooks");
mkdirp(".claude/hooks");
mkdirp(".cursor/hooks");
mkdirp(".cursor/rules");
mkdirp(".gemini/hooks");
mkdirp(".githooks");

results.push(["AGENTS.md", upsertMarkedSection("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", agentsSection)]);
results.push(["CLAUDE.md", upsertMarkedSection("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", claudeSection)]);
results.push(["GEMINI.md", upsertMarkedSection("GEMINI.md", "<!-- PROJECT-WIKI-GEMINI:START -->", "<!-- PROJECT-WIKI-GEMINI:END -->", geminiSection)]);
results.push([".cursor/rules/project-librarian.mdc", writeManaged(".cursor/rules/project-librarian.mdc", cursorRule)]);
results.push(["wiki/AGENTS.md", upsertMarkedSection("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", wikiAgentsSection)]);
results.push([".githooks/prepare-commit-msg", writeManaged(".githooks/prepare-commit-msg", gitPrepareCommitMsgHook)]);
makeExecutable(".githooks/prepare-commit-msg");
results.push([".githooks/wiki-commit-trailers.js", writeManaged(".githooks/wiki-commit-trailers.js", gitWikiCommitTrailersScript)]);
makeExecutable(".githooks/wiki-commit-trailers.js");
results.push(["git core.hooksPath", upsertGitHooksPath()]);
results.push([".codex/hooks.json", upsertHookConfig()]);
results.push([".codex/hooks/wiki-session-start.js", writeManaged(".codex/hooks/wiki-session-start.js", hookScript)]);
results.push([".claude/settings.json", upsertClaudeHookConfig()]);
results.push([".claude/hooks/wiki-session-start.js", writeManaged(".claude/hooks/wiki-session-start.js", hookScript)]);
results.push([".cursor/hooks.json", upsertCursorHookConfig()]);
results.push([".cursor/hooks/wiki-session-start.js", writeManaged(".cursor/hooks/wiki-session-start.js", cursorHookScript)]);
results.push([".gemini/settings.json", upsertGeminiHookConfig()]);
results.push([".gemini/hooks/wiki-session-start.js", writeManaged(".gemini/hooks/wiki-session-start.js", hookScript)]);
results.push(["wiki/startup.md", writeManaged("wiki/startup.md", withPreservedMarkedSections("wiki/startup.md", startup, [["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"]]))]);
results.push(["wiki/index.md", writeManaged("wiki/index.md", withPreservedMarkedSections("wiki/index.md", index, [
  ["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"],
  ["<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->"],
  ["<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->"],
  ["<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->"],
]))]);
results.push(["wiki/meta/operating-model.md", writeManaged("wiki/meta/operating-model.md", wikiOperatingModel)]);
results.push(["wiki/meta/decision-policy.md", writeManaged("wiki/meta/decision-policy.md", decisionPolicy)]);
results.push(["wiki/canonical/wiki-operating-model.md", deleteIfGenerated("wiki/canonical/wiki-operating-model.md", ["# Wiki Operating Model"])]);
results.push(["wiki/canonical/decision-policy.md", deleteIfGenerated("wiki/canonical/decision-policy.md", ["# Decision Policy"])]);
results.push(["wiki/decisions/wiki-v1-decisions.md", deleteIfGenerated("wiki/decisions/wiki-v1-decisions.md", ["# Wiki v1 Decisions", "# Wiki Operations v1 Decisions"])]);
for (const [relativePath, content] of Object.entries(starterFiles)) {
  results.push([relativePath, writeStarter(relativePath, content)]);
}
results.push(["wiki/meta/wiki-ops-v1-decisions.md", writeManaged("wiki/meta/wiki-ops-v1-decisions.md", starterFiles["wiki/meta/wiki-ops-v1-decisions.md"])]);
if (glossaryMode) {
  results.push(["wiki/canonical/glossary.md", writeStarter("wiki/canonical/glossary.md", glossary)]);
  results.push(["wiki/index.md glossary router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", glossaryIndexBlock)]);
}
if (captureInboxMode) {
  results.push(["wiki/inbox/project-candidates.md", appendCaptureInbox()]);
  results.push(["wiki/index.md inbox router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", inboxIndexBlock)]);
}
if (refreshIndexMode) {
  results.push(["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())]);
}
if (migrateMode && migrationState) {
  const migration = runMigrationMode(migrationState);
  for (const result of migration.results) results.push(result);
  results.push(["migration summary", `${migration.total} files from ${migration.legacyPath || "no legacy"}`]);
}
const modes: string[] = [];
if (migrateMode) modes.push("migration");
if (glossaryMode) modes.push("glossary");
if (captureInboxMode) modes.push("capture-inbox");
if (refreshIndexMode) modes.push("refresh-index");
if (noGitConfigMode) modes.push("no-git-config");
console.log(modes.length > 0 ? `Project Librarian + ${modes.join(" + ")} complete.` : "Project Librarian complete.");
for (const [relativePath, status] of results) {
  console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
