import * as crypto from "node:crypto";
import type { SqliteDatabase, SqliteStatement, SqliteValue } from "../code-index-db";
import { root } from "../workspace";

export type CodeParserMode = "default" | "tree-sitter";

export interface IndexStatements {
  deleteConfig: SqliteStatement;
  deleteEdge: SqliteStatement;
  deleteFile: SqliteStatement;
  deleteFileFts: SqliteStatement;
  deleteImport: SqliteStatement;
  deleteRoute: SqliteStatement;
  deleteSymbol: SqliteStatement;
  deleteSymbolFts: SqliteStatement;
  insertConfig: SqliteStatement;
  insertEdge: SqliteStatement;
  insertFile: SqliteStatement;
  insertFileFts: SqliteStatement;
  insertImport: SqliteStatement;
  insertMeta: SqliteStatement;
  insertRoute: SqliteStatement;
  insertSymbol: SqliteStatement;
  insertSymbolFts: SqliteStatement;
}

export const codeIndexSchemaVersion = "6";

function stableFtsRowid(parts: string[]): number {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  const digest = hash.digest();
  let value = 0;
  for (let index = 0; index < 6; index += 1) value = value * 256 + digest[index]!;
  return value + 1;
}

export function fileFtsRowid(filePath: string): number {
  return stableFtsRowid(["file", filePath]);
}

const secondaryIndexSql = `
  CREATE INDEX idx_symbols_file ON symbols(file_path);
  CREATE INDEX idx_symbols_name ON symbols(name);
  CREATE INDEX idx_imports_from ON imports(from_file);
  CREATE INDEX idx_routes_path ON routes(route);
  CREATE INDEX idx_configs_file ON configs(file_path);
  CREATE INDEX idx_edges_source ON edges(source_kind, source);
  CREATE INDEX idx_edges_target ON edges(target_kind, target);
  CREATE INDEX idx_edges_kind ON edges(kind);
`;

export function createSecondaryIndexes(database: SqliteDatabase): void {
  database.exec(secondaryIndexSql);
}

export function setupDatabase(database: SqliteDatabase, options: { secondaryIndexes?: boolean } = {}): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      fts_rowid INTEGER NOT NULL UNIQUE,
      language TEXT NOT NULL,
      profile TEXT NOT NULL,
      kind TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      hash TEXT NOT NULL,
      mtime_ms REAL NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      signature TEXT NOT NULL
    );
    CREATE TABLE imports (
      id INTEGER PRIMARY KEY,
      from_file TEXT NOT NULL,
      to_ref TEXT NOT NULL,
      imported TEXT NOT NULL,
      line INTEGER NOT NULL,
      raw TEXT NOT NULL
    );
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY,
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      handler TEXT NOT NULL
    );
    CREATE TABLE configs (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      evidence TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content);
    CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature);
  `);
  if (options.secondaryIndexes ?? true) createSecondaryIndexes(database);
}

export function createIndexStatements(database: SqliteDatabase): IndexStatements {
  return {
    deleteConfig: database.prepare("DELETE FROM configs WHERE file_path = ?"),
    deleteEdge: database.prepare("DELETE FROM edges WHERE file_path = ?"),
    deleteFile: database.prepare("DELETE FROM files WHERE path = ?"),
    deleteFileFts: database.prepare("DELETE FROM files_fts WHERE rowid = (SELECT fts_rowid FROM files WHERE path = ?)"),
    deleteImport: database.prepare("DELETE FROM imports WHERE from_file = ?"),
    deleteRoute: database.prepare("DELETE FROM routes WHERE file_path = ?"),
    deleteSymbol: database.prepare("DELETE FROM symbols WHERE file_path = ?"),
    deleteSymbolFts: database.prepare("DELETE FROM symbols_fts WHERE file_path = ?"),
    insertConfig: database.prepare("INSERT INTO configs (key, value, file_path, line) VALUES (?, ?, ?, ?)"),
    insertEdge: database.prepare("INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    insertFile: database.prepare("INSERT INTO files (path, fts_rowid, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    insertFileFts: database.prepare("INSERT INTO files_fts (rowid, path, language, profile, content) VALUES (?, ?, ?, ?, ?)"),
    insertImport: database.prepare("INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES (?, ?, ?, ?, ?)"),
    insertMeta: database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    insertRoute: database.prepare("INSERT INTO routes (method, route, file_path, line, handler) VALUES (?, ?, ?, ?, ?)"),
    insertSymbol: database.prepare("INSERT INTO symbols (name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?)"),
    insertSymbolFts: database.prepare("INSERT INTO symbols_fts (rowid, name, kind, file_path, signature) VALUES (last_insert_rowid(), ?, ?, ?, ?)"),
  };
}

export function removeIndexedFile(filePath: string, statements: IndexStatements): void {
  statements.deleteConfig.run(filePath);
  statements.deleteEdge.run(filePath);
  statements.deleteImport.run(filePath);
  statements.deleteRoute.run(filePath);
  statements.deleteSymbol.run(filePath);
  statements.deleteSymbolFts.run(filePath);
  statements.deleteFileFts.run(filePath);
  statements.deleteFile.run(filePath);
}

export function writeIndexMetadata(scopes: string[], parserMode: CodeParserMode, statements: IndexStatements): void {
  statements.insertMeta.run("schema_version", codeIndexSchemaVersion);
  statements.insertMeta.run("updated_at", new Date().toISOString());
  statements.insertMeta.run("root", root);
  statements.insertMeta.run("scopes", scopes.join(", "));
  statements.insertMeta.run("scopes_json", JSON.stringify(scopes));
  statements.insertMeta.run("parser_mode", parserMode);
  statements.insertMeta.run("terminology", "code evidence index");
}

export function readMetaValue(database: SqliteDatabase, key: string): string {
  const rows = database.prepare("SELECT value FROM meta WHERE key = ?").all(key);
  const value = rows[0]?.value;
  return typeof value === "string" ? value : "";
}

export function indexedScopes(database: SqliteDatabase): string[] {
  const scopesJson = readMetaValue(database, "scopes_json");
  if (scopesJson) {
    try {
      const parsed = JSON.parse(scopesJson);
      if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) return parsed;
    } catch {
      // Fall back to the legacy comma-separated scope metadata below.
    }
  }
  return readMetaValue(database, "scopes")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function indexedParserMode(database: SqliteDatabase): CodeParserMode {
  const mode = readMetaValue(database, "parser_mode");
  return mode === "tree-sitter" ? "tree-sitter" : "default";
}

function scopesMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

export function incrementalCompatibility(database: SqliteDatabase, scopes: string[], parserMode: CodeParserMode): { compatible: boolean; reason: string } {
  const existingSchemaVersion = readMetaValue(database, "schema_version");
  if (existingSchemaVersion !== codeIndexSchemaVersion) {
    return {
      compatible: false,
      reason: `existing schema version ${existingSchemaVersion || "(missing)"} does not match ${codeIndexSchemaVersion}`,
    };
  }
  const existingScopes = indexedScopes(database);
  if (!scopesMatch(existingScopes, scopes)) {
    return {
      compatible: false,
      reason: `indexed scopes do not match requested scopes: indexed [${existingScopes.join(", ")}], requested [${scopes.join(", ")}]`,
    };
  }
  const existingParserMode = indexedParserMode(database);
  if (existingParserMode !== parserMode) {
    return {
      compatible: false,
      reason: `indexed parser mode ${existingParserMode} does not match requested parser mode ${parserMode}`,
    };
  }
  return { compatible: true, reason: "" };
}

export type CodeIndexSnapshotRow = Record<string, SqliteValue>;

export interface CodeIndexSnapshot {
  configs: CodeIndexSnapshotRow[];
  edges: CodeIndexSnapshotRow[];
  files: CodeIndexSnapshotRow[];
  imports: CodeIndexSnapshotRow[];
  routes: CodeIndexSnapshotRow[];
  symbols: CodeIndexSnapshotRow[];
}

function snapshotRows(database: SqliteDatabase, sql: string): CodeIndexSnapshotRow[] {
  return database.prepare(sql).all().map((row) => {
    const normalized: CodeIndexSnapshotRow = {};
    for (const key of Object.keys(row).sort()) {
      const value = row[key];
      normalized[key] = typeof value === "string" || typeof value === "number" || value === null ? value : String(value);
    }
    return normalized;
  });
}

export function codeIndexSnapshot(database: SqliteDatabase): CodeIndexSnapshot {
  return {
    configs: snapshotRows(database, "SELECT file_path, line, key, value FROM configs ORDER BY file_path, line, key, value"),
    edges: snapshotRows(database, "SELECT file_path, line, kind, source_kind, source, target_kind, target, evidence FROM edges ORDER BY file_path, line, kind, source, target, evidence"),
    files: snapshotRows(database, "SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path"),
    imports: snapshotRows(database, "SELECT from_file, line, to_ref, imported, raw FROM imports ORDER BY from_file, line, to_ref, imported, raw"),
    routes: snapshotRows(database, "SELECT file_path, line, method, route, handler FROM routes ORDER BY file_path, line, method, route, handler"),
    symbols: snapshotRows(database, "SELECT file_path, line, kind, name, signature FROM symbols ORDER BY file_path, line, kind, name, signature"),
  };
}
