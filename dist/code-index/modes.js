"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCodeIndexMode = runCodeIndexMode;
exports.runCodeQueryMode = runCodeQueryMode;
exports.runCodeReportMode = runCodeReportMode;
exports.runCodeStatusMode = runCodeStatusMode;
exports.runCodeFilesMode = runCodeFilesMode;
exports.runCodeImpactMode = runCodeImpactMode;
exports.runCodeContextPackMode = runCodeContextPackMode;
exports.runCodeSearchSymbolMode = runCodeSearchSymbolMode;
exports.isCodeEvidenceModeFor = isCodeEvidenceModeFor;
exports.isCodeEvidenceMode = isCodeEvidenceMode;
const fs = __importStar(require("node:fs"));
const args_1 = require("../args");
const code_index_file_policy_1 = require("../code-index-file-policy");
const code_index_sql_1 = require("../code-index-sql");
const incremental_1 = require("./incremental");
const reports_1 = require("./reports");
const schema_1 = require("./schema");
const search_1 = require("./search");
function printRows(rows) {
    console.log(JSON.stringify(rows, null, 2));
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
function runCodeIndexMode(runtime) {
    const databasePath = runtime.codeEvidenceDatabasePath();
    const scopes = runtime.codeScopes();
    const parserMode = runtime.selectedCodeParserMode();
    // Scale gate before ANY write or database work: below the measured threshold
    // the build halts with the evidence-citing warning unless --acknowledge-small-repo
    // was passed (2026-06-12 scale-aware guidance decision).
    const discoveredFiles = (0, code_index_file_policy_1.discoverCodeFiles)(scopes);
    const scaleGate = (0, code_index_file_policy_1.smallRepoCodeIndexGate)(discoveredFiles.length, args_1.acknowledgeSmallRepoMode);
    if (!scaleGate.proceed)
        runtime.fail(scaleGate.warning);
    const existingIndex = fs.existsSync(databasePath.absolutePath);
    if (args_1.codeIndexIncrementalMode && !existingIndex) {
        runtime.fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
    }
    let incremental = false;
    if (existingIndex && !args_1.codeIndexFullMode) {
        let compatibility = { compatible: false, reason: "compatibility was not checked" };
        const existingDatabase = runtime.openDatabase(databasePath.absolutePath);
        try {
            compatibility = (0, schema_1.incrementalCompatibility)(existingDatabase, scopes, parserMode);
        }
        finally {
            existingDatabase.close();
        }
        incremental = !args_1.codeIndexFullMode && compatibility.compatible;
        if (args_1.codeIndexIncrementalMode && !compatibility.compatible)
            runtime.fail(`--incremental cannot update ${databasePath.relativePath}: ${compatibility.reason}`);
    }
    runtime.prepareOutputPath();
    if (!incremental)
        runtime.removeDatabaseFiles(databasePath.absolutePath);
    const database = runtime.openDatabase(databasePath.absolutePath);
    try {
        if (!incremental)
            (0, schema_1.setupDatabase)(database);
        const statements = (0, schema_1.createIndexStatements)(database);
        const currentFiles = discoveredFiles.map((filePath) => runtime.readCodeFile(filePath, parserMode));
        const indexed = incremental ? new Map(database.prepare("SELECT path, hash FROM files").all().map((row) => [String(row.path), String(row.hash)])) : new Map();
        const updatePlan = (0, incremental_1.planIndexUpdate)(currentFiles, indexed);
        const deletedPaths = incremental ? updatePlan.deletedPaths : [];
        const reindexedFiles = incremental ? updatePlan.reindexedFiles : currentFiles;
        const unchangedFiles = incremental ? updatePlan.unchangedFiles : 0;
        database.exec("BEGIN");
        if (!incremental)
            statements.insertMeta.run("created_at", new Date().toISOString());
        (0, schema_1.writeIndexMetadata)(scopes, parserMode, statements);
        for (const filePath of deletedPaths)
            (0, schema_1.removeIndexedFile)(filePath, statements);
        for (const file of reindexedFiles) {
            if (incremental && indexed.has(file.path))
                (0, schema_1.removeIndexedFile)(file.path, statements);
            runtime.indexCodeFile(file, statements);
        }
        database.exec("COMMIT");
        console.log("Project wiki code evidence index complete.");
        console.log(`database: ${databasePath.relativePath}`);
        console.log(`mode: ${incremental ? "incremental" : "full"}`);
        console.log(`parser_mode: ${parserMode}`);
        console.log(`scopes: ${scopes.join(", ")}`);
        console.log(`files: ${currentFiles.length}`);
        console.log(`reindexed_files: ${reindexedFiles.length}`);
        console.log(`deleted_files: ${deletedPaths.length}`);
        console.log(`unchanged_files: ${unchangedFiles}`);
    }
    catch (error) {
        try {
            database.exec("ROLLBACK");
        }
        catch {
            // Ignore rollback failures after setup errors.
        }
        throw error;
    }
    finally {
        database.close();
    }
}
function runCodeQueryMode(runtime) {
    if (!args_1.codeQuerySql.trim()) {
        console.error("missing SQL: use --code-query \"select ...\"");
        process.exit(1);
    }
    runtime.requireExistingIndex();
    if (!(0, code_index_sql_1.isReadOnlySql)(args_1.codeQuerySql)) {
        console.error("code queries must be read-only SQL starting with SELECT or WITH");
        process.exit(1);
    }
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        database.exec("PRAGMA query_only = ON");
        runtime.warnIfCodeIndexStale(database);
        printRows(database.prepare(args_1.codeQuerySql).all());
    }
    finally {
        database.close();
    }
}
function runCodeReportMode(runtime) {
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        const staleness = runtime.codeIndexStaleness(database);
        runtime.warnIfCodeIndexStale(database, staleness);
        const report = runtime.codeReportForRequestedSection(database, args_1.codeReportSection, { staleness });
        if (!report)
            runtime.fail((0, reports_1.invalidCodeReportSectionMessage)(args_1.codeReportSection));
        printJson(report);
    }
    finally {
        database.close();
    }
}
function runCodeStatusMode(runtime) {
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        const rows = database.prepare(`
      SELECT 'files' AS metric, count(*) AS value FROM files
      UNION ALL SELECT 'symbols', count(*) FROM symbols
      UNION ALL SELECT 'imports', count(*) FROM imports
      UNION ALL SELECT 'routes', count(*) FROM routes
      UNION ALL SELECT 'edges', count(*) FROM edges
      UNION ALL SELECT 'configs', count(*) FROM configs
    `).all();
        const staleness = runtime.codeIndexStaleness(database);
        rows.push({ metric: "stale_files", value: staleness.added + staleness.changed + staleness.deleted }, { metric: "stale_changed_files", value: staleness.changed }, { metric: "stale_added_files", value: staleness.added }, { metric: "stale_deleted_files", value: staleness.deleted });
        printRows(rows);
    }
    finally {
        database.close();
    }
}
function runCodeFilesMode(runtime) {
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        runtime.warnIfCodeIndexStale(database);
        printRows(database.prepare("SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path").all());
    }
    finally {
        database.close();
    }
}
function runCodeImpactMode(runtime) {
    if (!args_1.codeImpactTarget.trim()) {
        console.error("missing impact target: use --code-impact \"path-or-symbol-or-module\"");
        process.exit(1);
    }
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        const staleness = runtime.codeIndexStaleness(database);
        runtime.warnIfCodeIndexStale(database, staleness);
        printJson(runtime.codeImpact(database, args_1.codeImpactTarget.trim(), { staleness }));
    }
    finally {
        database.close();
    }
}
function runCodeContextPackMode(runtime) {
    if (!args_1.codeContextPackTarget.trim()) {
        console.error("missing context pack query: use --code-context-pack \"path-or-symbol-or-route\"");
        process.exit(1);
    }
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        const staleness = runtime.codeIndexStaleness(database);
        runtime.warnIfCodeIndexStale(database, staleness);
        console.log(runtime.codeContextPack(database, args_1.codeContextPackTarget.trim(), { staleness }));
    }
    finally {
        database.close();
    }
}
function runCodeSearchSymbolMode(runtime) {
    if (!args_1.codeSearchSymbol.trim()) {
        console.error("missing symbol search term: use --code-search-symbol \"term\"");
        process.exit(1);
    }
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        runtime.warnIfCodeIndexStale(database);
        printRows((0, search_1.searchSymbols)(database, args_1.codeSearchSymbol.trim()));
    }
    finally {
        database.close();
    }
}
function isCodeEvidenceModeFor(flags) {
    return Boolean(flags.codeContextPackTarget)
        || flags.codeIndexMode
        || Boolean(flags.codeQuerySql)
        || flags.codeReportMode
        || flags.codeStatusMode
        || flags.codeFilesMode
        || flags.codeImpactMode
        || Boolean(flags.codeSearchSymbol);
}
function isCodeEvidenceMode() {
    return isCodeEvidenceModeFor({ codeContextPackTarget: args_1.codeContextPackTarget, codeFilesMode: args_1.codeFilesMode, codeImpactMode: args_1.codeImpactMode, codeIndexMode: args_1.codeIndexMode, codeQuerySql: args_1.codeQuerySql, codeReportMode: args_1.codeReportMode, codeSearchSymbol: args_1.codeSearchSymbol, codeStatusMode: args_1.codeStatusMode });
}
