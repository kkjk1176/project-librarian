import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CodeParserMode } from "./schema";
import { normalizePath, root } from "../workspace";

export type NativeCodeIndexEngine = "native-rust";

export interface NativeCodeIndexFile {
  language: string;
  mtimeMs: number;
  path: string;
  profile: string;
  size: number;
}

export interface NativeCodeIndexJob {
  abi_version: 1;
  database_path: string;
  engine: NativeCodeIndexEngine;
  files: NativeCodeIndexFile[];
  mode: "full";
  parser_mode: CodeParserMode;
  project_root: string;
  scopes: string[];
  schema_version: string;
}

export interface NativeCodeIndexSummary {
  database?: string;
  database_path?: string;
  deleted_files?: number;
  engine?: string;
  files?: number;
  mode?: string;
  native_files?: number;
  reindexed_files?: number;
  schema_version?: string;
  typescript_files?: number;
  unchanged_files?: number;
  unsupported_profiles?: string[];
  warnings?: string[];
}

export interface NativeCodeIndexHelperOptions {
  helperPath?: string;
}

function configuredHelperPath(options: NativeCodeIndexHelperOptions = {}): string {
  return (options.helperPath ?? process.env.PROJECT_LIBRARIAN_NATIVE_INDEXER ?? "").trim();
}

function requireUsableHelperPath(helperPath: string): string {
  if (!helperPath) {
    throw new Error("--code-index-engine native-rust requires PROJECT_LIBRARIAN_NATIVE_INDEXER to point to the native helper; no native helper is packaged yet.");
  }
  if (!path.isAbsolute(helperPath)) {
    throw new Error(`PROJECT_LIBRARIAN_NATIVE_INDEXER must be an absolute path: ${helperPath}`);
  }
  const resolved = path.resolve(helperPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`PROJECT_LIBRARIAN_NATIVE_INDEXER does not exist: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`PROJECT_LIBRARIAN_NATIVE_INDEXER must point to an executable file: ${resolved}`);
  }
  return resolved;
}

export function requireNativeCodeIndexHelperPath(options: NativeCodeIndexHelperOptions = {}): string {
  return requireUsableHelperPath(configuredHelperPath(options));
}

function writeJobManifest(job: NativeCodeIndexJob): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-native-indexer-"));
  const manifestPath = path.join(tmpDir, "job.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(job, null, 2)}\n`);
  return manifestPath;
}

export function buildNativeCodeIndexJob(input: Omit<NativeCodeIndexJob, "abi_version" | "engine" | "mode" | "project_root">): NativeCodeIndexJob {
  return {
    abi_version: 1,
    engine: "native-rust",
    mode: "full",
    project_root: normalizePath(root),
    ...input,
  };
}

function validateNativeCodeIndexSummary(job: NativeCodeIndexJob, summary: NativeCodeIndexSummary): NativeCodeIndexSummary {
  if (summary.engine !== job.engine) {
    throw new Error(`native code index helper summary engine mismatch: expected ${job.engine}, got ${summary.engine ?? "(missing)"}`);
  }
  if (summary.schema_version !== job.schema_version) {
    throw new Error(`native code index helper summary schema mismatch: expected ${job.schema_version}, got ${summary.schema_version ?? "(missing)"}`);
  }
  if (summary.mode !== job.mode) {
    throw new Error(`native code index helper summary mode mismatch: expected ${job.mode}, got ${summary.mode ?? "(missing)"}`);
  }
  const database = summary.database ?? summary.database_path ?? "";
  if (path.resolve(database) !== path.resolve(job.database_path)) {
    throw new Error(`native code index helper summary database mismatch: expected ${job.database_path}, got ${database || "(missing)"}`);
  }
  if (!Number.isInteger(summary.files) || (summary.files ?? -1) < 0) {
    throw new Error("native code index helper summary files must be a non-negative integer");
  }
  if (summary.native_files !== undefined && summary.native_files !== job.files.length) {
    throw new Error(`native code index helper summary native_files mismatch: expected ${job.files.length}, got ${summary.native_files}`);
  }
  if ((summary.unsupported_profiles ?? []).length > 0) {
    throw new Error(`native code index helper reported unsupported profiles: ${(summary.unsupported_profiles ?? []).join(", ")}`);
  }
  return summary;
}

export function runNativeCodeIndexHelper(job: NativeCodeIndexJob, options: NativeCodeIndexHelperOptions = {}): NativeCodeIndexSummary {
  const helperPath = requireNativeCodeIndexHelperPath(options);
  const manifestPath = writeJobManifest(job);
  try {
    const result = childProcess.spawnSync(helperPath, ["--manifest", manifestPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(`native code index helper failed (${result.status ?? "signal"}): ${detail || helperPath}`);
    }
    let summary: NativeCodeIndexSummary;
    try {
      summary = JSON.parse(result.stdout || "{}") as NativeCodeIndexSummary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`native code index helper returned invalid JSON: ${message}`);
    }
    return validateNativeCodeIndexSummary(job, summary);
  } finally {
    fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });
  }
}
