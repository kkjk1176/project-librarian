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
    if (Array.isArray(workspaces)) {
        return workspaces
            .filter((value) => typeof value === "string")
            .map((pattern) => ({ pattern, source: "package.json workspaces" }));
    }
    if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
        const packages = workspaces.packages;
        if (Array.isArray(packages)) {
            return packages
                .filter((value) => typeof value === "string")
                .map((pattern) => ({ pattern, source: "package.json workspaces" }));
        }
    }
    return [];
}
function trimYamlComment(value) {
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (quote) {
            if (character === quote)
                quote = "";
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
            continue;
        }
        if (character === "#" && (index === 0 || /\s/.test(value[index - 1] ?? "")))
            return value.slice(0, index).trimEnd();
    }
    return value.trimEnd();
}
function parseYamlStringScalar(value) {
    const trimmed = trimYamlComment(value).trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith("\"")) {
        const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
        if (!match)
            return null;
        return match[1]?.replace(/\\"/g, "\"") ?? "";
    }
    if (trimmed.startsWith("'")) {
        const match = trimmed.match(/^'((?:''|[^'])*)'/);
        if (!match)
            return null;
        return match[1]?.replace(/''/g, "'") ?? "";
    }
    return trimmed;
}
function splitYamlFlowArray(value) {
    const trimmed = trimYamlComment(value).trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
        return null;
    const entries = [];
    let quote = "";
    let current = "";
    for (const character of trimmed.slice(1, -1)) {
        if (quote) {
            current += character;
            if (character === quote)
                quote = "";
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
            current += character;
            continue;
        }
        if (character === ",") {
            entries.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    entries.push(current);
    return entries;
}
function workspacePatternsFromPnpmWorkspace() {
    const filePath = "pnpm-workspace.yaml";
    if (!(0, workspace_1.containedProjectFileStat)(filePath))
        return [];
    const lines = (0, workspace_1.read)(filePath).split(/\r?\n/);
    const patterns = [];
    let packagesIndent = null;
    for (const line of lines) {
        if (!line.trim() || line.trimStart().startsWith("#"))
            continue;
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        const packagesMatch = line.match(/^(\s*)packages\s*:\s*(.*)$/);
        if (packagesMatch) {
            packagesIndent = packagesMatch[1]?.length ?? 0;
            const inlineArray = splitYamlFlowArray(packagesMatch[2] ?? "");
            if (inlineArray) {
                for (const entry of inlineArray) {
                    const pattern = parseYamlStringScalar(entry);
                    if (pattern && !pattern.startsWith("!"))
                        patterns.push({ pattern, source: "pnpm-workspace.yaml packages" });
                }
            }
            continue;
        }
        if (packagesIndent === null)
            continue;
        if (indent <= packagesIndent)
            break;
        const item = line.slice(indent).match(/^-\s+(.+)$/);
        if (!item)
            continue;
        const pattern = parseYamlStringScalar(item[1] ?? "");
        if (pattern && !pattern.startsWith("!"))
            patterns.push({ pattern, source: "pnpm-workspace.yaml packages" });
    }
    return patterns;
}
function workspacePatterns() {
    return [...workspacePatternsFromRootPackage(), ...workspacePatternsFromPnpmWorkspace()];
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
    for (const workspacePattern of workspacePatterns()) {
        for (const candidate of workspacePatternCandidates(workspacePattern.pattern)) {
            const packageJsonPath = (0, workspace_1.normalizePath)(path.join(candidate, "package.json"));
            if (!(0, workspace_1.containedProjectFileStat)(packageJsonPath))
                continue;
            const packageJson = readJsonObject(packageJsonPath);
            const packageName = typeof packageJson?.name === "string" ? packageJson.name : candidate;
            packages.set(candidate, {
                name: packageName,
                root: candidate,
                source: workspacePattern.source,
                workspace_pattern: workspacePattern.pattern,
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
