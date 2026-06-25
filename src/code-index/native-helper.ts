import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CodeParserMode } from "./schema";
import { normalizePath, root } from "../workspace";

export type NativeCodeIndexEngine = "native-rust";
export type NativeCodeIndexMode = "full" | "incremental";
export type NativeCodeIndexOutputMode = "row-stream" | "sqlite-bridge" | "sqlite-direct";

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
  deleted_paths?: string[];
  engine: NativeCodeIndexEngine;
  files: NativeCodeIndexFile[];
  mode: NativeCodeIndexMode;
  output_mode?: NativeCodeIndexOutputMode;
  parser_mode: CodeParserMode;
  project_root: string;
  rows_path?: string;
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
  arch?: string;
  env?: NodeJS.ProcessEnv;
  helperPath?: string;
  packageRoot?: string;
  platform?: NodeJS.Platform;
}

export type NativeCodeIndexHelperSource = "option" | "environment" | "packaged" | "missing";

export interface NativeCodeIndexHelperAvailability {
  available: boolean;
  helperPath: string;
  packagedHelperPath: string;
  platformTriple: string;
  reason: string;
  source: NativeCodeIndexHelperSource;
}

export interface NativeCodeIndexRows {
  configs: Array<{
    file_path: string;
    key: string;
    line: number;
    value: string;
  }>;
  edges: Array<{
    evidence: string;
    file_path: string;
    kind: string;
    line: number;
    source: string;
    source_kind: string;
    target: string;
    target_kind: string;
  }>;
  files: Array<{
    bytes: number;
    content: string;
    hash: string;
    kind: string;
    language: string;
    lines: number;
    mtime_ms: number;
    path: string;
    profile: string;
    size: number;
  }>;
  imports: Array<{
    from_file: string;
    imported: string;
    line: number;
    raw: string;
    to_ref: string;
  }>;
  routes: Array<{
    file_path: string;
    handler: string;
    line: number;
    method: string;
    route: string;
  }>;
  symbols: Array<{
    file_path: string;
    kind: string;
    line: number;
    name: string;
    signature: string;
  }>;
}

const supportedNativeHelperTriples = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

export function nativeCodeIndexHelperPlatformTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export function nativeCodeIndexHelperBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "project-librarian-indexer.exe" : "project-librarian-indexer";
}

function nativeCodeIndexHelperPackageRoot(options: NativeCodeIndexHelperOptions = {}): string {
  return path.resolve(options.packageRoot ?? path.join(__dirname, ".."));
}

export function packagedNativeCodeIndexHelperPath(options: NativeCodeIndexHelperOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return path.join(
    nativeCodeIndexHelperPackageRoot(options),
    "native",
    nativeCodeIndexHelperPlatformTriple(platform, arch),
    nativeCodeIndexHelperBinaryName(platform),
  );
}

function configuredHelperPath(options: NativeCodeIndexHelperOptions = {}): { helperPath: string; source: NativeCodeIndexHelperSource } {
  const optionPath = (options.helperPath ?? "").trim();
  if (optionPath) return { helperPath: optionPath, source: "option" };
  const envPath = ((options.env ?? process.env).PROJECT_LIBRARIAN_NATIVE_INDEXER ?? "").trim();
  if (envPath) return { helperPath: envPath, source: "environment" };
  return { helperPath: "", source: "missing" };
}

function helperPathLabel(source: NativeCodeIndexHelperSource): string {
  if (source === "option") return "native helper path";
  if (source === "environment") return "PROJECT_LIBRARIAN_NATIVE_INDEXER";
  return "packaged native helper";
}

function requireUsableHelperPath(helperPath: string, source: NativeCodeIndexHelperSource): string {
  const label = helperPathLabel(source);
  if (!path.isAbsolute(helperPath)) {
    throw new Error(`${label} must be an absolute path: ${helperPath}`);
  }
  const resolved = path.resolve(helperPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`${label} must point to an executable file: ${resolved}`);
  }
  fs.accessSync(resolved, fs.constants.X_OK);
  return resolved;
}

export function requireNativeCodeIndexHelperPath(options: NativeCodeIndexHelperOptions = {}): string {
  const availability = nativeCodeIndexHelperAvailability(options);
  if (availability.available) return availability.helperPath;
  throw new Error(availability.reason);
}

export function nativeCodeIndexHelperAvailability(options: NativeCodeIndexHelperOptions = {}): NativeCodeIndexHelperAvailability {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const platformTriple = nativeCodeIndexHelperPlatformTriple(platform, arch);
  const packagedHelperPath = packagedNativeCodeIndexHelperPath({ ...options, arch, platform });
  const configured = configuredHelperPath(options);
  if (configured.helperPath) {
    try {
      return {
        available: true,
        helperPath: requireUsableHelperPath(configured.helperPath, configured.source),
        packagedHelperPath,
        platformTriple,
        reason: "",
        source: configured.source,
      };
    } catch (error: unknown) {
      return {
        available: false,
        helperPath: "",
        packagedHelperPath,
        platformTriple,
        reason: error instanceof Error ? error.message : String(error),
        source: configured.source,
      };
    }
  }
  if (!supportedNativeHelperTriples.has(platformTriple)) {
    return {
      available: false,
      helperPath: "",
      packagedHelperPath,
      platformTriple,
      reason: `packaged native code index helper does not support this platform: ${platformTriple}; set PROJECT_LIBRARIAN_NATIVE_INDEXER to a compatible helper path`,
      source: "missing",
    };
  }
  if (fs.existsSync(packagedHelperPath)) {
    try {
      return {
        available: true,
        helperPath: requireUsableHelperPath(packagedHelperPath, "packaged"),
        packagedHelperPath,
        platformTriple,
        reason: "",
        source: "packaged",
      };
    } catch (error: unknown) {
      return {
        available: false,
        helperPath: "",
        packagedHelperPath,
        platformTriple,
        reason: error instanceof Error ? error.message : String(error),
        source: "packaged",
      };
    }
  }
  return {
    available: false,
    helperPath: "",
    packagedHelperPath,
    platformTriple,
    reason: `--code-index-engine native-rust requires PROJECT_LIBRARIAN_NATIVE_INDEXER or a packaged native helper at ${packagedHelperPath}`,
    source: "missing",
  };
}

export function nativeCodeIndexHelperAvailable(options: NativeCodeIndexHelperOptions = {}): boolean {
  return nativeCodeIndexHelperAvailability(options).available;
}

function writeJobManifest(job: NativeCodeIndexJob): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-native-indexer-"));
  const manifestPath = path.join(tmpDir, "job.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(job)}\n`);
  return manifestPath;
}

export function buildNativeCodeIndexJob(
  input: Omit<NativeCodeIndexJob, "abi_version" | "engine" | "mode" | "project_root"> & {
    mode?: NativeCodeIndexMode;
  },
): NativeCodeIndexJob {
  const { mode = "full", ...rest } = input;
  return {
    abi_version: 1,
    engine: "native-rust",
    mode,
    project_root: normalizePath(root),
    ...rest,
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

function validateNativeRows(value: unknown): NativeCodeIndexRows {
  if (typeof value !== "object" || value === null) {
    throw new Error("native code index helper row stream must be an object");
  }
  const rows = value as Partial<Record<keyof NativeCodeIndexRows, unknown>>;
  for (const key of ["configs", "edges", "files", "imports", "routes", "symbols"] as const) {
    if (!Array.isArray(rows[key])) {
      throw new Error(`native code index helper row stream missing array: ${key}`);
    }
  }
  return rows as NativeCodeIndexRows;
}

export function runNativeCodeIndexRowsHelper(job: NativeCodeIndexJob, options: NativeCodeIndexHelperOptions = {}): { rows: NativeCodeIndexRows; summary: NativeCodeIndexSummary } {
  if (job.output_mode !== "row-stream") {
    throw new Error("native row helper requires output_mode row-stream");
  }
  if (!job.rows_path) {
    throw new Error("native row helper requires rows_path");
  }
  const summary = runNativeCodeIndexHelper(job, options);
  let rowsJson = "";
  try {
    rowsJson = fs.readFileSync(job.rows_path, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`native code index helper did not write rows: ${message}`);
  }
  try {
    return { rows: validateNativeRows(JSON.parse(rowsJson)), summary };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`native code index helper returned invalid row stream: ${message}`);
  }
}
