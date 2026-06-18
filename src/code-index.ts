import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { acknowledgeSmallRepoMode, codeContextPackMode, codeContextPackTarget, codeFilesMode, codeImpactMode, codeImpactTarget, codeIndexFullMode, codeIndexHealthMode, codeIndexIncrementalMode, codeIndexOutput, codeIndexScopes, codeIndexMode, codeParser, codeQuerySql, codeReportMode, codeReportSection, codeSearchSymbol, codeStatusMode } from "./args";
import { openDatabase as openSqliteDatabase, type SqliteDatabase } from "./code-index-db";
import { codeEvidenceDirectory, discoverCodeFiles, fileLanguage, maxIndexedBytes, SMALL_REPO_FILE_THRESHOLD, smallRepoCodeIndexGate } from "./code-index-file-policy";
import { isReadOnlySql } from "./code-index-sql";
import { collectCodeEvidence } from "./code-index/evidence";
import { createExtractionBackendRegistry, extractionProfile } from "./code-index/extractors/registry";
import { oneLine } from "./code-index/extractors/shared";
import type { CodeFile, CodeFileFingerprint } from "./code-index/extractors/types";
import { formatCodeIndexHealthRemediation, inspectCodeIndexHealth, type CodeIndexHealth } from "./code-index/index-health";
import { isCodeEvidenceMode as isCodeEvidenceModeImpl, isCodeEvidenceModeFor as isCodeEvidenceModeForImpl, runCodeContextPackMode as runCodeContextPackModeImpl, runCodeFilesMode as runCodeFilesModeImpl, runCodeImpactMode as runCodeImpactModeImpl, runCodeIndexHealthMode as runCodeIndexHealthModeImpl, runCodeIndexMode as runCodeIndexModeImpl, runCodeQueryMode as runCodeQueryModeImpl, runCodeReportMode as runCodeReportModeImpl, runCodeSearchSymbolMode as runCodeSearchSymbolModeImpl, runCodeStatusMode as runCodeStatusModeImpl, type CodeIndexModeRuntime } from "./code-index/modes";
import { codeownerRules, matchedCodeownerRules, ownershipContext, ownershipInfo, type MatchedCodeownerRule, type OwnershipContext, type OwnershipInfo } from "./code-index/ownership";
import { codeReportForRequestedSection, codeReportMetadata, evidenceCoverage, invalidCodeReportSectionMessage, workspaceDependencyGraph, workspaceSummary, type CodeReportRuntime } from "./code-index/reports";
import { codeIndexSchemaVersion, codeIndexSnapshot, createIndexStatements, incrementalCompatibility, indexedParserMode, indexedScopes, readMetaValue, removeIndexedFile, setupDatabase, writeIndexMetadata, type CodeParserMode, type IndexStatements } from "./code-index/schema";
import { searchSymbols } from "./code-index/search";
import { abs, mkdirp, normalizePath, root } from "./workspace";

export { codeownerRules, evidenceCoverage, matchedCodeownerRules, ownershipContext, ownershipInfo, searchSymbols, workspaceDependencyGraph, workspaceSummary };
export { codeIndexSnapshot };
export type { CodeIndexSnapshot, CodeIndexSnapshotRow } from "./code-index/schema";
export type { CodeIndexHealth };
export type { MatchedCodeownerRule, OwnershipContext, OwnershipInfo };

export interface CodeIndexStaleness {
  added: number;
  changed: number;
  deleted: number;
  stale: boolean;
}

export interface CodeContextPackOptions {
  staleness?: CodeIndexStaleness;
}

export interface CodeEvidenceRenderOptions {
  staleness?: CodeIndexStaleness;
}

interface CodeEvidenceModeFlags {
  codeContextPackTarget: string;
  codeFilesMode: boolean;
  codeImpactMode: boolean;
  codeIndexHealthMode?: boolean;
  codeIndexMode: boolean;
  codeQuerySql: string;
  codeReportMode: boolean;
  codeSearchSymbol: string;
  codeStatusMode: boolean;
}

export const codeContextPackCharCap = 4000;
export const codeContextPackTruncationNotice = "[truncated - refine the query]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function normalizeProjectRelative(input: string, label: string): string {
  const raw = input.trim() || ".";
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    fail(`${label} must stay inside the project root: ${input}`);
  }
  return normalizePath(path.relative(rootResolved, resolved)) || ".";
}

function codeEvidenceDatabasePath(): { absolutePath: string; relativePath: string } {
  const raw = codeIndexOutput.trim() || `${codeEvidenceDirectory}/code-evidence.sqlite`;
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const evidenceRoot = path.resolve(root, codeEvidenceDirectory);
  if (absolutePath === evidenceRoot || !absolutePath.startsWith(`${evidenceRoot}${path.sep}`)) {
    fail(`--code-index-out must stay inside ${codeEvidenceDirectory}/`);
  }
  return {
    absolutePath,
    relativePath: normalizePath(path.relative(root, absolutePath)),
  };
}

function selectedCodeParserMode(): CodeParserMode {
  const requested = codeParser.trim().toLowerCase();
  if (!requested || requested === "default") return "default";
  if (requested === "tree-sitter" || requested === "treesitter") return "tree-sitter";
  fail(`invalid --code-parser: ${codeParser}; expected one of: default, tree-sitter`);
}

function normalizedMtimeMs(stat: fs.Stats): number {
  return Number(stat.mtimeMs.toFixed(3));
}

function readCodeFileFingerprint(relativePath: string): CodeFileFingerprint {
  const stat = fs.statSync(abs(relativePath));
  return {
    mtimeMs: normalizedMtimeMs(stat),
    path: relativePath,
    size: stat.size,
  };
}

function readCodeFile(relativePath: string, parserMode: CodeParserMode = "default"): CodeFile {
  const text = fs.readFileSync(abs(relativePath), "utf8");
  const fingerprint = readCodeFileFingerprint(relativePath);
  const language = fileLanguage(relativePath) || "config";
  return {
    bytes: fingerprint.size,
    hash: crypto.createHash("sha256").update(text).digest("hex"),
    language,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
    mtimeMs: fingerprint.mtimeMs,
    path: relativePath,
    profile: extractionProfile(relativePath, language, parserMode),
    size: fingerprint.size,
    text,
  };
}

const extractionBackendRegistry = createExtractionBackendRegistry(fail);

function extractionBackendForProfile(profile: string) {
  return extractionBackendRegistry.backendForProfile(profile);
}

function indexCodeFile(file: CodeFile, statements: IndexStatements): void {
  statements.insertFile.run(file.path, file.language, file.profile, file.language === "config" ? "config" : "source", file.bytes, file.lines, file.hash, file.mtimeMs, file.size);
  statements.insertFileFts.run(file.path, file.language, file.profile, file.text);
  extractionBackendForProfile(file.profile).index(file, statements);
}

function printRows(rows: Record<string, unknown>[]): void {
  console.log(JSON.stringify(rows, null, 2));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function codeScopes(): string[] {
  const scopes = codeIndexScopes.length > 0 ? codeIndexScopes : ["."];
  return scopes.map((scope) => normalizeProjectRelative(scope, "--code-scope"));
}

function openDatabase(databasePath: string): SqliteDatabase {
  return openSqliteDatabase(databasePath, fail);
}

function requireExistingIndex(): void {
  const databasePath = codeEvidenceDatabasePath();
  if (!fs.existsSync(databasePath.absolutePath)) {
    console.error(`missing code evidence index: ${databasePath.relativePath}; run --code-index first`);
    process.exit(1);
  }
}

function removeDatabaseFiles(databasePath: string): void {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export function codeIndexStaleness(database: SqliteDatabase): CodeIndexStaleness {
  const scopes = indexedScopes(database);
  const parserMode = indexedParserMode(database);
  const currentFiles = discoverCodeFiles(scopes.length > 0 ? scopes : ["."]).map(readCodeFileFingerprint);
  const currentPaths = new Set(currentFiles.map((file) => file.path));
  const indexedRows = database.prepare("SELECT path, hash, mtime_ms, size FROM files").all();
  const indexed = new Map(indexedRows.map((row) => [String(row.path), {
    hash: String(row.hash),
    mtimeMs: Number(row.mtime_ms),
    size: Number(row.size),
  }] as const));
  let added = 0;
  let changed = 0;
  for (const file of currentFiles) {
    const existing = indexed.get(file.path);
    if (!existing) {
      added += 1;
      continue;
    }
    if (existing.mtimeMs === file.mtimeMs && existing.size === file.size) continue;
    if (readCodeFile(file.path, parserMode).hash !== existing.hash) changed += 1;
  }
  const deleted = indexedRows.filter((row) => !currentPaths.has(String(row.path))).length;

  return {
    added,
    changed,
    deleted,
    stale: added > 0 || changed > 0 || deleted > 0,
  };
}

export function codeIndexHealth(): CodeIndexHealth {
  const databasePath = codeEvidenceDatabasePath();
  return inspectCodeIndexHealth({
    absolutePath: databasePath.absolutePath,
    defaultScopes: codeScopes(),
    discoverCodeFiles,
    expectedSchemaVersion: codeIndexSchemaVersion,
    openDatabase,
    relativePath: databasePath.relativePath,
    smallRepoThreshold: SMALL_REPO_FILE_THRESHOLD,
  });
}

function warnIfCodeIndexStale(database: SqliteDatabase, staleness = codeIndexStaleness(database)): void {
  if (!staleness.stale) return;
  console.error(`code evidence index may be stale: ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted; rerun --code-index`);
}

function codeReportRuntime(database: SqliteDatabase, options: CodeEvidenceRenderOptions = {}): CodeReportRuntime {
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

export function codeImpact(database: SqliteDatabase, target: string, options: CodeEvidenceRenderOptions = {}): Record<string, unknown> {
  const normalized = target.trim();
  const evidence = collectCodeEvidence(database, normalized, {
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
    ...codeReportMetadata(database, codeReportRuntime(database, options)),
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

function sampleLines<T>(items: T[], limit: number, render: (item: T) => string): string[] {
  const lines = items.slice(0, limit).map(render);
  if (items.length > limit) lines.push(`  ...+${items.length - limit} more`);
  return lines;
}

function pushBudgetedLine(lines: string[], line: string): boolean {
  const candidate = [...lines, line].join("\n");
  if (candidate.length > codeContextPackCharCap) return false;
  lines.push(line);
  return true;
}

function pushBudgetedSection<T>(lines: string[], title: string, items: T[], limit: number, render: (item: T) => string): void {
  if (items.length === 0) return;
  if (!pushBudgetedLine(lines, title)) return;
  for (const line of sampleLines(items, limit, render)) {
    if (!pushBudgetedLine(lines, line)) {
      pushBudgetedLine(lines, "  ...more omitted; refine the query");
      return;
    }
  }
}

function finalizeCodeContextPack(body: string): string {
  if (body.length <= codeContextPackCharCap) return body;
  const budget = codeContextPackCharCap - codeContextPackTruncationNotice.length - 1;
  return `${body.slice(0, budget > 0 ? budget : 0).trimEnd()}\n${codeContextPackTruncationNotice}`;
}

function codeContextScaleLine(fileCount: number): string {
  return fileCount < SMALL_REPO_FILE_THRESHOLD
    ? `scale small (${fileCount} indexed files < ${SMALL_REPO_FILE_THRESHOLD}); direct reads are usually cheaper for simple lookups`
    : `scale large (${fileCount} indexed files >= ${SMALL_REPO_FILE_THRESHOLD}); indexed traversal is useful for impact-style context`;
}

function structuralSignature(value: unknown): string {
  const signature = oneLine(String(value ?? ""));
  const bodyStart = signature.indexOf("{");
  return bodyStart >= 0 ? signature.slice(0, bodyStart).trimEnd() : signature;
}

export function codeContextPack(database: SqliteDatabase, query: string, options: CodeContextPackOptions = {}): string {
  const normalized = query.trim();
  if (!normalized) return 'Code context pack: missing query; use --code-context-pack "path-or-symbol-or-route".';
  const evidence = collectCodeEvidence(database, normalized, {
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
  const coverage = evidenceCoverage(database);
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
export class CodeEvidenceIndexUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeEvidenceIndexUnavailableError";
  }
}

// Open the existing .project-wiki code-evidence index READ-ONLY for serving:
// validates existence and schema version, then pins PRAGMA query_only = ON. Uses
// the same path resolution and schema constant as the indexer so the server and
// the writer share one contract. Throws CodeEvidenceIndexUnavailableError (never
// exits) so the MCP server can answer with guidance to run --code-index.
export function openCodeEvidenceDatabaseForServing(): { database: SqliteDatabase; relativePath: string } {
  const databasePath = codeEvidenceDatabasePath();
  if (!fs.existsSync(databasePath.absolutePath)) {
    throw new CodeEvidenceIndexUnavailableError(`missing code evidence index: ${databasePath.relativePath}; run \`project-librarian --code-index\` first`);
  }
  const database = openDatabase(databasePath.absolutePath);
  let schemaVersion = "";
  try {
    schemaVersion = readMetaValue(database, "schema_version");
  } catch (error: unknown) {
    database.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new CodeEvidenceIndexUnavailableError(`code evidence index at ${databasePath.relativePath} is not readable; rebuild with \`project-librarian --code-index\`. Error: ${message}`);
  }
  if (schemaVersion !== codeIndexSchemaVersion) {
    database.close();
    throw new CodeEvidenceIndexUnavailableError(formatCodeIndexHealthRemediation(codeIndexHealth()));
  }
  database.exec("PRAGMA query_only = ON");
  return { database, relativePath: databasePath.relativePath };
}

function prepareOutputPath(): void {
  const databasePath = codeEvidenceDatabasePath();
  mkdirp(path.dirname(databasePath.relativePath));
  mkdirp(codeEvidenceDirectory);
  fs.writeFileSync(abs(`${codeEvidenceDirectory}/.gitignore`), "*\n!.gitignore\n");
}

function codeIndexModeRuntime(): CodeIndexModeRuntime {
  return {
    codeContextPack,
    codeEvidenceDatabasePath,
    codeImpact,
    codeIndexHealth,
    codeIndexStaleness,
    codeReportForRequestedSection: (database, requestedSection, options) => codeReportForRequestedSection(database, requestedSection, codeReportRuntime(database, options)),
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

export function runCodeIndexMode(): void {
  runCodeIndexModeImpl(codeIndexModeRuntime());
}

export function runCodeQueryMode(): void {
  runCodeQueryModeImpl(codeIndexModeRuntime());
}

export function runCodeReportMode(): void {
  runCodeReportModeImpl(codeIndexModeRuntime());
}

export function runCodeStatusMode(): void {
  runCodeStatusModeImpl(codeIndexModeRuntime());
}

export function runCodeIndexHealthMode(): void {
  runCodeIndexHealthModeImpl(codeIndexModeRuntime());
}

export function runCodeFilesMode(): void {
  runCodeFilesModeImpl(codeIndexModeRuntime());
}

export function runCodeImpactMode(): void {
  runCodeImpactModeImpl(codeIndexModeRuntime());
}

export function runCodeContextPackMode(): void {
  runCodeContextPackModeImpl(codeIndexModeRuntime());
}

export function runCodeSearchSymbolMode(): void {
  runCodeSearchSymbolModeImpl(codeIndexModeRuntime());
}

export function isCodeEvidenceMode(): boolean {
  return isCodeEvidenceModeImpl();
}

export function isCodeEvidenceModeFor(flags: CodeEvidenceModeFlags): boolean {
  return isCodeEvidenceModeForImpl(flags);
}
