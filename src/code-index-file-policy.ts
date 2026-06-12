import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { abs, normalizePath, root } from "./workspace";

// Single source of truth for the disposable code-evidence directory name. Both
// the heavy code-index module and the light bootstrap path (hooks.ts) key off
// this; keeping it here avoids loading typescript/node:sqlite during bootstrap.
export const codeEvidenceDirectory = ".project-wiki";

export const ignoredDirectories = new Set([
  ".git",
  ".codex",
  ".claude",
  ".cursor",
  ".gemini",
  codeEvidenceDirectory,
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "tmp",
  "temp",
]);

const languageByExtension: Record<string, string> = {
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

export const maxIndexedBytes = 1024 * 1024;

export function fileLanguage(relativePath: string): string {
  if (path.basename(relativePath) === ".env.example") return "config";
  const extension = path.extname(relativePath).toLowerCase();
  return languageByExtension[extension] ?? (configExtensions.has(extension) ? "config" : "");
}

function isBlockedEnvFile(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return base.startsWith(".env") && base !== ".env.example";
}

function isBlockedSensitiveConfigFile(relativePath: string): boolean {
  if (fileLanguage(relativePath) !== "config") return false;
  const base = path.basename(relativePath).toLowerCase();
  if (base === ".env.example") return false;
  return /(^|[._-])(secret|secrets|credential|credentials|token|tokens|private|key|keys)([._-]|$)/i.test(base);
}

export function isJavaScriptLike(relativePath: string): boolean {
  return [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(path.extname(relativePath).toLowerCase());
}

export function shouldIndexFile(relativePath: string): boolean {
  if (isBlockedEnvFile(relativePath)) return false;
  if (isBlockedSensitiveConfigFile(relativePath)) return false;
  const language = fileLanguage(relativePath);
  if (language) return true;
  const base = path.basename(relativePath);
  return ["Dockerfile", "Makefile", "package.json", "tsconfig.json"].includes(base);
}

export function isIgnoredCodePath(relativePath: string): boolean {
  return normalizePath(relativePath)
    .split("/")
    .filter(Boolean)
    .some((part) => ignoredDirectories.has(part));
}

// Mirrors normalizeProjectRelative in code-index.ts for git ls-files output, but
// throws instead of exiting so the light bootstrap path can use discovery too.
// Git emits repo-relative paths, so the escape branch is unreachable for real
// output; it stays as a loud guard, not a recovery path.
function normalizeGitIndexedFile(input: string): string {
  const raw = input.trim() || ".";
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`git-indexed file must stay inside the project root: ${input}`);
  }
  return normalizePath(path.relative(rootResolved, resolved)) || ".";
}

function walkCodeFiles(relativePath: string, files: string[] = []): string[] {
  if (isIgnoredCodePath(relativePath)) return files.sort();
  const target = abs(relativePath);
  if (!fs.existsSync(target)) return files;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (stat.size <= maxIndexedBytes && shouldIndexFile(relativePath)) files.push(relativePath);
    return files.sort();
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = normalizePath(path.join(relativePath, entry.name));
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walkCodeFiles(child, files);
    } else if (entry.isFile() && shouldIndexFile(child)) {
      const childStat = fs.statSync(abs(child));
      if (childStat.size <= maxIndexedBytes) files.push(child);
    }
  }
  return files.sort();
}

function gitTrackedAndUnignoredFiles(scopes: string[]): string[] | null {
  try {
    const output = childProcess.execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...scopes], {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.toString("utf8").split("\0").filter(Boolean).map((file) => normalizeGitIndexedFile(file));
  } catch {
    return null;
  }
}

export function discoverCodeFiles(scopes: string[]): string[] {
  const gitFiles = gitTrackedAndUnignoredFiles(scopes);
  const candidates = gitFiles ?? scopes.flatMap((scope) => walkCodeFiles(scope));
  return Array.from(new Set(candidates))
    .filter((file) => !isIgnoredCodePath(file))
    .filter((file) => fs.existsSync(abs(file)))
    .filter((file) => fs.statSync(abs(file)).isFile())
    .filter((file) => shouldIndexFile(file))
    .filter((file) => fs.statSync(abs(file)).size <= maxIndexedBytes)
    .sort();
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
export const SMALL_REPO_FILE_THRESHOLD = 5000;

export interface SmallRepoCodeIndexGate {
  proceed: boolean;
  warning: string;
}

// Decision for the --code-index scale gate: below the threshold the build halts
// with an evidence-citing warning unless the caller explicitly acknowledged the
// measured cost. Consent is honored, never refused (2026-06-12 decision: defaults
// follow the evidence, explicit requests get warning + consent).
export function smallRepoCodeIndexGate(indexableFileCount: number, acknowledged: boolean): SmallRepoCodeIndexGate {
  if (acknowledged || indexableFileCount >= SMALL_REPO_FILE_THRESHOLD) return { proceed: true, warning: "" };
  return {
    proceed: false,
    warning: [
      `--code-index halted: ${indexableFileCount} indexable files is below the ${SMALL_REPO_FILE_THRESHOLD}-file scale threshold.`,
      "Measured evidence (real-corpus stageR1): on a ~1.2k-file repo the code-evidence track cost MORE on every measured question (impact_trace +116.9%, workspace_graph +106.5% cost-weighted tokens vs direct reads), and even on a ~11.8k-file repo ownership-style cheap lookups lost (+99.0%); only expensive traversal questions won there (impact_trace -27.7%).",
      "Reports: benchmarks/reports/llm/stageR1-real.md and benchmarks/reports/llm/stage2d-codegraph.md in the project-librarian repo (threshold is an n=2 extrapolation, subject to revision).",
      "Not measured, so not disproven: human-facing report value (--code-report) and answer accuracy/grounding value. This gate reflects measured LLM token cost only.",
      "To build the index anyway, re-run with --acknowledge-small-repo.",
    ].join("\n"),
  };
}
