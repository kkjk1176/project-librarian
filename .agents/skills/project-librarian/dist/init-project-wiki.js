#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const args_1 = require("./args");
const agent_surfaces_1 = require("./agent-surfaces");
const hooks_1 = require("./hooks");
const install_1 = require("./install");
const modes_1 = require("./modes");
const session_handoff_1 = require("./session-handoff");
const templates_1 = require("./templates");
const update_1 = require("./update");
const workspace_1 = require("./workspace");
function printUsage() {
    console.log(`Usage:
  project-librarian [init|update] [options]
  project-librarian install [--scope user|project] [--agents codex|claude|cursor|gemini|all] [--dry-run]

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
  --agents <list>                  With init/update, target agents; with install, skip the interactive agent selector.
  --scope <value>                  With install/update, skip the interactive scope selector: user or project.
  --targets <list>                 With update, target skill, agents, or all; skips the target selector.
  --no-git-config                  With init/update, write hook files without changing git core.hooksPath.
  --dry-run                        With install, preview copied skill files without writing them.
  --issue-draft                    Print a GitHub issue body draft for a Project Librarian problem.
  --issue-create                   Create the issue with gh after explicit user approval.
  --issue-body-file <path>         With --issue-create, use an existing Markdown body file.
  --issue-title <title>            Override the generated issue title.
  --help                           Show this help.

Commands:
  init                             Create missing wiki and selected agent setup files; preserve an existing wiki.
  update                           Interactively choose scope and update targets, then refresh selected skills or agent setup.
  install                          Interactively choose scope and agents, then install reusable skill files.`);
}
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
if (args_1.invalidAgentTargets.length > 0) {
    console.error(`invalid --agents entr${args_1.invalidAgentTargets.length === 1 ? "y" : "ies"}: ${args_1.invalidAgentTargets.join(", ")}; expected codex, claude, cursor, gemini, or all`);
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
if (args_1.pruneCheckStrictMode && !args_1.pruneCheckMode) {
    console.error("--prune-check-strict is only supported with --prune-check.");
    process.exit(1);
}
const activeHandoffModes = [
    args_1.handoffSaveMode ? "--handoff-save" : "",
    args_1.handoffShowMode ? "--handoff-show" : "",
    args_1.handoffStatusMode ? "--handoff-status" : "",
    args_1.handoffClearMode ? "--handoff-clear" : "",
    args_1.handoffPromoteInboxMode ? "--handoff-promote-inbox" : "",
    args_1.handoffInjectionEnableMode ? "--handoff-injection-enable" : "",
    args_1.handoffInjectionDisableMode ? "--handoff-injection-disable" : "",
    args_1.handoffInjectionStatusMode ? "--handoff-injection-status" : "",
].filter(Boolean);
if (activeHandoffModes.length > 1) {
    console.error(`Use one session handoff mode at a time: ${activeHandoffModes.join(", ")}.`);
    process.exit(1);
}
if (args_1.handoffInputMode && !args_1.handoffSaveMode) {
    console.error("--goal, --state, --blocked, --next, --decision, --open-question, --last-success-command, --last-failure-command, and --verification are only supported with --handoff-save.");
    process.exit(1);
}
if (args_1.command === "install") {
    (0, install_1.runInstallMode)()
        .then(() => exitAfterStdoutDrain(0))
        .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
else {
    runInitCommand().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
async function runInitCommand() {
    const activeHandoffMode = activeHandoffModes[0];
    if (activeHandoffMode) {
        try {
            if (args_1.handoffSaveMode)
                (0, session_handoff_1.runHandoffSaveMode)();
            else if (args_1.handoffShowMode)
                (0, session_handoff_1.runHandoffShowMode)();
            else if (args_1.handoffStatusMode)
                (0, session_handoff_1.runHandoffStatusMode)();
            else if (args_1.handoffClearMode)
                (0, session_handoff_1.runHandoffClearMode)();
            else if (args_1.handoffPromoteInboxMode)
                (0, session_handoff_1.runHandoffPromoteInboxMode)();
            else if (args_1.handoffInjectionEnableMode)
                (0, session_handoff_1.runHandoffInjectionEnableMode)();
            else if (args_1.handoffInjectionDisableMode)
                (0, session_handoff_1.runHandoffInjectionDisableMode)();
            else if (args_1.handoffInjectionStatusMode)
                (0, session_handoff_1.runHandoffInjectionStatusMode)();
            exitAfterStdoutDrain(0);
        }
        catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
        return;
    }
    if (args_1.wikiImpactMode) {
        (0, modes_1.runWikiImpactMode)();
        exitAfterStdoutDrain(0);
        return;
    }
    if (args_1.wikiNeighborhoodMode) {
        (0, modes_1.runWikiNeighborhoodMode)();
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
        (0, modes_1.runPruneCheckMode)({ strict: args_1.pruneCheckStrictMode });
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
    if (args_1.refreshIndexMode && !args_1.glossaryMode && !args_1.captureInboxMode) {
        runRefreshIndexOnlyMode();
        process.exit(0);
    }
    if (args_1.command === "update") {
        runUpdateMode(await (0, update_1.resolveUpdateSelection)());
        return;
    }
    const agentSurfaceResolution = (0, agent_surfaces_1.resolveBootstrapAgentSurfaces)("init", args_1.agentTargets, workspace_1.exists, workspace_1.read);
    const selectedAgentSurfaces = agentSurfaceResolution.surfaces;
    const shouldWriteSurface = (surface) => (0, agent_surfaces_1.includesAgentSurface)(selectedAgentSurfaces, surface);
    const writeCodexSurface = shouldWriteSurface("codex");
    const writeClaudeSurface = shouldWriteSurface("claude");
    const writeCursorSurface = shouldWriteSurface("cursor");
    const writeGeminiSurface = shouldWriteSurface("gemini");
    const results = [];
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
    ])
        (0, workspace_1.mkdirp)(directory);
    if (writeCodexSurface)
        (0, workspace_1.mkdirp)(".codex/hooks");
    if (writeClaudeSurface)
        (0, workspace_1.mkdirp)(".claude/hooks");
    if (writeCursorSurface) {
        (0, workspace_1.mkdirp)(".cursor/hooks");
        (0, workspace_1.mkdirp)(".cursor/rules");
    }
    if (writeGeminiSurface)
        (0, workspace_1.mkdirp)(".gemini/hooks");
    (0, workspace_1.mkdirp)(".githooks");
    const startupForSync = (0, workspace_1.exists)("wiki/startup.md") ? (0, workspace_1.read)("wiki/startup.md") : templates_1.startup;
    const startupTldrForAgents = (0, templates_1.extractStartupTldr)(startupForSync);
    results.push(["AGENTS.md", (0, workspace_1.upsertMarkedSection)("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", (0, templates_1.agentsSection)(startupTldrForAgents))]);
    if (writeClaudeSurface)
        results.push(["CLAUDE.md", (0, workspace_1.upsertMarkedSection)("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", templates_1.claudeSection)]);
    if (writeGeminiSurface)
        results.push(["GEMINI.md", (0, workspace_1.upsertMarkedSection)("GEMINI.md", "<!-- PROJECT-WIKI-GEMINI:START -->", "<!-- PROJECT-WIKI-GEMINI:END -->", templates_1.geminiSection)]);
    if (writeCursorSurface)
        results.push([".cursor/rules/project-librarian.mdc", (0, workspace_1.writeManaged)(".cursor/rules/project-librarian.mdc", templates_1.cursorRule)]);
    results.push(["wiki/AGENTS.md", (0, workspace_1.upsertMarkedSection)("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", templates_1.wikiAgentsSection)]);
    results.push([".githooks/prepare-commit-msg", (0, workspace_1.writeManaged)(".githooks/prepare-commit-msg", hooks_1.gitPrepareCommitMsgHook)]);
    (0, workspace_1.makeExecutable)(".githooks/prepare-commit-msg");
    results.push([".githooks/wiki-commit-trailers.js", (0, workspace_1.writeManaged)(".githooks/wiki-commit-trailers.js", hooks_1.gitWikiCommitTrailersScript)]);
    (0, workspace_1.makeExecutable)(".githooks/wiki-commit-trailers.js");
    results.push(["git core.hooksPath", (0, hooks_1.upsertGitHooksPath)()]);
    if (writeCodexSurface) {
        results.push([".codex/hooks.json", (0, hooks_1.upsertHookConfig)()]);
        results.push([".codex/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".codex/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    }
    if (writeClaudeSurface) {
        results.push([".claude/settings.json", (0, hooks_1.upsertClaudeHookConfig)()]);
        results.push([".claude/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".claude/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    }
    if (writeCursorSurface) {
        results.push([".cursor/hooks.json", (0, hooks_1.upsertCursorHookConfig)()]);
        results.push([".cursor/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".cursor/hooks/wiki-session-start.js", hooks_1.cursorHookScript)]);
    }
    if (writeGeminiSurface) {
        results.push([".gemini/settings.json", (0, hooks_1.upsertGeminiHookConfig)()]);
        results.push([".gemini/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".gemini/hooks/wiki-session-start.js", hooks_1.hookScript)]);
    }
    results.push(["wiki/startup.md", (0, workspace_1.writeStarter)("wiki/startup.md", templates_1.startup)]);
    results.push(["wiki/index.md", (0, workspace_1.writeStarter)("wiki/index.md", templates_1.index)]);
    results.push(["wiki/meta/operating-model.md", (0, workspace_1.writeStarter)("wiki/meta/operating-model.md", templates_1.wikiOperatingModelV2)]);
    results.push(["wiki/meta/decision-policy.md", (0, workspace_1.writeStarter)("wiki/meta/decision-policy.md", templates_1.decisionPolicyV2)]);
    for (const [relativePath, content] of Object.entries(templates_1.v2StarterFiles)) {
        if (!templates_1.v2DefaultStarterFilePaths.has(relativePath))
            continue;
        results.push([relativePath, (0, workspace_1.writeStarter)(relativePath, content)]);
    }
    results.push(["wiki/meta/wiki-ops-v2-decisions.md", (0, workspace_1.writeStarter)("wiki/meta/wiki-ops-v2-decisions.md", templates_1.v2StarterFiles["wiki/meta/wiki-ops-v2-decisions.md"])]);
    if (args_1.glossaryMode) {
        results.push(["wiki/20-shared/glossary.md", (0, workspace_1.writeStarter)("wiki/20-shared/glossary.md", templates_1.glossary)]);
        results.push(["wiki/index.md glossary router", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", templates_1.glossaryIndexBlock)]);
    }
    if (args_1.captureInboxMode) {
        results.push(["wiki/inbox/project-candidates.md", (0, modes_1.appendCaptureInbox)()]);
        results.push(["wiki/index.md inbox router", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", templates_1.inboxIndexBlock)]);
    }
    if (args_1.refreshIndexMode) {
        results.push(["wiki/index.md auto-discovered pages", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", (0, modes_1.buildRefreshIndexBlock)())]);
    }
    const modes = [];
    if (args_1.glossaryMode)
        modes.push("glossary");
    if (args_1.captureInboxMode)
        modes.push("capture-inbox");
    if (args_1.refreshIndexMode)
        modes.push("refresh-index");
    if (args_1.noGitConfigMode)
        modes.push("no-git-config");
    console.log(modes.length > 0 ? `Project Librarian + ${modes.join(" + ")} complete.` : "Project Librarian complete.");
    for (const [relativePath, status] of results)
        console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
function hasUpdateTarget(selection, target) {
    return selection.targets.includes(target);
}
function runUpdateMode(selection) {
    const updateSkill = hasUpdateTarget(selection, "skill");
    const updateAgents = hasUpdateTarget(selection, "agents");
    const results = [];
    if (selection.scope === "user") {
        const installed = (0, install_1.installedUserSkillSurfaces)();
        const selected = args_1.agentTargets.length > 0 ? installed.filter((surface) => (0, agent_surfaces_1.includesAgentSurface)(args_1.agentTargets, surface)) : installed;
        if (selected.length === 0) {
            throw new Error("update cannot detect an existing user-scope Project Librarian skill; use install for a fresh user-scope install.");
        }
        for (const surface of selected) {
            for (const result of (0, install_1.syncUserSkillInstall)(surface))
                results.push(result);
        }
    }
    else {
        const projectSkillSurfaces = updateSkill
            ? (0, install_1.installedProjectSkillSurfaces)().filter((surface) => args_1.agentTargets.length === 0 || (0, agent_surfaces_1.includesAgentSurface)(args_1.agentTargets, surface))
            : [];
        const syncSharedProjectSkill = updateSkill && (0, install_1.hasSharedProjectSkillInstall)();
        let selectedAgentSurfaces = [];
        if (updateAgents) {
            const agentSurfaceResolution = (0, agent_surfaces_1.resolveBootstrapAgentSurfaces)("update", args_1.agentTargets, workspace_1.exists, workspace_1.read);
            if (agentSurfaceResolution.source === "missing-update-target") {
                throw new Error("update cannot detect an existing Project Librarian install or agent surface; use init for a fresh project or pass --agents explicitly.");
            }
            selectedAgentSurfaces = agentSurfaceResolution.surfaces;
        }
        const shouldWriteSurface = (surface) => (0, agent_surfaces_1.includesAgentSurface)(selectedAgentSurfaces, surface);
        const writeCodexSurface = shouldWriteSurface("codex");
        const writeClaudeSurface = shouldWriteSurface("claude");
        const writeCursorSurface = shouldWriteSurface("cursor");
        const writeGeminiSurface = shouldWriteSurface("gemini");
        if (updateAgents) {
            if (writeCodexSurface)
                (0, workspace_1.mkdirp)(".codex/hooks");
            if (writeClaudeSurface)
                (0, workspace_1.mkdirp)(".claude/hooks");
            if (writeCursorSurface) {
                (0, workspace_1.mkdirp)(".cursor/hooks");
                (0, workspace_1.mkdirp)(".cursor/rules");
            }
            if (writeGeminiSurface)
                (0, workspace_1.mkdirp)(".gemini/hooks");
            (0, workspace_1.mkdirp)(".githooks");
        }
        if (updateSkill) {
            for (const surface of projectSkillSurfaces) {
                for (const result of (0, install_1.syncProjectSkillInstall)(surface))
                    results.push(result);
            }
            if (syncSharedProjectSkill) {
                for (const result of (0, install_1.syncSharedProjectSkillInstall)())
                    results.push(result);
            }
        }
        if (updateAgents) {
            const startupForSync = (0, workspace_1.exists)("wiki/startup.md") ? (0, workspace_1.read)("wiki/startup.md") : templates_1.startup;
            const startupTldrForAgents = (0, templates_1.extractStartupTldr)(startupForSync);
            results.push(["AGENTS.md", (0, workspace_1.upsertMarkedSection)("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", (0, templates_1.agentsSection)(startupTldrForAgents))]);
            if (writeClaudeSurface)
                results.push(["CLAUDE.md", (0, workspace_1.upsertMarkedSection)("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", templates_1.claudeSection)]);
            if (writeGeminiSurface)
                results.push(["GEMINI.md", (0, workspace_1.upsertMarkedSection)("GEMINI.md", "<!-- PROJECT-WIKI-GEMINI:START -->", "<!-- PROJECT-WIKI-GEMINI:END -->", templates_1.geminiSection)]);
            if (writeCursorSurface)
                results.push([".cursor/rules/project-librarian.mdc", (0, workspace_1.writeManaged)(".cursor/rules/project-librarian.mdc", templates_1.cursorRule)]);
            results.push([".githooks/prepare-commit-msg", (0, workspace_1.writeManaged)(".githooks/prepare-commit-msg", hooks_1.gitPrepareCommitMsgHook)]);
            (0, workspace_1.makeExecutable)(".githooks/prepare-commit-msg");
            results.push([".githooks/wiki-commit-trailers.js", (0, workspace_1.writeManaged)(".githooks/wiki-commit-trailers.js", hooks_1.gitWikiCommitTrailersScript)]);
            (0, workspace_1.makeExecutable)(".githooks/wiki-commit-trailers.js");
            if (!args_1.noGitConfigMode)
                results.push(["git core.hooksPath", (0, hooks_1.upsertGitHooksPath)()]);
            if (writeCodexSurface) {
                results.push([".codex/hooks.json", (0, hooks_1.upsertHookConfig)()]);
                results.push([".codex/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".codex/hooks/wiki-session-start.js", hooks_1.hookScript)]);
            }
            if (writeClaudeSurface) {
                results.push([".claude/settings.json", (0, hooks_1.upsertClaudeHookConfig)()]);
                results.push([".claude/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".claude/hooks/wiki-session-start.js", hooks_1.hookScript)]);
            }
            if (writeCursorSurface) {
                results.push([".cursor/hooks.json", (0, hooks_1.upsertCursorHookConfig)()]);
                results.push([".cursor/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".cursor/hooks/wiki-session-start.js", hooks_1.cursorHookScript)]);
            }
            if (writeGeminiSurface) {
                results.push([".gemini/settings.json", (0, hooks_1.upsertGeminiHookConfig)()]);
                results.push([".gemini/hooks/wiki-session-start.js", (0, workspace_1.writeManaged)(".gemini/hooks/wiki-session-start.js", hooks_1.hookScript)]);
            }
        }
    }
    const modes = [`scope=${selection.scope}`, `targets=${selection.targets.join(",")}`];
    if (args_1.noGitConfigMode && updateAgents)
        modes.push("no-git-config");
    console.log(`Project Librarian update complete (${modes.join(" + ")}).`);
    for (const [relativePath, status] of results)
        console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
function runRefreshIndexOnlyMode() {
    const results = [
        ["wiki/index.md", (0, workspace_1.writeStarter)("wiki/index.md", templates_1.index)],
        ["wiki/index.md auto-discovered pages", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", (0, modes_1.buildRefreshIndexBlock)())],
    ];
    console.log("Project Librarian refresh-index complete.");
    for (const [relativePath, status] of results)
        console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
