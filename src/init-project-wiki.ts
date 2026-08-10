#!/usr/bin/env node

import {
  agentTargets,
  captureInboxMode,
  command,
  doctorMode,
  fixMode,
  glossaryMode,
  handoffClearMode,
  handoffInputMode,
  handoffInjectionDisableMode,
  handoffInjectionEnableMode,
  handoffInjectionStatusMode,
  handoffPromoteInboxMode,
  handoffSaveMode,
  handoffShowMode,
  handoffStatusMode,
  helpMode,
  invalidAgentTargets,
  issueCreateMode,
  issueDraftMode,
  linkCheckMode,
  lintMode,
  missingValueOptions,
  noGitConfigMode,
  pruneCheckMode,
  pruneCheckStrictMode,
  qualityCheckMode,
  queryTerm,
  refreshIndexMode,
  unexpectedValueOptions,
  unknownCommand,
  unknownOptions,
  wikiImpactMode,
  wikiNeighborhoodMode,
} from "./args";
import { includesAgentSurface, resolveBootstrapAgentSurfaces } from "./agent-surfaces";
import {
  cursorHookScript,
  gitPrepareCommitMsgHook,
  gitWikiCommitTrailersScript,
  hookScript,
  upsertClaudeHookConfig,
  upsertCursorHookConfig,
  upsertGeminiHookConfig,
  upsertGitHooksPath,
  upsertHookConfig,
} from "./hooks";
import {
  hasSharedProjectSkillInstall,
  installedProjectSkillSurfaces,
  runInstallSkillMode,
  syncProjectSkillInstall,
  syncSharedProjectSkillInstall,
} from "./install-skill";
import {
  appendCaptureInbox,
  buildRefreshIndexBlock,
  runDoctorMode,
  runIssueCreateMode,
  runIssueDraftMode,
  runLinkCheckMode,
  runLintMode,
  runPruneCheckMode,
  runQualityCheckMode,
  runQueryMode,
  runWikiImpactMode,
  runWikiNeighborhoodMode,
} from "./modes";
import {
  runHandoffClearMode,
  runHandoffInjectionDisableMode,
  runHandoffInjectionEnableMode,
  runHandoffInjectionStatusMode,
  runHandoffPromoteInboxMode,
  runHandoffSaveMode,
  runHandoffShowMode,
  runHandoffStatusMode,
} from "./session-handoff";
import {
  agentsSection,
  claudeSection,
  cursorRule,
  decisionPolicyV2,
  extractStartupTldr,
  geminiSection,
  glossary,
  glossaryIndexBlock,
  inboxIndexBlock,
  index,
  startup,
  v2DefaultStarterFilePaths,
  v2StarterFiles,
  wikiAgentsSection,
  wikiOperatingModelV2,
} from "./templates";
import type { ResultRow } from "./types";
import { exists, makeExecutable, mkdirp, read, upsertMarkedSection, writeManaged, writeStarter } from "./workspace";

function printUsage(): void {
  console.log(`Usage:
  project-librarian [init|update] [options]
  project-librarian install [--scope user|project] [--agents codex|claude|cursor|gemini|all] [--dry-run]
  project-librarian install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all] [--dry-run]

Wiki options:
  --lint                           Validate the generated project wiki setup without editing files.
  --link-check                     Report broken wiki links, duplicate routes, and orphan pages.
  --quality-check                  Report stale, conflicting, and low-quality wiki document signals.
  --doctor                         Run lint, link-check, and quality-check together.
  --fix                            With --doctor, refresh generated index routing before diagnostics.
  --query <terms>                  Search wiki paths, metadata, titles, and bodies with capped output.
  --wiki-impact <page-or-term>     Show wiki backlinks, decision_ref citations, and router depth.
  --wiki-neighborhood <target>     Show a bounded read order for nearby wiki pages.
  --refresh-index                  Update the managed auto-discovered wiki index block.
  --capture-inbox                  Append a candidate note with --title, --content, and optional --category.
  --glossary-init                  Create and route the optional shared glossary page.
  --prune-check                    Report active pages with stale or unresolved signals.
  --prune-check-strict             With --prune-check, omit age-only candidates.

Session handoff options:
  --handoff-save                   Save generated local resume state under .project-wiki/session/.
  --handoff-show                   Print the current local session handoff.
  --handoff-status                 Print JSON status for the local session handoff.
  --handoff-clear                  Remove generated local session handoff files.
  --handoff-promote-inbox          Copy selected handoff facts into wiki/inbox/project-candidates.md.
  --handoff-injection-enable       Opt in to capped full handoff injection in startup hooks.
  --handoff-injection-disable      Remove the full handoff injection opt-in.
  --handoff-injection-status       Print JSON status for handoff injection.
  --goal, --state, --blocked       With --handoff-save, provide resume context fields.
  --next, --decision               With --handoff-save, repeat for next actions and decisions.

Setup and support options:
  --agents <list>                  With init/update, target codex, claude, cursor, gemini, or all.
  --no-git-config                  Install hook files without changing git core.hooksPath.
  --dry-run                        With install, preview copied skill files without writing them.
  --issue-draft                    Print a GitHub issue body draft for a Project Librarian problem.
  --issue-create                   Create the issue with gh after explicit user approval.
  --issue-body-file <path>         With --issue-create, use an existing Markdown body file.
  --issue-title <title>            Override the generated issue title.
  --help                           Show this help.

Commands:
  init                             Create missing wiki and selected agent setup files; preserve an existing wiki.
  update                           Refresh managed setup while preserving existing wiki content and agent surfaces.
  install                          Install reusable Project Librarian skill files for selected agents.
  install-skill                    Compatibility alias for install.`);
}

function exitAfterStdoutDrain(code: number): void {
  process.stdout.write("", () => process.exit(code));
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

if (fixMode && !doctorMode) {
  console.error("--fix is only supported with --doctor.");
  process.exit(1);
}

if (issueCreateMode && issueDraftMode) {
  console.error("Use one issue mode at a time: --issue-draft or --issue-create.");
  process.exit(1);
}

if (pruneCheckStrictMode && !pruneCheckMode) {
  console.error("--prune-check-strict is only supported with --prune-check.");
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

runInitCommand();

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
  if (wikiImpactMode) {
    runWikiImpactMode();
    exitAfterStdoutDrain(0);
    return;
  }
  if (wikiNeighborhoodMode) {
    runWikiNeighborhoodMode();
    exitAfterStdoutDrain(0);
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
  if (refreshIndexMode && !glossaryMode && !captureInboxMode) {
    runRefreshIndexOnlyMode();
    process.exit(0);
  }

  const agentSurfaceResolution = resolveBootstrapAgentSurfaces(command === "update" ? "update" : "init", agentTargets, exists, read);
  if (agentSurfaceResolution.source === "missing-update-target") {
    console.error("update cannot detect an existing Project Librarian install or agent surface; use init for a fresh project or pass --agents explicitly.");
    process.exit(1);
  }
  const selectedAgentSurfaces = agentSurfaceResolution.surfaces;
  const projectSkillSyncSurfaces = command === "update"
    ? installedProjectSkillSurfaces().filter((surface) => includesAgentSurface(selectedAgentSurfaces, surface))
    : [];
  const syncSharedProjectSkill = command === "update" && hasSharedProjectSkillInstall();
  const shouldWriteSurface = (surface: "codex" | "claude" | "cursor" | "gemini"): boolean => includesAgentSurface(selectedAgentSurfaces, surface);
  const writeCodexSurface = shouldWriteSurface("codex");
  const writeClaudeSurface = shouldWriteSurface("claude");
  const writeCursorSurface = shouldWriteSurface("cursor");
  const writeGeminiSurface = shouldWriteSurface("gemini");
  const results: ResultRow[] = [];

  for (const directory of [
    "wiki/00-index",
    "wiki/01-governance",
    "wiki/10-services",
    "wiki/20-shared",
    "wiki/30-portfolio",
    "wiki/90-archive",
    "wiki/inbox",
    "wiki/indexes",
    "wiki/meta",
  ]) mkdirp(directory);
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
  if (syncSharedProjectSkill) {
    for (const result of syncSharedProjectSkillInstall()) results.push(result);
  }

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

  results.push(["wiki/startup.md", writeStarter("wiki/startup.md", startup)]);
  results.push(["wiki/index.md", writeStarter("wiki/index.md", index)]);
  results.push(["wiki/meta/operating-model.md", writeStarter("wiki/meta/operating-model.md", wikiOperatingModelV2)]);
  results.push(["wiki/meta/decision-policy.md", writeStarter("wiki/meta/decision-policy.md", decisionPolicyV2)]);
  for (const [relativePath, content] of Object.entries(v2StarterFiles)) {
    if (!v2DefaultStarterFilePaths.has(relativePath)) continue;
    results.push([relativePath, writeStarter(relativePath, content)]);
  }
  results.push(["wiki/meta/wiki-ops-v2-decisions.md", writeStarter("wiki/meta/wiki-ops-v2-decisions.md", v2StarterFiles["wiki/meta/wiki-ops-v2-decisions.md"])]);
  if (glossaryMode) {
    results.push(["wiki/20-shared/glossary.md", writeStarter("wiki/20-shared/glossary.md", glossary)]);
    results.push(["wiki/index.md glossary router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", glossaryIndexBlock)]);
  }
  if (captureInboxMode) {
    results.push(["wiki/inbox/project-candidates.md", appendCaptureInbox()]);
    results.push(["wiki/index.md inbox router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", inboxIndexBlock)]);
  }
  if (refreshIndexMode) {
    results.push(["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())]);
  }
  const modes: string[] = [];
  if (glossaryMode) modes.push("glossary");
  if (captureInboxMode) modes.push("capture-inbox");
  if (refreshIndexMode) modes.push("refresh-index");
  if (noGitConfigMode) modes.push("no-git-config");
  console.log(modes.length > 0 ? `Project Librarian + ${modes.join(" + ")} complete.` : "Project Librarian complete.");
  for (const [relativePath, status] of results) console.log(`${String(status).padEnd(7)} ${relativePath}`);
}

function runRefreshIndexOnlyMode(): void {
  const results: ResultRow[] = [
    ["wiki/index.md", writeStarter("wiki/index.md", index)],
    ["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())],
  ];
  console.log("Project Librarian refresh-index complete.");
  for (const [relativePath, status] of results) console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
