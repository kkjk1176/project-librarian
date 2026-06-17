import * as fs from "node:fs";
import * as path from "node:path";
import { ignoredDirectorySet } from "./path-ignore-policy";
import type { MarkdownFileInfo, MetadataSummary, WikiLinkReference, WikiMarkdownBlock, WikiMarkdownBlockKind } from "./types";
import { abs, metadataValue, normalizePath, read, root, stripMetadataHeader, walkFilesUnder } from "./workspace";

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
  "wiki/migration/unit-map.md",
  "wiki/migration/split-plan.md",
  "wiki/migration/coverage.md",
  "wiki/migration/plan.md",
  "wiki/migration/review.md",
  "wiki/migration/verification.md",
  "wiki/migration/bulk-review.md",
  "wiki/canonical/glossary.md",
  "wiki/canonical/migration-inbox.md",
  "wiki/decisions/README.md",
  "wiki/decisions/log.md",
  "wiki/decisions/recent.md",
  "wiki/decisions/migration-inbox.md",
  "wiki/meta/operating-model.md",
  "wiki/meta/decision-policy.md",
  "wiki/meta/document-taxonomy.md",
  "wiki/meta/wiki-ops-v1-decisions.md",
  "wiki/sources/karpathy-llm-wiki.md",
  "wiki/sources/migration-inbox.md",
  "tools/project-librarian/SKILL.md",
  "tools/project-librarian/agents/openai.yaml",
  "tools/project-librarian/dist/init-project-wiki.js",
]);

export const ignoredDirs: Set<string> = ignoredDirectorySet();

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

function slugForBlockId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "block";
}

function isMarkdownHeading(line: string): RegExpMatchArray | null {
  return line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function blockId(kind: WikiMarkdownBlockKind, line: number, text: string): string {
  return `${kind}:${line}:${slugForBlockId(text)}`;
}

export function markdownBlockSnippet(block: WikiMarkdownBlock, maxLength = 180): string {
  const prefix = block.headingPath.length > 0 && block.kind !== "heading" ? `${block.headingPath.join(" > ")}: ` : "";
  return `${prefix}${normalizeBlockText(block.text)}`.slice(0, maxLength);
}

export function extractMarkdownBlocks(text: string): WikiMarkdownBlock[] {
  const body = stripMetadataHeader(text);
  const lines = body.split(/\r?\n/);
  const blocks: WikiMarkdownBlock[] = [];
  const headingPath: string[] = [];
  type MarkdownFence = { fence: string; lang: string; line: number; lines: string[] };
  let paragraph: { line: number; lines: string[] } | null = null;
  let fence: MarkdownFence | null = null;

  function addBlock(kind: WikiMarkdownBlockKind, line: number, blockText: string): void {
    const normalized = normalizeBlockText(blockText);
    if (!normalized) return;
    blocks.push({
      headingPath: [...headingPath],
      id: blockId(kind, line, normalized),
      kind,
      line,
      text: normalized,
    });
  }

  function flushParagraph(): void {
    if (!paragraph) return;
    addBlock("paragraph", paragraph.line, paragraph.lines.join(" "));
    paragraph = null;
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```+|~~~+)\s*(.*)$/);
    if (fence) {
      const closingFence = fenceMatch?.[1] ?? "";
      if (closingFence.startsWith(fence.fence.slice(0, 3)) && closingFence.length >= fence.fence.length) {
        const sample = fence.lines.map((item) => item.trim()).filter(Boolean).slice(0, 3).join(" ");
        addBlock("code_fence", fence.line, `code fence${fence.lang ? ` ${fence.lang}` : ""}: ${sample}`);
        fence = null;
      } else {
        fence.lines.push(line);
      }
      return;
    }

    if (fenceMatch) {
      flushParagraph();
      fence = { fence: fenceMatch[1] ?? "```", lang: (fenceMatch[2] ?? "").trim(), line: lineNumber, lines: [] };
      return;
    }

    if (!trimmed) {
      flushParagraph();
      return;
    }

    const heading = isMarkdownHeading(line);
    if (heading?.[1] && heading[2]) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2].trim();
      headingPath.splice(level - 1);
      headingPath[level - 1] = title;
      addBlock("heading", lineNumber, title);
      return;
    }

    if (/^\s{0,3}([-*+]|\d+\.)\s+\S/.test(line)) {
      flushParagraph();
      addBlock("list_item", lineNumber, trimmed);
      return;
    }

    if (/^\|.+\|$/.test(trimmed)) {
      flushParagraph();
      const cells = splitMarkdownRow(line);
      if (!isMarkdownTableSeparator(cells)) addBlock("table_row", lineNumber, cells.join(" | "));
      return;
    }

    if (!paragraph) paragraph = { line: lineNumber, lines: [] };
    paragraph.lines.push(trimmed);
  });

  const unclosedFence = fence as MarkdownFence | null;
  if (unclosedFence) {
    const sample = unclosedFence.lines.map((item) => item.trim()).filter(Boolean).slice(0, 3).join(" ");
    addBlock("code_fence", unclosedFence.line, `code fence${unclosedFence.lang ? ` ${unclosedFence.lang}` : ""}: ${sample}`);
  }
  flushParagraph();
  return blocks;
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

export function hasGlossaryNeedSignal(text: string): boolean {
  return /(^|\n)##\s+(Glossary|Terms|Roles|Entities|Data Model|State Model|Permissions|Events|용어|역할|엔티티|상태 모델|권한|이벤트)(\s|$)|`[^`]+`\s*(term|role|state|permission|event|entity|API|DB|UI|용어|역할|상태|권한|이벤트|엔티티)/i.test(text);
}

export function hasGlossaryTable(text: string): boolean {
  const body = stripMetadataHeader(text);
  return /\|\s*Term\s*\|\s*Definition\s*\|\s*Avoid\s*\|\s*Related Canonical Doc\s*\|\s*Status\s*\|/.test(body);
}

// First "## TL;DR" bullet for answer-shaped query envelopes: gives an agent the
// page's one-line summary without opening the page. Pages without a TL;DR section
// return "" and the envelope simply omits the line — quality-check separately
// flags the missing TL;DR, so this is optional enrichment, not a fallback path.
export function firstTldrBullet(text: string): string {
  const body = stripMetadataHeader(text);
  const match = body.match(/^##\s+TL;DR[^\n]*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/m);
  const bullet = match?.[1]?.split(/\r?\n/).find((line) => /^\s*-\s+\S/.test(line));
  return bullet ? bullet.replace(/^\s*-\s*/, "").trim().slice(0, 160) : "";
}

export function canonicalBodyForLint(): string {
  return walkFilesUnder("wiki/canonical", (file) => /\.(md|mdx)$/i.test(file) && file !== "wiki/canonical/glossary.md")
    .map((file) => stripMetadataHeader(read(file)))
    .join("\n");
}
