"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeEvidenceNodeRuntimeRequirement = void 0;
exports.loadDatabaseSync = loadDatabaseSync;
exports.openDatabase = openDatabase;
exports.codeEvidenceNodeRuntimeRequirement = "Node.js 22.13+ or 24+; node:sqlite was added in Node.js 22.5.0 and became available without --experimental-sqlite in Node.js 22.13.0";
function loadDatabaseSync(fail) {
    const previousListeners = process.listeners("warning");
    const suppressExperimentalSqliteWarning = (warning) => {
        if (warning.name !== "ExperimentalWarning" || !warning.message.includes("SQLite")) {
            for (const listener of previousListeners)
                listener.call(process, warning);
        }
    };
    try {
        process.removeAllListeners("warning");
        process.on("warning", suppressExperimentalSqliteWarning);
        const sqlite = require("node:sqlite");
        return sqlite.DatabaseSync;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`code evidence index requires Node.js 22.13+ because it uses node:sqlite without experimental flags; current Node is ${process.version}. Runtime policy: ${exports.codeEvidenceNodeRuntimeRequirement}. Error: ${message}`);
    }
    finally {
        process.removeAllListeners("warning");
        for (const listener of previousListeners)
            process.on("warning", listener);
    }
}
function openDatabase(databasePath, fail) {
    const DatabaseSync = loadDatabaseSync(fail);
    return new DatabaseSync(databasePath);
}
