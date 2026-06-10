import * as path from "node:path";
import { normalizePath } from "./workspace";

export const ignoredDirectories = new Set([
  ".git",
  ".codex",
  ".claude",
  ".cursor",
  ".gemini",
  ".project-wiki",
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
