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
exports.today = exports.root = void 0;
exports.abs = abs;
exports.exists = exists;
exports.read = read;
exports.write = write;
exports.mkdirp = mkdirp;
exports.writeManaged = writeManaged;
exports.writeStarter = writeStarter;
exports.upsertMarkedSection = upsertMarkedSection;
exports.deleteIfGenerated = deleteIfGenerated;
exports.parseJson = parseJson;
exports.hasMetadataHeader = hasMetadataHeader;
exports.metadataValue = metadataValue;
exports.stripMetadataHeader = stripMetadataHeader;
exports.normalizePath = normalizePath;
exports.commandOk = commandOk;
exports.isGitRepository = isGitRepository;
exports.makeExecutable = makeExecutable;
exports.walkFilesUnder = walkFilesUnder;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const childProcess = __importStar(require("node:child_process"));
exports.root = process.cwd();
exports.today = new Date().toISOString().slice(0, 10);
function abs(relativePath) {
    return path.join(exports.root, relativePath);
}
function exists(relativePath) {
    return fs.existsSync(abs(relativePath));
}
function read(relativePath) {
    return fs.readFileSync(abs(relativePath), "utf8");
}
function write(relativePath, content) {
    const filePath = abs(relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}
function mkdirp(relativePath) {
    fs.mkdirSync(abs(relativePath), { recursive: true });
}
function writeManaged(relativePath, content) {
    const previous = exists(relativePath) ? read(relativePath) : "";
    if (previous === content)
        return "exists";
    write(relativePath, content);
    return previous ? "updated" : "created";
}
function writeStarter(relativePath, content) {
    if (!exists(relativePath)) {
        write(relativePath, content);
        return "created";
    }
    const current = read(relativePath);
    if (current === content)
        return "exists";
    if (hasMetadataHeader(current))
        return "exists";
    const generatedSignals = [
        "This file is the current project-planning truth",
        "This wiki keeps project planning knowledge",
        "This page tracks unresolved project questions",
        "# <Topic> v<N> Decisions",
        "# ADR: <Title>",
        "# Karpathy LLM Wiki",
        "# Glossary",
        "아직 제품/서비스 주제는 정해지지 않았다",
    ];
    if (!generatedSignals.some((signal) => current.includes(signal)))
        return "manual-review";
    write(relativePath, content);
    return "updated";
}
function upsertMarkedSection(relativePath, startMarker, endMarker, section) {
    if (!exists(relativePath)) {
        write(relativePath, `${section.trim()}\n`);
        return "created";
    }
    const current = read(relativePath);
    const start = current.indexOf(startMarker);
    const end = current.indexOf(endMarker);
    if (start >= 0 && end > start) {
        const next = `${current.slice(0, start).trimEnd()}\n\n${section.trim()}\n\n${current.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
        if (next === current)
            return "exists";
        write(relativePath, next);
        return "updated";
    }
    write(relativePath, `${current.trimEnd()}\n\n${section.trim()}\n`);
    return "updated";
}
function deleteIfGenerated(relativePath, sentinels) {
    if (!exists(relativePath))
        return "absent";
    const current = read(relativePath);
    if (!sentinels.some((sentinel) => current.includes(sentinel)))
        return "manual-review";
    fs.unlinkSync(abs(relativePath));
    return "removed";
}
function parseJson(relativePath, fallback) {
    if (!exists(relativePath))
        return fallback;
    try {
        return JSON.parse(read(relativePath));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${relativePath} is not valid JSON: ${message}`);
    }
}
function hasMetadataHeader(text) {
    return /^---\n[\s\S]*?\n---\n/.test(text);
}
function metadataValue(text, key) {
    const header = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!header)
        return "";
    const headerBody = header[1] ?? "";
    const match = headerBody.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match?.[1]?.trim() ?? "";
}
function stripMetadataHeader(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}
function normalizePath(filePath) {
    return filePath.split(path.sep).join("/");
}
function commandOk(command, commandArgs, options = {}) {
    try {
        childProcess.execFileSync(command, commandArgs, { stdio: "ignore", ...options });
        return true;
    }
    catch {
        return false;
    }
}
function isGitRepository() {
    try {
        return childProcess.execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
            cwd: exports.root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim() === "true";
    }
    catch {
        return false;
    }
}
function makeExecutable(relativePath) {
    if (!exists(relativePath))
        return;
    const currentMode = fs.statSync(abs(relativePath)).mode;
    fs.chmodSync(abs(relativePath), currentMode | 0o755);
}
function walkFilesUnder(relativePath, predicate, acc = []) {
    const dirPath = abs(relativePath);
    if (!fs.existsSync(dirPath))
        return acc;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        const childRelative = normalizePath(path.relative(exports.root, fullPath));
        if (entry.isDirectory()) {
            walkFilesUnder(childRelative, predicate, acc);
        }
        else if (entry.isFile() && predicate(childRelative)) {
            acc.push(childRelative);
        }
    }
    return acc.sort();
}
