"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wikiImpactMode = exports.unknownOptions = exports.unknownCommand = exports.unexpectedValueOptions = exports.refreshIndexMode = exports.queryTerm = exports.qualityCheckMode = exports.pruneCheckStrictMode = exports.pruneCheckMode = exports.noGitConfigMode = exports.missingValueOptions = exports.lintMode = exports.linkCheckMode = exports.issueDraftTitle = exports.issueDraftMode = exports.issueCreateMode = exports.issueBodyFile = exports.invalidAgentTargets = exports.handoffVerification = exports.handoffStatusMode = exports.handoffState = exports.handoffShowMode = exports.handoffSaveMode = exports.handoffPromoteInboxMode = exports.handoffOpenQuestions = exports.handoffNextActions = exports.handoffLastSuccessCommand = exports.handoffLastFailureCommand = exports.handoffInjectionStatusMode = exports.handoffInjectionEnableMode = exports.handoffInjectionDisableMode = exports.handoffInputMode = exports.handoffGoal = exports.handoffDecisions = exports.handoffClearMode = exports.handoffBlocked = exports.helpMode = exports.glossaryMode = exports.fixMode = exports.doctorMode = exports.commandArgs = exports.command = exports.captureTitle = exports.captureInboxMode = exports.captureContent = exports.captureCategory = exports.args = exports.agentTargets = exports.parsedArgs = exports.rawArgs = void 0;
exports.wikiNeighborhoodTarget = exports.wikiNeighborhoodMode = exports.wikiImpactTarget = void 0;
exports.parseArgs = parseArgs;
exports.argValue = argValue;
exports.argValues = argValues;
const agent_surfaces_1 = require("./agent-surfaces");
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "update", "install"]);
const flagDefinitions = [
    { name: "--agents", value: "value" },
    { name: "--blocked", value: "value" },
    { name: "--capture-inbox", value: "none" },
    { name: "--category", value: "value" },
    { name: "--content", value: "value" },
    { name: "--decision", value: "value" },
    { name: "--doctor", value: "none" },
    { name: "--dry-run", value: "none" },
    { name: "--fix", value: "none" },
    { name: "--glossary-init", value: "none" },
    { name: "--goal", value: "value" },
    { name: "--handoff-clear", value: "none" },
    { name: "--handoff-injection-disable", value: "none" },
    { name: "--handoff-injection-enable", value: "none" },
    { name: "--handoff-injection-status", value: "none" },
    { name: "--handoff-promote-inbox", value: "none" },
    { name: "--handoff-save", value: "none" },
    { name: "--handoff-show", value: "none" },
    { name: "--handoff-status", value: "none" },
    { name: "--issue-body-file", value: "value" },
    { name: "--issue-create", value: "none" },
    { name: "--issue-draft", value: "none" },
    { name: "--issue-title", value: "value" },
    { name: "--last-failure-command", value: "value" },
    { name: "--last-success-command", value: "value" },
    { name: "--link-check", value: "none" },
    { name: "--lint", value: "none" },
    { name: "--next", value: "value" },
    { name: "--no-git-config", value: "none" },
    { name: "--open-question", value: "value" },
    { name: "--prune-check", value: "none" },
    { name: "--prune-check-strict", value: "none" },
    { name: "--quality-check", value: "none" },
    { name: "--query", value: "value" },
    { name: "--refresh-index", value: "none" },
    { name: "--scope", value: "value" },
    { name: "--state", value: "value" },
    { name: "--title", value: "value" },
    { name: "--targets", value: "value" },
    { name: "--verification", value: "value" },
    { name: "--wiki-impact", value: "value" },
    { name: "--wiki-neighborhood", value: "value" },
];
const flagsWithoutValues = new Set(flagDefinitions.filter((definition) => definition.value === "none").map((definition) => definition.name));
const flagsWithValues = new Set(flagDefinitions.filter((definition) => definition.value === "value").map((definition) => definition.name));
const knownFlags = new Set([...flagsWithoutValues, ...flagsWithValues, "--help", "-h"]);
function flagName(arg) {
    return arg.startsWith("--") ? arg.split("=", 1)[0] ?? arg : arg;
}
function hasFlagIn(commandArgs, name) {
    const prefix = `${name}=`;
    return commandArgs.some((arg) => arg === name || arg.startsWith(prefix));
}
function flagHasValue(commandArgs, name) {
    const prefix = `${name}=`;
    for (let index = 0; index < commandArgs.length; index += 1) {
        const arg = commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix))
            return arg.slice(prefix.length).trim().length > 0;
        if (arg === name) {
            const next = commandArgs[index + 1];
            return Boolean(next && !next.startsWith("-"));
        }
    }
    return true;
}
function argValueFrom(commandArgs, name) {
    const prefix = `${name}=`;
    const inline = commandArgs.find((arg) => arg.startsWith(prefix));
    if (inline)
        return inline.slice(prefix.length);
    const index = commandArgs.indexOf(name);
    const next = index >= 0 ? commandArgs[index + 1] : undefined;
    return next && !next.startsWith("--") ? next : "";
}
function argValuesFrom(commandArgs, name) {
    const prefix = `${name}=`;
    const values = [];
    for (let index = 0; index < commandArgs.length; index += 1) {
        const arg = commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix))
            values.push(arg.slice(prefix.length));
        else if (arg === name) {
            const next = commandArgs[index + 1];
            if (next && !next.startsWith("--"))
                values.push(next);
        }
    }
    return values.flatMap((value) => value.split(",").map((part) => part.trim()).filter(Boolean));
}
function parseArgs(argv) {
    const command = knownCommands.has(argv[0] ?? "") ? argv[0] : "init";
    const commandArgs = command === argv[0] ? argv.slice(1) : argv;
    const args = new Set(commandArgs);
    const hasFlag = (name) => hasFlagIn(commandArgs, name);
    const argValue = (name) => argValueFrom(commandArgs, name);
    const argValues = (name) => argValuesFrom(commandArgs, name);
    const parsedAgentTargets = (0, agent_surfaces_1.parseAgentSurfaceValues)(argValues("--agents"));
    const handoffInputMode = [
        "--blocked",
        "--decision",
        "--goal",
        "--last-failure-command",
        "--last-success-command",
        "--next",
        "--open-question",
        "--state",
        "--verification",
    ].some(hasFlag);
    return {
        agentTargets: parsedAgentTargets.surfaces,
        args,
        captureCategory: argValue("--category") || "project-candidate",
        captureContent: argValue("--content"),
        captureInboxMode: args.has("--capture-inbox"),
        captureTitle: argValue("--title"),
        command,
        commandArgs,
        doctorMode: args.has("--doctor"),
        fixMode: args.has("--fix"),
        glossaryMode: args.has("--glossary-init"),
        helpMode: argv.includes("--help") || argv.includes("-h"),
        handoffBlocked: argValues("--blocked"),
        handoffClearMode: args.has("--handoff-clear"),
        handoffDecisions: argValues("--decision"),
        handoffGoal: argValue("--goal"),
        handoffInputMode,
        handoffInjectionDisableMode: args.has("--handoff-injection-disable"),
        handoffInjectionEnableMode: args.has("--handoff-injection-enable"),
        handoffInjectionStatusMode: args.has("--handoff-injection-status"),
        handoffLastFailureCommand: argValue("--last-failure-command"),
        handoffLastSuccessCommand: argValue("--last-success-command"),
        handoffNextActions: argValues("--next"),
        handoffOpenQuestions: argValues("--open-question"),
        handoffPromoteInboxMode: args.has("--handoff-promote-inbox"),
        handoffSaveMode: args.has("--handoff-save"),
        handoffShowMode: args.has("--handoff-show"),
        handoffState: argValue("--state"),
        handoffStatusMode: args.has("--handoff-status"),
        handoffVerification: argValues("--verification"),
        invalidAgentTargets: parsedAgentTargets.invalid,
        issueBodyFile: argValue("--issue-body-file"),
        issueCreateMode: args.has("--issue-create"),
        issueDraftMode: args.has("--issue-draft"),
        issueDraftTitle: argValue("--issue-title"),
        linkCheckMode: args.has("--link-check"),
        lintMode: args.has("--lint"),
        missingValueOptions: [...flagsWithValues].filter((flag) => hasFlag(flag) && !flagHasValue(commandArgs, flag)),
        noGitConfigMode: args.has("--no-git-config"),
        pruneCheckMode: args.has("--prune-check"),
        pruneCheckStrictMode: args.has("--prune-check-strict"),
        qualityCheckMode: args.has("--quality-check"),
        queryTerm: argValue("--query"),
        rawArgs: argv,
        refreshIndexMode: args.has("--refresh-index"),
        unexpectedValueOptions: [...new Set(commandArgs
                .filter((arg) => arg.startsWith("--") && arg.includes("="))
                .map(flagName)
                .filter((arg) => flagsWithoutValues.has(arg)))],
        unknownCommand: argv[0] && !argv[0].startsWith("-") && !knownCommands.has(argv[0]) ? argv[0] : "",
        unknownOptions: [...new Set(commandArgs
                .filter((arg) => arg.startsWith("-"))
                .map(flagName)
                .filter((arg) => !knownFlags.has(arg)))],
        wikiImpactMode: hasFlag("--wiki-impact"),
        wikiImpactTarget: argValue("--wiki-impact"),
        wikiNeighborhoodMode: hasFlag("--wiki-neighborhood"),
        wikiNeighborhoodTarget: argValue("--wiki-neighborhood"),
    };
}
exports.parsedArgs = parseArgs(exports.rawArgs);
exports.agentTargets = exports.parsedArgs.agentTargets;
exports.args = exports.parsedArgs.args;
exports.captureCategory = exports.parsedArgs.captureCategory;
exports.captureContent = exports.parsedArgs.captureContent;
exports.captureInboxMode = exports.parsedArgs.captureInboxMode;
exports.captureTitle = exports.parsedArgs.captureTitle;
exports.command = exports.parsedArgs.command;
exports.commandArgs = exports.parsedArgs.commandArgs;
exports.doctorMode = exports.parsedArgs.doctorMode;
exports.fixMode = exports.parsedArgs.fixMode;
exports.glossaryMode = exports.parsedArgs.glossaryMode;
exports.helpMode = exports.parsedArgs.helpMode;
exports.handoffBlocked = exports.parsedArgs.handoffBlocked;
exports.handoffClearMode = exports.parsedArgs.handoffClearMode;
exports.handoffDecisions = exports.parsedArgs.handoffDecisions;
exports.handoffGoal = exports.parsedArgs.handoffGoal;
exports.handoffInputMode = exports.parsedArgs.handoffInputMode;
exports.handoffInjectionDisableMode = exports.parsedArgs.handoffInjectionDisableMode;
exports.handoffInjectionEnableMode = exports.parsedArgs.handoffInjectionEnableMode;
exports.handoffInjectionStatusMode = exports.parsedArgs.handoffInjectionStatusMode;
exports.handoffLastFailureCommand = exports.parsedArgs.handoffLastFailureCommand;
exports.handoffLastSuccessCommand = exports.parsedArgs.handoffLastSuccessCommand;
exports.handoffNextActions = exports.parsedArgs.handoffNextActions;
exports.handoffOpenQuestions = exports.parsedArgs.handoffOpenQuestions;
exports.handoffPromoteInboxMode = exports.parsedArgs.handoffPromoteInboxMode;
exports.handoffSaveMode = exports.parsedArgs.handoffSaveMode;
exports.handoffShowMode = exports.parsedArgs.handoffShowMode;
exports.handoffState = exports.parsedArgs.handoffState;
exports.handoffStatusMode = exports.parsedArgs.handoffStatusMode;
exports.handoffVerification = exports.parsedArgs.handoffVerification;
exports.invalidAgentTargets = exports.parsedArgs.invalidAgentTargets;
exports.issueBodyFile = exports.parsedArgs.issueBodyFile;
exports.issueCreateMode = exports.parsedArgs.issueCreateMode;
exports.issueDraftMode = exports.parsedArgs.issueDraftMode;
exports.issueDraftTitle = exports.parsedArgs.issueDraftTitle;
exports.linkCheckMode = exports.parsedArgs.linkCheckMode;
exports.lintMode = exports.parsedArgs.lintMode;
exports.missingValueOptions = exports.parsedArgs.missingValueOptions;
exports.noGitConfigMode = exports.parsedArgs.noGitConfigMode;
exports.pruneCheckMode = exports.parsedArgs.pruneCheckMode;
exports.pruneCheckStrictMode = exports.parsedArgs.pruneCheckStrictMode;
exports.qualityCheckMode = exports.parsedArgs.qualityCheckMode;
exports.queryTerm = exports.parsedArgs.queryTerm;
exports.refreshIndexMode = exports.parsedArgs.refreshIndexMode;
exports.unexpectedValueOptions = exports.parsedArgs.unexpectedValueOptions;
exports.unknownCommand = exports.parsedArgs.unknownCommand;
exports.unknownOptions = exports.parsedArgs.unknownOptions;
exports.wikiImpactMode = exports.parsedArgs.wikiImpactMode;
exports.wikiImpactTarget = exports.parsedArgs.wikiImpactTarget;
exports.wikiNeighborhoodMode = exports.parsedArgs.wikiNeighborhoodMode;
exports.wikiNeighborhoodTarget = exports.parsedArgs.wikiNeighborhoodTarget;
function argValue(name) {
    return argValueFrom(exports.commandArgs, name);
}
function argValues(name) {
    return argValuesFrom(exports.commandArgs, name);
}
