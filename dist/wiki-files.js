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
exports.ignoredDirs = exports.standardWikiFiles = void 0;
exports.walkMarkdownFiles = walkMarkdownFiles;
exports.firstHeading = firstHeading;
exports.compactSummary = compactSummary;
exports.splitMarkdownRow = splitMarkdownRow;
exports.parseMarkdownTableRows = parseMarkdownTableRows;
exports.wikiMarkdownFiles = wikiMarkdownFiles;
exports.wikiLinkForFile = wikiLinkForFile;
exports.wikiTitleForFile = wikiTitleForFile;
exports.metadataSummary = metadataSummary;
exports.stripMarkedSection = stripMarkedSection;
exports.extractMarkedSection = extractMarkedSection;
exports.withPreservedMarkedSections = withPreservedMarkedSections;
exports.hasGlossaryNeedSignal = hasGlossaryNeedSignal;
exports.hasGlossaryTable = hasGlossaryTable;
exports.canonicalBodyForLint = canonicalBodyForLint;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const workspace_1 = require("./workspace");
exports.standardWikiFiles = new Set([
    "AGENTS.md",
    "wiki/AGENTS.md",
    ".githooks/prepare-commit-msg",
    ".githooks/wiki-commit-trailers.js",
    ".codex/hooks.json",
    ".codex/hooks/wiki-session-start.js",
    ".claude/settings.json",
    ".claude/hooks/wiki-session-start.js",
    "wiki/README.md",
    "wiki/startup.md",
    "wiki/index.md",
    "wiki/inbox/project-candidates.md",
    "wiki/migration/inventory.md",
    "wiki/migration/plan.md",
    "wiki/migration/review.md",
    "wiki/migration/verification.md",
    "wiki/canonical/project-brief.md",
    "wiki/canonical/glossary.md",
    "wiki/canonical/open-questions.md",
    "wiki/canonical/assumptions.md",
    "wiki/canonical/risks.md",
    "wiki/canonical/migration-inbox.md",
    "wiki/decisions/README.md",
    "wiki/decisions/log.md",
    "wiki/decisions/recent.md",
    "wiki/decisions/decision-pack-template.md",
    "wiki/decisions/full-adr-template.md",
    "wiki/decisions/migration-inbox.md",
    "wiki/meta/operating-model.md",
    "wiki/meta/decision-policy.md",
    "wiki/meta/wiki-ops-v1-decisions.md",
    "wiki/sources/karpathy-llm-wiki.md",
    "wiki/sources/migration-inbox.md",
    "tools/project-wiki-bootstrap/SKILL.md",
    "tools/project-wiki-bootstrap/agents/openai.yaml",
    "tools/project-wiki-bootstrap/dist/init-project-wiki.js",
]);
exports.ignoredDirs = new Set([".git", ".codex", ".claude", "node_modules", ".next", "dist", "build", "coverage", "vendor", "tmp", "temp"]);
function walkMarkdownFiles(dir = workspace_1.root, acc = [], baseDir = workspace_1.root) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = (0, workspace_1.normalizePath)(path.relative(workspace_1.root, fullPath));
        const basePath = (0, workspace_1.normalizePath)(path.relative(baseDir, fullPath));
        if (!relativePath || relativePath.startsWith(".."))
            continue;
        if (entry.isDirectory()) {
            if (exports.ignoredDirs.has(entry.name))
                continue;
            if (relativePath === "tools/project-wiki-bootstrap")
                continue;
            if (relativePath.startsWith("wiki/migration"))
                continue;
            walkMarkdownFiles(fullPath, acc, baseDir);
        }
        else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && !exports.standardWikiFiles.has(relativePath)) {
            acc.push({ path: relativePath, basePath });
        }
    }
    return acc.sort((a, b) => a.path.localeCompare(b.path));
}
function firstHeading(text, fallback) {
    const heading = text.match(/^#{1,3}\s+(.+)$/m);
    if (heading?.[1])
        return heading[1].trim().replace(/\s+/g, " ");
    return fallback.replace(/\.(md|mdx)$/i, "").split("/").pop() ?? fallback;
}
function compactSummary(text) {
    return text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#*_`>\-[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}
function splitMarkdownRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function parseMarkdownTableRows(text, expectedColumns) {
    return text
        .split(/\r?\n/)
        .filter((line) => /^\|.+\|$/.test(line.trim()))
        .map(splitMarkdownRow)
        .filter((cells) => cells.length >= expectedColumns)
        .filter((cells) => !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ""))))
        .filter((cells) => !/^(source|legacy source|document)$/i.test(cells[0] ?? ""))
        .filter((cells) => cells[0] !== "none");
}
function wikiMarkdownFiles() {
    return (0, workspace_1.walkFilesUnder)("wiki", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/AGENTS.md").sort();
}
function wikiLinkForFile(relativePath) {
    return `[[${relativePath.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "")}]]`;
}
function wikiTitleForFile(relativePath, text) {
    return firstHeading((0, workspace_1.stripMetadataHeader)(text), relativePath);
}
function metadataSummary(relativePath, text) {
    return {
        status: (0, workspace_1.metadataValue)(text, "status") || "-",
        scope: (0, workspace_1.metadataValue)(text, "scope") || "-",
        budget: (0, workspace_1.metadataValue)(text, "read_budget") || "-",
    };
}
function stripMarkedSection(text, startMarker, endMarker) {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start < 0 || end <= start)
        return text;
    return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
}
function extractMarkedSection(text, startMarker, endMarker) {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start < 0 || end <= start)
        return "";
    return text.slice(start, end + endMarker.length).trim();
}
function withPreservedMarkedSections(relativePath, base, markerPairs) {
    if (!(0, workspace_1.exists)(relativePath))
        return base;
    const current = (0, workspace_1.read)(relativePath);
    const preserved = markerPairs
        .map(([startMarker, endMarker]) => extractMarkedSection(current, startMarker, endMarker))
        .filter(Boolean)
        .filter((section) => !base.includes(section));
    if (preserved.length === 0)
        return base;
    return `${base.trimEnd()}\n\n${preserved.join("\n\n")}\n`;
}
function hasGlossaryNeedSignal(text) {
    return /(^|\n)##\s+(Glossary|Terms|Roles|Entities|Data Model|State Model|Permissions|Events|용어|역할|엔티티|상태 모델|권한|이벤트)(\s|$)|`[^`]+`\s*(term|role|state|permission|event|entity|API|DB|UI|용어|역할|상태|권한|이벤트|엔티티)/i.test(text);
}
function hasGlossaryTable(text) {
    const body = (0, workspace_1.stripMetadataHeader)(text);
    return /\|\s*Term\s*\|\s*Definition\s*\|\s*Avoid\s*\|\s*Related Canonical Doc\s*\|\s*Status\s*\|/.test(body);
}
function canonicalBodyForLint() {
    return (0, workspace_1.walkFilesUnder)("wiki/canonical", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/canonical/glossary.md")
        .map((file) => (0, workspace_1.stripMetadataHeader)((0, workspace_1.read)(file)))
        .join("\n");
}
