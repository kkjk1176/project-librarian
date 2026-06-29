import * as fs from "node:fs";
import { acknowledgeSmallRepoMode, codeContextPackTarget, codeFilesMode, codeImpactMode, codeImpactTarget, codeIndexFullMode, codeIndexHealthMode, codeIndexIncrementalMode, codeIndexMigrateMode, codeIndexMode, codeIndexOutput, codeQuerySql, codeReportMode, codeReportSection, codeSearchSymbol, codeStatusMode } from "../args";
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
  close_database_ms?: number;
  compatibility_ms?: number;
  discover_files_ms?: number;
  fingerprints_ms?: number;
  native_helper_ms?: number;
  open_database_ms?: number;
  prepare_output_ms?: number;
  query_ms?: number;
  read_files_ms?: number;
  render_ms?: number;
  require_existing_index_ms?: number;
  sqlite_write_ms?: number;
  staleness_ms?: number;
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

function schemaMigrationRequired(reason: string): boolean {
  return reason.startsWith("existing schema version ") && !reason.includes("(missing)");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function schemaMigrationApprovalCommand(options: { parserMode: CodeParserMode; requestedEngine: CodeIndexEngine; scopes: string[] }): string {
  const parts = ["project-librarian", "--code-index", "--code-index-migrate"];
  for (const scope of options.scopes) {
    if (scope !== ".") parts.push("--code-scope", scope);
  }
  if (codeIndexOutput !== ".project-wiki/code-evidence.sqlite") parts.push("--code-index-out", codeIndexOutput);
  if (acknowledgeSmallRepoMode) parts.push("--acknowledge-small-repo");
  if (options.requestedEngine !== "auto") parts.push("--code-index-engine", options.requestedEngine);
  if (options.parserMode !== "default") parts.push("--code-parser", options.parserMode);
  return parts.map(shellQuote).join(" ");
}

function schemaMigrationRequiredMessage(runtime: CodeIndexModeRuntime, reason: string, options: { parserMode: CodeParserMode; requestedEngine: CodeIndexEngine; scopes: string[] }): string {
  const databasePath = runtime.codeEvidenceDatabasePath();
  return [
    `code evidence index schema migration required: ${reason}`,
    "The existing disposable code evidence index must be replaced before this version can write it.",
    `approve: ${schemaMigrationApprovalCommand(options)}`,
    "inspect: project-librarian --code-index-health",
    `database: ${databasePath.relativePath}`,
  ].join("\n");
}

function unreadableIndexMessage(runtime: CodeIndexModeRuntime): string {
  const health = runtime.codeIndexHealth();
  return [
    health.message,
    "inspect: project-librarian --code-index-health",
    `rebuild: ${health.recommended_rebuild_command}`,
    `database: ${health.database_path}`,
  ].join("\n");
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

function finishCodeEvidencePhaseTimings(started: bigint, timings: CodeIndexPhaseTimings): void {
  timings.total_ms = Number(elapsedMs(started).toFixed(3));
  emitCodeIndexPhaseTimings(timings);
}

function runWithCodeEvidenceDatabase(
  runtime: CodeIndexModeRuntime,
  operation: (database: SqliteDatabase, timings: CodeIndexPhaseTimings) => void,
  options: { beforeOpen?(): void } = {},
): void {
  const totalStarted = process.hrtime.bigint();
  const phaseTimings: CodeIndexPhaseTimings = {};
  let database: SqliteDatabase | undefined;
  try {
    measurePhase(phaseTimings, "require_existing_index_ms", () => runtime.requireExistingIndex());
    options.beforeOpen?.();
    database = measurePhase(phaseTimings, "open_database_ms", () => runtime.openDatabase(runtime.codeEvidenceDatabasePath().absolutePath));
    operation(database, phaseTimings);
  } finally {
    if (database) {
      const openedDatabase = database;
      measurePhase(phaseTimings, "close_database_ms", () => openedDatabase.close());
    }
    finishCodeEvidencePhaseTimings(totalStarted, phaseTimings);
  }
}

function requireCompatibleDatabaseTimed(database: SqliteDatabase, runtime: CodeIndexModeRuntime, timings: CodeIndexPhaseTimings): void {
  measurePhase(timings, "compatibility_ms", () => requireCompatibleDatabase(database, runtime));
}

function checkedCodeIndexStaleness(database: SqliteDatabase, runtime: CodeIndexModeRuntime, timings: CodeIndexPhaseTimings): CodeIndexStaleness {
  const staleness = measurePhase(timings, "staleness_ms", () => runtime.codeIndexStaleness(database));
  runtime.warnIfCodeIndexStale(database, staleness);
  return staleness;
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
  const existingIndex = fs.existsSync(databasePath.absolutePath);
  if (codeIndexIncrementalMode && !existingIndex) {
    runtime.fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
  }
  let compatibility = { compatible: false, reason: "compatibility was not checked" };
  let checkedCompatibility = false;
  if (existingIndex) {
    try {
      measurePhase(phaseTimings, "compatibility_ms", () => {
        const existingDatabase = runtime.openDatabase(databasePath.absolutePath);
        try {
          compatibility = incrementalCompatibility(existingDatabase, scopes, parserMode);
          checkedCompatibility = true;
        } finally {
          existingDatabase.close();
        }
      });
    } catch {
      if (!codeIndexFullMode && !codeIndexMigrateMode) runtime.fail(unreadableIndexMessage(runtime));
    }
    if (!compatibility.compatible && schemaMigrationRequired(compatibility.reason) && !codeIndexMigrateMode) {
      runtime.fail(schemaMigrationRequiredMessage(runtime, compatibility.reason, { parserMode, requestedEngine, scopes }));
    }
  }
  if (engine === "native-rust") {
    if (!codeIndexIncrementalMode) {
      try {
        measurePhase(phaseTimings, "native_helper_ms", () => runtime.runNativeCodeIndexMode({ databasePath, discoveredFiles, parserMode, requestedEngine, scopes }));
        finishCodeEvidencePhaseTimings(totalStarted, phaseTimings);
        return;
      } catch (error) {
        finishCodeEvidencePhaseTimings(totalStarted, phaseTimings);
        throw error;
      }
    }
  }
  let incremental = false;
  if (existingIndex && checkedCompatibility && !codeIndexFullMode && !codeIndexMigrateMode) {
    incremental = compatibility.compatible;
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
        finishCodeEvidencePhaseTimings(totalStarted, phaseTimings);
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
    finishCodeEvidencePhaseTimings(totalStarted, phaseTimings);
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
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    database.exec("PRAGMA query_only = ON");
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const rows = measurePhase(phaseTimings, "query_ms", () => database.prepare(codeQuerySql).all());
    measurePhase(phaseTimings, "render_ms", () => printRows(rows));
  }, {
    beforeOpen() {
      if (!isReadOnlySql(codeQuerySql)) {
        console.error("code queries must be read-only SQL starting with SELECT or WITH");
        process.exit(1);
      }
    },
  });
}

export function runCodeReportMode(runtime: CodeIndexModeRuntime): void {
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    const staleness = checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const report = measurePhase(phaseTimings, "query_ms", () => runtime.codeReportForRequestedSection(database, codeReportSection, { staleness }));
    if (!report) runtime.fail(invalidCodeReportSectionMessage(codeReportSection));
    measurePhase(phaseTimings, "render_ms", () => printJson(report));
  });
}

export function runCodeStatusMode(runtime: CodeIndexModeRuntime): void {
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    const rows = measurePhase(phaseTimings, "query_ms", () => database.prepare(`
      SELECT 'files' AS metric, count(*) AS value FROM files
      UNION ALL SELECT 'symbols', count(*) FROM symbols
      UNION ALL SELECT 'imports', count(*) FROM imports
      UNION ALL SELECT 'routes', count(*) FROM routes
      UNION ALL SELECT 'edges', count(*) FROM edges
      UNION ALL SELECT 'configs', count(*) FROM configs
    `).all());
    const staleness = measurePhase(phaseTimings, "staleness_ms", () => runtime.codeIndexStaleness(database));
    rows.push(
      { metric: "stale_files", value: staleness.added + staleness.changed + staleness.deleted },
      { metric: "stale_changed_files", value: staleness.changed },
      { metric: "stale_added_files", value: staleness.added },
      { metric: "stale_deleted_files", value: staleness.deleted },
    );
    measurePhase(phaseTimings, "render_ms", () => printRows(rows));
  });
}

export function runCodeIndexHealthMode(runtime: CodeIndexModeRuntime): void {
  printJson(runtime.codeIndexHealth());
}

export function runCodeFilesMode(runtime: CodeIndexModeRuntime): void {
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const rows = measurePhase(phaseTimings, "query_ms", () => database.prepare("SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path").all());
    measurePhase(phaseTimings, "render_ms", () => printRows(rows));
  });
}

export function runCodeImpactMode(runtime: CodeIndexModeRuntime): void {
  if (!codeImpactTarget.trim()) {
    console.error("missing impact target: use --code-impact \"path-or-symbol-or-module\"");
    process.exit(1);
  }
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    const staleness = checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const impact = measurePhase(phaseTimings, "query_ms", () => runtime.codeImpact(database, codeImpactTarget.trim(), { staleness }));
    measurePhase(phaseTimings, "render_ms", () => printJson(impact));
  });
}

export function runCodeContextPackMode(runtime: CodeIndexModeRuntime): void {
  if (!codeContextPackTarget.trim()) {
    console.error("missing context pack query: use --code-context-pack \"path-or-symbol-or-route\"");
    process.exit(1);
  }
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    const staleness = checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const pack = measurePhase(phaseTimings, "query_ms", () => runtime.codeContextPack(database, codeContextPackTarget.trim(), { staleness }));
    measurePhase(phaseTimings, "render_ms", () => console.log(pack));
  });
}

export function runCodeSearchSymbolMode(runtime: CodeIndexModeRuntime): void {
  if (!codeSearchSymbol.trim()) {
    console.error("missing symbol search term: use --code-search-symbol \"term\"");
    process.exit(1);
  }
  runWithCodeEvidenceDatabase(runtime, (database, phaseTimings) => {
    requireCompatibleDatabaseTimed(database, runtime, phaseTimings);
    checkedCodeIndexStaleness(database, runtime, phaseTimings);
    const rows = measurePhase(phaseTimings, "query_ms", () => searchSymbols(database, codeSearchSymbol.trim()));
    measurePhase(phaseTimings, "render_ms", () => printRows(rows));
  });
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
