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
exports.maxIndexedBytes = exports.ignoredDirectories = void 0;
exports.fileLanguage = fileLanguage;
exports.isJavaScriptLike = isJavaScriptLike;
exports.shouldIndexFile = shouldIndexFile;
exports.isIgnoredCodePath = isIgnoredCodePath;
const path = __importStar(require("node:path"));
const workspace_1 = require("./workspace");
exports.ignoredDirectories = new Set([
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
    return (0, workspace_1.normalizePath)(relativePath)
        .split("/")
        .filter(Boolean)
        .some((part) => exports.ignoredDirectories.has(part));
}
