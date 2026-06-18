"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeSearchSymbol = exports.codeReportSection = exports.codeQuerySql = exports.codeImpactTarget = exports.codeContextPackTarget = exports.wikiVisualizeOutput = exports.wikiVisualizeMode = exports.wikiImpactTarget = exports.wikiImpactMode = exports.queryTerm = exports.codeSearchSymbolMode = exports.codeQueryMode = exports.codeImpactMode = exports.codeParserMode = exports.codeContextPackMode = exports.codeFilesMode = exports.codeStatusMode = exports.codeReportMode = exports.codeIndexHealthMode = exports.codeIndexFullMode = exports.codeIndexIncrementalMode = exports.codeIndexMode = exports.acknowledgeSmallRepoMode = exports.noGitConfigMode = exports.reviewMigrationMode = exports.pruneCheckMode = exports.captureInboxMode = exports.refreshIndexMode = exports.issueDraftMode = exports.issueCreateMode = exports.glossaryMode = exports.fixMode = exports.doctorMode = exports.qualityCheckMode = exports.linkCheckMode = exports.migrationQualityCheckMode = exports.migrationLintMode = exports.migrationDoctorMode = exports.lintMode = exports.migrateMode = exports.missingValueOptions = exports.unexpectedValueOptions = exports.unknownOptions = exports.args = exports.commandArgs = exports.command = exports.unknownCommand = exports.helpMode = exports.parsedArgs = exports.rawArgs = void 0;
exports.issueDraftTitle = exports.issueBodyFile = exports.captureCategory = exports.captureContent = exports.captureTitle = exports.codeIndexScopes = exports.codeParser = exports.codeIndexOutput = void 0;
exports.parseArgs = parseArgs;
exports.argValue = argValue;
exports.argValues = argValues;
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "update", "install-skill", "mcp"]);
const flagsWithoutValues = new Set([
    "--acknowledge-small-repo",
    "--adopt-existing",
    "--capture-inbox",
    "--code-evidence-files",
    "--code-evidence-index",
    "--code-evidence-status",
    "--code-files",
    "--code-incremental",
    "--code-index",
    "--code-index-full",
    "--code-index-health",
    "--code-index-incremental",
    "--code-evidence-index-full",
    "--code-evidence-index-incremental",
    "--code-report",
    "--code-status",
    "--code-evidence-report",
    "--dry-run",
    "--glossary-init",
    "--doctor",
    "--fix",
    "--issue-create",
    "--issue-draft",
    "--incremental",
    "--link-check",
    "--lint",
    "--migrate",
    "--migration-doctor",
    "--migration-lint",
    "--migration-quality-check",
    "--no-git-config",
    "--prune-check",
    "--quality-check",
    "--refresh-index",
    "--review-migration",
    "--semantic-migrate",
    "--wiki-graph-html",
    "--wiki-visualize",
]);
const flagsWithValues = new Set([
    "--agents",
    "--category",
    "--code-evidence-context-pack",
    "--code-evidence-impact",
    "--code-context-pack",
    "--code-evidence-out",
    "--code-evidence-parser",
    "--code-evidence-query",
    "--code-evidence-report-section",
    "--code-evidence-scope",
    "--code-evidence-symbol",
    "--code-impact",
    "--code-index-out",
    "--code-parser",
    "--code-query",
    "--code-report-section",
    "--code-scope",
    "--code-search-symbol",
    "--content",
    "--issue-body-file",
    "--issue-title",
    "--query",
    "--scope",
    "--title",
    "--wiki-impact",
    "--wiki-visualize-out",
]);
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
    const codeImpactTarget = argValue("--code-impact") || argValue("--code-evidence-impact");
    const codeContextPackTarget = argValue("--code-context-pack") || argValue("--code-evidence-context-pack");
    const codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
    const codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
    return {
        acknowledgeSmallRepoMode: args.has("--acknowledge-small-repo"),
        args,
        captureCategory: argValue("--category") || "project-candidate",
        captureContent: argValue("--content"),
        captureInboxMode: args.has("--capture-inbox"),
        captureTitle: argValue("--title"),
        codeContextPackMode: hasFlag("--code-context-pack") || hasFlag("--code-evidence-context-pack"),
        codeContextPackTarget,
        codeFilesMode: args.has("--code-files") || args.has("--code-evidence-files"),
        codeImpactMode: hasFlag("--code-impact") || hasFlag("--code-evidence-impact"),
        codeImpactTarget,
        codeIndexFullMode: args.has("--code-index-full") || args.has("--code-evidence-index-full"),
        codeIndexHealthMode: args.has("--code-index-health"),
        codeIndexIncrementalMode: args.has("--incremental") || args.has("--code-incremental") || args.has("--code-index-incremental") || args.has("--code-evidence-index-incremental"),
        codeIndexMode: args.has("--code-index") || args.has("--code-evidence-index"),
        codeIndexOutput: argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite",
        codeIndexScopes: [...argValues("--code-scope"), ...argValues("--code-evidence-scope")],
        codeParser: argValue("--code-parser") || argValue("--code-evidence-parser") || "default",
        codeParserMode: hasFlag("--code-parser") || hasFlag("--code-evidence-parser"),
        codeQueryMode: hasFlag("--code-query") || hasFlag("--code-evidence-query"),
        codeQuerySql,
        codeReportMode: args.has("--code-report") || args.has("--code-evidence-report"),
        codeReportSection: argValue("--code-report-section") || argValue("--code-evidence-report-section"),
        codeSearchSymbol,
        codeSearchSymbolMode: hasFlag("--code-search-symbol") || hasFlag("--code-evidence-symbol"),
        codeStatusMode: args.has("--code-status") || args.has("--code-evidence-status"),
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
        linkCheckMode: args.has("--link-check"),
        lintMode: args.has("--lint"),
        migrationDoctorMode: args.has("--migration-doctor"),
        migrationLintMode: args.has("--migration-lint"),
        migrationQualityCheckMode: args.has("--migration-quality-check"),
        migrateMode: args.has("--migrate") || args.has("--adopt-existing"),
        missingValueOptions: Array.from(flagsWithValues).filter((flag) => hasFlag(flag) && !flagHasValue(commandArgs, flag)),
        noGitConfigMode: args.has("--no-git-config"),
        pruneCheckMode: args.has("--prune-check"),
        qualityCheckMode: args.has("--quality-check"),
        queryTerm: argValue("--query"),
        rawArgs: argv,
        refreshIndexMode: args.has("--refresh-index"),
        reviewMigrationMode: args.has("--review-migration") || args.has("--semantic-migrate"),
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
exports.helpMode = exports.parsedArgs.helpMode;
exports.unknownCommand = exports.parsedArgs.unknownCommand;
exports.command = exports.parsedArgs.command;
exports.commandArgs = exports.parsedArgs.commandArgs;
exports.args = exports.parsedArgs.args;
exports.unknownOptions = exports.parsedArgs.unknownOptions;
exports.unexpectedValueOptions = exports.parsedArgs.unexpectedValueOptions;
exports.missingValueOptions = exports.parsedArgs.missingValueOptions;
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
