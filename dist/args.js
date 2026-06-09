"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueDraftTitle = exports.issueBodyFile = exports.captureCategory = exports.captureContent = exports.captureTitle = exports.codeIndexScopes = exports.codeIndexOutput = exports.codeSearchSymbol = exports.codeQuerySql = exports.queryTerm = exports.codeSearchSymbolMode = exports.codeQueryMode = exports.codeFilesMode = exports.codeStatusMode = exports.codeReportMode = exports.codeIndexMode = exports.noGitConfigMode = exports.reviewMigrationMode = exports.pruneCheckMode = exports.captureInboxMode = exports.refreshIndexMode = exports.issueDraftMode = exports.issueCreateMode = exports.glossaryMode = exports.fixMode = exports.doctorMode = exports.qualityCheckMode = exports.linkCheckMode = exports.lintMode = exports.migrateMode = exports.missingValueOptions = exports.unknownOptions = exports.args = exports.commandArgs = exports.command = exports.unknownCommand = exports.helpMode = exports.rawArgs = void 0;
exports.argValue = argValue;
exports.argValues = argValues;
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "install-skill"]);
exports.helpMode = exports.rawArgs.includes("--help") || exports.rawArgs.includes("-h");
exports.unknownCommand = exports.rawArgs[0] && !exports.rawArgs[0].startsWith("-") && !knownCommands.has(exports.rawArgs[0]) ? exports.rawArgs[0] : "";
exports.command = knownCommands.has(exports.rawArgs[0] ?? "") ? exports.rawArgs[0] : "init";
exports.commandArgs = exports.command === exports.rawArgs[0] ? exports.rawArgs.slice(1) : exports.rawArgs;
exports.args = new Set(exports.commandArgs);
const flagsWithoutValues = new Set([
    "--adopt-existing",
    "--capture-inbox",
    "--code-evidence-files",
    "--code-evidence-index",
    "--code-evidence-status",
    "--code-files",
    "--code-index",
    "--code-report",
    "--code-status",
    "--code-evidence-report",
    "--dry-run",
    "--glossary-init",
    "--doctor",
    "--fix",
    "--issue-create",
    "--issue-draft",
    "--link-check",
    "--lint",
    "--migrate",
    "--no-git-config",
    "--prune-check",
    "--quality-check",
    "--refresh-index",
    "--review-migration",
    "--semantic-migrate",
]);
const flagsWithValues = new Set([
    "--agents",
    "--category",
    "--code-evidence-out",
    "--code-evidence-query",
    "--code-evidence-scope",
    "--code-evidence-symbol",
    "--code-index-out",
    "--code-query",
    "--code-scope",
    "--code-search-symbol",
    "--content",
    "--issue-body-file",
    "--issue-title",
    "--query",
    "--scope",
    "--title",
]);
const knownFlags = new Set([...flagsWithoutValues, ...flagsWithValues, "--help", "-h"]);
function flagName(arg) {
    return arg.startsWith("--") ? arg.split("=", 1)[0] ?? arg : arg;
}
function hasFlag(name) {
    const prefix = `${name}=`;
    return exports.commandArgs.some((arg) => arg === name || arg.startsWith(prefix));
}
function flagHasValue(name) {
    const prefix = `${name}=`;
    for (let index = 0; index < exports.commandArgs.length; index += 1) {
        const arg = exports.commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix))
            return arg.slice(prefix.length).trim().length > 0;
        if (arg === name) {
            const next = exports.commandArgs[index + 1];
            return Boolean(next && !next.startsWith("-"));
        }
    }
    return true;
}
exports.unknownOptions = Array.from(new Set(exports.commandArgs
    .filter((arg) => arg.startsWith("-"))
    .map(flagName)
    .filter((arg) => !knownFlags.has(arg))));
exports.missingValueOptions = Array.from(flagsWithValues).filter((flag) => hasFlag(flag) && !flagHasValue(flag));
exports.migrateMode = exports.args.has("--migrate") || exports.args.has("--adopt-existing");
exports.lintMode = exports.args.has("--lint");
exports.linkCheckMode = exports.args.has("--link-check");
exports.qualityCheckMode = exports.args.has("--quality-check");
exports.doctorMode = exports.args.has("--doctor");
exports.fixMode = exports.args.has("--fix");
exports.glossaryMode = exports.args.has("--glossary-init");
exports.issueCreateMode = exports.args.has("--issue-create");
exports.issueDraftMode = exports.args.has("--issue-draft");
exports.refreshIndexMode = exports.args.has("--refresh-index");
exports.captureInboxMode = exports.args.has("--capture-inbox");
exports.pruneCheckMode = exports.args.has("--prune-check");
exports.reviewMigrationMode = exports.args.has("--review-migration") || exports.args.has("--semantic-migrate");
exports.noGitConfigMode = exports.args.has("--no-git-config");
exports.codeIndexMode = exports.args.has("--code-index") || exports.args.has("--code-evidence-index");
exports.codeReportMode = exports.args.has("--code-report") || exports.args.has("--code-evidence-report");
exports.codeStatusMode = exports.args.has("--code-status") || exports.args.has("--code-evidence-status");
exports.codeFilesMode = exports.args.has("--code-files") || exports.args.has("--code-evidence-files");
exports.codeQueryMode = hasFlag("--code-query") || hasFlag("--code-evidence-query");
exports.codeSearchSymbolMode = hasFlag("--code-search-symbol") || hasFlag("--code-evidence-symbol");
function argValue(name) {
    const prefix = `${name}=`;
    const inline = exports.commandArgs.find((arg) => arg.startsWith(prefix));
    if (inline)
        return inline.slice(prefix.length);
    const index = exports.commandArgs.indexOf(name);
    const next = index >= 0 ? exports.commandArgs[index + 1] : undefined;
    if (next && !next.startsWith("--")) {
        return next;
    }
    return "";
}
function argValues(name) {
    const prefix = `${name}=`;
    const values = [];
    for (let index = 0; index < exports.commandArgs.length; index += 1) {
        const arg = exports.commandArgs[index];
        if (!arg)
            continue;
        if (arg.startsWith(prefix)) {
            values.push(arg.slice(prefix.length));
        }
        else if (arg === name) {
            const next = exports.commandArgs[index + 1];
            if (next && !next.startsWith("--"))
                values.push(next);
        }
    }
    return values.flatMap((value) => value.split(",").map((part) => part.trim()).filter(Boolean));
}
exports.queryTerm = argValue("--query");
exports.codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
exports.codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
exports.codeIndexOutput = argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite";
exports.codeIndexScopes = [...argValues("--code-scope"), ...argValues("--code-evidence-scope")];
exports.captureTitle = argValue("--title");
exports.captureContent = argValue("--content");
exports.captureCategory = argValue("--category") || "project-candidate";
exports.issueBodyFile = argValue("--issue-body-file");
exports.issueDraftTitle = argValue("--issue-title");
