import * as fs from "node:fs";
import type { FileStatus, MarkdownTableItem, MigrationInboxEntry, MigrationInboxStatus, MigrationItem, MigrationKind, MigrationReviewRow, MigrationRunResult, MigrationState, MigrationVerificationRow, ResultRow, SemanticStatus, StatusCounts } from "./types";
import { abs, exists, mkdirp, read, today, upsertMarkedSection, writeManaged } from "./workspace";
import { metadata } from "./templates";
import { compactSummary, firstHeading, parseMarkdownTableRows, walkMarkdownFiles } from "./wiki-files";

export function classifyMarkdown(relativePath: string, text: string): MigrationKind {
  const haystack = `${relativePath}\n${text.slice(0, 8000)}`.toLowerCase();
  const hasDecisionSignal = /\b(adr|decision|decisions|rejected|alternative|tradeoff|rationale)\b|결정|기각|대안|재검토/.test(haystack);
  const hasSourceSignal = /\b(source|sources|reference|references|bibliography|citation|citations|research|paper|article|link)\b|출처|참고|자료|링크/.test(haystack);
  const hasCanonicalSignal = /\b(prd|brief|spec|requirements|roadmap|architecture|api|data model|policy|scope|goal|goals|user|users|persona|scenario|success)\b|정본|요구사항|기획|범위|목표|사용자|시나리오|성공/.test(haystack);
  if (hasDecisionSignal) return "decision";
  if (hasSourceSignal) return "source";
  if (hasCanonicalSignal) return "canonical";
  if (/^(docs|documentation|wiki|notes|knowledge|specs)\//.test(relativePath)) return "canonical";
  return "other";
}


export function markdownTableRows(items: MarkdownTableItem[]): string {
  if (items.length === 0) return "| none | - | - | - |\n";
  return items.map((item) => `| ${item.path} | ${item.title.replace(/\|/g, "/")} | ${item.summary.replace(/\|/g, "/")} | pending |`).join("\n") + "\n";
}

export function buildInbox(title: string, description: string, items: MarkdownTableItem[]): string {
  return `${metadata("migration-inbox", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "migration candidates are adopted or rescanned")}
# ${title}

## TL;DR

- ${description}
- Original files are preserved under a \`wiki_legacy\` directory.
- Review each item, rewrite useful meaning into canonical/decision/source/meta docs, then set status to adopted/rejected/resolved/needs-human-review.
- Status values: pending, adopted, rejected, resolved, needs-human-review.

| Source | Title | Summary | Status |
| --- | --- | --- | --- |
${markdownTableRows(items)}`;
}

export function timestampSuffix(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

export function prepareMigrationMode(): MigrationState {
  if (exists("wiki")) {
    let legacyPath = "wiki_legacy";
    if (exists(legacyPath)) legacyPath = `wiki_legacy_${timestampSuffix()}`;
    fs.renameSync(abs("wiki"), abs(legacyPath));
    return { legacyPath, note: `moved wiki to ${legacyPath}` };
  }
  if (exists("wiki_legacy")) return { legacyPath: "wiki_legacy", note: "using existing wiki_legacy" };
  return { legacyPath: "", note: "no existing wiki directory to migrate" };
}

export function migrationTargetForKind(kind: MigrationKind | string): string {
  if (kind === "decision") return "wiki/decisions/migration-inbox.md";
  if (kind === "source") return "wiki/sources/migration-inbox.md";
  return "wiki/canonical/migration-inbox.md";
}

export function runMigrationMode(migrationState: MigrationState): MigrationRunResult {
  const legacyPath = migrationState.legacyPath;
  const markdownFiles = legacyPath && exists(legacyPath) ? walkMarkdownFiles(abs(legacyPath), [], abs(legacyPath)) : [];
  const items: MigrationItem[] = markdownFiles.map((file) => {
    const text = read(file.path);
    return {
      path: file.path,
      legacyPath: file.basePath,
      kind: classifyMarkdown(file.path, text),
      title: firstHeading(text, file.path),
      summary: compactSummary(text),
      bytes: Buffer.byteLength(text, "utf8"),
    };
  });
  const byKind: Record<MigrationKind, MigrationItem[]> = {
    canonical: items.filter((item) => item.kind === "canonical"),
    decision: items.filter((item) => item.kind === "decision"),
    source: items.filter((item) => item.kind === "source"),
    other: items.filter((item) => item.kind === "other"),
  };

  const inventoryRows = items.length === 0
    ? "| none | - | - | 0 | - |\n"
    : items.map((item) => `| ${item.path} | ${item.kind} | ${item.title.replace(/\|/g, "/")} | ${item.bytes} | ${item.summary.replace(/\|/g, "/")} |`).join("\n") + "\n";
  const inventory = `${metadata("migration-inventory", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration scan is rerun")}
# Migration Inventory

## TL;DR

- Generated: ${today}
- Legacy root: ${legacyPath || "none"}
- Markdown files: ${items.length}
- Legacy files are not copied directly into the new wiki; they are mapped to rewrite inboxes.

| Legacy Source | Classification | Title | Size (bytes) | Summary |
| --- | --- | --- | ---: | --- |
${inventoryRows}`;

  const plan = `${metadata("migration-plan", "short", "wiki/meta/wiki-ops-v1-decisions.md", "migration procedure or status changes")}
# Migration Plan

## TL;DR

- Generated: ${today}
- Preparation: ${migrationState.note}
- The new \`./wiki\` uses the standard structure.
- Next step: review inbox items and absorb useful meaning into canonical, decisions, sources, or meta docs.

## Counts

| Classification | Count |
| --- | ---: |
| canonical candidates | ${byKind.canonical.length} |
| decision candidates | ${byKind.decision.length} |
| source candidates | ${byKind.source.length} |
| other candidates | ${byKind.other.length} |
`;

  const verificationRows = items.length === 0
    ? "| none | - | - | pass | - |\n"
    : items.map((item) => `| ${item.path} | ${item.kind} | ${migrationTargetForKind(item.kind)} | mapped | pending semantic rewrite |`).join("\n") + "\n";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, or rescanned")}
# Migration Verification

## TL;DR

- legacy root: ${legacyPath || "none"}
- legacy markdown files: ${items.length}
- mapped files: ${items.length}
- coverage: ${items.length === markdownFiles.length ? "pass" : "fail"}
- This verifies file coverage only. Semantic completeness is confirmed after inbox statuses are resolved.

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRows}`;

  const migrationStartupBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration State

- ${today}: preserved existing wiki at \`${legacyPath || "no wiki_legacy"}\` and regenerated the standard wiki structure.
- Scanned ${items.length} legacy markdown files and created migration inventory, plan, verification, and inbox files.
- Do not delete \`${legacyPath || "wiki_legacy"}\` until all migration inbox items are adopted/rejected/resolved and needs-human-review is 0.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const migrationIndexBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration

- [[migration/plan]]
  - Read when: migration procedure or status matters.
  - Update when: migration procedure or state changes.
  - Token budget: short.
- [[migration/inventory]]
  - Read when: legacy markdown file list and classification matter.
  - Update when: migration is rescanned.
  - Token budget: on-demand.
- [[migration/verification]]
  - Read when: legacy file coverage or semantic migration status matters.
  - Update when: migration inbox statuses change.
  - Token budget: on-demand.
- [[migration/review]]
  - Read when: semantic migration review status matters.
  - Update when: \`--review-migration\` syncs migration state.
  - Token budget: on-demand.
- [[canonical/migration-inbox]]
  - Read when: absorbing legacy canonical candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
- [[decisions/migration-inbox]]
  - Read when: absorbing legacy decision candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
- [[sources/migration-inbox]]
  - Read when: absorbing legacy source candidates.
  - Update when: candidates are adopted/rejected/resolved/needs-human-review.
  - Token budget: medium.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const results: ResultRow[] = [];
  mkdirp("wiki/migration");
  results.push(["wiki/migration/inventory.md", writeManaged("wiki/migration/inventory.md", inventory)]);
  results.push(["wiki/migration/plan.md", writeManaged("wiki/migration/plan.md", plan)]);
  results.push(["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)]);
  results.push(["wiki/canonical/migration-inbox.md", writeManaged("wiki/canonical/migration-inbox.md", buildInbox("Canonical Migration Inbox", "Legacy content that may belong in current project truth.", byKind.canonical.concat(byKind.other)))]);
  results.push(["wiki/decisions/migration-inbox.md", writeManaged("wiki/decisions/migration-inbox.md", buildInbox("Decision Migration Inbox", "Legacy content that may belong in project decision history.", byKind.decision))]);
  results.push(["wiki/sources/migration-inbox.md", writeManaged("wiki/sources/migration-inbox.md", buildInbox("Source Migration Inbox", "Legacy content that may belong in source summaries.", byKind.source))]);
  results.push(["wiki/startup.md migration state", upsertMarkedSection("wiki/startup.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationStartupBlock)]);
  results.push(["wiki/index.md migration router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationIndexBlock)]);
  return { results, total: items.length, legacyPath };
}

export function normalizeMigrationStatus(status: unknown): MigrationInboxStatus {
  const value = String(status || "").trim().toLowerCase();
  if (isMigrationInboxStatus(value)) return value;
  if (value.includes("adopt")) return "adopted";
  if (value.includes("reject")) return "rejected";
  if (value.includes("resolve")) return "resolved";
  if (value.includes("human")) return "needs-human-review";
  return "pending";
}

export function isMigrationInboxStatus(value: string): value is MigrationInboxStatus {
  return ["adopted", "rejected", "resolved", "needs-human-review", "pending"].includes(value);
}

export function migrationInboxStatusMap(): Map<string, MigrationInboxEntry> {
  const inboxFiles = ["wiki/canonical/migration-inbox.md", "wiki/decisions/migration-inbox.md", "wiki/sources/migration-inbox.md"];
  const statuses = new Map<string, MigrationInboxEntry>();
  for (const file of inboxFiles) {
    if (!exists(file)) continue;
    for (const cells of parseMarkdownTableRows(read(file), 4)) {
      const source = cells[0];
      if (!source) continue;
      statuses.set(source, { status: normalizeMigrationStatus(cells[3]), inbox: file });
    }
  }
  return statuses;
}

export function semanticStatusForInboxStatus(status: MigrationInboxStatus): SemanticStatus {
  if (["adopted", "rejected", "resolved", "needs-human-review"].includes(status)) return status;
  return "pending semantic rewrite";
}

export function runReviewMigrationMode(): void {
  if (!exists("wiki/migration/verification.md")) {
    console.error("missing wiki/migration/verification.md; run --migrate first");
    process.exit(1);
  }
  const verificationText = read("wiki/migration/verification.md");
  const verificationRows: MigrationVerificationRow[] = parseMarkdownTableRows(verificationText, 5).map((cells) => ({
    legacyPath: cells[0] ?? "",
    kind: cells[1] ?? "",
    target: cells[2] ?? "",
    coverage: cells[3] ?? "",
  }));
  const inboxStatuses = migrationInboxStatusMap();
  const reviewedRows: MigrationReviewRow[] = verificationRows.map((row) => {
    const inbox = inboxStatuses.get(row.legacyPath);
    const status = inbox ? inbox.status : "needs-human-review";
    return { ...row, inboxStatus: status, semanticStatus: semanticStatusForInboxStatus(status), note: inbox ? inbox.inbox : "missing migration inbox row" };
  });
  const counts: StatusCounts = reviewedRows.reduce<StatusCounts>((acc, row) => {
    acc[row.inboxStatus] = (acc[row.inboxStatus] || 0) + 1;
    return acc;
  }, {});
  const pending = counts.pending || 0;
  const needsHuman = counts["needs-human-review"] || 0;
  const complete = pending === 0 && needsHuman === 0;
  const reviewRows = reviewedRows.length === 0
    ? "| none | - | - | - | - |\n"
    : reviewedRows.map((row) => `| ${row.legacyPath} | ${row.kind} | ${row.inboxStatus} | ${row.semanticStatus} | ${row.note.replace(/\|/g, "/")} |`).join("\n") + "\n";
  const review = `${metadata("migration-review", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox statuses change")}
# Migration Review

## TL;DR

- generated: ${today}
- total legacy rows: ${reviewedRows.length}
- adopted: ${counts.adopted || 0}
- rejected: ${counts.rejected || 0}
- resolved: ${counts.resolved || 0}
- pending: ${pending}
- needs-human-review: ${needsHuman}
- semantic migration complete: ${complete ? "yes" : "no"}

| Legacy Source | Classification | Inbox Status | Semantic Status | Evidence |
| --- | --- | --- | --- | --- |
${reviewRows}`;
  const verificationRowsText = reviewedRows.length === 0
    ? "| none | - | - | pass | - |\n"
    : reviewedRows.map((row) => `| ${row.legacyPath} | ${row.kind} | ${row.target} | ${row.coverage} | ${row.semanticStatus} |`).join("\n") + "\n";
  const legacyRoot = (verificationText.match(/^- legacy root:\s*(.+)$/m) || [])[1] || "unknown";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, resolved, or marked needs-human-review")}
# Migration Verification

## TL;DR

- legacy root: ${legacyRoot}
- legacy markdown files: ${reviewedRows.length}
- mapped files: ${reviewedRows.filter((row) => row.coverage === "mapped").length}
- coverage: ${reviewedRows.every((row) => row.coverage === "mapped") ? "pass" : "fail"}
- semantic migration complete: ${complete ? "yes" : "no"}
- pending: ${pending}
- needs-human-review: ${needsHuman}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRowsText}`;
  const results: ResultRow[] = [
    ["wiki/migration/review.md", writeManaged("wiki/migration/review.md", review)],
    ["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)],
  ];
  console.log("Project wiki migration review complete.");
  for (const [relativePath, status] of results) console.log(`${String(status).padEnd(7)} ${relativePath}`);
  console.log(`summary pending=${pending} needs-human-review=${needsHuman} complete=${complete ? "yes" : "no"}`);
}
