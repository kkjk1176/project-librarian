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
exports.requireNativeCodeIndexHelperPath = requireNativeCodeIndexHelperPath;
exports.buildNativeCodeIndexJob = buildNativeCodeIndexJob;
exports.runNativeCodeIndexHelper = runNativeCodeIndexHelper;
exports.runNativeCodeIndexRowsHelper = runNativeCodeIndexRowsHelper;
const childProcess = __importStar(require("node:child_process"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const workspace_1 = require("../workspace");
function configuredHelperPath(options = {}) {
    return (options.helperPath ?? process.env.PROJECT_LIBRARIAN_NATIVE_INDEXER ?? "").trim();
}
function requireUsableHelperPath(helperPath) {
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
function requireNativeCodeIndexHelperPath(options = {}) {
    return requireUsableHelperPath(configuredHelperPath(options));
}
function writeJobManifest(job) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-native-indexer-"));
    const manifestPath = path.join(tmpDir, "job.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(job, null, 2)}\n`);
    return manifestPath;
}
function buildNativeCodeIndexJob(input) {
    return {
        abi_version: 1,
        engine: "native-rust",
        mode: "full",
        project_root: (0, workspace_1.normalizePath)(workspace_1.root),
        ...input,
    };
}
function validateNativeCodeIndexSummary(job, summary) {
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
function runNativeCodeIndexHelper(job, options = {}) {
    const helperPath = requireNativeCodeIndexHelperPath(options);
    const manifestPath = writeJobManifest(job);
    try {
        const result = childProcess.spawnSync(helperPath, ["--manifest", manifestPath], {
            cwd: workspace_1.root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        if (result.status !== 0) {
            const detail = (result.stderr || result.stdout || "").trim();
            throw new Error(`native code index helper failed (${result.status ?? "signal"}): ${detail || helperPath}`);
        }
        let summary;
        try {
            summary = JSON.parse(result.stdout || "{}");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`native code index helper returned invalid JSON: ${message}`);
        }
        return validateNativeCodeIndexSummary(job, summary);
    }
    finally {
        fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });
    }
}
function validateNativeRows(value) {
    if (typeof value !== "object" || value === null) {
        throw new Error("native code index helper row stream must be an object");
    }
    const rows = value;
    for (const key of ["edges", "files", "imports", "routes", "symbols"]) {
        if (!Array.isArray(rows[key])) {
            throw new Error(`native code index helper row stream missing array: ${key}`);
        }
    }
    return rows;
}
function runNativeCodeIndexRowsHelper(job, options = {}) {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`native code index helper did not write rows: ${message}`);
    }
    try {
        return { rows: validateNativeRows(JSON.parse(rowsJson)), summary };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`native code index helper returned invalid row stream: ${message}`);
    }
}
