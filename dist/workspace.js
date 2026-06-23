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
exports.containedProjectFileStat = containedProjectFileStat;
exports.containedProjectDirectoryStat = containedProjectDirectoryStat;
exports.requireContainedProjectFile = requireContainedProjectFile;
exports.walkFilesUnder = walkFilesUnder;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const childProcess = __importStar(require("node:child_process"));
exports.root = process.cwd();
exports.today = new Date().toISOString().slice(0, 10);
const projectRoot = path.resolve(exports.root);
function abs(relativePath) {
    return path.join(exports.root, relativePath);
}
function isInsideProject(absolutePath) {
    const resolved = path.resolve(absolutePath);
    return resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`);
}
function resolveProjectPath(relativePath, label = "path") {
    const resolved = path.isAbsolute(relativePath) ? path.resolve(relativePath) : path.resolve(exports.root, relativePath);
    if (!isInsideProject(resolved)) {
        throw new Error(`${label} must stay inside the project root: ${relativePath}`);
    }
    return resolved;
}
function assertNoSymlinkInProjectPath(relativePath, includeLeaf, label = "path") {
    const target = resolveProjectPath(relativePath, label);
    const relative = path.relative(projectRoot, target);
    if (!relative)
        return target;
    const parts = relative.split(path.sep).filter(Boolean);
    const checkedParts = includeLeaf ? parts : parts.slice(0, -1);
    let current = projectRoot;
    for (const part of checkedParts) {
        current = path.join(current, part);
        if (!fs.existsSync(current))
            continue;
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw new Error(`${label} refuses to follow symlink: ${normalizePath(path.relative(projectRoot, current))}`);
        }
        if (current !== target && !stat.isDirectory()) {
            throw new Error(`${label} has a non-directory path component: ${normalizePath(path.relative(projectRoot, current))}`);
        }
    }
    return target;
}
function mkdirpAbsolute(target, label = "path") {
    if (!isInsideProject(target)) {
        throw new Error(`${label} must stay inside the project root: ${target}`);
    }
    const relative = path.relative(projectRoot, target);
    if (!relative)
        return;
    let current = projectRoot;
    for (const part of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`${label} refuses to follow symlink: ${normalizePath(path.relative(projectRoot, current))}`);
            }
            if (!stat.isDirectory()) {
                throw new Error(`${label} has a non-directory path component: ${normalizePath(path.relative(projectRoot, current))}`);
            }
            continue;
        }
        fs.mkdirSync(current);
    }
}
function writeFileNoFollow(filePath, content) {
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, 0o666);
    try {
        fs.writeFileSync(fd, content);
    }
    finally {
        fs.closeSync(fd);
    }
}
function exists(relativePath) {
    return fs.existsSync(abs(relativePath));
}
function read(relativePath) {
    const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed read");
    return fs.readFileSync(filePath, "utf8");
}
function write(relativePath, content) {
    const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed write");
    mkdirpAbsolute(path.dirname(filePath), "managed write");
    writeFileNoFollow(filePath, content);
}
function mkdirp(relativePath) {
    const dirPath = assertNoSymlinkInProjectPath(relativePath, true, "managed directory");
    mkdirpAbsolute(dirPath, "managed directory");
}
function writeManaged(relativePath, content) {
    const previous = exists(relativePath)
        ? (assertNoSymlinkInProjectPath(relativePath, true, "managed read"), read(relativePath))
        : "";
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
    assertNoSymlinkInProjectPath(relativePath, true, "managed read");
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
    assertNoSymlinkInProjectPath(relativePath, true, "managed read");
    const current = read(relativePath);
    const start = current.indexOf(startMarker);
    const end = current.indexOf(endMarker);
    if ((start >= 0) !== (end >= 0)) {
        throw new Error(`${relativePath} has a malformed managed section: expected both ${startMarker} and ${endMarker}`);
    }
    if (start >= 0 && end > start) {
        const next = `${current.slice(0, start).trimEnd()}\n\n${section.trim()}\n\n${current.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
        if (next === current)
            return "exists";
        write(relativePath, next);
        return "updated";
    }
    if (start >= 0) {
        throw new Error(`${relativePath} has a malformed managed section: ${endMarker} appears before ${startMarker}`);
    }
    write(relativePath, `${current.trimEnd()}\n\n${section.trim()}\n`);
    return "updated";
}
function deleteIfGenerated(relativePath, sentinels) {
    if (!exists(relativePath))
        return "absent";
    const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed delete");
    const current = read(relativePath);
    if (!sentinels.some((sentinel) => current.includes(sentinel)))
        return "manual-review";
    fs.unlinkSync(filePath);
    return "removed";
}
function parseJson(relativePath, fallback) {
    if (!exists(relativePath))
        return fallback;
    assertNoSymlinkInProjectPath(relativePath, true, "managed read");
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
    const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed chmod");
    const currentMode = fs.statSync(filePath).mode;
    fs.chmodSync(filePath, currentMode | 0o755);
}
function containedProjectFileStat(relativePath) {
    const filePath = resolveProjectPath(relativePath, "project file");
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    }
    catch {
        return null;
    }
    if (stat.isSymbolicLink() || !stat.isFile())
        return null;
    let realPath = "";
    try {
        realPath = fs.realpathSync(filePath);
    }
    catch {
        return null;
    }
    return isInsideProject(realPath) ? stat : null;
}
function containedProjectDirectoryStat(relativePath) {
    const dirPath = resolveProjectPath(relativePath, "project directory");
    let stat;
    try {
        stat = fs.lstatSync(dirPath);
    }
    catch {
        return null;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
        return null;
    let realPath = "";
    try {
        realPath = fs.realpathSync(dirPath);
    }
    catch {
        return null;
    }
    return isInsideProject(realPath) ? stat : null;
}
function requireContainedProjectFile(relativePath, label = "project file") {
    const filePath = resolveProjectPath(relativePath, label);
    const stat = containedProjectFileStat(relativePath);
    if (!stat) {
        throw new Error(`${label} must be a regular file inside the project root and must not be a symlink: ${relativePath}`);
    }
    return { absolutePath: filePath, stat };
}
function walkFilesUnder(relativePath, predicate, acc = []) {
    const dirPath = assertNoSymlinkInProjectPath(relativePath, true, "managed walk");
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
