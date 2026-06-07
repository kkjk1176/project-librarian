"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureCategory = exports.captureContent = exports.captureTitle = exports.queryTerm = exports.noGitConfigMode = exports.reviewMigrationMode = exports.pruneCheckMode = exports.captureInboxMode = exports.refreshIndexMode = exports.glossaryMode = exports.lintMode = exports.migrateMode = exports.args = exports.commandArgs = exports.command = exports.rawArgs = void 0;
exports.argValue = argValue;
exports.rawArgs = process.argv.slice(2);
const knownCommands = new Set(["init", "install-skill"]);
exports.command = knownCommands.has(exports.rawArgs[0] ?? "") ? exports.rawArgs[0] : "init";
exports.commandArgs = exports.command === exports.rawArgs[0] ? exports.rawArgs.slice(1) : exports.rawArgs;
exports.args = new Set(exports.commandArgs);
exports.migrateMode = exports.args.has("--migrate") || exports.args.has("--adopt-existing");
exports.lintMode = exports.args.has("--lint");
exports.glossaryMode = exports.args.has("--glossary-init");
exports.refreshIndexMode = exports.args.has("--refresh-index");
exports.captureInboxMode = exports.args.has("--capture-inbox");
exports.pruneCheckMode = exports.args.has("--prune-check");
exports.reviewMigrationMode = exports.args.has("--review-migration") || exports.args.has("--semantic-migrate");
exports.noGitConfigMode = exports.args.has("--no-git-config");
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
exports.queryTerm = argValue("--query");
exports.captureTitle = argValue("--title");
exports.captureContent = argValue("--content");
exports.captureCategory = argValue("--category") || "project-candidate";
