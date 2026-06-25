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
exports.resolveCodeIndexEngine = resolveCodeIndexEngine;
exports.runCodeIndexMode = runCodeIndexMode;
exports.runCodeQueryMode = runCodeQueryMode;
exports.runCodeReportMode = runCodeReportMode;
exports.runCodeStatusMode = runCodeStatusMode;
exports.runCodeIndexHealthMode = runCodeIndexHealthMode;
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
const reports_1 = require("./reports");
const schema_1 = require("./schema");
const search_1 = require("./search");
function printRows(rows) {
    console.log(JSON.stringify(rows, null, 2));
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
function requireCompatibleDatabase(database, runtime) {
    const schemaVersion = (0, schema_1.readMetaValue)(database, "schema_version");
    if (schemaVersion !== schema_1.codeIndexSchemaVersion) {
        const health = runtime.codeIndexHealth();
        const databasePath = runtime.codeEvidenceDatabasePath();
        runtime.fail([
            health.message,
            `inspect: project-librarian --code-index-health`,
            `rebuild: ${health.recommended_rebuild_command}`,
            `database: ${databasePath.relativePath}`,
        ].join("\n"));
    }
}
function elapsedMs(started) {
    return Number(process.hrtime.bigint() - started) / 1_000_000;
}
function measurePhase(timings, key, fn) {
    const started = process.hrtime.bigint();
    try {
        return fn();
    }
    finally {
        timings[key] = Number(((timings[key] ?? 0) + elapsedMs(started)).toFixed(3));
    }
}
function emitCodeIndexPhaseTimings(timings) {
    if (process.env.PROJECT_LIBRARIAN_CODE_INDEX_TIMINGS !== "1")
        return;
    console.error(`code_index_phase_timings ${JSON.stringify(timings)}`);
}
function configureBulkWriteConnection(database) {
    database.exec(`
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -20000;
  `);
}
function shouldUseNativeIncrementalForAuto(requestedEngine, runtime, staleFileCount) {
    if (requestedEngine !== "auto" || !args_1.codeIndexIncrementalMode)
        return false;
    if (staleFileCount <= 0 || !runtime.nativeCodeIndexAvailable())
        return false;
    return true;
}
function resolveCodeIndexEngine(requestedEngine, context, shouldUseNativeAuto, incrementalMode = args_1.codeIndexIncrementalMode) {
    if (requestedEngine !== "auto")
        return requestedEngine;
    if (incrementalMode)
        return "typescript";
    return shouldUseNativeAuto(context) ? "native-rust" : "typescript";
}
function runCodeIndexMode(runtime) {
    const totalStarted = process.hrtime.bigint();
    const phaseTimings = {};
    const databasePath = runtime.codeEvidenceDatabasePath();
    const scopes = runtime.codeScopes();
    const parserMode = runtime.selectedCodeParserMode();
    const requestedEngine = runtime.selectedCodeIndexEngine();
    // Scale gate before ANY write or database work: below the measured threshold
    // the build halts with the evidence-citing warning unless --acknowledge-small-repo
    // was passed (2026-06-12 scale-aware guidance decision).
    const discoveredFiles = measurePhase(phaseTimings, "discover_files_ms", () => (0, code_index_file_policy_1.discoverCodeFiles)(scopes));
    const scaleGate = (0, code_index_file_policy_1.smallRepoCodeIndexGate)(discoveredFiles.length, args_1.acknowledgeSmallRepoMode);
    if (!scaleGate.proceed)
        runtime.fail(scaleGate.warning);
    const engineSelectionContext = runtime.codeIndexEngineSelectionContext(discoveredFiles, parserMode);
    const engine = resolveCodeIndexEngine(requestedEngine, engineSelectionContext, runtime.shouldUseNativeCodeIndexAuto);
    if (engine === "native-rust") {
        if (!args_1.codeIndexIncrementalMode) {
            try {
                measurePhase(phaseTimings, "native_helper_ms", () => runtime.runNativeCodeIndexMode({ databasePath, discoveredFiles, parserMode, requestedEngine, scopes }));
                phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
                emitCodeIndexPhaseTimings(phaseTimings);
                return;
            }
            catch (error) {
                phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
                emitCodeIndexPhaseTimings(phaseTimings);
                throw error;
            }
        }
    }
    const existingIndex = fs.existsSync(databasePath.absolutePath);
    if (args_1.codeIndexIncrementalMode && !existingIndex) {
        runtime.fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
    }
    let incremental = false;
    if (existingIndex && !args_1.codeIndexFullMode) {
        let compatibility = { compatible: false, reason: "compatibility was not checked" };
        measurePhase(phaseTimings, "compatibility_ms", () => {
            const existingDatabase = runtime.openDatabase(databasePath.absolutePath);
            try {
                compatibility = (0, schema_1.incrementalCompatibility)(existingDatabase, scopes, parserMode);
            }
            finally {
                existingDatabase.close();
            }
        });
        incremental = !args_1.codeIndexFullMode && compatibility.compatible;
        if (args_1.codeIndexIncrementalMode && !compatibility.compatible)
            runtime.fail(`--incremental cannot update ${databasePath.relativePath}: ${compatibility.reason}`);
    }
    measurePhase(phaseTimings, "prepare_output_ms", () => {
        runtime.prepareOutputPath();
        if (!incremental)
            runtime.removeDatabaseFiles(databasePath.absolutePath);
    });
    let database = runtime.openDatabase(databasePath.absolutePath);
    try {
        if (!incremental)
            (0, schema_1.setupDatabase)(database, { secondaryIndexes: false });
        const currentFingerprints = measurePhase(phaseTimings, "fingerprints_ms", () => discoveredFiles.map((filePath) => runtime.readCodeFileFingerprint(filePath)));
        let reindexedFingerprints;
        let deletedPaths;
        let indexedPaths = new Set();
        let unchangedFiles = 0;
        if (incremental) {
            const indexedRows = database.prepare("SELECT path, hash, mtime_ms, size FROM files").all();
            indexedPaths = new Set(indexedRows.map((row) => String(row.path)));
            const indexed = new Map(indexedRows.map((row) => [String(row.path), {
                    hash: String(row.hash),
                    mtimeMs: Number(row.mtime_ms),
                    size: Number(row.size),
                }]));
            const currentPaths = new Set(currentFingerprints.map((file) => file.path));
            deletedPaths = indexedRows.map((row) => String(row.path)).filter((filePath) => !currentPaths.has(filePath));
            reindexedFingerprints = [];
            for (const file of currentFingerprints) {
                const existing = indexed.get(file.path);
                if (existing && existing.mtimeMs === file.mtimeMs && existing.size === file.size) {
                    unchangedFiles += 1;
                    continue;
                }
                reindexedFingerprints.push(file);
            }
        }
        else {
            deletedPaths = [];
            reindexedFingerprints = currentFingerprints;
        }
        const nativeIncrementalRequested = engine === "native-rust"
            || shouldUseNativeIncrementalForAuto(requestedEngine, runtime, reindexedFingerprints.length + deletedPaths.length);
        if (nativeIncrementalRequested) {
            if (!runtime.nativeCodeIndexAvailable()) {
                runtime.fail("--code-index-engine native-rust --incremental requires PROJECT_LIBRARIAN_NATIVE_INDEXER or a packaged native helper.");
            }
            if (!runtime.nativeCodeIndexIncrementalEligible(reindexedFingerprints, parserMode)) {
                if (engine === "native-rust") {
                    runtime.fail("--code-index-engine native-rust --incremental only supports native-eligible parser profiles; use --code-index-engine typescript for this incremental update.");
                }
            }
            else {
                database.close();
                database = undefined;
                measurePhase(phaseTimings, "native_helper_ms", () => runtime.runNativeCodeIndexIncrementalMode({
                    databasePath,
                    deletedPaths,
                    discoveredFiles,
                    parserMode,
                    requestedEngine,
                    reindexedFiles: reindexedFingerprints,
                    scopes,
                    unchangedFiles,
                }));
                phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
                emitCodeIndexPhaseTimings(phaseTimings);
                return;
            }
        }
        const reindexedFiles = measurePhase(phaseTimings, "read_files_ms", () => reindexedFingerprints.map((file) => runtime.readCodeFile(file.path, parserMode, file)));
        const activeDatabase = database;
        const statements = (0, schema_1.createIndexStatements)(activeDatabase);
        measurePhase(phaseTimings, "sqlite_write_ms", () => {
            configureBulkWriteConnection(activeDatabase);
            activeDatabase.exec("BEGIN");
            if (!incremental)
                statements.insertMeta.run("created_at", new Date().toISOString());
            (0, schema_1.writeIndexMetadata)(scopes, parserMode, statements);
            for (const filePath of deletedPaths)
                (0, schema_1.removeIndexedFile)(filePath, statements);
            for (const file of reindexedFiles) {
                if (incremental && indexedPaths.has(file.path))
                    (0, schema_1.removeIndexedFile)(file.path, statements);
                runtime.indexCodeFile(file, statements);
            }
            if (!incremental)
                (0, schema_1.createSecondaryIndexes)(activeDatabase);
            activeDatabase.exec("COMMIT");
        });
        phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
        console.log("Project wiki code evidence index complete.");
        console.log(`database: ${databasePath.relativePath}`);
        console.log(`mode: ${incremental ? "incremental" : "full"}`);
        console.log(`engine: ${engine}`);
        if (requestedEngine === "auto")
            console.log("engine_selection: auto");
        console.log(`parser_mode: ${parserMode}`);
        console.log(`scopes: ${scopes.join(", ")}`);
        console.log(`files: ${currentFingerprints.length}`);
        console.log(`reindexed_files: ${reindexedFiles.length}`);
        console.log(`deleted_files: ${deletedPaths.length}`);
        console.log(`unchanged_files: ${unchangedFiles}`);
        emitCodeIndexPhaseTimings(phaseTimings);
    }
    catch (error) {
        try {
            database?.exec("ROLLBACK");
        }
        catch {
            // Ignore rollback failures after setup errors.
        }
        throw error;
    }
    finally {
        database?.close();
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
        requireCompatibleDatabase(database, runtime);
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
        requireCompatibleDatabase(database, runtime);
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
        requireCompatibleDatabase(database, runtime);
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
function runCodeIndexHealthMode(runtime) {
    printJson(runtime.codeIndexHealth());
}
function runCodeFilesMode(runtime) {
    runtime.requireExistingIndex();
    const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
    try {
        requireCompatibleDatabase(database, runtime);
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
        requireCompatibleDatabase(database, runtime);
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
        requireCompatibleDatabase(database, runtime);
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
        requireCompatibleDatabase(database, runtime);
        runtime.warnIfCodeIndexStale(database);
        printRows((0, search_1.searchSymbols)(database, args_1.codeSearchSymbol.trim()));
    }
    finally {
        database.close();
    }
}
function isCodeEvidenceModeFor(flags) {
    return Boolean(flags.codeContextPackTarget)
        || Boolean(flags.codeIndexHealthMode)
        || flags.codeIndexMode
        || Boolean(flags.codeQuerySql)
        || flags.codeReportMode
        || flags.codeStatusMode
        || flags.codeFilesMode
        || flags.codeImpactMode
        || Boolean(flags.codeSearchSymbol);
}
function isCodeEvidenceMode() {
    return isCodeEvidenceModeFor({ codeContextPackTarget: args_1.codeContextPackTarget, codeFilesMode: args_1.codeFilesMode, codeImpactMode: args_1.codeImpactMode, codeIndexHealthMode: args_1.codeIndexHealthMode, codeIndexMode: args_1.codeIndexMode, codeQuerySql: args_1.codeQuerySql, codeReportMode: args_1.codeReportMode, codeSearchSymbol: args_1.codeSearchSymbol, codeStatusMode: args_1.codeStatusMode });
}
