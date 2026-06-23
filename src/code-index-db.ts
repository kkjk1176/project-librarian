export type SqliteValue = string | number | null;

export interface SqliteStatement {
  all(...params: SqliteValue[]): Record<string, unknown>[];
  run(...params: SqliteValue[]): void;
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

export const codeEvidenceNodeRuntimeRequirement = "Node.js 22.13+ or 24+; node:sqlite was added in Node.js 22.5.0 and became available without --experimental-sqlite in Node.js 22.13.0";

function warningType(option: unknown): string {
  if (typeof option === "string") return option;
  if (typeof option !== "object" || option === null || !("type" in option)) return "";
  const value = (option as { type?: unknown }).type;
  return typeof value === "string" ? value : "";
}

function isSqliteExperimentalWarning(warning: unknown, options: unknown[]): boolean {
  const message = warning instanceof Error ? warning.message : typeof warning === "string" ? warning : "";
  const type = warning instanceof Error ? warning.name : warningType(options[0]);
  return type === "ExperimentalWarning" && message.includes("SQLite");
}

export function loadDatabaseSync(fail: (message: string) => never): SqliteDatabaseConstructor {
  const previousEmitWarning = process.emitWarning;
  try {
    process.emitWarning = ((warning: unknown, ...options: unknown[]): void => {
      if (isSqliteExperimentalWarning(warning, options)) return;
      (previousEmitWarning as (...args: unknown[]) => void).call(process, warning, ...options);
    }) as typeof process.emitWarning;
    const sqlite = require("node:sqlite") as { DatabaseSync: SqliteDatabaseConstructor };
    return sqlite.DatabaseSync;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`code evidence index requires Node.js 22.13+ because it uses node:sqlite without experimental flags; current Node is ${process.version}. Runtime policy: ${codeEvidenceNodeRuntimeRequirement}. Error: ${message}`);
  } finally {
    process.emitWarning = previousEmitWarning;
  }
}

export function openDatabase(databasePath: string, fail: (message: string) => never): SqliteDatabase {
  const DatabaseSync = loadDatabaseSync(fail);
  return new DatabaseSync(databasePath);
}
