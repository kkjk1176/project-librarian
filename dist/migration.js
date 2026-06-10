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
exports.classifyMarkdown = classifyMarkdown;
exports.extractMigrationUnits = extractMigrationUnits;
exports.collectMigrationCoverageDiagnostics = collectMigrationCoverageDiagnostics;
exports.markdownTableRows = markdownTableRows;
exports.buildInbox = buildInbox;
exports.timestampSuffix = timestampSuffix;
exports.prepareMigrationMode = prepareMigrationMode;
exports.migrationTargetForKind = migrationTargetForKind;
exports.runMigrationMode = runMigrationMode;
exports.normalizeMigrationStatus = normalizeMigrationStatus;
exports.isMigrationInboxStatus = isMigrationInboxStatus;
exports.migrationInboxStatusMap = migrationInboxStatusMap;
exports.semanticStatusForInboxStatus = semanticStatusForInboxStatus;
exports.runReviewMigrationMode = runReviewMigrationMode;
const fs = __importStar(require("node:fs"));
const workspace_1 = require("./workspace");
const templates_1 = require("./templates");
const wiki_files_1 = require("./wiki-files");
function classifyMarkdown(relativePath, text) {
    const haystack = `${relativePath}\n${text.slice(0, 8000)}`.toLowerCase();
    const hasDecisionSignal = /\b(adr|decision|decisions|rejected|alternative|tradeoff|rationale)\b|결정|기각|대안|재검토/.test(haystack);
    const hasSourceSignal = /\b(source|sources|reference|references|bibliography|citation|citations|research|paper|article|link)\b|출처|참고|자료|링크/.test(haystack);
    const hasCanonicalSignal = /\b(prd|brief|spec|requirements|roadmap|architecture|api|data model|policy|scope|goal|goals|user|users|persona|scenario|success)\b|정본|요구사항|기획|범위|목표|사용자|시나리오|성공/.test(haystack);
    if (hasDecisionSignal)
        return "decision";
    if (hasSourceSignal)
        return "source";
    if (hasCanonicalSignal)
        return "canonical";
    if (/^(docs|documentation|wiki|notes|knowledge|specs)\//.test(relativePath))
        return "canonical";
    return "other";
}
function markdownTableCell(value) {
    return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
function slugPart(value) {
    return value.toLowerCase().replace(/[^a-z0-9가-힣ぁ-んァ-ン一-龥]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unit";
}
function unitSummary(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 180);
}
function nextUnitId(legacyPath, index, summary) {
    return `${legacyPath}#u${String(index).padStart(3, "0")}-${slugPart(summary)}`;
}
function extractMigrationUnits(legacyPath, text) {
    const body = (0, workspace_1.stripMetadataHeader)(text);
    const lines = body.split(/\r?\n/);
    const units = [];
    let heading = "";
    let paragraph = [];
    let inCodeFence = false;
    let codeBlock = [];
    const pushUnit = (type, value) => {
        const summary = unitSummary(value);
        if (!summary)
            return;
        units.push({
            id: nextUnitId(legacyPath, units.length + 1, summary),
            legacyPath,
            type,
            heading,
            summary,
        });
    };
    const flushParagraph = () => {
        if (paragraph.length === 0)
            return;
        pushUnit("paragraph", paragraph.join(" "));
        paragraph = [];
    };
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^```/.test(trimmed)) {
            if (inCodeFence) {
                codeBlock.push(line);
                pushUnit("code-block", codeBlock.join("\n"));
                codeBlock = [];
                inCodeFence = false;
            }
            else {
                flushParagraph();
                inCodeFence = true;
                codeBlock = [line];
            }
            continue;
        }
        if (inCodeFence) {
            codeBlock.push(line);
            continue;
        }
        if (!trimmed) {
            flushParagraph();
            continue;
        }
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch?.[2]) {
            flushParagraph();
            heading = headingMatch[2].trim();
            pushUnit("heading", heading);
            continue;
        }
        if (/^\|.+\|$/.test(trimmed) && !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) {
            flushParagraph();
            pushUnit("table-row", trimmed);
            continue;
        }
        if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) {
            flushParagraph();
            pushUnit("list-item", trimmed);
            continue;
        }
        paragraph.push(trimmed);
    }
    if (inCodeFence && codeBlock.length > 0)
        pushUnit("code-block", codeBlock.join("\n"));
    flushParagraph();
    return units;
}
function coverageTableRows(units) {
    if (units.length === 0)
        return "| none | - | - | - | - | pending | - | - |\n";
    return units.map((unit) => `| ${markdownTableCell(unit.id)} | ${markdownTableCell(unit.legacyPath)} | ${unit.type} | ${markdownTableCell(unit.heading || "-")} | ${markdownTableCell(unit.summary)} | pending | - | - |`).join("\n") + "\n";
}
function isMigrationCoverageStatus(value) {
    return ["adopted", "merged", "superseded", "rejected", "resolved", "needs-human-review", "pending"].includes(value);
}
function legacyWikiRoots() {
    if (!fs.existsSync(workspace_1.root))
        return [];
    return fs.readdirSync(workspace_1.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^wiki_legacy(?:_|$)/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
}
function expectedMigrationUnits() {
    return legacyWikiRoots()
        .flatMap((legacyRoot) => (0, wiki_files_1.walkMarkdownFiles)((0, workspace_1.abs)(legacyRoot), [], (0, workspace_1.abs)(legacyRoot)))
        .flatMap((file) => extractMigrationUnits(file.basePath, (0, workspace_1.read)(file.path)));
}
function collectMigrationCoverageDiagnostics() {
    const units = expectedMigrationUnits();
    if (units.length === 0)
        return [];
    if (!(0, workspace_1.exists)("wiki/migration/coverage.md")) {
        return [{
                code: "migration-coverage-missing",
                severity: "error",
                file: "wiki/migration/coverage.md",
                message: "migration unit coverage ledger is missing; run --migrate to account for legacy meaning units",
            }];
    }
    const diagnostics = [];
    const expectedIds = new Set(units.map((unit) => unit.id));
    const seenIds = new Set();
    const rows = (0, wiki_files_1.parseMarkdownTableRows)((0, workspace_1.read)("wiki/migration/coverage.md"), 8).filter((cells) => cells[0] !== "Unit ID");
    for (const cells of rows) {
        const id = cells[0] || "";
        const status = String(cells[5] || "").trim().toLowerCase();
        const target = String(cells[6] || "").trim();
        if (seenIds.has(id)) {
            diagnostics.push({ code: "migration-duplicate-unit", severity: "error", file: "wiki/migration/coverage.md", message: `duplicate migration unit row: ${id}` });
        }
        seenIds.add(id);
        if (!expectedIds.has(id)) {
            diagnostics.push({ code: "migration-stale-unit", severity: "warn", file: "wiki/migration/coverage.md", message: `coverage row does not match current legacy units: ${id}` });
        }
        if (!isMigrationCoverageStatus(status)) {
            diagnostics.push({ code: "migration-invalid-status", severity: "error", file: "wiki/migration/coverage.md", message: `unit ${id} has invalid status: ${status || "(blank)"}` });
        }
        if (["adopted", "merged"].includes(status) && !/^wiki\/(canonical|decisions|sources|meta)\//.test(target)) {
            diagnostics.push({ code: "migration-missing-target", severity: "error", file: "wiki/migration/coverage.md", message: `unit ${id} is ${status} but target is not a new wiki page` });
        }
        if (/\bwiki_legacy(?:_|\b|\/)/.test(target)) {
            diagnostics.push({ code: "migration-legacy-target", severity: "error", file: "wiki/migration/coverage.md", message: `unit ${id} targets wiki_legacy* instead of migrated new-wiki truth` });
        }
        if (status === "pending") {
            diagnostics.push({ code: "migration-pending-unit", severity: "warn", file: "wiki/migration/coverage.md", message: `unit ${id} is still pending migration review` });
        }
    }
    for (const unit of units) {
        if (!seenIds.has(unit.id)) {
            diagnostics.push({ code: "migration-unaccounted-unit", severity: "error", file: unit.legacyPath, message: `legacy meaning unit missing from coverage ledger: ${unit.id}` });
        }
    }
    return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}
function markdownTableRows(items) {
    if (items.length === 0)
        return "| none | - | - | - |\n";
    return items.map((item) => `| ${markdownTableCell(item.path)} | ${markdownTableCell(item.title)} | ${markdownTableCell(item.summary)} | pending |`).join("\n") + "\n";
}
function buildInbox(title, description, items) {
    return `${(0, templates_1.metadata)("migration-inbox", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "migration candidates are adopted or rescanned")}
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
function migrationBatchScope(legacyRoot) {
    return `${workspace_1.today} migration batch${legacyRoot && legacyRoot !== "none" ? ` from ${legacyRoot}` : ""}`;
}
function semanticCompletionValue(complete, batchScope) {
    if (complete)
        return `yes, for the ${batchScope} only`;
    return `no, the ${batchScope} still has unresolved rows`;
}
function completionScopeSection(batchScope) {
    return `## Completion Scope

- This page records the ${batchScope} only.
- It does not mean future requests to build a new wiki from the existing wiki should reuse current \`wiki/\` in place.
- For a fresh rebuild request, treat current \`wiki/\` as the legacy source unless the user says otherwise: preserve it as \`wiki_legacy*\`, create a fresh standard \`wiki/\`, migrate/adopt content from the preserved legacy source, then refresh routing and diagnostics.
`;
}
function timestampSuffix() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}
function nextLegacyPath() {
    if (!(0, workspace_1.exists)("wiki_legacy"))
        return "wiki_legacy";
    const base = `wiki_legacy_${timestampSuffix()}`;
    if (!(0, workspace_1.exists)(base))
        return base;
    for (let counter = 2; counter < 1000; counter += 1) {
        const candidate = `${base}_${counter}`;
        if (!(0, workspace_1.exists)(candidate))
            return candidate;
    }
    throw new Error(`could not find an available wiki_legacy path for ${base}`);
}
function prepareMigrationMode() {
    if ((0, workspace_1.exists)("wiki")) {
        const legacyPath = nextLegacyPath();
        fs.renameSync((0, workspace_1.abs)("wiki"), (0, workspace_1.abs)(legacyPath));
        return { legacyPath, note: `moved wiki to ${legacyPath}` };
    }
    if ((0, workspace_1.exists)("wiki_legacy"))
        return { legacyPath: "wiki_legacy", note: "using existing wiki_legacy" };
    return { legacyPath: "", note: "no existing wiki directory to migrate" };
}
function migrationTargetForKind(kind) {
    if (kind === "decision")
        return "wiki/decisions/migration-inbox.md";
    if (kind === "source")
        return "wiki/sources/migration-inbox.md";
    return "wiki/canonical/migration-inbox.md";
}
function runMigrationMode(migrationState) {
    const legacyPath = migrationState.legacyPath;
    const markdownFiles = legacyPath && (0, workspace_1.exists)(legacyPath) ? (0, wiki_files_1.walkMarkdownFiles)((0, workspace_1.abs)(legacyPath), [], (0, workspace_1.abs)(legacyPath)) : [];
    const items = markdownFiles.map((file) => {
        const text = (0, workspace_1.read)(file.path);
        return {
            path: file.path,
            legacyPath: file.basePath,
            kind: classifyMarkdown(file.path, text),
            title: (0, wiki_files_1.firstHeading)(text, file.path),
            summary: (0, wiki_files_1.compactSummary)(text),
            bytes: Buffer.byteLength(text, "utf8"),
        };
    });
    const byKind = {
        canonical: items.filter((item) => item.kind === "canonical"),
        decision: items.filter((item) => item.kind === "decision"),
        source: items.filter((item) => item.kind === "source"),
        other: items.filter((item) => item.kind === "other"),
    };
    const inventoryRows = items.length === 0
        ? "| none | - | - | 0 | - |\n"
        : items.map((item) => `| ${markdownTableCell(item.path)} | ${item.kind} | ${markdownTableCell(item.title)} | ${item.bytes} | ${markdownTableCell(item.summary)} |`).join("\n") + "\n";
    const inventory = `${(0, templates_1.metadata)("migration-inventory", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration scan is rerun")}
# Migration Inventory

## TL;DR

- Generated: ${workspace_1.today}
- Legacy root: ${legacyPath || "none"}
- Markdown files: ${items.length}
- Legacy files are not copied directly into the new wiki; they are mapped to rewrite inboxes.

| Legacy Source | Classification | Title | Size (bytes) | Summary |
| --- | --- | --- | ---: | --- |
${inventoryRows}`;
    const units = items.flatMap((item) => extractMigrationUnits(item.legacyPath, (0, workspace_1.read)(item.path)));
    const coverage = `${(0, templates_1.metadata)("migration-coverage", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration unit coverage statuses change")}
# Migration Coverage Ledger

## TL;DR

- Generated: ${workspace_1.today}
- Legacy root: ${legacyPath || "none"}
- Legacy meaning units: ${units.length}
- Every legacy heading, paragraph, list item, table row, and code block should remain accounted for.
- Status values: pending, adopted, merged, superseded, rejected, resolved, needs-human-review.
- \`adopted\` and \`merged\` rows require a new-wiki target under \`wiki/canonical/\`, \`wiki/decisions/\`, \`wiki/sources/\`, or \`wiki/meta/\`.

| Unit ID | Legacy Source | Type | Heading | Summary | Status | Target | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
${coverageTableRows(units)}`;
    const plan = `${(0, templates_1.metadata)("migration-plan", "short", "wiki/meta/wiki-ops-v1-decisions.md", "migration procedure or status changes")}
# Migration Plan

## TL;DR

- Generated: ${workspace_1.today}
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
        : items.map((item) => `| ${markdownTableCell(item.path)} | ${item.kind} | ${migrationTargetForKind(item.kind)} | mapped | pending semantic rewrite |`).join("\n") + "\n";
    const verification = `${(0, templates_1.metadata)("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, or rescanned")}
# Migration Verification

## TL;DR

- legacy root: ${legacyPath || "none"}
- legacy markdown files: ${items.length}
- mapped files: ${items.length}
- coverage: ${items.length === markdownFiles.length ? "pass" : "fail"}
- This verifies file coverage only. Semantic completeness is confirmed after inbox statuses are resolved.

${completionScopeSection(migrationBatchScope(legacyPath || "none"))}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRows}`;
    const migrationStartupBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration State

- ${workspace_1.today}: preserved existing wiki at \`${legacyPath || "no wiki_legacy"}\` and regenerated the standard wiki structure.
- Scanned ${items.length} legacy markdown files and created migration inventory, plan, verification, and inbox files.
- Do not delete \`${legacyPath || "wiki_legacy"}\` until all migration inbox items are adopted/rejected/resolved and needs-human-review is 0.
- Migration completion status is scoped to this batch only. For a future fresh rebuild request, treat current \`wiki/\` as the legacy source unless the user says otherwise.
<!-- PROJECT-WIKI-MIGRATION:END -->`;
    const migrationIndexBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration

- [[migration/plan]]
  - Read when: migration procedure, fresh rebuild procedure, or status matters.
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
- [[migration/coverage]]
  - Read when: checking whether legacy meaning units were adopted, merged, superseded, rejected, resolved, or marked for review.
  - Update when: unit-level migration coverage statuses, targets, or notes change.
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
    const results = [];
    (0, workspace_1.mkdirp)("wiki/migration");
    results.push(["wiki/migration/inventory.md", (0, workspace_1.writeManaged)("wiki/migration/inventory.md", inventory)]);
    results.push(["wiki/migration/coverage.md", (0, workspace_1.writeManaged)("wiki/migration/coverage.md", coverage)]);
    results.push(["wiki/migration/plan.md", (0, workspace_1.writeManaged)("wiki/migration/plan.md", plan)]);
    results.push(["wiki/migration/verification.md", (0, workspace_1.writeManaged)("wiki/migration/verification.md", verification)]);
    results.push(["wiki/canonical/migration-inbox.md", (0, workspace_1.writeManaged)("wiki/canonical/migration-inbox.md", buildInbox("Canonical Migration Inbox", "Legacy content that may belong in current project truth.", byKind.canonical.concat(byKind.other)))]);
    results.push(["wiki/decisions/migration-inbox.md", (0, workspace_1.writeManaged)("wiki/decisions/migration-inbox.md", buildInbox("Decision Migration Inbox", "Legacy content that may belong in project decision history.", byKind.decision))]);
    results.push(["wiki/sources/migration-inbox.md", (0, workspace_1.writeManaged)("wiki/sources/migration-inbox.md", buildInbox("Source Migration Inbox", "Legacy content that may belong in source summaries.", byKind.source))]);
    results.push(["wiki/startup.md migration state", (0, workspace_1.upsertMarkedSection)("wiki/startup.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationStartupBlock)]);
    results.push(["wiki/index.md migration router", (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationIndexBlock)]);
    return { results, total: items.length, legacyPath };
}
function normalizeMigrationStatus(status) {
    const value = String(status || "").trim().toLowerCase();
    if (isMigrationInboxStatus(value))
        return value;
    if (value.includes("adopt"))
        return "adopted";
    if (value.includes("reject"))
        return "rejected";
    if (value.includes("resolve"))
        return "resolved";
    if (value.includes("human"))
        return "needs-human-review";
    return "pending";
}
function isMigrationInboxStatus(value) {
    return ["adopted", "rejected", "resolved", "needs-human-review", "pending"].includes(value);
}
function migrationInboxStatusMap() {
    const inboxFiles = ["wiki/canonical/migration-inbox.md", "wiki/decisions/migration-inbox.md", "wiki/sources/migration-inbox.md"];
    const statuses = new Map();
    for (const file of inboxFiles) {
        if (!(0, workspace_1.exists)(file))
            continue;
        for (const cells of (0, wiki_files_1.parseMarkdownTableRows)((0, workspace_1.read)(file), 4)) {
            const source = cells[0];
            if (!source)
                continue;
            statuses.set(source, { status: normalizeMigrationStatus(cells[3]), inbox: file });
        }
    }
    return statuses;
}
function semanticStatusForInboxStatus(status) {
    if (["adopted", "rejected", "resolved", "needs-human-review"].includes(status))
        return status;
    return "pending semantic rewrite";
}
function runReviewMigrationMode() {
    if (!(0, workspace_1.exists)("wiki/migration/verification.md")) {
        console.error("missing wiki/migration/verification.md; run --migrate first");
        process.exit(1);
    }
    const verificationText = (0, workspace_1.read)("wiki/migration/verification.md");
    const verificationRows = (0, wiki_files_1.parseMarkdownTableRows)(verificationText, 5).map((cells) => ({
        legacyPath: cells[0] ?? "",
        kind: cells[1] ?? "",
        target: cells[2] ?? "",
        coverage: cells[3] ?? "",
    }));
    const inboxStatuses = migrationInboxStatusMap();
    const reviewedRows = verificationRows.map((row) => {
        const inbox = inboxStatuses.get(row.legacyPath);
        const status = inbox ? inbox.status : "needs-human-review";
        return { ...row, inboxStatus: status, semanticStatus: semanticStatusForInboxStatus(status), note: inbox ? inbox.inbox : "missing migration inbox row" };
    });
    const counts = reviewedRows.reduce((acc, row) => {
        acc[row.inboxStatus] = (acc[row.inboxStatus] || 0) + 1;
        return acc;
    }, {});
    const pending = counts.pending || 0;
    const needsHuman = counts["needs-human-review"] || 0;
    const complete = pending === 0 && needsHuman === 0;
    const legacyRoot = (verificationText.match(/^- legacy root:\s*(.+)$/m) || [])[1] || "unknown";
    const batchScope = migrationBatchScope(legacyRoot);
    const completionValue = semanticCompletionValue(complete, batchScope);
    const reviewRows = reviewedRows.length === 0
        ? "| none | - | - | - | - |\n"
        : reviewedRows.map((row) => `| ${markdownTableCell(row.legacyPath)} | ${row.kind} | ${row.inboxStatus} | ${row.semanticStatus} | ${markdownTableCell(row.note)} |`).join("\n") + "\n";
    const review = `${(0, templates_1.metadata)("migration-review", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox statuses change")}
# Migration Review

## TL;DR

- generated: ${workspace_1.today}
- total legacy rows: ${reviewedRows.length}
- adopted: ${counts.adopted || 0}
- rejected: ${counts.rejected || 0}
- resolved: ${counts.resolved || 0}
- pending: ${pending}
- needs-human-review: ${needsHuman}
- semantic migration complete: ${completionValue}

${completionScopeSection(batchScope)}

| Legacy Source | Classification | Inbox Status | Semantic Status | Evidence |
| --- | --- | --- | --- | --- |
${reviewRows}`;
    const verificationRowsText = reviewedRows.length === 0
        ? "| none | - | - | pass | - |\n"
        : reviewedRows.map((row) => `| ${markdownTableCell(row.legacyPath)} | ${row.kind} | ${row.target} | ${row.coverage} | ${row.semanticStatus} |`).join("\n") + "\n";
    const verification = `${(0, templates_1.metadata)("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, resolved, or marked needs-human-review")}
# Migration Verification

## TL;DR

- legacy root: ${legacyRoot}
- legacy markdown files: ${reviewedRows.length}
- mapped files: ${reviewedRows.filter((row) => row.coverage === "mapped").length}
- coverage: ${reviewedRows.every((row) => row.coverage === "mapped") ? "pass" : "fail"}
- semantic migration complete: ${completionValue}
- pending: ${pending}
- needs-human-review: ${needsHuman}

${completionScopeSection(batchScope)}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRowsText}`;
    const results = [
        ["wiki/migration/review.md", (0, workspace_1.writeManaged)("wiki/migration/review.md", review)],
        ["wiki/migration/verification.md", (0, workspace_1.writeManaged)("wiki/migration/verification.md", verification)],
    ];
    console.log("Project wiki migration review complete.");
    for (const [relativePath, status] of results)
        console.log(`${String(status).padEnd(7)} ${relativePath}`);
    console.log(`summary pending=${pending} needs-human-review=${needsHuman} complete=${complete ? "yes" : "no"}`);
}
