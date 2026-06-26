import * as fs from "node:fs";
import type { SqliteDatabase } from "../code-index-db";

export type CodeIndexHealthStatus = "missing" | "compatible" | "incompatible_schema" | "unreadable";

export interface CodeIndexHealth {
  database_path: string;
  expected_schema_version: string;
  found_schema_version: string;
  indexed_files: number | null;
  indexable_files: number | null;
  message: string;
  parser_mode: string;
  recommended_rebuild_command: string;
  scopes: string[];
  status: CodeIndexHealthStatus;
  tables: string[];
  updated_at: string;
}

export interface InspectCodeIndexHealthOptions {
  absolutePath: string;
  defaultScopes: string[];
  discoverCodeFiles(scopes: string[]): string[];
  expectedSchemaVersion: string;
  openDatabase(databasePath: string): SqliteDatabase;
  relativePath: string;
  smallRepoThreshold: number;
}

function safeDiscoverCodeFiles(discoverCodeFiles: (scopes: string[]) => string[], scopes: string[]): number | null {
  try {
    return discoverCodeFiles(scopes).length;
  } catch {
    return null;
  }
}

function safeScalar(database: SqliteDatabase, sql: string, param?: string): string {
  try {
    const rows = typeof param === "string" ? database.prepare(sql).all(param) : database.prepare(sql).all();
    const value = rows[0]?.value;
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  } catch {
    return "";
  }
}

function tableNames(database: SqliteDatabase): string[] {
  try {
    return database.prepare("SELECT name AS value FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name")
      .all()
      .map((row) => String(row.value))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readScopes(scopesJson: string, scopesText: string, fallback: string[]): string[] {
  if (scopesJson) {
    try {
      const parsed = JSON.parse(scopesJson);
      if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) return parsed;
    } catch {
      // Fall back to legacy comma-separated metadata below.
    }
  }
  const scopes = scopesText.split(",").map((scope) => scope.trim()).filter(Boolean);
  return scopes.length > 0 ? scopes : fallback;
}

function rebuildCommand(indexableFiles: number | null, smallRepoThreshold: number, options: { schemaMigration?: boolean } = {}): string {
  const parts = ["project-librarian", "--code-index", options.schemaMigration ? "--code-index-migrate" : "--code-index-full"];
  if (indexableFiles !== null && indexableFiles < smallRepoThreshold) parts.push("--acknowledge-small-repo");
  return parts.join(" ");
}

function baseHealth(options: InspectCodeIndexHealthOptions, status: CodeIndexHealthStatus, message: string, indexableFiles: number | null): CodeIndexHealth {
  return {
    database_path: options.relativePath,
    expected_schema_version: options.expectedSchemaVersion,
    found_schema_version: "",
    indexed_files: null,
    indexable_files: indexableFiles,
    message,
    parser_mode: "",
    recommended_rebuild_command: rebuildCommand(indexableFiles, options.smallRepoThreshold),
    scopes: options.defaultScopes,
    status,
    tables: [],
    updated_at: "",
  };
}

export function inspectCodeIndexHealth(options: InspectCodeIndexHealthOptions): CodeIndexHealth {
  if (!fs.existsSync(options.absolutePath)) {
    const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
    return baseHealth(options, "missing", `missing code evidence index: ${options.relativePath}`, indexableFiles);
  }

  let database: SqliteDatabase;
  try {
    database = options.openDatabase(options.absolutePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
    return baseHealth(options, "unreadable", `code evidence index is not readable: ${message}`, indexableFiles);
  }

  try {
    database.exec("PRAGMA query_only = ON");
    const tables = tableNames(database);
    const foundSchemaVersion = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "schema_version");
    const updatedAt = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "updated_at");
    const parserMode = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "parser_mode");
    const scopes = readScopes(
      safeScalar(database, "SELECT value FROM meta WHERE key = ?", "scopes_json"),
      safeScalar(database, "SELECT value FROM meta WHERE key = ?", "scopes"),
      options.defaultScopes,
    );
    const indexedFilesText = tables.includes("files") ? safeScalar(database, "SELECT count(*) AS value FROM files") : "";
    const indexedFiles = indexedFilesText ? Number(indexedFilesText) : null;
    const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, scopes.length > 0 ? scopes : options.defaultScopes);
    const compatible = foundSchemaVersion === options.expectedSchemaVersion;
    const schemaMigration = Boolean(foundSchemaVersion) && !compatible;
    return {
      database_path: options.relativePath,
      expected_schema_version: options.expectedSchemaVersion,
      found_schema_version: foundSchemaVersion,
      indexed_files: indexedFiles !== null && Number.isFinite(indexedFiles) ? indexedFiles : null,
      indexable_files: indexableFiles,
      message: compatible
        ? `code evidence index is compatible: schema ${foundSchemaVersion}`
        : `code evidence index schema version ${foundSchemaVersion || "(missing)"} is incompatible with ${options.expectedSchemaVersion}`,
      parser_mode: parserMode,
      recommended_rebuild_command: rebuildCommand(indexableFiles, options.smallRepoThreshold, { schemaMigration }),
      scopes,
      status: compatible ? "compatible" : "incompatible_schema",
      tables,
      updated_at: updatedAt,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
    return baseHealth(options, "unreadable", `code evidence index is not readable: ${message}`, indexableFiles);
  } finally {
    database.close();
  }
}

export function formatCodeIndexHealthRemediation(health: CodeIndexHealth): string {
  return [
    health.message,
    `database: ${health.database_path}`,
    `status: ${health.status}`,
    `expected_schema_version: ${health.expected_schema_version}`,
    `found_schema_version: ${health.found_schema_version || "(missing)"}`,
    `rebuild: ${health.recommended_rebuild_command}`,
  ].join("\n");
}
