import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { type AgentTarget, agentRequiredFiles, commonRequiredFiles, resolveProjectAgents } from "./agent-state";
import { captureCategory, captureContent, captureTitle, issueBodyFile, issueDraftTitle, noGitConfigMode, queryTerm } from "./args";
import type { CursorHookConfig, FileStatus, HookConfig, PruneCandidate, QueryResult, WikiDiagnostic, WikiLinkReference } from "./types";
import { abs, exists, hasMetadataHeader, isGitRepository, metadataValue, mkdirp, parseJson, read, root, stripMetadataHeader, today, upsertMarkedSection, walkFilesUnder, write } from "./workspace";
import { metadata } from "./templates";
import { collectMigrationCoverageDiagnostics } from "./migration";
import { canonicalBodyForLint, extractWikiLinks, hasGlossaryNeedSignal, hasGlossaryTable, metadataSummary, stripMarkedSection, wikiLinkForFile, wikiMarkdownFiles, wikiTitleForFile } from "./wiki-files";

const scopedAutoIndexThreshold = 40;
const scopedAutoIndexMarker = "<!-- PROJECT-WIKI-SCOPED-AUTO-INDEX -->";

function isScopedAutoIndex(file: string): boolean {
  return /^wiki\/indexes\/auto-[a-z0-9-]+\.md$/.test(file);
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "misc";
}

function routeAreaForWikiFile(file: string): string {
  const base = path.basename(file, path.extname(file));
  const parts = base.split(/[-_]+/).filter(Boolean);
  if (parts.length >= 3 && ["apps", "libs", "packages", "services"].includes(parts[0] ?? "")) return slugPart(parts.slice(0, 3).join("-"));
  const wikiParts = file.replace(/^wiki\//, "").replace(/\.md$/, "").split(/[\\/]+/).filter(Boolean);
  const routeParts = wikiParts[0] && ["canonical", "decisions", "inbox", "meta", "sources"].includes(wikiParts[0]) ? wikiParts.slice(1) : wikiParts;
  const monorepoRootIndex = routeParts.findIndex((part) => ["apps", "libs", "packages", "services"].includes(part));
  if (monorepoRootIndex >= 0 && routeParts[monorepoRootIndex + 1]) {
    return slugPart(routeParts.slice(monorepoRootIndex, monorepoRootIndex + 2).join("-"));
  }
  const directory = path.dirname(file).replace(/^wiki\//, "");
  if (directory && directory !== ".") return slugPart(directory);
  return "misc";
}

function scopedIndexPath(area: string): string {
  return `wiki/indexes/auto-${slugPart(area)}.md`;
}

function scopedIndexContent(area: string, files: string[]): string {
  const rows = files.map((file) => {
    const meta = metadataSummary(file, read(file));
    return `| ${wikiLinkForFile(file)} | ${meta.scope} | ${meta.status} | ${meta.budget} |`;
  }).join("\n");
  return `${metadata("wiki-router", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "auto-discovered scoped routes change")}${scopedAutoIndexMarker}
# Auto Index: ${area}

## TL;DR

- Generated scoped router for auto-discovered wiki pages.
- Managed by \`--refresh-index\`; move durable routes into \`wiki/index.md\` when they become normal project routes.

| Document | Scope | Status | Token Budget |
| --- | --- | --- | --- |
${rows}
`;
}

function removeStaleScopedAutoIndexes(keepPaths: Set<string>): void {
  if (!exists("wiki/indexes")) return;
  for (const file of walkFilesUnder("wiki/indexes", isScopedAutoIndex)) {
    if (keepPaths.has(file)) continue;
    if (read(file).includes(scopedAutoIndexMarker)) fs.unlinkSync(abs(file));
  }
}

function syncScopedAutoIndexes(files: string[]): Array<{ area: string; count: number; file: string }> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const area = routeAreaForWikiFile(file);
    groups.set(area, [...(groups.get(area) ?? []), file]);
  }
  const summaries = Array.from(groups.entries()).map(([area, areaFiles]) => ({
    area,
    count: areaFiles.length,
    file: scopedIndexPath(area),
    files: areaFiles.sort(),
  })).sort((left, right) => right.count - left.count || left.area.localeCompare(right.area));
  const keepPaths = new Set(summaries.map((summary) => summary.file));
  removeStaleScopedAutoIndexes(keepPaths);
  for (const summary of summaries) write(summary.file, scopedIndexContent(summary.area, summary.files));
  return summaries.map(({ area, count, file }) => ({ area, count, file }));
}

export function buildRefreshIndexBlock(): string {
  const indexText = exists("wiki/index.md") ? read("wiki/index.md") : "";
  const comparableIndex = stripMarkedSection(indexText, "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->");
  const files = wikiMarkdownFiles().filter((file) => !["wiki/index.md", "wiki/startup.md", "wiki/README.md"].includes(file) && !isScopedAutoIndex(file));
  const missing = files.filter((file) => !comparableIndex.includes(wikiLinkForFile(file)));
  if (missing.length > scopedAutoIndexThreshold) {
    const summaries = syncScopedAutoIndexes(missing);
    const rows = summaries.map((summary) => `| ${wikiLinkForFile(summary.file)} | ${summary.area} | ${summary.count} |`).join("\n");
    return `<!-- PROJECT-WIKI-AUTO-INDEX:START -->
## Auto-Discovered Pages

This block is managed by \`--refresh-index\`. Large route sets are split into scoped generated routers to keep \`wiki/index.md\` within startup-hook budget.

| Scoped Router | Area | Pages |
| --- | --- | ---: |
${rows}
<!-- PROJECT-WIKI-AUTO-INDEX:END -->`;
  }
  removeStaleScopedAutoIndexes(new Set());
  const rows = missing.length === 0
    ? "| none | - | - | - |\n"
    : missing.map((file) => {
        const meta = metadataSummary(file, read(file));
        return `| ${wikiLinkForFile(file)} | ${meta.scope} | ${meta.status} | ${meta.budget} |`;
      }).join("\n") + "\n";
  return `<!-- PROJECT-WIKI-AUTO-INDEX:START -->
## Auto-Discovered Pages

This block is managed by \`--refresh-index\`. Move useful rows into a hand-written section when they become part of the normal route.

| Document | Scope | Status | Token Budget |
| --- | --- | --- | --- |
${rows}<!-- PROJECT-WIKI-AUTO-INDEX:END -->`;
}

export function runQueryMode(): void {
  if (!queryTerm.trim()) {
    console.error("missing query: use --query \"search terms\"");
    process.exit(1);
  }
  const terms = queryTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const results: QueryResult[] = wikiMarkdownFiles().map((file) => {
    const text = read(file);
    const body = stripMetadataHeader(text);
    const title = wikiTitleForFile(file, text);
    const meta = metadataSummary(file, text);
    const weighted = `${file}\n${title}\n${meta.scope}\n${metadataValue(text, "tags")}\n${body}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (weighted.split(term).length - 1) + (file.toLowerCase().includes(term) ? 3 : 0) + (title.toLowerCase().includes(term) ? 5 : 0), 0);
    return { file, title, score, ...meta };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 10);
  console.log(`Project wiki query: ${queryTerm}`);
  if (results.length === 0) console.log("no matches");
  for (const item of results) console.log(`${item.score.toString().padStart(3)}  ${item.file}  ${item.scope}  ${item.status}  ${item.title}`);
}

export function projectCandidatesContent(): string {
  return `${metadata("inbox", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "candidates are adopted, rejected, or stale")}
# Project Candidates Inbox

## TL;DR

- This file temporarily stores project-canonical candidates from conversation.
- This file is not canonical truth.
- After review, move useful content into canonical/decision/source/meta docs or mark it rejected/resolved.

| Date | Title | Category | Content | Status |
| --- | --- | --- | --- | --- |
`;
}

export function appendCaptureInbox(): FileStatus {
  mkdirp("wiki/inbox");
  const relativePath = "wiki/inbox/project-candidates.md";
  const existed = exists(relativePath);
  if (!existed) write(relativePath, projectCandidatesContent());
  if (!captureTitle && !captureContent) return existed ? "exists" : "created";
  const title = (captureTitle || "Untitled candidate").replace(/\|/g, "/");
  const content = (captureContent || "").replace(/\r?\n/g, "<br>").replace(/\|/g, "/");
  const row = `| ${today} | ${title} | ${captureCategory.replace(/\|/g, "/")} | ${content} | pending |`;
  const current = read(relativePath);
  if (current.includes(row)) return "exists";
  write(relativePath, `${current.trimEnd()}\n${row}\n`);
  return "updated";
}

function gitOutput(args: string[]): string {
  try {
    return childProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function markdownList(items: string[], empty: string): string {
  if (items.length === 0) return `- ${empty}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function redactedPath(value: string): string {
  if (!value || value === "unset" || value === "not a git repository") return value;
  return path.isAbsolute(value) ? "<absolute-path>" : value;
}

function runtimePackageVersion(): string {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function existingFileList(files: string[]): string[] {
  return files.map((file) => `${exists(file) ? "[x]" : "[ ]"} \`${file}\``);
}

function issueReportTitle(): string {
  const title = issueDraftTitle.replace(/\r?\n/g, " ").trim();
  if (title) return title;
  return "Report project-librarian problem or side effect";
}

function issueDraftMarkdown(): string {
  const gitRepo = isGitRepository();
  const statusLines = gitRepo ? gitOutput(["status", "--short"]).split(/\r?\n/).filter(Boolean) : [];
  const branch = gitRepo ? gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown" : "not a git repository";
  const hooksPath = gitRepo ? gitOutput(["config", "--get", "core.hooksPath"]) || "unset" : "not a git repository";
  const remoteNames = gitRepo ? gitOutput(["remote"]).split(/\r?\n/).filter(Boolean) : [];
  const generatedFiles = existingFileList([
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "wiki/AGENTS.md",
    "wiki/startup.md",
    "wiki/index.md",
    ".codex/hooks.json",
    ".codex/hooks/wiki-session-start.js",
    ".claude/settings.json",
    ".claude/hooks/wiki-session-start.js",
    ".cursor/rules/project-librarian.mdc",
    ".cursor/hooks.json",
    ".cursor/hooks/wiki-session-start.js",
    ".gemini/settings.json",
    ".gemini/hooks/wiki-session-start.js",
    ".githooks/prepare-commit-msg",
    ".githooks/wiki-commit-trailers.js",
  ]);
  const title = issueReportTitle();
  const environment = [
    `project-librarian version: ${runtimePackageVersion()}`,
    `node version: ${process.version}`,
    `working directory: ${redactedPath(root)}`,
    `git branch: ${branch}`,
    `git local changes: ${gitRepo ? statusLines.length : "not available"}`,
    `git remotes configured: ${remoteNames.length}`,
    `git core.hooksPath: ${redactedPath(hooksPath)}`,
  ];
  const verification = [
    "Run `npx project-librarian --lint` and paste the output.",
    "If generated wiki links or document quality are involved, run `npx project-librarian --doctor` and paste the output.",
    "If the problem involves code evidence indexing, include the exact `--code-*` command and whether the runtime supports `node:sqlite`.",
  ];
  return `# ${title}

## Summary

Describe the problem, side effect, confusing behavior, or edge case found while using project-librarian.

## What You Were Trying To Do

- Command or natural-language skill request:
- Target project type:
- Expected project-librarian behavior:

## What Happened Instead

- Actual behavior:
- Error output or surprising generated content:
- Whether rerunning changed the result:

## Reproduction Steps

1. 
2. 
3. 

## Side Effects Or Risk

- Files unexpectedly changed:
- Existing content that may have been overwritten or moved:
- Hooks, git config, or agent startup context affected:
- User-visible confusion or workflow breakage:

## Affected Generated Files

${markdownList(generatedFiles, "No standard generated files detected yet.")}

## Environment

${markdownList(environment, "Environment unavailable.")}

## Diagnostics To Attach

${markdownList(verification, "Add the exact validation commands and results before filing.")}

## Workaround

- Current workaround, if any:
- Whether the workaround is safe to repeat:

## Notes

- This draft is read-only and does not create a GitHub issue.
- To create a GitHub issue after explicit user approval, use \`project-librarian --issue-create --issue-title "${title.replace(/"/g, "\\\"")}"\` or \`gh issue create --title "${title.replace(/"/g, "\\\"")}" --body-file <draft.md>\`.
- If local git changes are present, try to reproduce on a clean checkout before filing when practical.
`;
}

export function runIssueDraftMode(): void {
  console.log(issueDraftMarkdown());
}

function githubRemoteConfigured(): boolean {
  if (!isGitRepository()) return false;
  const remotes = gitOutput(["remote", "-v"]);
  return /github\.com[:/]/i.test(remotes);
}

function runGh(args: string[]): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
  });
}

function printGhFailure(result: childProcess.SpawnSyncReturns<string>, action: string): never {
  if (result.error) console.error(`gh ${action} failed: ${result.error.message}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status && result.status > 0 ? result.status : 1);
}

function issueBodyFilePath(): { file: string; cleanupDir: string | null } {
  if (issueBodyFile.trim()) return { file: path.resolve(root, issueBodyFile), cleanupDir: null };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-wiki-issue-"));
  const file = path.join(tempDir, "issue-body.md");
  fs.writeFileSync(file, issueDraftMarkdown(), "utf8");
  return { file, cleanupDir: tempDir };
}

export function runIssueCreateMode(): void {
  if (!isGitRepository()) {
    console.error("--issue-create requires a git repository with a GitHub remote.");
    process.exit(1);
  }
  if (!githubRemoteConfigured()) {
    console.error("--issue-create requires a GitHub remote so gh can infer the target repository.");
    process.exit(1);
  }
  const auth = runGh(["auth", "status"]);
  if (auth.status !== 0 || auth.error) printGhFailure(auth, "auth status");

  const body = issueBodyFilePath();
  try {
    const created = runGh(["issue", "create", "--title", issueReportTitle(), "--body-file", body.file]);
    if (created.status !== 0 || created.error) printGhFailure(created, "issue create");
    if (created.stdout) process.stdout.write(created.stdout);
    if (created.stderr) process.stderr.write(created.stderr);
  } finally {
    if (body.cleanupDir) fs.rmSync(body.cleanupDir, { recursive: true, force: true });
  }
}

export function runPruneCheckMode(): void {
  const candidates: PruneCandidate[] = [];
  for (const file of wikiMarkdownFiles()) {
    const text = read(file);
    const status = metadataValue(text, "status");
    const updated = metadataValue(text, "updated");
    const trigger = metadataValue(text, "review_trigger");
    const scope = metadataValue(text, "scope");
    const body = stripMetadataHeader(text);
    const reasons = [];
    const lifecycleScope = /project-canonical|project-decisions|inbox|migration-inbox/.test(scope);
    if (status === "active" && lifecycleScope && /pending|proposed|undecided|TODO|TBD|미정/i.test(body)) reasons.push("contains pending/proposed/undecided signal");
    if (status === "active" && trigger && /stale|old|expired|due|오래|도래|만료/i.test(trigger)) reasons.push(`review trigger: ${trigger}`);
    if (updated && updated < today && status === "active") reasons.push(`updated before today: ${updated}`);
    if (reasons.length > 0) candidates.push({ file, status, updated, reasons });
  }
  console.log("Project wiki prune-check");
  if (candidates.length === 0) console.log("no candidates");
  for (const item of candidates) {
    console.log(`${item.file}  status=${item.status || "-"}  updated=${item.updated || "-"}`);
    for (const reason of item.reasons) console.log(`  - ${reason}`);
  }
}

function printDiagnostics(title: string, diagnostics: WikiDiagnostic[], checked: number): boolean {
  console.log(title);
  for (const item of diagnostics) {
    console.log(`${item.severity} ${item.code} ${item.file} ${item.message}`);
  }
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.length - errors;
  if (errors > 0) {
    console.log(`failed: ${errors} errors, ${warnings} warnings, ${checked} wiki markdown files checked`);
    return false;
  }
  console.log(`passed: ${checked} wiki markdown files checked, ${warnings} warnings`);
  return true;
}

function collectWikiLinkReferences(files: string[]): WikiLinkReference[] {
  return files.flatMap((file) => extractWikiLinks(file, read(file)));
}

export function collectLinkDiagnostics(): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = [];
  const files = wikiMarkdownFiles();
  const fileSet = new Set(files);
  const links = collectWikiLinkReferences(files);
  for (const link of links) {
    if (!fileSet.has(link.normalizedTarget)) {
      diagnostics.push({
        code: "broken-link",
        severity: "error",
        file: link.file,
        message: `${link.kind} ${link.target} resolves to missing ${link.normalizedTarget}`,
      });
    }
  }
  if (exists("wiki/index.md")) {
    const indexLinks = extractWikiLinks("wiki/index.md", read("wiki/index.md"));
    const indexTargets = new Map<string, number>();
    for (const link of indexLinks) indexTargets.set(link.normalizedTarget, (indexTargets.get(link.normalizedTarget) ?? 0) + 1);
    for (const [target, count] of indexTargets) {
      if (count > 1) {
        diagnostics.push({
          code: "duplicate-route",
          severity: "warn",
          file: "wiki/index.md",
          message: `${count} index routes resolve to ${target}`,
        });
      }
    }
  }
  const incoming = new Map<string, number>();
  for (const link of links) incoming.set(link.normalizedTarget, (incoming.get(link.normalizedTarget) ?? 0) + 1);
  const orphanExemptions = new Set(["wiki/index.md", "wiki/startup.md", "wiki/README.md"]);
  for (const file of files) {
    if (orphanExemptions.has(file)) continue;
    if ((incoming.get(file) ?? 0) === 0) {
      diagnostics.push({
        code: "orphan-page",
        severity: "warn",
        file,
        message: "no incoming wiki links; route it from wiki/index.md or remove/merge it",
      });
    }
  }
  return diagnostics.sort((a, b) => a.severity.localeCompare(b.severity) || a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}

function legacyWikiRoots(): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^wiki_legacy(?:_|$)/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function shouldGuardAgainstLegacyReference(file: string): boolean {
  if (!/^wiki\/(?:canonical|decisions|sources)\//.test(file)) return false;
  return !file.endsWith("/migration-inbox.md");
}

function migrationLegacyReferenceDiagnostics(files: string[]): WikiDiagnostic[] {
  return files
    .filter(shouldGuardAgainstLegacyReference)
    .filter((file) => /\bwiki_legacy(?:_|\b|\/)/.test(stripMetadataHeader(read(file))))
    .map((file) => ({
      code: "migration-legacy-reference",
      severity: "error",
      file,
      message: "new project truth must not link to or cite wiki_legacy*; migrate the meaning or keep unresolved material in migration inboxes",
    }));
}

export function collectQualityDiagnostics(): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = [];
  const files = wikiMarkdownFiles();
  const titles = new Map<string, string[]>();
  for (const file of files) {
    const text = read(file);
    const body = stripMetadataHeader(text);
    const title = wikiTitleForFile(file, text).toLowerCase();
    titles.set(title, [...(titles.get(title) ?? []), file]);
    const status = metadataValue(text, "status");
    const updated = metadataValue(text, "updated");
    const scope = metadataValue(text, "scope");
    const budget = metadataValue(text, "read_budget");
    const tldrExpected = !/startup-router|wiki-router|wiki-entry|project-decision-template/.test(scope);
    if (tldrExpected && !/##\s+TL;DR/.test(body)) {
      diagnostics.push({ code: "missing-tldr", severity: "warn", file, message: "add a compact TL;DR near the top" });
    }
    if (status === "active" && updated && updated < today && /project-canonical|project-decisions|source-summary|wiki-meta/.test(scope)) {
      diagnostics.push({ code: "stale-review", severity: "warn", file, message: `updated before today: ${updated}` });
    }
    if (status === "active" && !/inbox|migration-inbox/.test(scope) && /proposed|undecided|TODO|TBD|미정/i.test(body)) {
      diagnostics.push({ code: "unresolved-signal", severity: "warn", file, message: "contains pending/proposed/undecided language" });
    }
    const shortLimit = file === "wiki/index.md" ? 4500 : 3500;
    if (budget === "short" && text.length > shortLimit) {
      diagnostics.push({ code: "budget-drift", severity: "warn", file, message: `${text.length}/${shortLimit} chars for short read_budget` });
    } else if (budget === "medium" && text.length > 8000) {
      diagnostics.push({ code: "budget-drift", severity: "warn", file, message: `${text.length}/8000 chars for medium read_budget` });
    }
    if (file.startsWith("wiki/canonical/") && /Code-proven behavior:/i.test(body) && !/evidence:\s*`?[\w./-]+/i.test(body)) {
      diagnostics.push({ code: "missing-evidence", severity: "warn", file, message: "code-proven canonical claims should cite concrete evidence paths" });
    }
    if (scope === "source-summary" && !/https?:\/\//.test(body)) {
      diagnostics.push({ code: "missing-source-link", severity: "warn", file, message: "source summaries should retain at least one source URL" });
    }
  }
  for (const [title, titleFiles] of titles) {
    if (titleFiles.length > 1) {
      for (const file of titleFiles) {
        diagnostics.push({ code: "duplicate-title", severity: "warn", file, message: `title also appears in ${titleFiles.filter((item) => item !== file).join(", ")}` });
      }
    }
  }
  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}

export function collectMigrationQualityDiagnostics(): WikiDiagnostic[] {
  const files = wikiMarkdownFiles();
  return migrationLegacyReferenceDiagnostics(files).sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}

export function collectMigrationLintDiagnostics(): WikiDiagnostic[] {
  if (legacyWikiRoots().length === 0) return [];
  const requiredFiles = [
    "wiki/migration/inventory.md",
    "wiki/migration/coverage.md",
    "wiki/migration/plan.md",
    "wiki/migration/verification.md",
    "wiki/canonical/migration-inbox.md",
    "wiki/decisions/migration-inbox.md",
    "wiki/sources/migration-inbox.md",
  ];
  const diagnostics: WikiDiagnostic[] = requiredFiles
    .filter((file) => !exists(file))
    .map((file) => ({
      code: "migration-missing-file",
      severity: "error",
      file,
      message: "migration review files are missing; run --migrate or keep migration diagnostics out of normal doctor",
    }));
  diagnostics.push(...collectMigrationCoverageDiagnostics());
  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

export function runLinkCheckMode(): void {
  const ok = printDiagnostics("Project wiki link-check", collectLinkDiagnostics(), wikiMarkdownFiles().length);
  if (!ok) process.exit(1);
}

export function runQualityCheckMode(): void {
  const ok = printDiagnostics("Project wiki quality-check", collectQualityDiagnostics(), wikiMarkdownFiles().length);
  if (!ok) process.exit(1);
}

export function runMigrationQualityCheckMode(): void {
  const ok = printDiagnostics("Project wiki migration quality-check", collectMigrationQualityDiagnostics(), wikiMarkdownFiles().length);
  if (!ok) process.exit(1);
}

export function runMigrationLintMode(): void {
  const ok = printDiagnostics("Project wiki migration lint", collectMigrationLintDiagnostics(), wikiMarkdownFiles().length);
  if (!ok) process.exit(1);
}

export function runMigrationDoctorMode(): void {
  const lintOk = printDiagnostics("Project wiki migration lint", collectMigrationLintDiagnostics(), wikiMarkdownFiles().length);
  const qualityOk = printDiagnostics("Project wiki migration quality-check", collectMigrationQualityDiagnostics(), wikiMarkdownFiles().length);
  if (!lintOk || !qualityOk) process.exit(1);
}

// B2 router-truth contradiction rule. A compact router that contradicts the
// decision log is worse than none: the measured 2026-06-10 run spiraled into
// post-answer verification because wiki/startup.md Recent Decisions and
// wiki/decisions/recent.md said "None yet." while wiki/decisions/log.md held the
// dated answer. This flags that exact contradiction as an error-level diagnostic.
// "None yet." is the bootstrap template marker for an empty decision surface
// (startup template "## Recent Project Decisions" and recent.md template
// "## Decisions" both seed "- None yet."), so its presence while the log carries a
// dated entry is the template-equivalent of an unmaintained router.
//
// SECTION-ANCHORED SCAN: the rule checks the relevant section body only, not the
// whole file, to avoid false-positives on other sections (e.g. an open-questions
// list that legitimately says "None yet." while Recent Decisions is maintained).
//   wiki/startup.md   → "## Recent Project Decisions" section body
//   decisions/recent.md → "## Decisions" section body
//
// MINOR 2: the marker regex is tolerant of trailing whitespace / omitted terminal
// period ("None yet", "None yet. ") but stays anchored to the section scope above.
// Coupling: this English-only marker matches the bootstrap template text only;
// a project using a different language for these sections will not be checked.
const ROUTER_TRUTH_NONE_YET_REGEX = /\bNone yet\.?\s*$/m;

// Extract the body of a named heading section (from the heading line to the next
// same-or-higher-level heading, or end of string). Returns empty string when the
// heading is absent so the caller can decide whether to flag or skip.
function extractSectionBody(markdown: string, headingText: string): string {
  // Match `## <headingText>` (level-2 only, matching the template structure).
  const headingRe = new RegExp(`^##\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = headingRe.exec(markdown);
  if (!match) return "";
  const afterHeading = markdown.slice(match.index + match[0].length);
  // Stop at the next ## heading (same or higher level), or end of string.
  const nextHeading = /^##\s/m.exec(afterHeading);
  return nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;
}

export function collectRouterTruthDiagnostics(): WikiDiagnostic[] {
  const logPath = "wiki/decisions/log.md";
  if (!exists(logPath)) return [];
  const logHasDatedEntry = /\b\d{4}-\d{2}-\d{2}\b/.test(stripMetadataHeader(read(logPath)));
  if (!logHasDatedEntry) return [];
  const diagnostics: WikiDiagnostic[] = [];
  // Each tuple: [file, headingText, surfaceLabel]
  // headingText must match the bootstrap template section heading exactly so the
  // section-anchored scan never accidentally reads unrelated sections.
  const routers: Array<[file: string, heading: string, surface: string]> = [
    ["wiki/startup.md", "Recent Project Decisions", "Recent Decisions"],
    ["wiki/decisions/recent.md", "Decisions", "Decisions"],
  ];
  for (const [file, heading, surface] of routers) {
    if (!exists(file)) continue;
    const section = extractSectionBody(stripMetadataHeader(read(file)), heading);
    if (section === "") continue; // section absent — skip rather than false-positive
    if (ROUTER_TRUTH_NONE_YET_REGEX.test(section)) {
      diagnostics.push({
        code: "router-truth-contradiction",
        severity: "error",
        file,
        message: `${file} ${surface} still says "None yet." while ${logPath} holds a dated decision entry; update ${file} to reflect the recorded decision`,
      });
    }
  }
  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}

export function runDoctorMode(fix: boolean): void {
  if (fix) {
    console.log("Project wiki doctor --fix");
    if (exists("wiki/index.md")) {
      upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock());
      console.log("updated wiki/index.md auto-discovered pages");
    } else {
      console.log("skipped wiki/index.md auto-discovered pages: missing wiki/index.md");
    }
  }
  const files = wikiMarkdownFiles();
  const linkOk = printDiagnostics("Project wiki link-check", collectLinkDiagnostics(), files.length);
  const qualityOk = printDiagnostics("Project wiki quality-check", collectQualityDiagnostics(), files.length);
  const routerTruthOk = printDiagnostics("Project wiki router-truth check", collectRouterTruthDiagnostics(), files.length);
  runLintMode();
  if (!linkOk || !qualityOk || !routerTruthOk) process.exit(1);
}

export function runLintMode(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const agentSelection = resolveProjectAgents();
  const activeAgents = new Set<AgentTarget>(agentSelection.agents);
  const hasAgent = (agent: AgentTarget): boolean => activeAgents.has(agent);
  warnings.push(...agentSelection.warnings);
  const requiredFiles = [
    ...commonRequiredFiles,
    ...agentSelection.agents.flatMap((agent) => agentRequiredFiles[agent]),
  ];
  for (const file of requiredFiles) {
    if (!exists(file)) errors.push(`missing required file: ${file}`);
  }
  const files = wikiMarkdownFiles();
  const requiredMetadataKeys = ["status", "updated", "scope", "read_budget", "decision_ref", "review_trigger"];
  for (const file of files) {
    const text = read(file);
    if (!hasMetadataHeader(text)) {
      errors.push(`missing metadata header: ${file}`);
      continue;
    }
    for (const key of requiredMetadataKeys) {
      if (!metadataValue(text, key)) errors.push(`missing metadata key ${key}: ${file}`);
    }
  }
  const startupLength = exists("wiki/startup.md") ? read("wiki/startup.md").length : 0;
  const indexLength = exists("wiki/index.md") ? read("wiki/index.md").length : 0;
  if (startupLength > 3500) warnings.push(`startup exceeds hook budget: ${startupLength}/3500 chars`);
  if (indexLength > 4500) warnings.push(`index exceeds hook budget: ${indexLength}/4500 chars`);
  if (exists("wiki/startup.md") && /##\s+Always Read First/.test(read("wiki/startup.md"))) warnings.push("startup uses Always Read First; prefer Read On Demand routing");
  if (exists("AGENTS.md") && !read("AGENTS.md").includes("wiki/AGENTS.md")) warnings.push("root AGENTS.md should point detailed wiki editing rules to wiki/AGENTS.md");
  if (hasAgent("claude") && exists("CLAUDE.md") && !read("CLAUDE.md").includes("@AGENTS.md")) errors.push("CLAUDE.md should import AGENTS.md for Claude Code compatibility");
  if (hasAgent("gemini") && exists("GEMINI.md") && !read("GEMINI.md").includes("@AGENTS.md")) errors.push("GEMINI.md should import AGENTS.md for Gemini CLI compatibility");
  if (hasAgent("cursor") && exists(".cursor/rules/project-librarian.mdc")) {
    const cursorRule = read(".cursor/rules/project-librarian.mdc");
    if (!cursorRule.includes("alwaysApply: true") || !cursorRule.includes("@AGENTS.md")) errors.push("Cursor project rule should always apply and reference AGENTS.md");
  }
  if (exists("wiki/AGENTS.md") && !read("wiki/AGENTS.md").includes("Language policy")) warnings.push("wiki/AGENTS.md is missing language policy");
  for (const legacyFile of ["wiki/canonical/wiki-operating-model.md", "wiki/canonical/decision-policy.md", "wiki/decisions/wiki-v1-decisions.md"]) {
    if (exists(legacyFile)) errors.push(`legacy wiki-ops file must move out of project canonical/decisions: ${legacyFile}`);
  }
  if (hasAgent("codex") && exists(".codex/hooks/wiki-session-start.js")) {
    const hook = read(".codex/hooks/wiki-session-start.js");
    if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]')) errors.push("startup hook does not clearly inject only startup/index with expected budgets");
  }
  if (hasAgent("claude") && exists(".claude/hooks/wiki-session-start.js")) {
    const hook = read(".claude/hooks/wiki-session-start.js");
    if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]')) errors.push("Claude startup hook does not clearly inject only startup/index with expected budgets");
  }
  if (hasAgent("cursor") && exists(".cursor/hooks/wiki-session-start.js")) {
    const hook = read(".cursor/hooks/wiki-session-start.js");
    if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]') || !hook.includes("additional_context")) errors.push("Cursor startup hook does not clearly inject startup/index through additional_context");
  }
  if (hasAgent("gemini") && exists(".gemini/hooks/wiki-session-start.js")) {
    const hook = read(".gemini/hooks/wiki-session-start.js");
    if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]') || !hook.includes("hookSpecificOutput")) errors.push("Gemini startup hook does not clearly inject startup/index through hookSpecificOutput");
  }
  if (hasAgent("claude") && exists(".claude/settings.json")) {
    const command = "node .claude/hooks/wiki-session-start.js";
    try {
      const settings = parseJson<HookConfig>(".claude/settings.json", { hooks: {} });
      if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
        throw new Error(".claude/settings.json has invalid hooks object");
      }
      const sessionStart = settings.hooks.SessionStart ?? [];
      const configuredMatchers = new Set(sessionStart
        .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command))
        .map((entry) => entry.matcher));
      for (const matcher of ["startup", "resume", "clear", "compact"]) {
        if (!configuredMatchers.has(matcher)) errors.push(`.claude/settings.json is missing the project wiki SessionStart hook for ${matcher}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }
  if (hasAgent("cursor") && exists(".cursor/hooks.json")) {
    const command = "node .cursor/hooks/wiki-session-start.js";
    try {
      const settings = parseJson<CursorHookConfig>(".cursor/hooks.json", { version: 1, hooks: {} });
      if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
        throw new Error(".cursor/hooks.json has invalid hooks object");
      }
      const sessionStart = settings.hooks.sessionStart ?? [];
      if (!Array.isArray(sessionStart) || !sessionStart.some((hook) => hook?.command === command)) {
        errors.push(".cursor/hooks.json is missing the project wiki sessionStart hook");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }
  if (hasAgent("gemini") && exists(".gemini/settings.json")) {
    const command = 'node "$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js"';
    try {
      const settings = parseJson<HookConfig>(".gemini/settings.json", { hooks: {} });
      if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
        throw new Error(".gemini/settings.json has invalid hooks object");
      }
      const sessionStart = settings.hooks.SessionStart ?? [];
      const configuredMatchers = new Set(sessionStart
        .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command))
        .map((entry) => entry.matcher));
      for (const matcher of ["startup", "resume", "clear"]) {
        if (!configuredMatchers.has(matcher)) errors.push(`.gemini/settings.json is missing the project wiki SessionStart hook for ${matcher}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }
  for (const file of [".githooks/prepare-commit-msg", ".githooks/wiki-commit-trailers.js"]) {
    if (exists(file) && (fs.statSync(abs(file)).mode & 0o111) === 0) errors.push(`${file} is not executable`);
  }
  if (isGitRepository() && !noGitConfigMode) {
    let hooksPath = "";
    try {
      hooksPath = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      hooksPath = "";
    }
    if (hooksPath !== ".githooks") warnings.push(`git core.hooksPath is not .githooks: ${hooksPath || "unset"}`);
  }
  if (exists("wiki/index.md") && !read("wiki/index.md").includes("## Language Policy")) errors.push("index is missing Language Policy section");
  if (exists("wiki/canonical/glossary.md")) {
    const glossaryText = read("wiki/canonical/glossary.md");
    if (!hasGlossaryTable(glossaryText)) errors.push("glossary is missing required table header: | Term | Definition | Avoid | Related Canonical Doc | Status |");
    if (exists("wiki/index.md") && !read("wiki/index.md").includes("[[canonical/glossary]]")) errors.push("glossary exists but index is missing glossary routing");
  } else if (hasGlossaryNeedSignal(canonicalBodyForLint())) {
    warnings.push("project canonical docs contain naming/model signals; consider running --glossary-init");
  }
  if (exists("wiki/meta/wiki-ops-v1-decisions.md")) {
    const ops = read("wiki/meta/wiki-ops-v1-decisions.md");
    for (const phrase of ["metadata headers", "Read On Demand", "language", "--no-git-config", "needs-human-review", "Wiki-scope"]) {
      if (!ops.includes(phrase)) warnings.push(`wiki ops decision pack may be missing decision phrase: ${phrase}`);
    }
  }
  console.log("Project wiki lint");
  for (const warning of warnings) console.log(`warn  ${warning}`);
  for (const error of errors) console.log(`error ${error}`);
  if (errors.length > 0) {
    console.log(`failed: ${errors.length} errors, ${warnings.length} warnings`);
    process.exit(1);
  }
  console.log(`passed: ${files.length} wiki markdown files checked, ${warnings.length} warnings`);
}
