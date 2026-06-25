#!/usr/bin/env node

import { acknowledgeSmallRepoMode, agentTargets, captureInboxMode, codeContextPackMode, codeFilesMode, codeImpactMode, codeIndexEngineMode, codeIndexFullMode, codeIndexHealthMode, codeIndexIncrementalMode, codeIndexMode, codeParserMode, codeQueryMode, codeReportMode, codeReportSection, codeSearchSymbolMode, codeStatusMode, command, doctorMode, fixMode, glossaryMode, handoffClearMode, handoffInputMode, handoffInjectionDisableMode, handoffInjectionEnableMode, handoffInjectionStatusMode, handoffPromoteInboxMode, handoffSaveMode, handoffShowMode, handoffStatusMode, helpMode, invalidAgentTargets, issueCreateMode, issueDraftMode, linkCheckMode, lintMode, migrationDoctorMode, migrationLintMode, migrationQualityCheckMode, migrateMode, missingValueOptions, noGitConfigMode, pruneCheckMode, pruneCheckStrictMode, qualityCheckMode, queryTerm, refreshIndexMode, reviewMigrationMode, unexpectedValueOptions, unknownCommand, unknownOptions, wikiImpactMode, wikiVisualizeMode, wikiVisualizeOutput } from "./args";
import { allAgentSurfaces, includesAgentSurface, resolveBootstrapAgentSurfaces } from "./agent-surfaces";
import { cursorHookScript, hookScript, gitPrepareCommitMsgHook, gitWikiCommitTrailersScript, mcpRegistrationGate, upsertClaudeHookConfig, upsertClaudeMcpConfig, upsertCursorHookConfig, upsertCursorMcpConfig, upsertGeminiHookConfig, upsertGeminiMcpConfig, upsertGitHooksPath, upsertHookConfig } from "./hooks";
import { installedProjectSkillSurfaces, runInstallSkillMode, syncProjectSkillInstall } from "./install-skill";
import { appendCaptureInbox, buildRefreshIndexBlock, runDoctorMode, runIssueCreateMode, runIssueDraftMode, runLinkCheckMode, runLintMode, runMigrationDoctorMode, runMigrationLintMode, runMigrationQualityCheckMode, runPruneCheckMode, runQualityCheckMode, runQueryMode, runWikiImpactMode } from "./modes";
import { prepareMigrationMode, runMigrationMode, runReviewMigrationMode } from "./migration";
import { runHandoffClearMode, runHandoffInjectionDisableMode, runHandoffInjectionEnableMode, runHandoffInjectionStatusMode, runHandoffPromoteInboxMode, runHandoffSaveMode, runHandoffShowMode, runHandoffStatusMode } from "./session-handoff";
import { agentsSection, claudeSection, cursorRule, decisionPolicy, defaultStarterFilePaths, extractStartupTldr, geminiSection, glossary, glossaryIndexBlock, inboxIndexBlock, index, starterFiles, startup, wikiAgentsSection, wikiOperatingModel } from "./templates";
import type { MigrationState, ResultRow } from "./types";
import { writeWikiVisualizer } from "./wiki-visualizer";
import { deleteIfGenerated, exists, makeExecutable, mkdirp, read, upsertMarkedSection, writeManaged, writeStarter } from "./workspace";

type CodeIndexModule = typeof import("./code-index");

interface CodeEvidenceCliMode {
  active: boolean;
  drainStdout: boolean;
  run: (codeIndexModule: CodeIndexModule) => void;
}

function codeIndex(): CodeIndexModule {
  return require("./code-index") as CodeIndexModule;
}

function printUsage(): void {
  console.log(`Usage:
  project-librarian [init|update] [options]
  project-librarian install [--scope user|project] [--agents codex|claude|cursor|gemini|all] [--dry-run]
  project-librarian mcp

Options:
  --migrate, --adopt-existing      Preserve an existing wiki as wiki_legacy and create unit-level migration map, split plan, coverage ledger, review files, and inboxes.
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
  --dry-run                        With install, preview copied skill files without writing them.
  --query <terms>                  Search wiki paths, metadata, titles, and bodies (answer-shaped, capped output).
  --wiki-impact <page-or-term>     Show wiki backlinks, decision_ref citations, and router depth for matching pages.
  --wiki-visualize                 Write a static wiki graph visualizer to .project-wiki/wiki-graph.html.
  --wiki-visualize-out <path>      With --wiki-visualize, write under a custom .project-wiki/ path.
  --refresh-index                  Update the managed auto-discovered wiki index block.
  --capture-inbox                  Append a candidate note with --title, --content, and optional --category.
  --handoff-save                   Save local generated session handoff state under .project-wiki/session/.
  --handoff-show                   Print the current local session handoff.
  --handoff-status                 Print JSON status for the local session handoff.
  --handoff-clear                  Remove generated session handoff files.
  --handoff-promote-inbox          Promote selected generated handoff facts into wiki/inbox/project-candidates.md.
  --handoff-injection-enable       Opt in to capped full handoff injection in startup hooks.
  --handoff-injection-disable      Remove the generated full handoff injection opt-in.
  --handoff-injection-status       Print JSON status for the full handoff injection experiment.
  --goal, --state, --blocked       With --handoff-save, provide resume context fields.
  --next, --decision               With --handoff-save, repeat for next actions and decisions.
  --glossary-init                  Create and route the optional glossary page.
  --agents <list>                  With init/update, write only selected agent surfaces: codex, claude, cursor, gemini, or all. Existing project skill/setup surfaces are preserved by default.
  --prune-check                    Report active pages with stale or unresolved signals.
  --prune-check-strict             With --prune-check, omit age-only candidates and show only higher-signal lifecycle items.
  --review-migration               Sync unit coverage and compatible inbox statuses into migration review files.
  --no-git-config                  Install hook files without changing git core.hooksPath.
  --code-index                     Build the disposable .project-wiki code evidence index.
  --code-index-health              Inspect code evidence cache compatibility and print rebuild guidance without writing.
  --acknowledge-small-repo         With --code-index, proceed below the small-repo scale gate after its cost warning.
  --incremental                    With --code-index, require an existing compatible index and update only changes.
  --code-index-full                With --code-index, force a full rebuild even when incremental update is possible.
  --code-index-engine <engine>     With --code-index, override default auto engine: typescript or native-rust.
  --code-parser <mode>             With --code-index, use parser mode default or tree-sitter.
  --code-query <sql>               Run conservative read-only SQL over the code evidence index.
  --code-status, --code-files      Inspect the code evidence index.
  --code-report                    Print architecture and ownership summaries from the code evidence index.
  --code-report-section <section>  With --code-report, print one section: coverage, ownership, languages, parsers, workspaces, workspace-graph, routes, hotspots, configs, or edges.
  --code-impact <term>             Show file, symbol, route, import, and edge impact evidence for a term.
  --code-context-pack <term>       Print a budgeted first-pass code context pack for a path, symbol, route, or module term.
  --code-search-symbol <term>      Search indexed symbols.

Commands:
  install                          Install the reusable Project Librarian skill files for selected agents.
  install-skill                    Compatibility alias for install.
  update                           Run the idempotent wiki/setup update path, sync existing project-scoped skill installs, and reject migration flags.
  mcp                              Run the stdio MCP server exposing answer-shaped code-evidence tools (code_context_pack, code_impact, code_ownership, code_workspace_graph, code_search, code_status) over the existing .project-wiki index.

  --help                           Show this help.`);
}

// console.log queues asynchronously on pipes; an immediate process.exit() discards
// anything past the first ~64KB pipe chunk (observed truncating a large
// --code-report on an 11k-file repo). Exiting from a zero-length write callback
// guarantees everything queued before it has drained.
function exitAfterStdoutDrain(code: number): void {
  process.stdout.write("", () => process.exit(code));
}

function activeCodeEvidenceCliModes(): CodeEvidenceCliMode[] {
  const modes: CodeEvidenceCliMode[] = [
    { active: codeQueryMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeQueryMode() },
    { active: codeReportMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeReportMode() },
    { active: codeStatusMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeStatusMode() },
    { active: codeFilesMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeFilesMode() },
    { active: codeImpactMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeImpactMode() },
    { active: codeContextPackMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeContextPackMode() },
    { active: codeSearchSymbolMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeSearchSymbolMode() },
    { active: codeIndexHealthMode, drainStdout: true, run: (codeIndexModule) => codeIndexModule.runCodeIndexHealthMode() },
    { active: codeIndexMode, drainStdout: false, run: (codeIndexModule) => codeIndexModule.runCodeIndexMode() },
  ];
  return modes.filter((mode) => mode.active);
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

if (invalidAgentTargets.length > 0) {
  console.error(`invalid --agents entr${invalidAgentTargets.length === 1 ? "y" : "ies"}: ${invalidAgentTargets.join(", ")}; expected codex, claude, cursor, gemini, or all`);
  printUsage();
  process.exit(1);
}

if (command === "update" && migrateMode) {
  console.error("update cannot be combined with --migrate or --adopt-existing; use project-librarian --migrate for migration.");
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

if (wikiVisualizeOutput && !wikiVisualizeMode) {
  console.error("--wiki-visualize-out is only supported with --wiki-visualize.");
  process.exit(1);
}

if (pruneCheckStrictMode && !pruneCheckMode) {
  console.error("--prune-check-strict is only supported with --prune-check.");
  process.exit(1);
}

if (codeIndexIncrementalMode && !codeIndexMode) {
  console.error("--incremental is only supported with --code-index.");
  process.exit(1);
}

if (acknowledgeSmallRepoMode && !codeIndexMode) {
  console.error("--acknowledge-small-repo is only supported with --code-index.");
  process.exit(1);
}

if (codeIndexFullMode && !codeIndexMode) {
  console.error("--code-index-full is only supported with --code-index.");
  process.exit(1);
}

if (codeIndexEngineMode && !codeIndexMode) {
  console.error("--code-index-engine is only supported with --code-index.");
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

const activeHandoffModes = [
  handoffSaveMode ? "--handoff-save" : "",
  handoffShowMode ? "--handoff-show" : "",
  handoffStatusMode ? "--handoff-status" : "",
  handoffClearMode ? "--handoff-clear" : "",
  handoffPromoteInboxMode ? "--handoff-promote-inbox" : "",
  handoffInjectionEnableMode ? "--handoff-injection-enable" : "",
  handoffInjectionDisableMode ? "--handoff-injection-disable" : "",
  handoffInjectionStatusMode ? "--handoff-injection-status" : "",
].filter(Boolean);

if (activeHandoffModes.length > 1) {
  console.error(`Use one session handoff mode at a time: ${activeHandoffModes.join(", ")}.`);
  process.exit(1);
}

if (handoffInputMode && !handoffSaveMode) {
  console.error("--goal, --state, --blocked, --next, --decision, --open-question, --last-success-command, --last-failure-command, and --verification are only supported with --handoff-save.");
  process.exit(1);
}

if (command === "install" || command === "install-skill") {
  runInstallSkillMode();
  process.exit(0);
}

if (command === "mcp") {
  // Hand-rolled stdio MCP server over the existing code-evidence index. Lazy
  // require keeps the server (and its node:sqlite dependency) out of the normal
  // bootstrap path. The server roots at process.cwd() and runs until stdin ends,
  // exiting from inside runMcpServerMode; the init flow below must not run.
  (require("./mcp-server") as typeof import("./mcp-server")).runMcpServerMode();
} else {
  runInitCommand();
}

function runInitCommand(): void {
const activeHandoffMode = activeHandoffModes[0];
if (activeHandoffMode) {
  try {
    if (handoffSaveMode) runHandoffSaveMode();
    else if (handoffShowMode) runHandoffShowMode();
    else if (handoffStatusMode) runHandoffStatusMode();
    else if (handoffClearMode) runHandoffClearMode();
    else if (handoffPromoteInboxMode) runHandoffPromoteInboxMode();
    else if (handoffInjectionEnableMode) runHandoffInjectionEnableMode();
    else if (handoffInjectionDisableMode) runHandoffInjectionDisableMode();
    else if (handoffInjectionStatusMode) runHandoffInjectionStatusMode();
    exitAfterStdoutDrain(0);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  return;
}
const activeCodeModes = activeCodeEvidenceCliModes();
if (activeCodeModes.length > 1) {
  console.error("Use one code evidence mode at a time: --code-index, --code-index-health, --code-query, --code-report, --code-status, --code-files, --code-impact, --code-context-pack, or --code-search-symbol.");
  process.exit(1);
}

const activeCodeMode = activeCodeModes[0];
if (activeCodeMode) {
  activeCodeMode.run(codeIndex());
  if (activeCodeMode.drainStdout) exitAfterStdoutDrain(0);
  else process.exit(0);
  return;
}
if (wikiImpactMode) {
  runWikiImpactMode();
  exitAfterStdoutDrain(0);
  return;
}
if (wikiVisualizeMode) {
  try {
    const output = writeWikiVisualizer(wikiVisualizeOutput);
    console.log(`Project wiki visualizer written: ${output}`);
    exitAfterStdoutDrain(0);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  return;
}
if (queryTerm) {
  runQueryMode();
  exitAfterStdoutDrain(0);
  return;
}
if (issueCreateMode) {
  runIssueCreateMode();
  process.exit(0);
}
if (issueDraftMode) {
  runIssueDraftMode();
  exitAfterStdoutDrain(0);
  return;
}
if (pruneCheckMode) {
  runPruneCheckMode({ strict: pruneCheckStrictMode });
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
if (refreshIndexMode && !migrateMode && !glossaryMode && !captureInboxMode) {
  runRefreshIndexOnlyMode();
  process.exit(0);
}

const selectedAgentSurfaces = agentTargets.length > 0
  ? agentTargets
  : migrateMode
    ? Array.from(allAgentSurfaces)
    : resolveBootstrapAgentSurfaces(agentTargets, exists, read);
const projectSkillSyncSurfaces = command === "update"
  ? installedProjectSkillSurfaces().filter((surface) => includesAgentSurface(selectedAgentSurfaces, surface))
  : [];
const shouldWriteSurface = (surface: "codex" | "claude" | "cursor" | "gemini"): boolean => includesAgentSurface(selectedAgentSurfaces, surface);
const writeCodexSurface = shouldWriteSurface("codex");
const writeClaudeSurface = shouldWriteSurface("claude");
const writeCursorSurface = shouldWriteSurface("cursor");
const writeGeminiSurface = shouldWriteSurface("gemini");

const migrationState: MigrationState | null = migrateMode ? prepareMigrationMode() : null;
const results: ResultRow[] = [];
if (migrationState) results.push(["migration prepare", migrationState.note]);

mkdirp("wiki/canonical");
mkdirp("wiki/decisions");
mkdirp("wiki/inbox");
mkdirp("wiki/meta");
mkdirp("wiki/sources");
if (writeCodexSurface) mkdirp(".codex/hooks");
if (writeClaudeSurface) mkdirp(".claude/hooks");
if (writeCursorSurface) {
  mkdirp(".cursor/hooks");
  mkdirp(".cursor/rules");
}
if (writeGeminiSurface) mkdirp(".gemini/hooks");
mkdirp(".githooks");
for (const surface of projectSkillSyncSurfaces) {
  for (const result of syncProjectSkillInstall(surface)) results.push(result);
}

// B1 fallback: sync the CURRENT startup.md TL;DR into the managed AGENTS.md block
// so non-interactive `codex exec` (which does not run SessionStart hooks) still
// gets compact startup context. Routers are starter files written later in this
// flow, so on a fresh bootstrap startup.md does not exist yet; fall back to the
// template TL;DR that bootstrap is about to write. A missing "## TL;DR" section in
// an existing startup.md fails loudly inside extractStartupTldr (no fallback).
const startupForSync = exists("wiki/startup.md") ? read("wiki/startup.md") : startup;
const startupTldrForAgents = extractStartupTldr(startupForSync);
results.push(["AGENTS.md", upsertMarkedSection("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", agentsSection(startupTldrForAgents))]);
if (writeClaudeSurface) results.push(["CLAUDE.md", upsertMarkedSection("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", claudeSection)]);
if (writeGeminiSurface) results.push(["GEMINI.md", upsertMarkedSection("GEMINI.md", "<!-- PROJECT-WIKI-GEMINI:START -->", "<!-- PROJECT-WIKI-GEMINI:END -->", geminiSection)]);
if (writeCursorSurface) results.push([".cursor/rules/project-librarian.mdc", writeManaged(".cursor/rules/project-librarian.mdc", cursorRule)]);
results.push(["wiki/AGENTS.md", upsertMarkedSection("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", wikiAgentsSection)]);
results.push([".githooks/prepare-commit-msg", writeManaged(".githooks/prepare-commit-msg", gitPrepareCommitMsgHook)]);
makeExecutable(".githooks/prepare-commit-msg");
results.push([".githooks/wiki-commit-trailers.js", writeManaged(".githooks/wiki-commit-trailers.js", gitWikiCommitTrailersScript)]);
makeExecutable(".githooks/wiki-commit-trailers.js");
results.push(["git core.hooksPath", upsertGitHooksPath()]);
if (writeCodexSurface) {
  results.push([".codex/hooks.json", upsertHookConfig()]);
  results.push([".codex/hooks/wiki-session-start.js", writeManaged(".codex/hooks/wiki-session-start.js", hookScript)]);
}
if (writeClaudeSurface) {
  results.push([".claude/settings.json", upsertClaudeHookConfig()]);
  results.push([".claude/hooks/wiki-session-start.js", writeManaged(".claude/hooks/wiki-session-start.js", hookScript)]);
}
if (writeCursorSurface) {
  results.push([".cursor/hooks.json", upsertCursorHookConfig()]);
  results.push([".cursor/hooks/wiki-session-start.js", writeManaged(".cursor/hooks/wiki-session-start.js", cursorHookScript)]);
}
if (writeGeminiSurface) {
  results.push([".gemini/settings.json", upsertGeminiHookConfig()]);
  results.push([".gemini/hooks/wiki-session-start.js", writeManaged(".gemini/hooks/wiki-session-start.js", hookScript)]);
}
// Bootstrap-managed MCP registration (preservation-first, idempotent). Claude
// Code reads `.mcp.json`, Cursor reads `.cursor/mcp.json`, and Gemini reads
// `mcpServers` inside `.gemini/settings.json`. Codex only supports user-level MCP
// config (`codex mcp add` -> ~/.codex/config.toml), so it is intentionally not
// registered at project level; the README documents the manual user-level step.
// Registration is scale-gated (2026-06-12 decision): below the measured
// file-count threshold with no existing .project-wiki index, the rows report the
// skip reason instead of writing config; an existing index registers regardless.
if (writeClaudeSurface || writeCursorSurface || writeGeminiSurface) {
  const mcpGate = mcpRegistrationGate();
  if (mcpGate.register) {
    if (writeClaudeSurface) results.push([".mcp.json", upsertClaudeMcpConfig()]);
    if (writeCursorSurface) results.push([".cursor/mcp.json", upsertCursorMcpConfig()]);
    if (writeGeminiSurface) results.push([".gemini/settings.json mcpServers", upsertGeminiMcpConfig()]);
  } else {
    if (writeClaudeSurface) results.push([".mcp.json", mcpGate.reason]);
    if (writeCursorSurface) results.push([".cursor/mcp.json", mcpGate.reason]);
    if (writeGeminiSurface) results.push([".gemini/settings.json mcpServers", mcpGate.reason]);
  }
}
// Routers accumulate user-maintained project state after bootstrap, so they are
// starter files: templates are written only when the file is absent, never rebuilt.
results.push(["wiki/startup.md", writeStarter("wiki/startup.md", startup)]);
results.push(["wiki/index.md", writeStarter("wiki/index.md", index)]);
results.push(["wiki/meta/operating-model.md", writeManaged("wiki/meta/operating-model.md", wikiOperatingModel)]);
results.push(["wiki/meta/decision-policy.md", writeManaged("wiki/meta/decision-policy.md", decisionPolicy)]);
results.push(["wiki/canonical/wiki-operating-model.md", deleteIfGenerated("wiki/canonical/wiki-operating-model.md", ["# Wiki Operating Model"])]);
results.push(["wiki/canonical/decision-policy.md", deleteIfGenerated("wiki/canonical/decision-policy.md", ["# Decision Policy"])]);
results.push(["wiki/decisions/wiki-v1-decisions.md", deleteIfGenerated("wiki/decisions/wiki-v1-decisions.md", ["# Wiki v1 Decisions", "# Wiki Operations v1 Decisions"])]);
for (const [relativePath, content] of Object.entries(starterFiles)) {
  if (!defaultStarterFilePaths.has(relativePath)) continue;
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
}

function runRefreshIndexOnlyMode(): void {
  const results: ResultRow[] = [];
  results.push(["wiki/index.md", writeStarter("wiki/index.md", index)]);
  results.push(["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())]);
  console.log("Project Librarian refresh-index complete.");
  for (const [relativePath, status] of results) {
    console.log(`${String(status).padEnd(7)} ${relativePath}`);
  }
}
