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
exports.SMALL_REPO_FILE_THRESHOLD = exports.maxIndexedBytes = exports.ignoredDirectories = exports.codeEvidenceDirectory = void 0;
exports.fileLanguage = fileLanguage;
exports.isJavaScriptLike = isJavaScriptLike;
exports.shouldIndexFile = shouldIndexFile;
exports.isIgnoredCodePath = isIgnoredCodePath;
exports.cachedDiscoveredCodeFileStat = cachedDiscoveredCodeFileStat;
exports.discoverCodeFiles = discoverCodeFiles;
exports.smallRepoCodeIndexGate = smallRepoCodeIndexGate;
const childProcess = __importStar(require("node:child_process"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const path_ignore_policy_1 = require("./path-ignore-policy");
const workspace_1 = require("./workspace");
// Single source of truth for the disposable code-evidence directory name. Both
// the heavy code-index module and the light bootstrap path (hooks.ts) key off
// this; keeping it here avoids loading typescript/node:sqlite during bootstrap.
exports.codeEvidenceDirectory = ".project-wiki";
exports.ignoredDirectories = (0, path_ignore_policy_1.ignoredDirectorySet)([exports.codeEvidenceDirectory]);
const languageByExtension = {
    ".c": "c",
    ".cc": "cpp",
    ".cjs": "javascript",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".cts": "typescript",
    ".go": "go",
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".kt": "kotlin",
    ".mjs": "javascript",
    ".mts": "typescript",
    ".php": "php",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".vue": "vue",
};
const configExtensions = new Set([".json", ".yaml", ".yml", ".toml"]);
exports.maxIndexedBytes = 1024 * 1024;
const discoveredCodeFileStats = new Map();
function fileLanguage(relativePath) {
    if (path.basename(relativePath) === ".env.example")
        return "config";
    const extension = path.extname(relativePath).toLowerCase();
    return languageByExtension[extension] ?? (configExtensions.has(extension) ? "config" : "");
}
function isBlockedEnvFile(relativePath) {
    const base = path.basename(relativePath);
    return base.startsWith(".env") && base !== ".env.example";
}
function isBlockedSensitiveConfigFile(relativePath) {
    if (fileLanguage(relativePath) !== "config")
        return false;
    const base = path.basename(relativePath).toLowerCase();
    if (base === ".env.example")
        return false;
    if (base.startsWith("."))
        return true;
    return /(^|[._-])(secret|secrets|credential|credentials|token|tokens|private|key|keys)([._-]|$)/i.test(base);
}
function isJavaScriptLike(relativePath) {
    return [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(path.extname(relativePath).toLowerCase());
}
function shouldIndexFile(relativePath) {
    if (isBlockedEnvFile(relativePath))
        return false;
    if (isBlockedSensitiveConfigFile(relativePath))
        return false;
    const language = fileLanguage(relativePath);
    if (language)
        return true;
    const base = path.basename(relativePath);
    return ["Dockerfile", "Makefile", "package.json", "tsconfig.json"].includes(base);
}
function isIgnoredCodePath(relativePath) {
    return (0, path_ignore_policy_1.pathContainsIgnoredDirectory)(relativePath, exports.ignoredDirectories);
}
// Mirrors normalizeProjectRelative in code-index.ts for git ls-files output, but
// throws instead of exiting so the light bootstrap path can use discovery too.
// Git emits repo-relative paths, so the escape branch is unreachable for real
// output; it stays as a loud guard, not a recovery path.
function normalizeGitIndexedFile(input) {
    const raw = input.trim() || ".";
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace_1.root, raw);
    const rootResolved = path.resolve(workspace_1.root);
    if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
        throw new Error(`git-indexed file must stay inside the project root: ${input}`);
    }
    return (0, workspace_1.normalizePath)(path.relative(rootResolved, resolved)) || ".";
}
function walkCodeFiles(relativePath, files = []) {
    if (isIgnoredCodePath(relativePath))
        return files.sort();
    const target = (0, workspace_1.abs)(relativePath);
    if (!fs.existsSync(target))
        return files;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink())
        return files.sort();
    if (stat.isFile()) {
        if (stat.size <= exports.maxIndexedBytes && shouldIndexFile(relativePath))
            files.push(relativePath);
        return files.sort();
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const child = (0, workspace_1.normalizePath)(path.join(relativePath, entry.name));
        if (entry.isDirectory()) {
            if (!exports.ignoredDirectories.has(entry.name))
                walkCodeFiles(child, files);
        }
        else if (entry.isFile() && shouldIndexFile(child)) {
            const childStat = (0, workspace_1.containedProjectFileStat)(child);
            if (childStat && childStat.size <= exports.maxIndexedBytes)
                files.push(child);
        }
    }
    return files.sort();
}
function gitTrackedAndUnignoredFiles(scopes) {
    try {
        const output = childProcess.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...scopes], {
            cwd: workspace_1.root,
            encoding: "buffer",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return output.toString("utf8").split("\0").filter(Boolean).map((file) => normalizeGitIndexedFile(file));
    }
    catch {
        return null;
    }
}
function indexableFileStat(file) {
    return (0, workspace_1.containedProjectFileStat)(file);
}
function cachedDiscoveredCodeFileStat(relativePath) {
    return discoveredCodeFileStats.get(relativePath);
}
function discoverCodeFiles(scopes) {
    discoveredCodeFileStats.clear();
    const gitFiles = gitTrackedAndUnignoredFiles(scopes);
    const candidates = gitFiles ?? scopes.flatMap((scope) => walkCodeFiles(scope));
    const files = [];
    for (const file of Array.from(new Set(candidates))) {
        if (isIgnoredCodePath(file) || !shouldIndexFile(file))
            continue;
        const stat = indexableFileStat(file);
        if (stat && stat.size <= exports.maxIndexedBytes) {
            discoveredCodeFileStats.set(file, { absolutePath: (0, workspace_1.abs)(file), stat });
            files.push(file);
        }
    }
    return files.sort();
}
// --- Scale-aware code-evidence gate ------------------------------------------
//
// Threshold in indexable files (the discoverCodeFiles count) below which the
// code-evidence surfaces warn (--code-index) or skip by default (bootstrap MCP
// auto-registration). Evidence: stageR1 real-corpus run, 2026-06-12
// (benchmarks/reports/llm/stageR1-real.md) — the ~1.2k-file repo LOST every
// measured question (impact_trace +116.9%, workspace_graph +106.5% cost-weighted
// tokens vs direct reads) while the ~11.8k-file repo still lost the cheap
// ownership lookup (+99.0%) and won only the expensive traversal questions
// (impact_trace -27.7%, workspace_graph -2.6%); stage2d synthetic scales
// (benchmarks/reports/llm/stage2d-codegraph.md) lost across the board. 5000 sits
// between the two real measured points: an n=2 extrapolation (1.2k all-loss /
// 11.8k partial win), explicitly subject to revision as more scales are measured.
exports.SMALL_REPO_FILE_THRESHOLD = 5000;
// Decision for the --code-index scale gate: below the threshold the build halts
// with an evidence-citing warning unless the caller explicitly acknowledged the
// measured cost. Consent is honored, never refused (2026-06-12 decision: defaults
// follow the evidence, explicit requests get warning + consent).
function smallRepoCodeIndexGate(indexableFileCount, acknowledged) {
    if (acknowledged || indexableFileCount >= exports.SMALL_REPO_FILE_THRESHOLD)
        return { proceed: true, warning: "" };
    return {
        proceed: false,
        warning: [
            `--code-index halted: ${indexableFileCount} indexable files is below the ${exports.SMALL_REPO_FILE_THRESHOLD}-file scale threshold.`,
            "Measured evidence (real-corpus stageR1): on a ~1.2k-file repo the code-evidence track cost MORE on every measured question (impact_trace +116.9%, workspace_graph +106.5% cost-weighted tokens vs direct reads), and even on a ~11.8k-file repo ownership-style cheap lookups lost (+99.0%); only expensive traversal questions won there (impact_trace -27.7%).",
            "Reports: benchmarks/reports/llm/stageR1-real.md and benchmarks/reports/llm/stage2d-codegraph.md in the project-librarian repo (threshold is an n=2 extrapolation, subject to revision).",
            "Not measured, so not disproven: human-facing report value (--code-report) and answer accuracy/grounding value. This gate reflects measured LLM token cost only.",
            "To build the index anyway, re-run with --acknowledge-small-repo.",
        ].join("\n"),
    };
}
