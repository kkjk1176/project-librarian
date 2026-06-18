import * as fs from "node:fs";
import { acknowledgeSmallRepoMode, codeContextPackTarget, codeFilesMode, codeImpactMode, codeImpactTarget, codeIndexFullMode, codeIndexHealthMode, codeIndexIncrementalMode, codeIndexMode, codeQuerySql, codeReportMode, codeReportSection, codeSearchSymbol, codeStatusMode } from "../args";
import type { SqliteDatabase } from "../code-index-db";
import { discoverCodeFiles, smallRepoCodeIndexGate } from "../code-index-file-policy";
import { isReadOnlySql } from "../code-index-sql";
import type { CodeContextPackOptions, CodeEvidenceRenderOptions, CodeIndexStaleness } from "../code-index";
import type { CodeFile, CodeFileFingerprint } from "./extractors/types";
import { invalidCodeReportSectionMessage } from "./reports";
import { codeIndexSchemaVersion, createIndexStatements, incrementalCompatibility, readMetaValue, removeIndexedFile, setupDatabase, writeIndexMetadata, type CodeParserMode, type IndexStatements } from "./schema";
import { searchSymbols } from "./search";

export interface CodeEvidenceDatabasePath {
  absolutePath: string;
  relativePath: string;
}

export interface CodeIndexModeRuntime {
  codeContextPack(database: SqliteDatabase, query: string, options?: CodeContextPackOptions): string;
  codeEvidenceDatabasePath(): CodeEvidenceDatabasePath;
  codeImpact(database: SqliteDatabase, target: string, options?: CodeEvidenceRenderOptions): Record<string, unknown>;
  codeIndexHealth(): unknown;
  codeIndexStaleness(database: SqliteDatabase): CodeIndexStaleness;
  codeReportForRequestedSection(database: SqliteDatabase, requestedSection: string, options?: CodeEvidenceRenderOptions): Record<string, unknown> | undefined;
  codeScopes(): string[];
  fail(message: string): never;
  indexCodeFile(file: CodeFile, statements: IndexStatements): void;
  openDatabase(databasePath: string): SqliteDatabase;
  prepareOutputPath(): void;
  readCodeFileFingerprint(relativePath: string): CodeFileFingerprint;
  readCodeFile(relativePath: string, parserMode: CodeParserMode): CodeFile;
  removeDatabaseFiles(databasePath: string): void;
  requireExistingIndex(): void;
  selectedCodeParserMode(): CodeParserMode;
  warnIfCodeIndexStale(database: SqliteDatabase, staleness?: CodeIndexStaleness): void;
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
    runtime.fail(`code evidence index schema version ${schemaVersion || "(missing)"} is incompatible with ${codeIndexSchemaVersion}; rebuild with --code-index`);
  }
}

export function runCodeIndexMode(runtime: CodeIndexModeRuntime): void {
  const databasePath = runtime.codeEvidenceDatabasePath();
  const scopes = runtime.codeScopes();
  const parserMode = runtime.selectedCodeParserMode();
  // Scale gate before ANY write or database work: below the measured threshold
  // the build halts with the evidence-citing warning unless --acknowledge-small-repo
  // was passed (2026-06-12 scale-aware guidance decision).
  const discoveredFiles = discoverCodeFiles(scopes);
  const scaleGate = smallRepoCodeIndexGate(discoveredFiles.length, acknowledgeSmallRepoMode);
  if (!scaleGate.proceed) runtime.fail(scaleGate.warning);
  const existingIndex = fs.existsSync(databasePath.absolutePath);
  if (codeIndexIncrementalMode && !existingIndex) {
    runtime.fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
  }
  let incremental = false;
  if (existingIndex && !codeIndexFullMode) {
    let compatibility = { compatible: false, reason: "compatibility was not checked" };
    const existingDatabase = runtime.openDatabase(databasePath.absolutePath);
    try {
      compatibility = incrementalCompatibility(existingDatabase, scopes, parserMode);
    } finally {
      existingDatabase.close();
    }
    incremental = !codeIndexFullMode && compatibility.compatible;
    if (codeIndexIncrementalMode && !compatibility.compatible) runtime.fail(`--incremental cannot update ${databasePath.relativePath}: ${compatibility.reason}`);
  }
  runtime.prepareOutputPath();
  if (!incremental) runtime.removeDatabaseFiles(databasePath.absolutePath);
  const database = runtime.openDatabase(databasePath.absolutePath);
  try {
    if (!incremental) setupDatabase(database);
    const statements = createIndexStatements(database);
    const currentFingerprints = discoveredFiles.map((filePath) => runtime.readCodeFileFingerprint(filePath));
    let reindexedFiles: CodeFile[];
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
      reindexedFiles = [];
      for (const file of currentFingerprints) {
        const existing = indexed.get(file.path);
        if (existing && existing.mtimeMs === file.mtimeMs && existing.size === file.size) {
          unchangedFiles += 1;
          continue;
        }
        reindexedFiles.push(runtime.readCodeFile(file.path, parserMode));
      }
    } else {
      deletedPaths = [];
      reindexedFiles = discoveredFiles.map((filePath) => runtime.readCodeFile(filePath, parserMode));
    }

    database.exec("BEGIN");
    if (!incremental) statements.insertMeta.run("created_at", new Date().toISOString());
    writeIndexMetadata(scopes, parserMode, statements);
    for (const filePath of deletedPaths) removeIndexedFile(filePath, statements);
    for (const file of reindexedFiles) {
      if (incremental && indexedPaths.has(file.path)) removeIndexedFile(file.path, statements);
      runtime.indexCodeFile(file, statements);
    }
    database.exec("COMMIT");
    console.log("Project wiki code evidence index complete.");
    console.log(`database: ${databasePath.relativePath}`);
    console.log(`mode: ${incremental ? "incremental" : "full"}`);
    console.log(`parser_mode: ${parserMode}`);
    console.log(`scopes: ${scopes.join(", ")}`);
    console.log(`files: ${currentFingerprints.length}`);
    console.log(`reindexed_files: ${reindexedFiles.length}`);
    console.log(`deleted_files: ${deletedPaths.length}`);
    console.log(`unchanged_files: ${unchangedFiles}`);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after setup errors.
    }
    throw error;
  } finally {
    database.close();
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
