import * as fs from "node:fs";
import * as path from "node:path";
import type { MarkdownFileInfo, MetadataSummary, WikiLinkReference } from "./types";
import { abs, exists, metadataValue, normalizePath, read, root, stripMetadataHeader, walkFilesUnder } from "./workspace";

export const standardWikiFiles: Set<string> = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "wiki/AGENTS.md",
  ".githooks/prepare-commit-msg",
  ".githooks/wiki-commit-trailers.js",
  ".codex/hooks.json",
  ".codex/hooks/wiki-session-start.js",
  ".claude/settings.json",
  ".claude/hooks/wiki-session-start.js",
  ".cursor/rules/project-librarian.mdc",
  ".cursor/hooks.json",
  ".cursor/hooks/wiki-session-start.js",
  ".gemini/settings.json",
  ".gemini/hooks/wiki-session-start.js",
  "wiki/README.md",
  "wiki/startup.md",
  "wiki/index.md",
  "wiki/inbox/project-candidates.md",
  "wiki/migration/inventory.md",
  "wiki/migration/coverage.md",
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
  "tools/project-librarian/SKILL.md",
  "tools/project-librarian/agents/openai.yaml",
  "tools/project-librarian/dist/init-project-wiki.js",
]);

export const ignoredDirs: Set<string> = new Set([".git", ".codex", ".claude", ".cursor", ".gemini", "node_modules", ".next", "dist", "build", "coverage", "vendor", "tmp", "temp"]);

export function walkMarkdownFiles(dir: string = root, acc: MarkdownFileInfo[] = [], baseDir: string = root): MarkdownFileInfo[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalizePath(path.relative(root, fullPath));
    const basePath = normalizePath(path.relative(baseDir, fullPath));
    if (!relativePath || relativePath.startsWith("..")) continue;
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      if (relativePath === "tools/project-librarian") continue;
      if (relativePath.startsWith("wiki/migration")) continue;
      walkMarkdownFiles(fullPath, acc, baseDir);
    } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && !standardWikiFiles.has(relativePath)) {
      acc.push({ path: relativePath, basePath });
    }
  }
  return acc.sort((a, b) => a.path.localeCompare(b.path));
}

export function firstHeading(text: string, fallback: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().replace(/\s+/g, " ");
  return fallback.replace(/\.(md|mdx)$/i, "").split("/").pop() ?? fallback;
}

export function compactSummary(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}


export function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const row = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of row) {
    if (escaped) {
      current += char === "|" ? "|" : `\\${char}`;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

export function parseMarkdownTableRows(text: string, expectedColumns: number): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\|.+\|$/.test(line.trim()))
    .map(splitMarkdownRow)
    .filter((cells) => cells.length >= expectedColumns)
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell.replace(/\s/g, ""))))
    .filter((cells) => !/^(source|legacy source|document)$/i.test(cells[0] ?? ""))
    .filter((cells) => cells[0] !== "none");
}


export function wikiMarkdownFiles(): string[] {
  return walkFilesUnder("wiki", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/AGENTS.md").sort();
}

export function wikiLinkForFile(relativePath: string): string {
  return `[[${relativePath.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "")}]]`;
}

function stripIgnoredMarkdownBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

export function normalizeWikiLinkTarget(sourceFile: string, rawTarget: string, relativeToSource: boolean = false): string {
  let target = rawTarget
    .trim()
    .split("|", 1)[0] ?? "";
  target = target.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!target || /^(https?:|mailto:|tel:)/i.test(target)) return "";
  if (target.startsWith("/wiki/")) {
    target = target.replace(/^\//, "");
  } else if (target.startsWith("/")) {
    return "";
  }
  if (target.startsWith("./") || target.startsWith("../") || (relativeToSource && !target.startsWith("wiki/"))) {
    const sourceDir = path.dirname(sourceFile);
    target = normalizePath(path.normalize(path.join(sourceDir, target)));
  } else if (!target.startsWith("wiki/")) {
    target = `wiki/${target}`;
  }
  if (!/\.(md|mdx)$/i.test(target)) target = `${target}.md`;
  return normalizePath(target);
}

function markdownLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end > 0 ? trimmed.slice(1, end).trim() : "";
  }
  return trimmed.split(/\s+/, 1)[0] ?? "";
}

function isMarkdownDocumentTarget(rawTarget: string): boolean {
  const target = rawTarget.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!target) return false;
  const ext = path.extname(target).toLowerCase();
  return !ext || ext === ".md" || ext === ".mdx";
}

export function extractWikiLinks(file: string, text: string): WikiLinkReference[] {
  const body = stripIgnoredMarkdownBlocks(stripMetadataHeader(text));
  const links: WikiLinkReference[] = [];
  for (const match of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const target = match[1]?.trim() ?? "";
    const normalizedTarget = normalizeWikiLinkTarget(file, target);
    if (normalizedTarget) links.push({ file, target, normalizedTarget, kind: "wikilink" });
  }
  for (const match of body.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    if (match.index && body[match.index - 1] === "!") continue;
    const target = markdownLinkTarget(match[1] ?? "");
    if (!target || /^(https?:|mailto:|tel:|#)/i.test(target)) continue;
    if (!isMarkdownDocumentTarget(target)) continue;
    const normalizedTarget = normalizeWikiLinkTarget(file, target, true);
    if (normalizedTarget.startsWith("wiki/")) links.push({ file, target, normalizedTarget, kind: "markdown" });
  }
  return links;
}

export function wikiTitleForFile(relativePath: string, text: string): string {
  return firstHeading(stripMetadataHeader(text), relativePath);
}

export function metadataSummary(relativePath: string, text: string): MetadataSummary {
  return {
    status: metadataValue(text, "status") || "-",
    scope: metadataValue(text, "scope") || "-",
    budget: metadataValue(text, "read_budget") || "-",
  };
}

export function stripMarkedSection(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return text;
  return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
}

export function extractMarkedSection(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return "";
  return text.slice(start, end + endMarker.length).trim();
}

export function withPreservedMarkedSections(relativePath: string, base: string, markerPairs: Array<[string, string]>): string {
  if (!exists(relativePath)) return base;
  const current = read(relativePath);
  const preserved = markerPairs
    .map(([startMarker, endMarker]) => extractMarkedSection(current, startMarker, endMarker))
    .filter(Boolean)
    .filter((section) => !base.includes(section));
  if (preserved.length === 0) return base;
  return `${base.trimEnd()}\n\n${preserved.join("\n\n")}\n`;
}

export function hasGlossaryNeedSignal(text: string): boolean {
  return /(^|\n)##\s+(Glossary|Terms|Roles|Entities|Data Model|State Model|Permissions|Events|용어|역할|엔티티|상태 모델|권한|이벤트)(\s|$)|`[^`]+`\s*(term|role|state|permission|event|entity|API|DB|UI|용어|역할|상태|권한|이벤트|엔티티)/i.test(text);
}

export function hasGlossaryTable(text: string): boolean {
  const body = stripMetadataHeader(text);
  return /\|\s*Term\s*\|\s*Definition\s*\|\s*Avoid\s*\|\s*Related Canonical Doc\s*\|\s*Status\s*\|/.test(body);
}

export function canonicalBodyForLint(): string {
  return walkFilesUnder("wiki/canonical", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/canonical/glossary.md")
    .map((file) => stripMetadataHeader(read(file)))
    .join("\n");
}
