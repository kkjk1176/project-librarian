"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeEvidenceNodeRuntimeRequirement = void 0;
exports.loadDatabaseSync = loadDatabaseSync;
exports.openDatabase = openDatabase;
exports.codeEvidenceNodeRuntimeRequirement = "Node.js 22.13+ or 24+; node:sqlite was added in Node.js 22.5.0 and became available without --experimental-sqlite in Node.js 22.13.0";
function warningType(option) {
    if (typeof option === "string")
        return option;
    if (typeof option !== "object" || option === null || !("type" in option))
        return "";
    const value = option.type;
    return typeof value === "string" ? value : "";
}
function isSqliteExperimentalWarning(warning, options) {
    const message = warning instanceof Error ? warning.message : typeof warning === "string" ? warning : "";
    const type = warning instanceof Error ? warning.name : warningType(options[0]);
    return type === "ExperimentalWarning" && message.includes("SQLite");
}
function loadDatabaseSync(fail) {
    const previousEmitWarning = process.emitWarning;
    try {
        process.emitWarning = ((warning, ...options) => {
            if (isSqliteExperimentalWarning(warning, options))
                return;
            previousEmitWarning.call(process, warning, ...options);
        });
        const sqlite = require("node:sqlite");
        return sqlite.DatabaseSync;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`code evidence index requires Node.js 22.13+ because it uses node:sqlite without experimental flags; current Node is ${process.version}. Runtime policy: ${exports.codeEvidenceNodeRuntimeRequirement}. Error: ${message}`);
    }
    finally {
        process.emitWarning = previousEmitWarning;
    }
}
function openDatabase(databasePath, fail) {
    const DatabaseSync = loadDatabaseSync(fail);
    return new DatabaseSync(databasePath);
}
