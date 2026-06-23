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
exports.readJsonObject = readJsonObject;
exports.workspacePackages = workspacePackages;
exports.matchingWorkspace = matchingWorkspace;
exports.codeownerRules = codeownerRules;
exports.matchedCodeownerRules = matchedCodeownerRules;
exports.ownershipContext = ownershipContext;
exports.ownershipInfo = ownershipInfo;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const workspace_1 = require("../workspace");
function pathOwnerKey(filePath) {
    const parts = (0, workspace_1.normalizePath)(filePath).split("/").filter(Boolean);
    if (parts.length === 0)
        return ".";
    if (["apps", "libs", "packages", "services"].includes(parts[0] ?? "") && parts[1])
        return `${parts[0]}/${parts[1]}`;
    return parts[0] ?? ".";
}
function readJsonObject(relativePath) {
    if (!(0, workspace_1.containedProjectFileStat)(relativePath))
        return null;
    try {
        const parsed = JSON.parse((0, workspace_1.read)(relativePath));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function workspacePatternsFromRootPackage() {
    const rootPackage = readJsonObject("package.json");
    const workspaces = rootPackage?.workspaces;
    if (Array.isArray(workspaces))
        return workspaces.filter((value) => typeof value === "string");
    if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
        const packages = workspaces.packages;
        if (Array.isArray(packages))
            return packages.filter((value) => typeof value === "string");
    }
    return [];
}
function workspacePatternCandidates(pattern) {
    const normalized = (0, workspace_1.normalizePath)(pattern).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalized || normalized.includes(".."))
        return [];
    if (!normalized.includes("*"))
        return [normalized];
    const starIndex = normalized.indexOf("*");
    const prefix = normalized.slice(0, starIndex).replace(/\/+$/, "");
    const suffix = normalized.slice(starIndex + 1).replace(/^\/+/, "");
    const base = prefix || ".";
    const basePath = (0, workspace_1.abs)(base);
    if (!(0, workspace_1.containedProjectDirectoryStat)(base))
        return [];
    return fs.readdirSync(basePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => (0, workspace_1.normalizePath)(path.join(base, entry.name, suffix)))
        .filter((candidate) => (0, workspace_1.containedProjectDirectoryStat)(candidate));
}
function workspacePackages() {
    const packages = new Map();
    for (const pattern of workspacePatternsFromRootPackage()) {
        for (const candidate of workspacePatternCandidates(pattern)) {
            const packageJsonPath = (0, workspace_1.normalizePath)(path.join(candidate, "package.json"));
            if (!(0, workspace_1.containedProjectFileStat)(packageJsonPath))
                continue;
            const packageJson = readJsonObject(packageJsonPath);
            const packageName = typeof packageJson?.name === "string" ? packageJson.name : candidate;
            packages.set(candidate, {
                name: packageName,
                root: candidate,
                source: "package.json workspaces",
                workspace_pattern: pattern,
            });
        }
    }
    return Array.from(packages.values()).sort((left, right) => left.root.localeCompare(right.root));
}
function matchingWorkspace(filePath, workspaces) {
    const normalized = (0, workspace_1.normalizePath)(filePath);
    return workspaces
        .filter((workspace) => normalized === workspace.root || normalized.startsWith(`${workspace.root}/`))
        .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}
function codeownerRules() {
    const files = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
    const rules = [];
    for (const filePath of files) {
        if (!(0, workspace_1.containedProjectFileStat)(filePath))
            continue;
        const lines = (0, workspace_1.read)(filePath).split(/\r?\n/);
        lines.forEach((lineText, index) => {
            const trimmed = lineText.trim();
            if (!trimmed || trimmed.startsWith("#"))
                return;
            const parts = trimmed.split(/\s+/);
            const pattern = parts[0] ?? "";
            const owners = parts.slice(1);
            if (!pattern || owners.length === 0)
                return;
            rules.push({ file_path: filePath, line: index + 1, owners, pattern });
        });
    }
    return rules;
}
function codeownerPatternRegex(pattern) {
    const normalized = (0, workspace_1.normalizePath)(pattern).replace(/^\/+/, "");
    const source = normalized
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    if (normalized.endsWith("/"))
        return new RegExp(`^${source}.*$`);
    return new RegExp(`^${source}(?:/.*)?$`);
}
function codeownerPatternMatches(pattern, filePath) {
    const normalized = (0, workspace_1.normalizePath)(pattern).replace(/^\/+/, "");
    const target = (0, workspace_1.normalizePath)(filePath);
    if (normalized === "*")
        return true;
    if (normalized.startsWith("*."))
        return path.basename(target).endsWith(normalized.slice(1));
    return codeownerPatternRegex(normalized).test(target);
}
function matchingCodeowners(filePath, rules) {
    const matches = rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
    return matches[matches.length - 1]?.owners ?? [];
}
// Return every CODEOWNERS rule that matches a path, in file order. The last entry
// is the effective owner under last-match-wins; earlier entries are overridden.
// Reuses the same matcher as matchingCodeowners so precedence answers stay
// consistent with --code-report / --code-impact.
function matchedCodeownerRules(filePath, rules) {
    return rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
}
function ownershipContext() {
    return {
        codeownerRules: codeownerRules(),
        workspaces: workspacePackages(),
    };
}
function ownershipInfo(filePath, context) {
    const workspace = matchingWorkspace(filePath, context.workspaces);
    const owners = matchingCodeowners(filePath, context.codeownerRules);
    return {
        codeowners: owners.join(", "),
        owner: workspace?.root ?? pathOwnerKey(filePath),
        owner_source: workspace ? "workspace" : "path",
    };
}
