"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeImpactTarget = exports.codeContextPackTarget = exports.wikiVisualizeOutput = exports.wikiVisualizeMode = exports.wikiImpactTarget = exports.wikiImpactMode = exports.queryTerm = exports.codeSearchSymbolMode = exports.codeQueryMode = exports.codeImpactMode = exports.codeParserMode = exports.codeContextPackMode = exports.codeFilesMode = exports.codeStatusMode = exports.codeReportMode = exports.codeIndexHealthMode = exports.codeIndexFullMode = exports.codeIndexIncrementalMode = exports.codeIndexMode = exports.acknowledgeSmallRepoMode = exports.noGitConfigMode = exports.reviewMigrationMode = exports.pruneCheckStrictMode = exports.pruneCheckMode = exports.captureInboxMode = exports.refreshIndexMode = exports.issueDraftMode = exports.issueCreateMode = exports.glossaryMode = exports.fixMode = exports.doctorMode = exports.qualityCheckMode = exports.linkCheckMode = exports.migrationQualityCheckMode = exports.migrationLintMode = exports.migrationDoctorMode = exports.lintMode = exports.migrateMode = exports.invalidAgentTargets = exports.missingValueOptions = exports.unexpectedValueOptions = exports.unknownOptions = exports.args = exports.commandArgs = exports.command = exports.unknownCommand = exports.helpMode = exports.agentTargets = exports.parsedArgs = exports.rawArgs = void 0;
exports.issueDraftTitle = exports.issueBodyFile = exports.captureCategory = exports.captureContent = exports.captureTitle = exports.codeIndexScopes = exports.codeParser = exports.codeIndexOutput = exports.codeSearchSymbol = exports.codeReportSection = exports.codeQuerySql = void 0;
exports.parseArgs = parseArgs;
exports.argValue = argValue;
exports.argValues = argValues;
const agent_surfaces_1 = require("./agent-surfaces");
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "update", "install", "install-skill", "mcp"]);
const flagDefinitions = [
    { name: "--acknowledge-small-repo", value: "none" },
    { name: "--adopt-existing", value: "none" },
    { name: "--agents", value: "value" },
    { name: "--capture-inbox", value: "none" },
    { name: "--category", value: "value" },
    { name: "--code-context-pack", value: "value", aliases: ["--code-evidence-context-pack"] },
    { name: "--code-files", value: "none", aliases: ["--code-evidence-files"] },
    { name: "--code-impact", value: "value", aliases: ["--code-evidence-impact"] },
    { name: "--code-index", value: "none", aliases: ["--code-evidence-index"] },
    { name: "--code-index-full", value: "none", aliases: ["--code-evidence-index-full"] },
    { name: "--code-index-health", value: "none" },
    { name: "--code-index-incremental", value: "none", aliases: ["--incremental", "--code-incremental", "--code-evidence-index-incremental"] },
    { name: "--code-index-out", value: "value", aliases: ["--code-evidence-out"] },
    { name: "--code-parser", value: "value", aliases: ["--code-evidence-parser"] },
    { name: "--code-query", value: "value", aliases: ["--code-evidence-query"] },
    { name: "--code-report", value: "none", aliases: ["--code-evidence-report"] },
    { name: "--code-report-section", value: "value", aliases: ["--code-evidence-report-section"] },
    { name: "--code-scope", value: "value", aliases: ["--code-evidence-scope"] },
    { name: "--code-search-symbol", value: "value", aliases: ["--code-evidence-symbol"] },
    { name: "--code-status", value: "none", aliases: ["--code-evidence-status"] },
    { name: "--content", value: "value" },
    { name: "--doctor", value: "none" },
    { name: "--dry-run", value: "none" },
    { name: "--fix", value: "none" },
    { name: "--glossary-init", value: "none" },
    { name: "--issue-body-file", value: "value" },
    { name: "--issue-create", value: "none" },
    { name: "--issue-draft", value: "none" },
    { name: "--issue-title", value: "value" },
    { name: "--link-check", value: "none" },
    { name: "--lint", value: "none" },
    { name: "--migrate", value: "none" },
    { name: "--migration-doctor", value: "none" },
    { name: "--migration-lint", value: "none" },
    { name: "--migration-quality-check", value: "none" },
    { name: "--no-git-config", value: "none" },
    { name: "--prune-check", value: "none" },
    { name: "--prune-check-strict", value: "none" },
    { name: "--quality-check", value: "none" },
    { name: "--query", value: "value" },
    { name: "--refresh-index", value: "none" },
    { name: "--review-migration", value: "none", aliases: ["--semantic-migrate"] },
    { name: "--scope", value: "value" },
    { name: "--title", value: "value" },
    { name: "--wiki-graph-html", value: "none" },
    { name: "--wiki-impact", value: "value" },
    { name: "--wiki-visualize", value: "none" },
    { name: "--wiki-visualize-out", value: "value" },
];
function definitionNames(definition) {
    return [definition.name, ...(definition.aliases ?? [])];
}
function flagNamesByPolicy(value) {
    return flagDefinitions.filter((definition) => definition.value === value).flatMap(definitionNames);
}
function namesForFlag(name) {
    const definition = flagDefinitions.find((candidate) => definitionNames(candidate).includes(name));
    return definition ? definitionNames(definition) : [name];
}
const flagsWithoutValues = new Set(flagNamesByPolicy("none"));
const flagsWithValues = new Set(flagNamesByPolicy("value"));
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
    if (next && !next.startsWith("--")) {
        return next;
    }
    return "";
}
function argValuesFrom(commandArgs, name) {
    const prefix = `${name}=`;
    const values = [];
    for (let index = 0; index < commandArgs.length; index += 1) {
        const arg = commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix)) {
            values.push(arg.slice(prefix.length));
        }
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
    const hasAnyFlag = (name) => namesForFlag(name).some(hasFlag);
    const argValueFromAny = (name) => namesForFlag(name).map(argValue).find(Boolean) ?? "";
    const argValuesFromAny = (name) => namesForFlag(name).flatMap(argValues);
    const codeImpactTarget = argValueFromAny("--code-impact");
    const codeContextPackTarget = argValueFromAny("--code-context-pack");
    const codeQuerySql = argValueFromAny("--code-query");
    const codeSearchSymbol = argValueFromAny("--code-search-symbol");
    const parsedAgentTargets = (0, agent_surfaces_1.parseAgentSurfaceValues)(argValues("--agents"));
    return {
        acknowledgeSmallRepoMode: args.has("--acknowledge-small-repo"),
        agentTargets: parsedAgentTargets.surfaces,
        args,
        captureCategory: argValue("--category") || "project-candidate",
        captureContent: argValue("--content"),
        captureInboxMode: args.has("--capture-inbox"),
        captureTitle: argValue("--title"),
        codeContextPackMode: hasAnyFlag("--code-context-pack"),
        codeContextPackTarget,
        codeFilesMode: hasAnyFlag("--code-files"),
        codeImpactMode: hasAnyFlag("--code-impact"),
        codeImpactTarget,
        codeIndexFullMode: hasAnyFlag("--code-index-full"),
        codeIndexHealthMode: args.has("--code-index-health"),
        codeIndexIncrementalMode: hasAnyFlag("--code-index-incremental"),
        codeIndexMode: hasAnyFlag("--code-index"),
        codeIndexOutput: argValueFromAny("--code-index-out") || ".project-wiki/code-evidence.sqlite",
        codeIndexScopes: argValuesFromAny("--code-scope"),
        codeParser: argValueFromAny("--code-parser") || "default",
        codeParserMode: hasAnyFlag("--code-parser"),
        codeQueryMode: hasAnyFlag("--code-query"),
        codeQuerySql,
        codeReportMode: hasAnyFlag("--code-report"),
        codeReportSection: argValueFromAny("--code-report-section"),
        codeSearchSymbol,
        codeSearchSymbolMode: hasAnyFlag("--code-search-symbol"),
        codeStatusMode: hasAnyFlag("--code-status"),
        command,
        commandArgs,
        doctorMode: args.has("--doctor"),
        fixMode: args.has("--fix"),
        glossaryMode: args.has("--glossary-init"),
        helpMode: argv.includes("--help") || argv.includes("-h"),
        issueBodyFile: argValue("--issue-body-file"),
        issueCreateMode: args.has("--issue-create"),
        issueDraftMode: args.has("--issue-draft"),
        issueDraftTitle: argValue("--issue-title"),
        invalidAgentTargets: parsedAgentTargets.invalid,
        linkCheckMode: args.has("--link-check"),
        lintMode: args.has("--lint"),
        migrationDoctorMode: args.has("--migration-doctor"),
        migrationLintMode: args.has("--migration-lint"),
        migrationQualityCheckMode: args.has("--migration-quality-check"),
        migrateMode: args.has("--migrate") || args.has("--adopt-existing"),
        missingValueOptions: Array.from(flagsWithValues).filter((flag) => hasFlag(flag) && !flagHasValue(commandArgs, flag)),
        noGitConfigMode: args.has("--no-git-config"),
        pruneCheckMode: args.has("--prune-check"),
        pruneCheckStrictMode: args.has("--prune-check-strict"),
        qualityCheckMode: args.has("--quality-check"),
        queryTerm: argValue("--query"),
        rawArgs: argv,
        refreshIndexMode: args.has("--refresh-index"),
        reviewMigrationMode: hasAnyFlag("--review-migration"),
        unexpectedValueOptions: Array.from(new Set(commandArgs
            .filter((arg) => arg.startsWith("--") && arg.includes("="))
            .map(flagName)
            .filter((arg) => flagsWithoutValues.has(arg)))),
        unknownCommand: argv[0] && !argv[0].startsWith("-") && !knownCommands.has(argv[0]) ? argv[0] : "",
        unknownOptions: Array.from(new Set(commandArgs
            .filter((arg) => arg.startsWith("-"))
            .map(flagName)
            .filter((arg) => !knownFlags.has(arg)))),
        wikiImpactMode: hasFlag("--wiki-impact"),
        wikiImpactTarget: argValue("--wiki-impact"),
        wikiVisualizeMode: hasFlag("--wiki-visualize") || hasFlag("--wiki-graph-html"),
        wikiVisualizeOutput: argValue("--wiki-visualize-out"),
    };
}
exports.parsedArgs = parseArgs(exports.rawArgs);
exports.agentTargets = exports.parsedArgs.agentTargets;
exports.helpMode = exports.parsedArgs.helpMode;
exports.unknownCommand = exports.parsedArgs.unknownCommand;
exports.command = exports.parsedArgs.command;
exports.commandArgs = exports.parsedArgs.commandArgs;
exports.args = exports.parsedArgs.args;
exports.unknownOptions = exports.parsedArgs.unknownOptions;
exports.unexpectedValueOptions = exports.parsedArgs.unexpectedValueOptions;
exports.missingValueOptions = exports.parsedArgs.missingValueOptions;
exports.invalidAgentTargets = exports.parsedArgs.invalidAgentTargets;
exports.migrateMode = exports.parsedArgs.migrateMode;
exports.lintMode = exports.parsedArgs.lintMode;
exports.migrationDoctorMode = exports.parsedArgs.migrationDoctorMode;
exports.migrationLintMode = exports.parsedArgs.migrationLintMode;
exports.migrationQualityCheckMode = exports.parsedArgs.migrationQualityCheckMode;
exports.linkCheckMode = exports.parsedArgs.linkCheckMode;
exports.qualityCheckMode = exports.parsedArgs.qualityCheckMode;
exports.doctorMode = exports.parsedArgs.doctorMode;
exports.fixMode = exports.parsedArgs.fixMode;
exports.glossaryMode = exports.parsedArgs.glossaryMode;
exports.issueCreateMode = exports.parsedArgs.issueCreateMode;
exports.issueDraftMode = exports.parsedArgs.issueDraftMode;
exports.refreshIndexMode = exports.parsedArgs.refreshIndexMode;
exports.captureInboxMode = exports.parsedArgs.captureInboxMode;
exports.pruneCheckMode = exports.parsedArgs.pruneCheckMode;
exports.pruneCheckStrictMode = exports.parsedArgs.pruneCheckStrictMode;
exports.reviewMigrationMode = exports.parsedArgs.reviewMigrationMode;
exports.noGitConfigMode = exports.parsedArgs.noGitConfigMode;
exports.acknowledgeSmallRepoMode = exports.parsedArgs.acknowledgeSmallRepoMode;
exports.codeIndexMode = exports.parsedArgs.codeIndexMode;
exports.codeIndexIncrementalMode = exports.parsedArgs.codeIndexIncrementalMode;
exports.codeIndexFullMode = exports.parsedArgs.codeIndexFullMode;
exports.codeIndexHealthMode = exports.parsedArgs.codeIndexHealthMode;
exports.codeReportMode = exports.parsedArgs.codeReportMode;
exports.codeStatusMode = exports.parsedArgs.codeStatusMode;
exports.codeFilesMode = exports.parsedArgs.codeFilesMode;
exports.codeContextPackMode = exports.parsedArgs.codeContextPackMode;
exports.codeParserMode = exports.parsedArgs.codeParserMode;
exports.codeImpactMode = exports.parsedArgs.codeImpactMode;
exports.codeQueryMode = exports.parsedArgs.codeQueryMode;
exports.codeSearchSymbolMode = exports.parsedArgs.codeSearchSymbolMode;
function argValue(name) {
    return argValueFrom(exports.commandArgs, name);
}
function argValues(name) {
    return argValuesFrom(exports.commandArgs, name);
}
exports.queryTerm = exports.parsedArgs.queryTerm;
exports.wikiImpactMode = exports.parsedArgs.wikiImpactMode;
exports.wikiImpactTarget = exports.parsedArgs.wikiImpactTarget;
exports.wikiVisualizeMode = exports.parsedArgs.wikiVisualizeMode;
exports.wikiVisualizeOutput = exports.parsedArgs.wikiVisualizeOutput;
exports.codeContextPackTarget = exports.parsedArgs.codeContextPackTarget;
exports.codeImpactTarget = exports.parsedArgs.codeImpactTarget;
exports.codeQuerySql = exports.parsedArgs.codeQuerySql;
exports.codeReportSection = exports.parsedArgs.codeReportSection;
exports.codeSearchSymbol = exports.parsedArgs.codeSearchSymbol;
exports.codeIndexOutput = exports.parsedArgs.codeIndexOutput;
exports.codeParser = exports.parsedArgs.codeParser;
exports.codeIndexScopes = exports.parsedArgs.codeIndexScopes;
exports.captureTitle = exports.parsedArgs.captureTitle;
exports.captureContent = exports.parsedArgs.captureContent;
exports.captureCategory = exports.parsedArgs.captureCategory;
exports.issueBodyFile = exports.parsedArgs.issueBodyFile;
exports.issueDraftTitle = exports.parsedArgs.issueDraftTitle;
