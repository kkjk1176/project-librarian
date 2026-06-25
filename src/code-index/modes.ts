import * as fs from "node:fs";
import { acknowledgeSmallRepoMode, codeContextPackTarget, codeFilesMode, codeImpactMode, codeImpactTarget, codeIndexFullMode, codeIndexHealthMode, codeIndexIncrementalMode, codeIndexMode, codeQuerySql, codeReportMode, codeReportSection, codeSearchSymbol, codeStatusMode } from "../args";
import type { SqliteDatabase } from "../code-index-db";
import { discoverCodeFiles, smallRepoCodeIndexGate } from "../code-index-file-policy";
import { isReadOnlySql } from "../code-index-sql";
import type { CodeContextPackOptions, CodeEvidenceRenderOptions, CodeIndexStaleness } from "../code-index";
import type { CodeFile, CodeFileFingerprint } from "./extractors/types";
import type { CodeIndexHealth } from "./index-health";
import { invalidCodeReportSectionMessage } from "./reports";
import { codeIndexSchemaVersion, createIndexStatements, createSecondaryIndexes, incrementalCompatibility, readMetaValue, removeIndexedFile, setupDatabase, writeIndexMetadata, type CodeParserMode, type IndexStatements } from "./schema";
import { searchSymbols } from "./search";

export interface CodeEvidenceDatabasePath {
  absolutePath: string;
  relativePath: string;
}

export type CodeIndexEngine = "auto" | "typescript" | "native-rust";
export type ResolvedCodeIndexEngine = "typescript" | "native-rust";

export interface CodeIndexEngineSelectionContext {
  discoveredFileCount: number;
  nativeEligibleFileCount: number;
  nativeIneligibleFileCount: number;
}

export interface NativeCodeIndexModeRequest {
  databasePath: CodeEvidenceDatabasePath;
  discoveredFiles: string[];
  parserMode: CodeParserMode;
  requestedEngine: CodeIndexEngine;
  scopes: string[];
}

export interface NativeCodeIndexIncrementalModeRequest extends NativeCodeIndexModeRequest {
  deletedPaths: string[];
  reindexedFiles: CodeFileFingerprint[];
  unchangedFiles: number;
}

export interface CodeIndexModeRuntime {
  codeContextPack(database: SqliteDatabase, query: string, options?: CodeContextPackOptions): string;
  codeEvidenceDatabasePath(): CodeEvidenceDatabasePath;
  codeImpact(database: SqliteDatabase, target: string, options?: CodeEvidenceRenderOptions): Record<string, unknown>;
  codeIndexHealth(): CodeIndexHealth;
  codeIndexStaleness(database: SqliteDatabase): CodeIndexStaleness;
  codeReportForRequestedSection(database: SqliteDatabase, requestedSection: string, options?: CodeEvidenceRenderOptions): Record<string, unknown> | undefined;
  codeScopes(): string[];
  fail(message: string): never;
  indexCodeFile(file: CodeFile, statements: IndexStatements): void;
  nativeCodeIndexAvailable(): boolean;
  nativeCodeIndexIncrementalEligible(files: CodeFileFingerprint[], parserMode: CodeParserMode): boolean;
  openDatabase(databasePath: string): SqliteDatabase;
  prepareOutputPath(): void;
  readCodeFileFingerprint(relativePath: string): CodeFileFingerprint;
  readCodeFile(relativePath: string, parserMode: CodeParserMode, fingerprint?: CodeFileFingerprint): CodeFile;
  removeDatabaseFiles(databasePath: string): void;
  requireExistingIndex(): void;
  runNativeCodeIndexIncrementalMode(request: NativeCodeIndexIncrementalModeRequest): void;
  runNativeCodeIndexMode(request: NativeCodeIndexModeRequest): void;
  selectedCodeIndexEngine(): CodeIndexEngine;
  selectedCodeParserMode(): CodeParserMode;
  codeIndexEngineSelectionContext(discoveredFiles: string[], parserMode: CodeParserMode): CodeIndexEngineSelectionContext;
  shouldUseNativeCodeIndexAuto(context: CodeIndexEngineSelectionContext): boolean;
  warnIfCodeIndexStale(database: SqliteDatabase, staleness?: CodeIndexStaleness): void;
}

interface CodeIndexPhaseTimings {
  compatibility_ms?: number;
  discover_files_ms?: number;
  fingerprints_ms?: number;
  native_helper_ms?: number;
  prepare_output_ms?: number;
  read_files_ms?: number;
  sqlite_write_ms?: number;
  total_ms?: number;
}

function printRows(rows: Record<string, unknown>[]): void {
  console.log(JSON.stringify(rows, null, 2));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function requireCompatibleDatabase(database: SqliteDatabase, runtime: CodeIndexModeRuntime): void {
  const schemaVersion = readMetaValue(database, "schema_version");
  if (schemaVersion !== codeIndexSchemaVersion) {
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

function elapsedMs(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function measurePhase<T>(timings: CodeIndexPhaseTimings, key: keyof CodeIndexPhaseTimings, fn: () => T): T {
  const started = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    timings[key] = Number(((timings[key] ?? 0) + elapsedMs(started)).toFixed(3));
  }
}

function emitCodeIndexPhaseTimings(timings: CodeIndexPhaseTimings): void {
  if (process.env.PROJECT_LIBRARIAN_CODE_INDEX_TIMINGS !== "1") return;
  console.error(`code_index_phase_timings ${JSON.stringify(timings)}`);
}

function configureBulkWriteConnection(database: SqliteDatabase): void {
  database.exec(`
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -20000;
  `);
}

function shouldUseNativeIncrementalForAuto(
  requestedEngine: CodeIndexEngine,
  runtime: CodeIndexModeRuntime,
  staleFileCount: number,
): boolean {
  if (requestedEngine !== "auto" || !codeIndexIncrementalMode) return false;
  if (staleFileCount <= 0 || !runtime.nativeCodeIndexAvailable()) return false;
  return true;
}

export function resolveCodeIndexEngine(
  requestedEngine: CodeIndexEngine,
  context: CodeIndexEngineSelectionContext,
  shouldUseNativeAuto: (context: CodeIndexEngineSelectionContext) => boolean,
  incrementalMode = codeIndexIncrementalMode,
): ResolvedCodeIndexEngine {
  if (requestedEngine !== "auto") return requestedEngine;
  if (incrementalMode) return "typescript";
  return shouldUseNativeAuto(context) ? "native-rust" : "typescript";
}

export function runCodeIndexMode(runtime: CodeIndexModeRuntime): void {
  const totalStarted = process.hrtime.bigint();
  const phaseTimings: CodeIndexPhaseTimings = {};
  const databasePath = runtime.codeEvidenceDatabasePath();
  const scopes = runtime.codeScopes();
  const parserMode = runtime.selectedCodeParserMode();
  const requestedEngine = runtime.selectedCodeIndexEngine();
  // Scale gate before ANY write or database work: below the measured threshold
  // the build halts with the evidence-citing warning unless --acknowledge-small-repo
  // was passed (2026-06-12 scale-aware guidance decision).
  const discoveredFiles = measurePhase(phaseTimings, "discover_files_ms", () => discoverCodeFiles(scopes));
  const scaleGate = smallRepoCodeIndexGate(discoveredFiles.length, acknowledgeSmallRepoMode);
  if (!scaleGate.proceed) runtime.fail(scaleGate.warning);
  const engineSelectionContext = runtime.codeIndexEngineSelectionContext(discoveredFiles, parserMode);
  const engine = resolveCodeIndexEngine(requestedEngine, engineSelectionContext, runtime.shouldUseNativeCodeIndexAuto);
  if (engine === "native-rust") {
    if (!codeIndexIncrementalMode) {
      try {
        measurePhase(phaseTimings, "native_helper_ms", () => runtime.runNativeCodeIndexMode({ databasePath, discoveredFiles, parserMode, requestedEngine, scopes }));
        phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
        emitCodeIndexPhaseTimings(phaseTimings);
        return;
      } catch (error) {
        phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
        emitCodeIndexPhaseTimings(phaseTimings);
        throw error;
      }
    }
  }
  const existingIndex = fs.existsSync(databasePath.absolutePath);
  if (codeIndexIncrementalMode && !existingIndex) {
    runtime.fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
  }
  let incremental = false;
  if (existingIndex && !codeIndexFullMode) {
    let compatibility = { compatible: false, reason: "compatibility was not checked" };
    measurePhase(phaseTimings, "compatibility_ms", () => {
      const existingDatabase = runtime.openDatabase(databasePath.absolutePath);
      try {
        compatibility = incrementalCompatibility(existingDatabase, scopes, parserMode);
      } finally {
        existingDatabase.close();
      }
    });
    incremental = !codeIndexFullMode && compatibility.compatible;
    if (codeIndexIncrementalMode && !compatibility.compatible) runtime.fail(`--incremental cannot update ${databasePath.relativePath}: ${compatibility.reason}`);
  }
  measurePhase(phaseTimings, "prepare_output_ms", () => {
    runtime.prepareOutputPath();
    if (!incremental) runtime.removeDatabaseFiles(databasePath.absolutePath);
  });
  let database: SqliteDatabase | undefined = runtime.openDatabase(databasePath.absolutePath);
  try {
    if (!incremental) setupDatabase(database, { secondaryIndexes: false });
    const currentFingerprints = measurePhase(phaseTimings, "fingerprints_ms", () => discoveredFiles.map((filePath) => runtime.readCodeFileFingerprint(filePath)));
    let reindexedFingerprints: CodeFileFingerprint[];
    let deletedPaths: string[];
    let indexedPaths = new Set<string>();
    let unchangedFiles = 0;
    if (incremental) {
      const indexedRows = database.prepare("SELECT path, hash, mtime_ms, size FROM files").all();
      indexedPaths = new Set(indexedRows.map((row) => String(row.path)));
      const indexed = new Map(indexedRows.map((row) => [String(row.path), {
        hash: String(row.hash),
        mtimeMs: Number(row.mtime_ms),
        size: Number(row.size),
      }] as const));
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
    } else {
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
      } else {
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
    const statements = createIndexStatements(activeDatabase);
    measurePhase(phaseTimings, "sqlite_write_ms", () => {
      configureBulkWriteConnection(activeDatabase);
      activeDatabase.exec("BEGIN");
      if (!incremental) statements.insertMeta.run("created_at", new Date().toISOString());
      writeIndexMetadata(scopes, parserMode, statements);
      for (const filePath of deletedPaths) removeIndexedFile(filePath, statements);
      for (const file of reindexedFiles) {
        if (incremental && indexedPaths.has(file.path)) removeIndexedFile(file.path, statements);
        runtime.indexCodeFile(file, statements);
      }
      if (!incremental) createSecondaryIndexes(activeDatabase);
      activeDatabase.exec("COMMIT");
    });
    phaseTimings.total_ms = Number(elapsedMs(totalStarted).toFixed(3));
    console.log("Project wiki code evidence index complete.");
    console.log(`database: ${databasePath.relativePath}`);
    console.log(`mode: ${incremental ? "incremental" : "full"}`);
    console.log(`engine: ${engine}`);
    if (requestedEngine === "auto") console.log("engine_selection: auto");
    console.log(`parser_mode: ${parserMode}`);
    console.log(`scopes: ${scopes.join(", ")}`);
    console.log(`files: ${currentFingerprints.length}`);
    console.log(`reindexed_files: ${reindexedFiles.length}`);
    console.log(`deleted_files: ${deletedPaths.length}`);
    console.log(`unchanged_files: ${unchangedFiles}`);
    emitCodeIndexPhaseTimings(phaseTimings);
  } catch (error) {
    try {
      database?.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after setup errors.
    }
    throw error;
  } finally {
    database?.close();
  }
}

export function runCodeQueryMode(runtime: CodeIndexModeRuntime): void {
  if (!codeQuerySql.trim()) {
    console.error("missing SQL: use --code-query \"select ...\"");
    process.exit(1);
  }
  runtime.requireExistingIndex();
  if (!isReadOnlySql(codeQuerySql)) {
    console.error("code queries must be read-only SQL starting with SELECT or WITH");
    process.exit(1);
  }
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    database.exec("PRAGMA query_only = ON");
    requireCompatibleDatabase(database, runtime);
    runtime.warnIfCodeIndexStale(database);
    printRows(database.prepare(codeQuerySql).all());
  } finally {
    database.close();
  }
}

export function runCodeReportMode(runtime: CodeIndexModeRuntime): void {
  runtime.requireExistingIndex();
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    requireCompatibleDatabase(database, runtime);
    const staleness = runtime.codeIndexStaleness(database);
    runtime.warnIfCodeIndexStale(database, staleness);
    const report = runtime.codeReportForRequestedSection(database, codeReportSection, { staleness });
    if (!report) runtime.fail(invalidCodeReportSectionMessage(codeReportSection));
    printJson(report);
  } finally {
    database.close();
  }
}

export function runCodeStatusMode(runtime: CodeIndexModeRuntime): void {
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
    rows.push(
      { metric: "stale_files", value: staleness.added + staleness.changed + staleness.deleted },
      { metric: "stale_changed_files", value: staleness.changed },
      { metric: "stale_added_files", value: staleness.added },
      { metric: "stale_deleted_files", value: staleness.deleted },
    );
    printRows(rows);
  } finally {
    database.close();
  }
}

export function runCodeIndexHealthMode(runtime: CodeIndexModeRuntime): void {
  printJson(runtime.codeIndexHealth());
}

export function runCodeFilesMode(runtime: CodeIndexModeRuntime): void {
  runtime.requireExistingIndex();
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    requireCompatibleDatabase(database, runtime);
    runtime.warnIfCodeIndexStale(database);
    printRows(database.prepare("SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path").all());
  } finally {
    database.close();
  }
}

export function runCodeImpactMode(runtime: CodeIndexModeRuntime): void {
  if (!codeImpactTarget.trim()) {
    console.error("missing impact target: use --code-impact \"path-or-symbol-or-module\"");
    process.exit(1);
  }
  runtime.requireExistingIndex();
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    requireCompatibleDatabase(database, runtime);
    const staleness = runtime.codeIndexStaleness(database);
    runtime.warnIfCodeIndexStale(database, staleness);
    printJson(runtime.codeImpact(database, codeImpactTarget.trim(), { staleness }));
  } finally {
    database.close();
  }
}

export function runCodeContextPackMode(runtime: CodeIndexModeRuntime): void {
  if (!codeContextPackTarget.trim()) {
    console.error("missing context pack query: use --code-context-pack \"path-or-symbol-or-route\"");
    process.exit(1);
  }
  runtime.requireExistingIndex();
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    requireCompatibleDatabase(database, runtime);
    const staleness = runtime.codeIndexStaleness(database);
    runtime.warnIfCodeIndexStale(database, staleness);
    console.log(runtime.codeContextPack(database, codeContextPackTarget.trim(), { staleness }));
  } finally {
    database.close();
  }
}

export function runCodeSearchSymbolMode(runtime: CodeIndexModeRuntime): void {
  if (!codeSearchSymbol.trim()) {
    console.error("missing symbol search term: use --code-search-symbol \"term\"");
    process.exit(1);
  }
  runtime.requireExistingIndex();
  const database = runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath);
  try {
    requireCompatibleDatabase(database, runtime);
    runtime.warnIfCodeIndexStale(database);
    printRows(searchSymbols(database, codeSearchSymbol.trim()));
  } finally {
    database.close();
  }
}

export function isCodeEvidenceModeFor(flags: { codeContextPackTarget: string; codeFilesMode: boolean; codeImpactMode: boolean; codeIndexHealthMode?: boolean; codeIndexMode: boolean; codeQuerySql: string; codeReportMode: boolean; codeSearchSymbol: string; codeStatusMode: boolean }): boolean {
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

export function isCodeEvidenceMode(): boolean {
  return isCodeEvidenceModeFor({ codeContextPackTarget, codeFilesMode, codeImpactMode, codeIndexHealthMode, codeIndexMode, codeQuerySql, codeReportMode, codeSearchSymbol, codeStatusMode });
}
