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
exports.CodeEvidenceIndexUnavailableError = exports.codeContextPackTruncationNotice = exports.codeContextPackCharCap = exports.codeIndexSnapshot = exports.workspaceSummary = exports.workspaceDependencyGraph = exports.searchSymbols = exports.ownershipInfo = exports.ownershipContext = exports.matchedCodeownerRules = exports.evidenceCoverage = exports.codeownerRules = void 0;
exports.codeIndexStaleness = codeIndexStaleness;
exports.codeIndexHealth = codeIndexHealth;
exports.codeImpact = codeImpact;
exports.codeContextPack = codeContextPack;
exports.openCodeEvidenceDatabaseForServing = openCodeEvidenceDatabaseForServing;
exports.runCodeIndexMode = runCodeIndexMode;
exports.runCodeQueryMode = runCodeQueryMode;
exports.runCodeReportMode = runCodeReportMode;
exports.runCodeStatusMode = runCodeStatusMode;
exports.runCodeIndexHealthMode = runCodeIndexHealthMode;
exports.runCodeFilesMode = runCodeFilesMode;
exports.runCodeImpactMode = runCodeImpactMode;
exports.runCodeContextPackMode = runCodeContextPackMode;
exports.runCodeSearchSymbolMode = runCodeSearchSymbolMode;
exports.isCodeEvidenceMode = isCodeEvidenceMode;
exports.isCodeEvidenceModeFor = isCodeEvidenceModeFor;
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const args_1 = require("./args");
const code_index_db_1 = require("./code-index-db");
const code_index_file_policy_1 = require("./code-index-file-policy");
const evidence_1 = require("./code-index/evidence");
const registry_1 = require("./code-index/extractors/registry");
const shared_1 = require("./code-index/extractors/shared");
const index_health_1 = require("./code-index/index-health");
const modes_1 = require("./code-index/modes");
const ownership_1 = require("./code-index/ownership");
Object.defineProperty(exports, "codeownerRules", { enumerable: true, get: function () { return ownership_1.codeownerRules; } });
Object.defineProperty(exports, "matchedCodeownerRules", { enumerable: true, get: function () { return ownership_1.matchedCodeownerRules; } });
Object.defineProperty(exports, "ownershipContext", { enumerable: true, get: function () { return ownership_1.ownershipContext; } });
Object.defineProperty(exports, "ownershipInfo", { enumerable: true, get: function () { return ownership_1.ownershipInfo; } });
const reports_1 = require("./code-index/reports");
Object.defineProperty(exports, "evidenceCoverage", { enumerable: true, get: function () { return reports_1.evidenceCoverage; } });
Object.defineProperty(exports, "workspaceDependencyGraph", { enumerable: true, get: function () { return reports_1.workspaceDependencyGraph; } });
Object.defineProperty(exports, "workspaceSummary", { enumerable: true, get: function () { return reports_1.workspaceSummary; } });
const schema_1 = require("./code-index/schema");
Object.defineProperty(exports, "codeIndexSnapshot", { enumerable: true, get: function () { return schema_1.codeIndexSnapshot; } });
const search_1 = require("./code-index/search");
Object.defineProperty(exports, "searchSymbols", { enumerable: true, get: function () { return search_1.searchSymbols; } });
const workspace_1 = require("./workspace");
exports.codeContextPackCharCap = 4000;
exports.codeContextPackTruncationNotice = "[truncated - refine the query]";
function fail(message) {
    console.error(message);
    process.exit(1);
}
function normalizeProjectRelative(input, label) {
    const raw = input.trim() || ".";
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace_1.root, raw);
    const rootResolved = path.resolve(workspace_1.root);
    if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
        fail(`${label} must stay inside the project root: ${input}`);
    }
    return (0, workspace_1.normalizePath)(path.relative(rootResolved, resolved)) || ".";
}
function codeEvidenceDatabasePath() {
    const raw = args_1.codeIndexOutput.trim() || `${code_index_file_policy_1.codeEvidenceDirectory}/code-evidence.sqlite`;
    const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace_1.root, raw);
    const evidenceRoot = path.resolve(workspace_1.root, code_index_file_policy_1.codeEvidenceDirectory);
    if (absolutePath === evidenceRoot || !absolutePath.startsWith(`${evidenceRoot}${path.sep}`)) {
        fail(`--code-index-out must stay inside ${code_index_file_policy_1.codeEvidenceDirectory}/`);
    }
    return {
        absolutePath,
        relativePath: (0, workspace_1.normalizePath)(path.relative(workspace_1.root, absolutePath)),
    };
}
function selectedCodeParserMode() {
    const requested = args_1.codeParser.trim().toLowerCase();
    if (!requested || requested === "default")
        return "default";
    if (requested === "tree-sitter" || requested === "treesitter")
        return "tree-sitter";
    fail(`invalid --code-parser: ${args_1.codeParser}; expected one of: default, tree-sitter`);
}
function normalizedMtimeMs(stat) {
    return Number(stat.mtimeMs.toFixed(3));
}
function readCodeFileFingerprint(relativePath) {
    const { stat } = (0, workspace_1.requireContainedProjectFile)(relativePath, "code-index file");
    return {
        mtimeMs: normalizedMtimeMs(stat),
        path: relativePath,
        size: stat.size,
    };
}
function readCodeFile(relativePath, parserMode = "default") {
    const { absolutePath } = (0, workspace_1.requireContainedProjectFile)(relativePath, "code-index file");
    const text = fs.readFileSync(absolutePath, "utf8");
    const fingerprint = readCodeFileFingerprint(relativePath);
    const language = (0, code_index_file_policy_1.fileLanguage)(relativePath) || "config";
    return {
        bytes: fingerprint.size,
        hash: crypto.createHash("sha256").update(text).digest("hex"),
        language,
        lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
        mtimeMs: fingerprint.mtimeMs,
        path: relativePath,
        profile: (0, registry_1.extractionProfile)(relativePath, language, parserMode),
        size: fingerprint.size,
        text,
    };
}
const extractionBackendRegistry = (0, registry_1.createExtractionBackendRegistry)(fail);
function extractionBackendForProfile(profile) {
    return extractionBackendRegistry.backendForProfile(profile);
}
function indexCodeFile(file, statements) {
    statements.insertFile.run(file.path, file.language, file.profile, file.language === "config" ? "config" : "source", file.bytes, file.lines, file.hash, file.mtimeMs, file.size);
    statements.insertFileFts.run(file.path, file.language, file.profile, file.text);
    extractionBackendForProfile(file.profile).index(file, statements);
}
function printRows(rows) {
    console.log(JSON.stringify(rows, null, 2));
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
function codeScopes() {
    const scopes = args_1.codeIndexScopes.length > 0 ? args_1.codeIndexScopes : ["."];
    return scopes.map((scope) => normalizeProjectRelative(scope, "--code-scope"));
}
function openDatabase(databasePath) {
    return (0, code_index_db_1.openDatabase)(databasePath, fail);
}
function requireExistingIndex() {
    const databasePath = codeEvidenceDatabasePath();
    if (!fs.existsSync(databasePath.absolutePath)) {
        console.error(`missing code evidence index: ${databasePath.relativePath}; run --code-index first`);
        process.exit(1);
    }
}
function removeDatabaseFiles(databasePath) {
    for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
        if (fs.existsSync(filePath))
            fs.unlinkSync(filePath);
    }
}
function codeIndexStaleness(database) {
    const scopes = (0, schema_1.indexedScopes)(database);
    const parserMode = (0, schema_1.indexedParserMode)(database);
    const currentFiles = (0, code_index_file_policy_1.discoverCodeFiles)(scopes.length > 0 ? scopes : ["."]).map(readCodeFileFingerprint);
    const currentPaths = new Set(currentFiles.map((file) => file.path));
    const indexedRows = database.prepare("SELECT path, hash, mtime_ms, size FROM files").all();
    const indexed = new Map(indexedRows.map((row) => [String(row.path), {
            hash: String(row.hash),
            mtimeMs: Number(row.mtime_ms),
            size: Number(row.size),
        }]));
    let added = 0;
    let changed = 0;
    for (const file of currentFiles) {
        const existing = indexed.get(file.path);
        if (!existing) {
            added += 1;
            continue;
        }
        if (existing.mtimeMs === file.mtimeMs && existing.size === file.size)
            continue;
        if (readCodeFile(file.path, parserMode).hash !== existing.hash)
            changed += 1;
    }
    const deleted = indexedRows.filter((row) => !currentPaths.has(String(row.path))).length;
    return {
        added,
        changed,
        deleted,
        stale: added > 0 || changed > 0 || deleted > 0,
    };
}
function codeIndexHealth() {
    const databasePath = codeEvidenceDatabasePath();
    return (0, index_health_1.inspectCodeIndexHealth)({
        absolutePath: databasePath.absolutePath,
        defaultScopes: codeScopes(),
        discoverCodeFiles: code_index_file_policy_1.discoverCodeFiles,
        expectedSchemaVersion: schema_1.codeIndexSchemaVersion,
        openDatabase,
        relativePath: databasePath.relativePath,
        smallRepoThreshold: code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD,
    });
}
function warnIfCodeIndexStale(database, staleness = codeIndexStaleness(database)) {
    if (!staleness.stale)
        return;
    console.error(`code evidence index may be stale: ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted; rerun --code-index`);
}
function codeReportRuntime(database, options = {}) {
    const databasePath = codeEvidenceDatabasePath();
    return {
        databaseRelativePath: databasePath.relativePath,
        parserBackendForProfile: (profile) => {
            const backend = extractionBackendForProfile(profile);
            return {
                id: backend.id,
                label: backend.label,
                strength: backend.strength,
            };
        },
        staleness: options.staleness ?? codeIndexStaleness(database),
    };
}
function codeImpact(database, target, options = {}) {
    const normalized = target.trim();
    const evidence = (0, evidence_1.collectCodeEvidence)(database, normalized, {
        edgeLimit: 100,
        fileLimit: 25,
        includeEdgeEvidenceMatches: false,
        includeOwnerCodeowners: true,
        includeRouteEdges: true,
        importLimit: 75,
        ownerSampleLimit: 10,
        routeEdgeLimit: 100,
        routeLimit: 50,
        symbolLimit: 50,
    });
    return {
        ...(0, reports_1.codeReportMetadata)(database, codeReportRuntime(database, options)),
        target,
        matches: {
            files: evidence.files,
            symbols: evidence.symbols,
            routes: evidence.routes,
            imports: evidence.imports,
        },
        edges: {
            outgoing: evidence.outgoingEdges,
            incoming: evidence.incomingEdges,
            routes: evidence.routeEdges,
        },
        impacted_owners: evidence.owners,
    };
}
function sampleLines(items, limit, render) {
    const lines = items.slice(0, limit).map(render);
    if (items.length > limit)
        lines.push(`  ...+${items.length - limit} more`);
    return lines;
}
function pushBudgetedLine(lines, line) {
    const candidate = [...lines, line].join("\n");
    if (candidate.length > exports.codeContextPackCharCap)
        return false;
    lines.push(line);
    return true;
}
function pushBudgetedSection(lines, title, items, limit, render) {
    if (items.length === 0)
        return;
    if (!pushBudgetedLine(lines, title))
        return;
    for (const line of sampleLines(items, limit, render)) {
        if (!pushBudgetedLine(lines, line)) {
            pushBudgetedLine(lines, "  ...more omitted; refine the query");
            return;
        }
    }
}
function finalizeCodeContextPack(body) {
    if (body.length <= exports.codeContextPackCharCap)
        return body;
    const budget = exports.codeContextPackCharCap - exports.codeContextPackTruncationNotice.length - 1;
    return `${body.slice(0, budget > 0 ? budget : 0).trimEnd()}\n${exports.codeContextPackTruncationNotice}`;
}
function codeContextScaleLine(fileCount) {
    return fileCount < code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD
        ? `scale small (${fileCount} indexed files < ${code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD}); direct reads are usually cheaper for simple lookups`
        : `scale large (${fileCount} indexed files >= ${code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD}); indexed traversal is useful for impact-style context`;
}
function structuralSignature(value) {
    const signature = (0, shared_1.oneLine)(String(value ?? ""));
    const bodyStart = signature.indexOf("{");
    return bodyStart >= 0 ? signature.slice(0, bodyStart).trimEnd() : signature;
}
function codeContextPack(database, query, options = {}) {
    const normalized = query.trim();
    if (!normalized)
        return 'Code context pack: missing query; use --code-context-pack "path-or-symbol-or-route".';
    const evidence = (0, evidence_1.collectCodeEvidence)(database, normalized, {
        edgeLimit: 30,
        fileLimit: 12,
        includeEdgeEvidenceMatches: true,
        includeOwnerCodeowners: false,
        includeRouteEdges: false,
        importLimit: 30,
        ownerSampleLimit: 4,
        routeEdgeLimit: 0,
        routeLimit: 20,
        symbolLimit: 20,
    });
    const staleness = options.staleness ?? codeIndexStaleness(database);
    const coverage = (0, reports_1.evidenceCoverage)(database);
    const staleLabel = staleness.stale
        ? `STALE ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted`
        : "fresh";
    const lines = [
        `Code context pack "${normalized}": ${evidence.files.length} file matches, ${evidence.symbols.length} symbols, ${evidence.routes.length} routes, ${evidence.imports.length} imports, ${evidence.incomingEdges.length} incoming / ${evidence.outgoingEdges.length} outgoing edges; index ${staleLabel}; ${codeContextScaleLine(Number(coverage.files ?? 0))}.`,
        "Evidence is structural only: paths, lines, signatures, routes, imports, edges, and owners; no source snippets are included.",
    ];
    pushBudgetedSection(lines, "Files:", evidence.files, 8, (row) => `  file-match ${String(row.path)} (${String(row.language)}, ${String(row.profile)}, ${Number(row.lines ?? 0)} lines)`);
    pushBudgetedSection(lines, "Symbols:", evidence.symbols, 12, (row) => `  symbol-match ${String(row.file_path)}:${String(row.line)} ${String(row.kind)} ${String(row.name)} - ${structuralSignature(row.signature)}`);
    pushBudgetedSection(lines, "Routes:", evidence.routes, 8, (row) => `  route-match ${String(row.method)} ${String(row.route)} -> ${String(row.handler)} (${String(row.file_path)}:${String(row.line)})`);
    pushBudgetedSection(lines, "Imports:", evidence.imports, 8, (row) => `  import-match ${String(row.from_file)}:${String(row.line)} -> ${String(row.to_ref)}${row.imported ? ` (${String(row.imported)})` : ""}`);
    pushBudgetedSection(lines, "Incoming edges:", evidence.incomingEdges, 8, (row) => `  edge-in ${String(row.kind)} ${String(row.source)} -> ${String(row.target)} (${String(row.file_path)}:${String(row.line)})`);
    pushBudgetedSection(lines, "Outgoing edges:", evidence.outgoingEdges, 8, (row) => `  edge-out ${String(row.kind)} ${String(row.source)} -> ${String(row.target)} (${String(row.file_path)}:${String(row.line)})`);
    pushBudgetedSection(lines, "Owners:", evidence.owners, 6, (row) => `  owner ${row.owner} (${row.owner_source}, ${row.files} files): ${row.sample_files.join(", ")}`);
    return finalizeCodeContextPack(lines.join("\n"));
}
// Error thrown when the code-evidence index is missing or schema-incompatible.
// The MCP server catches this to return an isError tool result (tools/list still
// works); CLI modes keep their own process.exit path via requireExistingIndex.
class CodeEvidenceIndexUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = "CodeEvidenceIndexUnavailableError";
    }
}
exports.CodeEvidenceIndexUnavailableError = CodeEvidenceIndexUnavailableError;
// Open the existing .project-wiki code-evidence index READ-ONLY for serving:
// validates existence and schema version, then pins PRAGMA query_only = ON. Uses
// the same path resolution and schema constant as the indexer so the server and
// the writer share one contract. Throws CodeEvidenceIndexUnavailableError (never
// exits) so the MCP server can answer with guidance to run --code-index.
function openCodeEvidenceDatabaseForServing() {
    const databasePath = codeEvidenceDatabasePath();
    if (!fs.existsSync(databasePath.absolutePath)) {
        throw new CodeEvidenceIndexUnavailableError(`missing code evidence index: ${databasePath.relativePath}; run \`project-librarian --code-index\` first`);
    }
    const database = openDatabase(databasePath.absolutePath);
    let schemaVersion = "";
    try {
        schemaVersion = (0, schema_1.readMetaValue)(database, "schema_version");
    }
    catch (error) {
        database.close();
        const message = error instanceof Error ? error.message : String(error);
        throw new CodeEvidenceIndexUnavailableError(`code evidence index at ${databasePath.relativePath} is not readable; rebuild with \`project-librarian --code-index\`. Error: ${message}`);
    }
    if (schemaVersion !== schema_1.codeIndexSchemaVersion) {
        database.close();
        throw new CodeEvidenceIndexUnavailableError((0, index_health_1.formatCodeIndexHealthRemediation)(codeIndexHealth()));
    }
    database.exec("PRAGMA query_only = ON");
    return { database, relativePath: databasePath.relativePath };
}
function prepareOutputPath() {
    const databasePath = codeEvidenceDatabasePath();
    (0, workspace_1.mkdirp)(path.dirname(databasePath.relativePath));
    (0, workspace_1.mkdirp)(code_index_file_policy_1.codeEvidenceDirectory);
    (0, workspace_1.write)(`${code_index_file_policy_1.codeEvidenceDirectory}/.gitignore`, "*\n!.gitignore\n");
}
function codeIndexModeRuntime() {
    return {
        codeContextPack,
        codeEvidenceDatabasePath,
        codeImpact,
        codeIndexHealth,
        codeIndexStaleness,
        codeReportForRequestedSection: (database, requestedSection, options) => (0, reports_1.codeReportForRequestedSection)(database, requestedSection, codeReportRuntime(database, options)),
        codeScopes,
        fail,
        indexCodeFile,
        openDatabase,
        prepareOutputPath,
        readCodeFileFingerprint,
        readCodeFile,
        removeDatabaseFiles,
        requireExistingIndex,
        selectedCodeParserMode,
        warnIfCodeIndexStale,
    };
}
function runCodeIndexMode() {
    (0, modes_1.runCodeIndexMode)(codeIndexModeRuntime());
}
function runCodeQueryMode() {
    (0, modes_1.runCodeQueryMode)(codeIndexModeRuntime());
}
function runCodeReportMode() {
    (0, modes_1.runCodeReportMode)(codeIndexModeRuntime());
}
function runCodeStatusMode() {
    (0, modes_1.runCodeStatusMode)(codeIndexModeRuntime());
}
function runCodeIndexHealthMode() {
    (0, modes_1.runCodeIndexHealthMode)(codeIndexModeRuntime());
}
function runCodeFilesMode() {
    (0, modes_1.runCodeFilesMode)(codeIndexModeRuntime());
}
function runCodeImpactMode() {
    (0, modes_1.runCodeImpactMode)(codeIndexModeRuntime());
}
function runCodeContextPackMode() {
    (0, modes_1.runCodeContextPackMode)(codeIndexModeRuntime());
}
function runCodeSearchSymbolMode() {
    (0, modes_1.runCodeSearchSymbolMode)(codeIndexModeRuntime());
}
function isCodeEvidenceMode() {
    return (0, modes_1.isCodeEvidenceMode)();
}
function isCodeEvidenceModeFor(flags) {
    return (0, modes_1.isCodeEvidenceModeFor)(flags);
}
