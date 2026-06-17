import * as fs from "node:fs";
import type { FileStatus, MarkdownTableItem, MigrationBulkReviewGroup, MigrationBulkReviewPlan, MigrationBulkReviewRow, MigrationConfidence, MigrationCoverageStatus, MigrationInboxEntry, MigrationInboxStatus, MigrationItem, MigrationKind, MigrationReviewRow, MigrationRunResult, MigrationState, MigrationStorage, MigrationUnit, MigrationVerificationRow, ResultRow, SemanticStatus, StatusCounts, WikiDiagnostic } from "./types";
import { classifyMigrationUnit, storageToMigrationKind } from "./taxonomy";
import { abs, exists, metadataValue, mkdirp, read, root, stripMetadataHeader, today, upsertMarkedSection, writeManaged } from "./workspace";
import { metadata, starterFiles } from "./templates";
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

function markdownTableCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function plainMarkdownTableCell(value: string | number): string {
  return markdownTableCell(String(value).replace(/\[/g, "&#91;").replace(/\]/g, "&#93;"));
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣ぁ-んァ-ン一-龥]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unit";
}

function unitSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function nextUnitId(legacyPath: string, index: number, summary: string): string {
  return `${legacyPath}#u${String(index).padStart(3, "0")}-${slugPart(summary)}`;
}

const generatedEmptyStarterPaths = new Map([
  ["canonical/project-brief.md", "wiki/canonical/project-brief.md"],
  ["canonical/open-questions.md", "wiki/canonical/open-questions.md"],
  ["canonical/assumptions.md", "wiki/canonical/assumptions.md"],
  ["canonical/risks.md", "wiki/canonical/risks.md"],
]);

function normalizedTemplateBody(value: string): string {
  return stripMetadataHeader(value).replace(/\r\n/g, "\n").trim().replace(/[ \t]+/g, " ");
}

function isGeneratedEmptyStarterDocument(legacyPath: string, text: string): boolean {
  const starterPath = generatedEmptyStarterPaths.get(legacyPath.replace(/^wiki\//, ""));
  if (!starterPath) return false;
  const starter = starterFiles[starterPath as keyof typeof starterFiles];
  if (!starter) return false;
  return normalizedTemplateBody(text) === normalizedTemplateBody(starter);
}

export function formOnlyMigrationDocumentReason(legacyPath: string, text: string): string {
  if (metadataValue(text, "status").toLowerCase() === "template") return "metadata status is template";
  if (isGeneratedEmptyStarterDocument(legacyPath, text)) return "matches generated empty starter page";
  return "";
}

function isFormOnlyTemplateRouteUnit(legacyPath: string, value: string): boolean {
  if (legacyPath.replace(/^wiki\//, "") !== "index.md") return false;
  return /\bdecisions\/(?:decision-pack-template|full-adr-template)\b/.test(value);
}

export function extractMigrationUnits(legacyPath: string, text: string): MigrationUnit[] {
  if (formOnlyMigrationDocumentReason(legacyPath, text)) return [];
  const body = stripMetadataHeader(text);
  const lines = body.split(/\r?\n/);
  const units: MigrationUnit[] = [];
  let heading = "";
  let headingPath: string[] = [];
  let paragraph: string[] = [];
  let inCodeFence = false;
  let codeBlock: string[] = [];
  let sourceUnitIndex = 0;
  const pushUnit = (type: MigrationUnit["type"], value: string): void => {
    const summary = unitSummary(value);
    if (!summary) return;
    sourceUnitIndex += 1;
    if (isFormOnlyTemplateRouteUnit(legacyPath, value)) return;
    const unitHeadingPath = [...headingPath];
    units.push({
      id: nextUnitId(legacyPath, sourceUnitIndex, summary),
      legacyPath,
      type,
      heading,
      headingPath: unitHeadingPath,
      content: value,
      summary,
      classification: classifyMigrationUnit({ legacyPath, heading, headingPath: unitHeadingPath, content: value, summary }),
    });
  };
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
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
      } else {
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
      const level = headingMatch[1]?.length ?? 1;
      headingPath = [...headingPath.slice(0, level - 1), heading];
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
  if (inCodeFence && codeBlock.length > 0) pushUnit("code-block", codeBlock.join("\n"));
  flushParagraph();
  return units;
}

function coverageTableRows(units: MigrationUnit[]): string {
  if (units.length === 0) return "| none | - | - | - | - | pending | - | - | - | - | - |\n";
  return units.map((unit) => {
    const status = unit.classification.confidence === "low" ? "needs-human-review" : "pending";
    return `| ${markdownTableCell(unit.id)} | ${markdownTableCell(unit.legacyPath)} | ${unit.type} | ${plainMarkdownTableCell(unit.heading || "-")} | ${plainMarkdownTableCell(unit.summary)} | ${status} | ${markdownTableCell(unit.classification.target)} | - | ${markdownTableCell(unit.classification.label)} | ${unit.classification.confidence} | ${plainMarkdownTableCell(unit.classification.reason)} |`;
  }).join("\n") + "\n";
}

interface MigrationCoverageRow {
  unitId: string;
  legacySource: string;
  type: string;
  heading: string;
  summary: string;
  status: MigrationCoverageStatus;
  target: string;
  note: string;
  area: string;
  confidence: MigrationConfidence;
  reason: string;
}

function coverageRowsFromUnits(units: MigrationUnit[]): MigrationCoverageRow[] {
  return units.map((unit) => ({
    unitId: unit.id,
    legacySource: unit.legacyPath,
    type: unit.type,
    heading: unit.heading || "-",
    summary: unit.summary,
    status: unit.classification.confidence === "low" ? "needs-human-review" : "pending",
    target: unit.classification.target,
    note: "-",
    area: unit.classification.label,
    confidence: unit.classification.confidence,
    reason: unit.classification.reason,
  }));
}

function normalizeCoverageStatus(value: unknown): MigrationCoverageStatus {
  const status = String(value || "").trim().toLowerCase();
  if (isMigrationCoverageStatus(status)) return status;
  return "pending";
}

function normalizeConfidence(value: unknown): MigrationConfidence {
  const confidence = String(value || "").trim().toLowerCase();
  if (isMigrationConfidence(confidence)) return confidence;
  return "low";
}

function parseMigrationCoverageRows(text: string): MigrationCoverageRow[] {
  return parseMarkdownTableRows(text, 11)
    .filter((cells) => cells[0] !== "Unit ID")
    .filter((cells) => !isMarkdownTableSeparatorRow(cells))
    .map((cells) => ({
      unitId: cells[0] ?? "",
      legacySource: cells[1] ?? "",
      type: cells[2] ?? "",
      heading: cells[3] ?? "",
      summary: cells[4] ?? "",
      status: normalizeCoverageStatus(cells[5]),
      target: cells[6] ?? "",
      note: cells[7] ?? "",
      area: cells[8] ?? "",
      confidence: normalizeConfidence(cells[9]),
      reason: cells[10] ?? "",
    }))
    .filter((row) => row.unitId);
}

function unitMapRows(units: MigrationUnit[]): string {
  if (units.length === 0) return "| none | - | - | - | - | - | - | - | - | - |\n";
  return units.map((unit) => {
    const status = unit.classification.confidence === "low" ? "needs-human-review" : "pending";
    return `| ${markdownTableCell(unit.id)} | ${markdownTableCell(unit.legacyPath)} | ${plainMarkdownTableCell(unit.headingPath.join(" > ") || "-")} | ${markdownTableCell(unit.classification.label)} | ${unit.classification.storage} | ${unit.classification.confidence} | ${markdownTableCell(unit.classification.target)} | ${plainMarkdownTableCell(unit.classification.reason)} | ${plainMarkdownTableCell(unit.summary)} | ${status} |`;
  }).join("\n") + "\n";
}

function confidenceRank(value: MigrationUnit["classification"]["confidence"]): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function splitPlanRows(units: MigrationUnit[]): string {
  if (units.length === 0) return "| none | - | - | - | 0 | - |\n";
  const groups = new Map<string, MigrationUnit[]>();
  for (const unit of units) {
    const key = unit.classification.target;
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([target, group]) => {
      const first = group[0];
      const confidence = group.map((unit) => unit.classification.confidence).sort((left, right) => confidenceRank(left) - confidenceRank(right))[0] ?? "low";
      const unitIds = group.map((unit) => unit.id).join("<br>");
      return `| ${markdownTableCell(target)} | ${markdownTableCell(first?.classification.label ?? "-")} | ${first?.classification.storage ?? "-"} | ${confidence} | ${group.length} | ${markdownTableCell(unitIds)} |`;
    }).join("\n") + "\n";
}

function isMigrationCoverageStatus(value: string): value is MigrationCoverageStatus {
  return ["adopted", "merged", "superseded", "rejected", "resolved", "needs-human-review", "pending"].includes(value);
}

function legacyWikiRoots(): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^wiki_legacy(?:_|$)/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function migrationVerificationLegacyRoot(): string | null {
  if (!exists("wiki/migration/verification.md")) return null;
  const legacyRoot = (read("wiki/migration/verification.md").match(/^- legacy root:\s*(.+)$/m) || [])[1]?.trim();
  if (!legacyRoot || ["none", "unknown"].includes(legacyRoot)) return null;
  return exists(legacyRoot) ? legacyRoot : null;
}

function activeMigrationLegacyRoots(): string[] {
  const verifiedRoot = migrationVerificationLegacyRoot();
  return verifiedRoot ? [verifiedRoot] : legacyWikiRoots();
}

function expectedMigrationUnits(): MigrationUnit[] {
  return activeMigrationLegacyRoots()
    .flatMap((legacyRoot) => walkMarkdownFiles(abs(legacyRoot), [], abs(legacyRoot)))
    .flatMap((file) => extractMigrationUnits(file.basePath, read(file.path)));
}

export interface MigrationUnitContext {
  units: MigrationUnit[];
}

export function loadMigrationUnitContext(): MigrationUnitContext {
  return { units: expectedMigrationUnits() };
}

function isMigrationConfidence(value: string): value is MigrationConfidence {
  return ["high", "medium", "low"].includes(value);
}

function isMigrationStorage(value: string): value is MigrationStorage {
  return ["canonical", "decisions", "sources", "meta"].includes(value);
}

export const generatedMigrationInboxFiles = [
  "wiki/canonical/migration-inbox.md",
  "wiki/decisions/migration-inbox.md",
  "wiki/sources/migration-inbox.md",
] as const;

function isNewWikiTarget(value: string): boolean {
  return /^wiki\/(canonical|decisions|sources|meta)\//.test(value);
}

function expectedUnitMap(units: MigrationUnit[]): Map<string, MigrationUnit> {
  return new Map(units.map((unit) => [unit.id, unit]));
}

function splitLegacyUnitsCell(value: string): string[] {
  return value
    .split(/<br\s*\/?>|,/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMarkdownTableSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")));
}

function isReviewedCoverageRetarget(cells: string[]): boolean {
  const note = String(cells[7] || "").toLowerCase();
  const reason = String(cells[10] || "").toLowerCase();
  return note.includes("reviewed low-confidence content; retargeted")
    || reason.includes("reviewed source context; taxonomy target assigned");
}

export function collectMigrationCoverageDiagnostics(context: MigrationUnitContext = loadMigrationUnitContext()): WikiDiagnostic[] {
  const units = context.units;
  if (units.length === 0) return [];
  if (!exists("wiki/migration/coverage.md")) {
    return [{
      code: "migration-coverage-missing",
      severity: "error",
      file: "wiki/migration/coverage.md",
      message: "migration unit coverage ledger is missing; run --migrate to account for legacy meaning units",
    }];
  }
  const diagnostics: WikiDiagnostic[] = [];
  const expectedIds = new Set(units.map((unit) => unit.id));
  const unitsById = expectedUnitMap(units);
  const seenIds = new Set<string>();
  const rows = parseMarkdownTableRows(read("wiki/migration/coverage.md"), 8)
    .filter((cells) => cells[0] !== "Unit ID")
    .filter((cells) => !isMarkdownTableSeparatorRow(cells));
  for (const cells of rows) {
    const id = cells[0] || "";
    const status = String(cells[5] || "").trim().toLowerCase();
    const target = String(cells[6] || "").trim();
    const confidence = String(cells[9] || "").trim().toLowerCase();
    const expectedUnit = unitsById.get(id);
    if (cells.length < 11) {
      diagnostics.push({ code: "migration-coverage-schema-drift", severity: "error", file: "wiki/migration/coverage.md", message: `coverage row for ${id || "(blank)"} is missing Area, Confidence, or Reason columns; rerun --migrate` });
    }
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
    if (confidence && !isMigrationConfidence(confidence)) {
      diagnostics.push({ code: "migration-invalid-confidence", severity: "error", file: "wiki/migration/coverage.md", message: `unit ${id} has invalid confidence: ${confidence}` });
    }
    if (["adopted", "merged"].includes(status) && !isNewWikiTarget(target)) {
      diagnostics.push({ code: "migration-missing-target", severity: "error", file: "wiki/migration/coverage.md", message: `unit ${id} is ${status} but target is not a new wiki page` });
    }
    if (status === "pending" && expectedUnit && target && target !== expectedUnit.classification.target && !isReviewedCoverageRetarget(cells)) {
      diagnostics.push({ code: "migration-pending-target-drift", severity: "warn", file: "wiki/migration/coverage.md", message: `pending unit ${id} target differs from generated taxonomy target ${expectedUnit.classification.target}` });
    }
    if (["adopted", "merged"].includes(status) && confidence === "low") {
      diagnostics.push({ code: "migration-low-confidence-adopted", severity: "warn", file: "wiki/migration/coverage.md", message: `unit ${id} is ${status} despite low confidence classification; verify the target manually` });
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

export function collectMigrationUnitMapDiagnostics(context: MigrationUnitContext = loadMigrationUnitContext()): WikiDiagnostic[] {
  const units = context.units;
  if (units.length === 0) return [];
  const file = "wiki/migration/unit-map.md";
  if (!exists(file)) {
    return [{
      code: "migration-unit-map-missing",
      severity: "error",
      file,
      message: "migration unit map is missing; run --migrate to classify legacy meaning units",
    }];
  }
  const diagnostics: WikiDiagnostic[] = [];
  const unitsById = expectedUnitMap(units);
  const seenIds = new Set<string>();
  const rows = parseMarkdownTableRows(read(file), 10)
    .filter((cells) => cells[0] !== "Unit ID")
    .filter((cells) => !isMarkdownTableSeparatorRow(cells));
  for (const cells of rows) {
    const id = cells[0] || "";
    const area = String(cells[3] || "").trim();
    const storage = String(cells[4] || "").trim();
    const confidence = String(cells[5] || "").trim().toLowerCase();
    const target = String(cells[6] || "").trim();
    const status = String(cells[9] || "").trim().toLowerCase();
    const expectedUnit = unitsById.get(id);

    if (seenIds.has(id)) {
      diagnostics.push({ code: "migration-unit-map-duplicate-unit", severity: "error", file, message: `duplicate unit-map row: ${id}` });
    }
    seenIds.add(id);
    if (!expectedUnit) {
      diagnostics.push({ code: "migration-unit-map-stale-unit", severity: "warn", file, message: `unit-map row does not match current migration batch: ${id}` });
    }
    if (!isMigrationStorage(storage)) {
      diagnostics.push({ code: "migration-unit-map-invalid-storage", severity: "error", file, message: `unit ${id} has invalid storage: ${storage || "(blank)"}` });
    }
    if (!isMigrationConfidence(confidence)) {
      diagnostics.push({ code: "migration-unit-map-invalid-confidence", severity: "error", file, message: `unit ${id} has invalid confidence: ${confidence || "(blank)"}` });
    }
    if (!isMigrationCoverageStatus(status)) {
      diagnostics.push({ code: "migration-unit-map-invalid-status", severity: "error", file, message: `unit ${id} has invalid status: ${status || "(blank)"}` });
    }
    if (!isNewWikiTarget(target)) {
      diagnostics.push({ code: "migration-unit-map-invalid-target", severity: "error", file, message: `unit ${id} target is not under wiki/canonical, wiki/decisions, wiki/sources, or wiki/meta` });
    }
    if (expectedUnit) {
      if (area !== expectedUnit.classification.label) {
        diagnostics.push({ code: "migration-unit-map-area-drift", severity: "warn", file, message: `unit ${id} area differs from generated classification ${expectedUnit.classification.label}` });
      }
      if (storage !== expectedUnit.classification.storage) {
        diagnostics.push({ code: "migration-unit-map-storage-drift", severity: "warn", file, message: `unit ${id} storage differs from generated classification ${expectedUnit.classification.storage}` });
      }
      if (confidence !== expectedUnit.classification.confidence) {
        diagnostics.push({ code: "migration-unit-map-confidence-drift", severity: "warn", file, message: `unit ${id} confidence differs from generated classification ${expectedUnit.classification.confidence}` });
      }
      if (target !== expectedUnit.classification.target) {
        diagnostics.push({ code: "migration-unit-map-target-drift", severity: "warn", file, message: `unit ${id} target differs from generated classification ${expectedUnit.classification.target}` });
      }
    }
  }
  for (const unit of units) {
    if (!seenIds.has(unit.id)) {
      diagnostics.push({ code: "migration-unit-map-unaccounted-unit", severity: "error", file: unit.legacyPath, message: `legacy meaning unit missing from unit map: ${unit.id}` });
    }
  }
  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

export function collectMigrationSplitPlanDiagnostics(context: MigrationUnitContext = loadMigrationUnitContext()): WikiDiagnostic[] {
  const units = context.units;
  if (units.length === 0) return [];
  const file = "wiki/migration/split-plan.md";
  if (!exists(file)) {
    return [{
      code: "migration-split-plan-missing",
      severity: "error",
      file,
      message: "migration split plan is missing; run --migrate to group legacy units by target page",
    }];
  }
  const diagnostics: WikiDiagnostic[] = [];
  const unitsById = expectedUnitMap(units);
  const seenTargets = new Set<string>();
  const seenUnitIds = new Set<string>();
  const rows = parseMarkdownTableRows(read(file), 6)
    .filter((cells) => cells[0] !== "Suggested Target")
    .filter((cells) => !isMarkdownTableSeparatorRow(cells));
  for (const cells of rows) {
    const target = String(cells[0] || "").trim();
    const area = String(cells[1] || "").trim();
    const storage = String(cells[2] || "").trim();
    const confidence = String(cells[3] || "").trim().toLowerCase();
    const count = Number(String(cells[4] || "").trim());
    const unitIds = splitLegacyUnitsCell(cells[5] || "");
    const targetStorage = target.match(/^wiki\/([^/]+)\//)?.[1] ?? "";

    if (seenTargets.has(target)) {
      diagnostics.push({ code: "migration-split-plan-duplicate-target", severity: "error", file, message: `duplicate split-plan target row: ${target}` });
    }
    seenTargets.add(target);
    if (!isNewWikiTarget(target)) {
      diagnostics.push({ code: "migration-split-plan-invalid-target", severity: "error", file, message: `split-plan target is not under wiki/canonical, wiki/decisions, wiki/sources, or wiki/meta: ${target || "(blank)"}` });
    }
    if (!isMigrationStorage(storage)) {
      diagnostics.push({ code: "migration-split-plan-invalid-storage", severity: "error", file, message: `target ${target || "(blank)"} has invalid storage: ${storage || "(blank)"}` });
    }
    if (isMigrationStorage(storage) && targetStorage && storage !== targetStorage) {
      diagnostics.push({ code: "migration-split-plan-storage-target-mismatch", severity: "error", file, message: `target ${target} is under wiki/${targetStorage}/ but split-plan storage is ${storage}` });
    }
    if (!isMigrationConfidence(confidence)) {
      diagnostics.push({ code: "migration-split-plan-invalid-confidence", severity: "error", file, message: `target ${target || "(blank)"} has invalid confidence: ${confidence || "(blank)"}` });
    }
    if (!Number.isInteger(count) || count !== unitIds.length) {
      diagnostics.push({ code: "migration-split-plan-count-mismatch", severity: "error", file, message: `target ${target || "(blank)"} says ${Number.isFinite(count) ? count : "(blank)"} units but lists ${unitIds.length}` });
    }
    for (const unitId of unitIds) {
      const expectedUnit = unitsById.get(unitId);
      if (seenUnitIds.has(unitId)) {
        diagnostics.push({ code: "migration-split-plan-duplicate-unit", severity: "error", file, message: `unit appears in more than one split-plan row: ${unitId}` });
      }
      seenUnitIds.add(unitId);
      if (!expectedUnit) {
        diagnostics.push({ code: "migration-split-plan-stale-unit", severity: "warn", file, message: `split-plan unit does not match current migration batch: ${unitId}` });
        continue;
      }
      if (expectedUnit.classification.target !== target) {
        diagnostics.push({ code: "migration-split-plan-target-drift", severity: "warn", file, message: `unit ${unitId} is listed under ${target} but generated classification targets ${expectedUnit.classification.target}` });
      }
      if (expectedUnit.classification.label !== area) {
        diagnostics.push({ code: "migration-split-plan-area-drift", severity: "warn", file, message: `unit ${unitId} row area differs from generated classification ${expectedUnit.classification.label}` });
      }
    }
  }
  for (const unit of units) {
    if (!seenUnitIds.has(unit.id)) {
      diagnostics.push({ code: "migration-split-plan-unaccounted-unit", severity: "error", file: unit.legacyPath, message: `legacy meaning unit missing from split plan: ${unit.id}` });
    }
  }
  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

export function markdownTableRows(items: MarkdownTableItem[]): string {
  if (items.length === 0) return "| none | - | - | - |\n";
  return items.map((item) => `| ${markdownTableCell(item.path)} | ${plainMarkdownTableCell(item.title)} | ${plainMarkdownTableCell(item.summary)} | pending |`).join("\n") + "\n";
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

function wikiLinkForMigrationPath(relativePath: string): string {
  return `[[${relativePath.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "")}]]`;
}

function isGeneratedFileLevelMigrationInboxText(text: string): boolean {
  if (metadataValue(text, "scope") !== "migration-inbox") return false;
  const body = stripMetadataHeader(text).trim();
  if (!body.includes("| Source | Title | Summary | Status |")) return false;
  if (!body.includes("Status values: pending, adopted, rejected, resolved, needs-human-review.")) return false;
  const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]?.trim() ?? "");
  if (headings.length !== 2) return false;
  return (headings[0]?.endsWith("Migration Inbox") ?? false) && headings[1] === "TL;DR";
}

export function isPrunableGeneratedMigrationInbox(relativePath: string): boolean {
  if (!generatedMigrationInboxFiles.includes(relativePath as typeof generatedMigrationInboxFiles[number])) return false;
  if (!exists(relativePath)) return false;
  return isGeneratedFileLevelMigrationInboxText(read(relativePath));
}

export function migrationSemanticReviewComplete(): boolean {
  if (!exists("wiki/migration/verification.md")) return false;
  return /^- semantic migration complete:\s*yes, for\b/m.test(read("wiki/migration/verification.md"));
}

function migrationBatchScope(legacyRoot: string): string {
  return `${today} migration batch${legacyRoot && legacyRoot !== "none" ? ` from ${legacyRoot}` : ""}`;
}

function semanticCompletionValue(complete: boolean, batchScope: string): string {
  if (complete) return `yes, for the ${batchScope} only`;
  return `no, the ${batchScope} still has unresolved rows`;
}

function completionScopeSection(batchScope: string): string {
  return `## Completion Scope

- This page records the ${batchScope} only.
- It does not mean future requests to build a new wiki from the existing wiki should reuse current \`wiki/\` in place.
- For a fresh rebuild request, treat current \`wiki/\` as the legacy source unless the user says otherwise: preserve it as \`wiki_legacy*\`, create a fresh standard \`wiki/\`, migrate/adopt content from the preserved legacy source, then refresh routing and diagnostics.
`;
}

function completedMigrationStartupBlock(legacyRoot: string, remainingInboxes: string[]): string {
  const retainedInboxLine = remainingInboxes.length === 0
    ? "- Generated file-level migration inboxes were pruned after semantic completion."
    : `- Generated file-level migration inboxes were pruned where safe; retained inbox-like pages: ${remainingInboxes.map((file) => `\`${file}\``).join(", ")}.`;
  return `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration State

- ${today}: migration review is complete for \`${legacyRoot || "wiki_legacy"}\`; pending 0 and needs-human-review 0.
${retainedInboxLine}
- Migration ledgers under \`wiki/migration/\` remain as audit evidence.
- \`${legacyRoot || "wiki_legacy"}\` remains preserved as source/rollback archive and is not deleted automatically.
- Migration completion status is scoped to this batch only. For a future fresh rebuild request, treat current \`wiki/\` as the legacy source unless the user says otherwise.
<!-- PROJECT-WIKI-MIGRATION:END -->`;
}

function completedMigrationIndexBlock(remainingInboxes: string[]): string {
  const inboxLine = remainingInboxes.length === 0
    ? "- Generated file-level migration inboxes were pruned after semantic completion."
    : `- Retained inbox-like pages: ${remainingInboxes.map(wikiLinkForMigrationPath).join(", ")}.`;
  return `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration

- Core ledgers: [[migration/coverage]], [[migration/review]], [[migration/verification]], [[migration/bulk-review]].
- Planning ledgers: [[migration/plan]], [[migration/inventory]], [[migration/unit-map]], [[migration/split-plan]].
${inboxLine}
- Keep \`wiki_legacy*\` only as source/rollback archive after semantic completion; it is not deleted automatically.
<!-- PROJECT-WIKI-MIGRATION:END -->`;
}

function pruneCompletedMigrationJunk(legacyRoot: string): ResultRow[] {
  const results: ResultRow[] = [];
  for (const file of generatedMigrationInboxFiles) {
    if (!isPrunableGeneratedMigrationInbox(file)) continue;
    fs.unlinkSync(abs(file));
    results.push([file, "removed"]);
  }
  const remainingInboxes = generatedMigrationInboxFiles.filter((file) => exists(file));
  if (exists("wiki/startup.md")) {
    results.push(["wiki/startup.md migration state", upsertMarkedSection("wiki/startup.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", completedMigrationStartupBlock(legacyRoot, remainingInboxes))]);
  }
  if (exists("wiki/index.md")) {
    results.push(["wiki/index.md migration router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", completedMigrationIndexBlock(remainingInboxes))]);
  }
  return results;
}

function isOpenMigrationRow(row: MigrationBulkReviewRow): boolean {
  return row.inboxStatus === "pending" || row.inboxStatus === "needs-human-review" || row.semanticStatus === "pending semantic rewrite";
}

function sourceLooksGeneratedOrRouter(source: string): boolean {
  return /^(AGENTS|CLAUDE|GEMINI|README|startup|index)\.md$/.test(source)
    || /^meta\/(operating-model|decision-policy|wiki-ops-v1-decisions|document-taxonomy)\.md$/.test(source);
}

const structuralHumanReviewHeadings = new Set([
  "Active",
  "Audience",
  "Claim Boundary",
  "Code-Proven Behavior",
  "Code-proven behavior",
  "Constraints",
  "Core Scenarios",
  "Current State",
  "Diagnostics And Search",
  "Discovery Rules",
  "Evidence",
  "Generated Output Ownership",
  "Incremental Update Behavior",
  "Inference",
  "Mode Surface",
  "Parser Backend Registry",
  "Product",
  "Product Direction",
  "Project State",
  "Query And Staleness",
  "Read On Demand",
  "Related Canonical Pages",
  "Resolved",
  "Retired",
  "Routing And Inbox",
  "Skill Installation",
  "Success Criteria",
  "TL;DR",
  "Token Discipline",
  "Tree-Sitter Mode",
  "Workspace And Ownership Adapters",
]);

function normalizedReviewText(value: string): string {
  return value.replace(/\\\|/g, "|").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
}

function isMarkdownTableDividerSummary(summary: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(summary);
}

function isMarkdownTableHeaderSummary(summary: string): boolean {
  if (!/^\|.+\|$/.test(summary)) return false;
  if (summary.includes("`")) return false;
  if (isMarkdownTableDividerSummary(summary)) return true;
  const cells = summary.split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.length > 1 && cells.every((cell) => /^[A-Z가-힣][A-Za-z가-힣 /-]{0,40}$/.test(cell));
}

function isStructuralHumanReviewRow(row: MigrationBulkReviewRow): boolean {
  const summary = normalizedReviewText(row.summary);
  const heading = normalizedReviewText(row.heading);
  if (row.unitType === "heading" && (summary === heading || structuralHumanReviewHeadings.has(summary))) return true;
  if (row.unitType === "paragraph" && /^(Code-proven facts:|Code-proven behavior:|Evidence:|Inference:|Product framing:)$/i.test(summary)) return true;
  if (isMarkdownTableDividerSummary(summary) || isMarkdownTableHeaderSummary(summary)) return true;
  return false;
}

function confidenceCounts(rows: MigrationBulkReviewRow[]): Pick<MigrationBulkReviewGroup, "high" | "medium" | "low"> {
  return {
    high: rows.filter((row) => row.confidence === "high").length,
    medium: rows.filter((row) => row.confidence === "medium").length,
    low: rows.filter((row) => row.confidence === "low").length,
  };
}

function groupBulkRows(rows: MigrationBulkReviewRow[], keyForRow: (row: MigrationBulkReviewRow) => string): MigrationBulkReviewGroup[] {
  const groups = new Map<string, MigrationBulkReviewRow[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => {
      const counts = confidenceCounts(groupRows);
      return {
        key,
        rows: groupRows.length,
        ...counts,
        sources: Array.from(new Set(groupRows.map((row) => row.legacySource))).sort(),
        targets: Array.from(new Set(groupRows.map((row) => row.target))).sort(),
        areas: Array.from(new Set(groupRows.map((row) => row.area))).sort(),
        sampleUnitIds: groupRows.slice(0, 5).map((row) => row.unitId),
        sampleSummaries: groupRows.slice(0, 3).map((row) => row.summary),
      };
    })
    .sort((left, right) => right.rows - left.rows || left.key.localeCompare(right.key));
}

function groupList(values: string[], limit = 4): string {
  const shown = values.slice(0, limit).map((value) => markdownTableCell(value));
  const hidden = values.length - shown.length;
  return hidden > 0 ? `${shown.join("<br>")}<br>+${hidden} more` : shown.join("<br>") || "-";
}

function sampleList(values: string[], limit = 3): string {
  const shown = values.slice(0, limit).map((value) => plainMarkdownTableCell(value));
  const hidden = values.length - shown.length;
  return hidden > 0 ? `${shown.join("<br>")}<br>+${hidden} more` : shown.join("<br>") || "-";
}

function confidenceMix(group: MigrationBulkReviewGroup): string {
  return `high ${group.high}, medium ${group.medium}, low ${group.low}`;
}

function renderTargetGroupRows(groups: MigrationBulkReviewGroup[], suggestedStatus: string, limit = Number.POSITIVE_INFINITY): string {
  const selected = groups.slice(0, limit);
  if (selected.length === 0) return "| none | - | 0 | - | - | - |\n";
  return selected.map((group) => `| ${markdownTableCell(group.key)} | ${group.rows} | ${confidenceMix(group)} | ${groupList(group.sources)} | ${groupList(group.areas)} | ${markdownTableCell(suggestedStatus)} |`).join("\n") + "\n";
}

function renderSourceGroupRows(groups: MigrationBulkReviewGroup[], suggestedStatus: string, limit = Number.POSITIVE_INFINITY): string {
  const selected = groups.slice(0, limit);
  if (selected.length === 0) return "| none | 0 | - | - | - | - |\n";
  return selected.map((group) => `| ${markdownTableCell(group.key)} | ${group.rows} | ${confidenceMix(group)} | ${groupList(group.targets, 3)} | ${groupList(group.areas)} | ${markdownTableCell(suggestedStatus)} |`).join("\n") + "\n";
}

function renderHumanReviewGroupRows(groups: MigrationBulkReviewGroup[], suggestedStatus: string, limit = Number.POSITIVE_INFINITY): string {
  const selected = groups.slice(0, limit);
  if (selected.length === 0) return "| none | 0 | - | - | - | - | - |\n";
  return selected.map((group) => `| ${markdownTableCell(group.key)} | ${group.rows} | ${confidenceMix(group)} | ${groupList(group.targets, 3)} | ${sampleList(group.sampleSummaries)} | ${groupList(group.sampleUnitIds, 3)} | ${markdownTableCell(suggestedStatus)} |`).join("\n") + "\n";
}

export function buildMigrationBulkReviewPlan(rows: MigrationBulkReviewRow[]): MigrationBulkReviewPlan {
  const openRows = rows.filter(isOpenMigrationRow);
  const humanRows = openRows.filter((row) => row.inboxStatus === "needs-human-review" || row.confidence === "low");
  const humanStructuralRows = humanRows.filter(isStructuralHumanReviewRow);
  const humanContentRows = humanRows.filter((row) => !isStructuralHumanReviewRow(row));
  const highRows = openRows.filter((row) => row.inboxStatus === "pending" && row.confidence === "high");
  const mediumRows = openRows.filter((row) => row.inboxStatus === "pending" && row.confidence === "medium");
  const sourceGroups = groupBulkRows(openRows, (row) => row.legacySource);
  const singleTargetSourceGroups = sourceGroups.filter((group) => group.targets.length === 1 && group.low === 0);
  const generatedSourceGroups = sourceGroups.filter((group) => sourceLooksGeneratedOrRouter(group.key));
  return {
    totalRows: rows.length,
    openRows: openRows.length,
    completedRows: rows.length - openRows.length,
    highConfidenceRows: highRows.length,
    mediumConfidenceRows: mediumRows.length,
    humanReviewRows: humanRows.length,
    humanReviewStructuralRows: humanStructuralRows.length,
    humanReviewContentRows: humanContentRows.length,
    highTargetGroups: groupBulkRows(highRows, (row) => row.target),
    mediumTargetGroups: groupBulkRows(mediumRows, (row) => row.target),
    singleTargetSourceGroups,
    humanReviewSourceGroups: groupBulkRows(humanRows, (row) => row.legacySource),
    humanReviewStructuralSourceGroups: groupBulkRows(humanStructuralRows, (row) => row.legacySource),
    humanReviewContentSourceGroups: groupBulkRows(humanContentRows, (row) => row.legacySource),
    generatedSourceGroups,
  };
}

function bulkReviewRowsFromCoverage(coverageRows: MigrationCoverageRow[], reviewedRows: MigrationReviewRow[] = []): MigrationBulkReviewRow[] {
  const reviewedByUnit = new Map(reviewedRows.map((row) => [row.legacyPath, row]));
  return coverageRows.map((row) => {
    const reviewed = reviewedByUnit.get(row.unitId);
    const inboxStatus = reviewed?.inboxStatus ?? normalizeCoverageStatusForReview(row.status);
    const semanticStatus = reviewed?.semanticStatus ?? semanticStatusForInboxStatus(inboxStatus);
    return {
      unitId: row.unitId,
      legacySource: row.legacySource,
      unitType: row.type,
      heading: row.heading,
      summary: row.summary,
      target: reviewed?.target || row.target,
      area: row.area,
      confidence: row.confidence,
      inboxStatus,
      semanticStatus,
      reason: row.reason,
    };
  });
}

function bulkReviewSummarySection(plan: MigrationBulkReviewPlan): string {
  return `## Bulk Review Summary

- Do not review all ${plan.totalRows} rows one by one; use [[migration/bulk-review]] to process batches.
- Completed rows: ${plan.completedRows}
- Open rows: ${plan.openRows}
- High-confidence bulk candidates: ${plan.highConfidenceRows} rows across ${plan.highTargetGroups.length} target groups.
- Medium-confidence batch candidates: ${plan.mediumConfidenceRows} rows across ${plan.mediumTargetGroups.length} target groups.
- Human-review priority: ${plan.humanReviewContentSourceGroups.length} content-bearing source batches (${plan.humanReviewContentRows} rows), plus ${plan.humanReviewStructuralRows} structural/layout rows handled with the same source review.

| Queue | Rows | Groups | Recommended handling |
| --- | ---: | ---: | --- |
| High-confidence target batches | ${plan.highConfidenceRows} | ${plan.highTargetGroups.length} | Rewrite or confirm target page, then bulk mark rows adopted or merged. |
| Medium-confidence target batches | ${plan.mediumConfidenceRows} | ${plan.mediumTargetGroups.length} | Review by target page, sample source evidence, then bulk mark rows. |
| Human-review content batches | ${plan.humanReviewContentRows} | ${plan.humanReviewContentSourceGroups.length} | Inspect by source page; do not handle as isolated rows unless a batch remains ambiguous. |
| Human-review structural/layout rows | ${plan.humanReviewStructuralRows} | ${plan.humanReviewStructuralSourceGroups.length} | Close with the source rewrite when headings, table headers, or boilerplate carry no standalone project truth. |
| Single-target source shortcuts | ${plan.singleTargetSourceGroups.reduce((sum, group) => sum + group.rows, 0)} | ${plan.singleTargetSourceGroups.length} | One source maps to one target; a file-level inbox decision can close the batch. |
| Generated/router source candidates | ${plan.generatedSourceGroups.reduce((sum, group) => sum + group.rows, 0)} | ${plan.generatedSourceGroups.length} | Compare against regenerated operating docs; mark superseded or resolved only when no project truth remains. |
`;
}

function renderMigrationBulkReviewDocument(plan: MigrationBulkReviewPlan, batchScope: string): string {
  return `${metadata("migration-bulk-review", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration coverage or confidence grouping changes")}
# Migration Bulk Review Plan

## TL;DR

- Scope: ${batchScope}
- Total rows: ${plan.totalRows}
- Open rows: ${plan.openRows}
- Completed rows: ${plan.completedRows}
- The low-confidence queue is ${plan.humanReviewContentSourceGroups.length} content-bearing source batches, not ${plan.humanReviewRows} isolated row decisions.
- Structural/layout low rows: ${plan.humanReviewStructuralRows}; content-bearing low rows: ${plan.humanReviewContentRows}.
- This page is advisory. It never changes \`wiki/migration/coverage.md\` statuses by itself.

${bulkReviewSummarySection(plan)}

## Human-Review Triage

Low-confidence rows are not intended to be reviewed one by one. Start with content-bearing source batches, then close structural/layout rows while rewriting or rejecting that same source.

| Queue | Rows | Source batches | What to do |
| --- | ---: | ---: | --- |
| Content-bearing low rows | ${plan.humanReviewContentRows} | ${plan.humanReviewContentSourceGroups.length} | Review the legacy source page once, adopt/retarget/reject the useful meaning, then mark its low rows together. |
| Structural/layout low rows | ${plan.humanReviewStructuralRows} | ${plan.humanReviewStructuralSourceGroups.length} | Treat headings, TL;DR labels, table headers, and separators as source-structure evidence; usually close them with the source page decision. |
| Total low/needs-human-review rows | ${plan.humanReviewRows} | ${plan.humanReviewSourceGroups.length} | Escalate to row-level review only when a source batch mixes unrelated truths that cannot be split safely. |

## Single-Target Source Shortcuts

Use these when a legacy source maps to one target and has no low-confidence rows. A compatible file-level inbox status can close the whole source batch.

| Legacy Source | Rows | Confidence Mix | Target | Areas | Suggested status |
| --- | ---: | --- | --- | --- | --- |
${renderSourceGroupRows(plan.singleTargetSourceGroups, "adopted or merged after target rewrite")}

## High-Confidence Target Batches

| Suggested Target | Rows | Confidence Mix | Sources | Areas | Suggested status |
| --- | ---: | --- | --- | --- | --- |
${renderTargetGroupRows(plan.highTargetGroups, "adopted or merged after target rewrite")}

## Medium-Confidence Target Batches

| Suggested Target | Rows | Confidence Mix | Sources | Areas | Suggested status |
| --- | ---: | --- | --- | --- | --- |
${renderTargetGroupRows(plan.mediumTargetGroups, "review by target page before adopting")}

## Content-Bearing Human-Review Batches

These are the practical manual review units. Review each legacy source page once; use the sample rows to find the relevant evidence quickly.

| Legacy Source | Rows | Confidence Mix | Targets | Sample summaries | Sample unit ids | Suggested status |
| --- | ---: | --- | --- | --- | --- | --- |
${renderHumanReviewGroupRows(plan.humanReviewContentSourceGroups, "source-batch adopt, retarget, resolve, or reject")}

## Structural Human-Review Batches

These rows are low-confidence because they are headings, table scaffolding, or boilerplate labels. They rarely require standalone decisions.

| Legacy Source | Rows | Confidence Mix | Targets | Sample summaries | Sample unit ids | Suggested status |
| --- | ---: | --- | --- | --- | --- | --- |
${renderHumanReviewGroupRows(plan.humanReviewStructuralSourceGroups, "close with the same source-page decision")}

## All Human-Review Source Groups

These rows have low confidence or are explicitly marked needs-human-review.

| Legacy Source | Rows | Confidence Mix | Targets | Areas | Suggested status |
| --- | ---: | --- | --- | --- | --- |
${renderSourceGroupRows(plan.humanReviewSourceGroups, "manual adopt, resolve, reject, or retarget")}

## Generated Or Router Source Candidates

These sources often overlap with regenerated bootstrap/wiki operating documents. Do not discard them automatically; compare for project-specific truth first.

| Legacy Source | Rows | Confidence Mix | Targets | Areas | Suggested status |
| --- | ---: | --- | --- | --- | --- |
${renderSourceGroupRows(plan.generatedSourceGroups, "superseded or resolved only after comparison")}
`;
}

export function timestampSuffix(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function nextLegacyPath(): string {
  if (!exists("wiki_legacy")) return "wiki_legacy";
  const base = `wiki_legacy_${timestampSuffix()}`;
  if (!exists(base)) return base;
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${base}_${counter}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`could not find an available wiki_legacy path for ${base}`);
}

export function prepareMigrationMode(): MigrationState {
  if (exists("wiki")) {
    const legacyPath = nextLegacyPath();
    fs.renameSync(abs("wiki"), abs(legacyPath));
    return { legacyPath, note: `moved wiki to ${legacyPath}` };
  }
  if (exists("wiki_legacy")) return { legacyPath: "wiki_legacy", note: "using existing wiki_legacy" };
  return { legacyPath: "", note: "no existing wiki directory to migrate" };
}

export function migrationTargetForKind(kind: MigrationKind | string): string {
  if (kind === "decision") return "wiki/decisions/migration-inbox.md";
  if (kind === "source") return "wiki/sources/migration-inbox.md";
  if (kind === "meta") return "wiki/meta/migration-inbox.md";
  return "wiki/canonical/migration-inbox.md";
}

export function runMigrationMode(migrationState: MigrationState): MigrationRunResult {
  const legacyPath = migrationState.legacyPath;
  const markdownFiles = legacyPath && exists(legacyPath) ? walkMarkdownFiles(abs(legacyPath), [], abs(legacyPath)) : [];
  const fileRecords = markdownFiles.map((file) => {
    const text = read(file.path);
    return { file, text, formOnlyReason: formOnlyMigrationDocumentReason(file.basePath, text) };
  });
  const skippedFormOnlyFiles = fileRecords.filter((record) => record.formOnlyReason);
  const items: MigrationItem[] = fileRecords.filter((record) => !record.formOnlyReason).map(({ file, text }) => {
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
    meta: items.filter((item) => item.kind === "meta"),
    other: items.filter((item) => item.kind === "other"),
  };

  const inventoryRows = items.length === 0
    ? "| none | - | - | 0 | - |\n"
    : items.map((item) => `| ${markdownTableCell(item.path)} | ${item.kind} | ${plainMarkdownTableCell(item.title)} | ${item.bytes} | ${plainMarkdownTableCell(item.summary)} |`).join("\n") + "\n";
  const skippedRows = skippedFormOnlyFiles.length === 0
    ? "| none | - | - |\n"
    : skippedFormOnlyFiles.map((record) => `| ${markdownTableCell(record.file.path)} | ${markdownTableCell(record.formOnlyReason)} | ${plainMarkdownTableCell(firstHeading(record.text, record.file.path))} |`).join("\n") + "\n";
  const inventory = `${metadata("migration-inventory", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration scan is rerun")}
# Migration Inventory

## TL;DR

- Generated: ${today}
- Legacy root: ${legacyPath || "none"}
- Legacy markdown files: ${markdownFiles.length}
- Migratable markdown files: ${items.length}
- Skipped form-only/template files: ${skippedFormOnlyFiles.length}
- Legacy files are not copied directly into the new wiki; they are mapped to rewrite inboxes.

## Migratable Files

| Legacy Source | Classification | Title | Size (bytes) | Summary |
| --- | --- | --- | ---: | --- |
${inventoryRows}
## Skipped Form-Only Files

| Legacy Source | Reason | Title |
| --- | --- | --- |
${skippedRows}`;

  const units = items.flatMap((item) => extractMigrationUnits(item.legacyPath, read(item.path)));
  const unitsByStorage: Record<MigrationStorage, MigrationUnit[]> = {
    canonical: units.filter((unit) => unit.classification.storage === "canonical"),
    decisions: units.filter((unit) => unit.classification.storage === "decisions"),
    sources: units.filter((unit) => unit.classification.storage === "sources"),
    meta: units.filter((unit) => unit.classification.storage === "meta"),
  };
  const batchScope = migrationBatchScope(legacyPath || "none");
  const initialBulkPlan = buildMigrationBulkReviewPlan(bulkReviewRowsFromCoverage(coverageRowsFromUnits(units)));
  const bulkReview = renderMigrationBulkReviewDocument(initialBulkPlan, batchScope);
  const coverage = `${metadata("migration-coverage", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration unit coverage statuses change")}
# Migration Coverage Ledger

## TL;DR

- Generated: ${today}
- Legacy root: ${legacyPath || "none"}
- Legacy meaning units: ${units.length}
- Every legacy heading, paragraph, list item, table row, and code block should remain accounted for.
- Status values: pending, adopted, merged, superseded, rejected, resolved, needs-human-review.
- \`adopted\` and \`merged\` rows require a new-wiki target under \`wiki/canonical/\`, \`wiki/decisions/\`, \`wiki/sources/\`, or \`wiki/meta/\`.

| Unit ID | Legacy Source | Type | Heading | Summary | Status | Target | Note | Area | Confidence | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${coverageTableRows(units)}`;

  const unitMap = `${metadata("migration-unit-map", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration classification or target suggestions change")}
# Migration Unit Map

## TL;DR

- Generated: ${today}
- Legacy meaning units: ${units.length}
- Each row classifies one legacy meaning unit against the service/product document taxonomy.
- Low-confidence rows start as needs-human-review.

| Unit ID | Legacy Source | Heading Path | Area | Storage | Confidence | Suggested Target | Reason | Summary | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${unitMapRows(units)}`;

  const splitPlan = `${metadata("migration-split-plan", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration split grouping changes")}
# Migration Split Plan

## TL;DR

- Generated: ${today}
- Suggested target pages: ${new Set(units.map((unit) => unit.classification.target)).size}
- Use this as the rewrite plan when one legacy page mixes API specs, features, UX, policy, QA, operations, or source evidence.

| Suggested Target | Area | Storage | Lowest Confidence | Unit Count | Legacy Units |
| --- | --- | --- | --- | ---: | --- |
${splitPlanRows(units)}`;

  const plan = `${metadata("migration-plan", "short", "wiki/meta/wiki-ops-v1-decisions.md", "migration procedure or status changes")}
# Migration Plan

## TL;DR

- Generated: ${today}
- Preparation: ${migrationState.note}
- The new \`./wiki\` uses the standard structure.
- Form-only/template files are recorded in inventory but excluded from meaning-unit migration.
- Next step: review inbox items and absorb useful meaning into canonical, decisions, sources, or meta docs.

## Counts

| Classification | Count |
| --- | ---: |
| canonical candidates | ${byKind.canonical.length} |
| decision candidates | ${byKind.decision.length} |
| source candidates | ${byKind.source.length} |
| meta candidates | ${byKind.meta.length} |
| other candidates | ${byKind.other.length} |
| skipped form-only/template files | ${skippedFormOnlyFiles.length} |
| canonical units | ${unitsByStorage.canonical.length} |
| decision units | ${unitsByStorage.decisions.length} |
| source units | ${unitsByStorage.sources.length} |
| meta units | ${unitsByStorage.meta.length} |
`;

  const verificationRows = units.length === 0
    ? "| none | - | - | pass | - |\n"
    : units.map((unit) => {
        const semanticStatus = unit.classification.confidence === "low" ? "needs-human-review" : "pending semantic rewrite";
        return `| ${markdownTableCell(unit.id)} | ${storageToMigrationKind(unit.classification.storage)} | ${markdownTableCell(unit.classification.target)} | mapped | ${semanticStatus} |`;
      }).join("\n") + "\n";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, or rescanned")}
# Migration Verification

## TL;DR

- legacy root: ${legacyPath || "none"}
- legacy markdown files: ${markdownFiles.length}
- skipped form-only/template files: ${skippedFormOnlyFiles.length}
- mapped units: ${units.length}
- coverage: ${items.length + skippedFormOnlyFiles.length === markdownFiles.length ? "pass" : "fail"}
- This verifies unit coverage. Semantic completeness is confirmed after coverage or inbox statuses are resolved.

${completionScopeSection(batchScope)}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRows}`;

  const review = `${metadata("migration-review", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox statuses change")}
# Migration Review

## TL;DR

- generated: ${today}
- total legacy rows: ${units.length}
- skipped form-only/template files: ${skippedFormOnlyFiles.length}
- semantic migration complete: no, the ${batchScope} still has unresolved rows
- Run \`--review-migration\` after updating coverage or migration inbox statuses.

${completionScopeSection(batchScope)}

${bulkReviewSummarySection(initialBulkPlan)}

| Legacy Source | Classification | Inbox Status | Semantic Status | Evidence |
| --- | --- | --- | --- | --- |
${units.length === 0 ? "| none | - | - | - | - |\n" : units.map((unit) => `| ${markdownTableCell(unit.id)} | ${storageToMigrationKind(unit.classification.storage)} | ${unit.classification.confidence === "low" ? "needs-human-review" : "pending"} | ${unit.classification.confidence === "low" ? "needs-human-review" : "pending semantic rewrite"} | ${plainMarkdownTableCell(unit.classification.reason)} |`).join("\n") + "\n"}`;

  const migrationStartupBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration State

- ${today}: preserved existing wiki at \`${legacyPath || "no wiki_legacy"}\` and regenerated the standard wiki structure.
- Scanned ${markdownFiles.length} legacy markdown files, skipped ${skippedFormOnlyFiles.length} form-only/template files, and mapped ${units.length} meaning units; created inventory, unit map, split plan, coverage, verification, review, and inbox files.
- Do not delete \`${legacyPath || "wiki_legacy"}\` until all migration inbox items are adopted/rejected/resolved and needs-human-review is 0.
- Migration completion status is scoped to this batch only. For a future fresh rebuild request, treat current \`wiki/\` as the legacy source unless the user says otherwise.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const migrationIndexBlock = `<!-- PROJECT-WIKI-MIGRATION:START -->
## Migration

- [[migration/plan]]: migration procedure, fresh rebuild procedure, and counts.
- [[migration/inventory]]: legacy file list and file-level classification.
- [[migration/unit-map]]: meaning-unit taxonomy classification and suggested target pages.
- [[migration/split-plan]]: target-page grouping for mixed legacy pages.
- [[migration/coverage]]: editable unit status, target, and note ledger.
- [[migration/verification]]: current unit coverage and semantic status.
- [[migration/review]]: regenerated summary from coverage/inbox status.
- [[migration/bulk-review]]: batch review queues so humans do not inspect every unit one by one.
- [[canonical/migration-inbox]], [[decisions/migration-inbox]], [[sources/migration-inbox]]: file-level adoption inboxes.
<!-- PROJECT-WIKI-MIGRATION:END -->`;

  const results: ResultRow[] = [];
  mkdirp("wiki/migration");
  results.push(["wiki/migration/inventory.md", writeManaged("wiki/migration/inventory.md", inventory)]);
  results.push(["wiki/migration/unit-map.md", writeManaged("wiki/migration/unit-map.md", unitMap)]);
  results.push(["wiki/migration/split-plan.md", writeManaged("wiki/migration/split-plan.md", splitPlan)]);
  results.push(["wiki/migration/coverage.md", writeManaged("wiki/migration/coverage.md", coverage)]);
  results.push(["wiki/migration/plan.md", writeManaged("wiki/migration/plan.md", plan)]);
  results.push(["wiki/migration/review.md", writeManaged("wiki/migration/review.md", review)]);
  results.push(["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)]);
  results.push(["wiki/migration/bulk-review.md", writeManaged("wiki/migration/bulk-review.md", bulkReview)]);
  results.push(["wiki/canonical/migration-inbox.md", writeManaged("wiki/canonical/migration-inbox.md", buildInbox("Canonical Migration Inbox", "Legacy content that may belong in current project truth.", byKind.canonical.concat(byKind.other)))]);
  results.push(["wiki/decisions/migration-inbox.md", writeManaged("wiki/decisions/migration-inbox.md", buildInbox("Decision Migration Inbox", "Legacy content that may belong in project decision history.", byKind.decision))]);
  results.push(["wiki/sources/migration-inbox.md", writeManaged("wiki/sources/migration-inbox.md", buildInbox("Source Migration Inbox", "Legacy content that may belong in source summaries.", byKind.source))]);
  results.push(["wiki/startup.md migration state", upsertMarkedSection("wiki/startup.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationStartupBlock)]);
  results.push(["wiki/index.md migration router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->", migrationIndexBlock)]);
  return { results, total: markdownFiles.length, legacyPath };
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
      const entry = { status: normalizeMigrationStatus(cells[3]), inbox: file };
      statuses.set(source, entry);
      const rootStripped = source.replace(/^wiki_legacy(?:_[^/]+)?\//, "");
      if (rootStripped !== source) statuses.set(rootStripped, entry);
    }
  }
  return statuses;
}

function normalizeCoverageStatusForReview(status: unknown): MigrationInboxStatus {
  const value = String(status || "").trim().toLowerCase();
  if (value === "merged") return "adopted";
  if (value === "superseded") return "resolved";
  if (isMigrationInboxStatus(value)) return value;
  return "pending";
}

export function migrationCoverageStatusMap(): Map<string, MigrationInboxEntry> {
  const statuses = new Map<string, MigrationInboxEntry>();
  if (!exists("wiki/migration/coverage.md")) return statuses;
  for (const cells of parseMarkdownTableRows(read("wiki/migration/coverage.md"), 8).filter((row) => row[0] !== "Unit ID")) {
    const source = cells[0];
    if (!source) continue;
    statuses.set(source, { status: normalizeCoverageStatusForReview(cells[5]), inbox: "wiki/migration/coverage.md" });
  }
  return statuses;
}

function legacySourceFromUnitId(value: string): string {
  return value.split("#u", 1)[0] ?? value;
}

function sourcesSafeForFileLevelFallback(rows: MigrationVerificationRow[]): Set<string> {
  const targetsBySource = new Map<string, Set<string>>();
  for (const row of rows) {
    const source = legacySourceFromUnitId(row.legacyPath);
    const targets = targetsBySource.get(source) ?? new Set<string>();
    targets.add(row.target);
    targetsBySource.set(source, targets);
  }
  return new Set(Array.from(targetsBySource.entries()).filter(([, targets]) => targets.size === 1).map(([source]) => source));
}

function migrationStatusForRow(row: MigrationVerificationRow, coverageStatuses: Map<string, MigrationInboxEntry>, inboxStatuses: Map<string, MigrationInboxEntry>, fileLevelFallbackSources: Set<string>): MigrationInboxEntry {
  const coverage = coverageStatuses.get(row.legacyPath);
  if (coverage && coverage.status !== "pending") return coverage;
  const exactInbox = inboxStatuses.get(row.legacyPath);
  if (exactInbox) return exactInbox;
  const source = legacySourceFromUnitId(row.legacyPath);
  const sourceInbox = inboxStatuses.get(source);
  if (sourceInbox && fileLevelFallbackSources.has(source)) return sourceInbox;
  if (sourceInbox) {
    const note = `file-level inbox row ignored for mixed-target legacy source: ${sourceInbox.inbox}`;
    return coverage ? { status: coverage.status, inbox: `${note}; using ${coverage.inbox}` } : { status: "needs-human-review", inbox: note };
  }
  if (coverage) return coverage;
  return { status: "needs-human-review", inbox: "missing migration coverage or inbox row" };
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
  const coverageStatuses = migrationCoverageStatusMap();
  const inboxStatuses = migrationInboxStatusMap();
  const fileLevelFallbackSources = sourcesSafeForFileLevelFallback(verificationRows);
  const reviewedRows: MigrationReviewRow[] = verificationRows.map((row) => {
    const statusEntry = migrationStatusForRow(row, coverageStatuses, inboxStatuses, fileLevelFallbackSources);
    return { ...row, inboxStatus: statusEntry.status, semanticStatus: semanticStatusForInboxStatus(statusEntry.status), note: statusEntry.inbox };
  });
  const counts: StatusCounts = reviewedRows.reduce<StatusCounts>((acc, row) => {
    acc[row.inboxStatus] = (acc[row.inboxStatus] || 0) + 1;
    return acc;
  }, {});
  const pending = counts.pending || 0;
  const needsHuman = counts["needs-human-review"] || 0;
  const complete = pending === 0 && needsHuman === 0;
  const legacyRoot = (verificationText.match(/^- legacy root:\s*(.+)$/m) || [])[1] || "unknown";
  const batchScope = migrationBatchScope(legacyRoot);
  const completionValue = semanticCompletionValue(complete, batchScope);
  const coverageRows = exists("wiki/migration/coverage.md") ? parseMigrationCoverageRows(read("wiki/migration/coverage.md")) : [];
  const bulkPlan = buildMigrationBulkReviewPlan(bulkReviewRowsFromCoverage(coverageRows, reviewedRows));
  const bulkReview = renderMigrationBulkReviewDocument(bulkPlan, batchScope);
  const reviewRows = reviewedRows.length === 0
    ? "| none | - | - | - | - |\n"
    : reviewedRows.map((row) => `| ${markdownTableCell(row.legacyPath)} | ${row.kind} | ${row.inboxStatus} | ${row.semanticStatus} | ${markdownTableCell(row.note)} |`).join("\n") + "\n";
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
- semantic migration complete: ${completionValue}

${completionScopeSection(batchScope)}

${bulkReviewSummarySection(bulkPlan)}

| Legacy Source | Classification | Inbox Status | Semantic Status | Evidence |
| --- | --- | --- | --- | --- |
${reviewRows}`;
  const verificationRowsText = reviewedRows.length === 0
    ? "| none | - | - | pass | - |\n"
    : reviewedRows.map((row) => `| ${markdownTableCell(row.legacyPath)} | ${row.kind} | ${row.target} | ${row.coverage} | ${row.semanticStatus} |`).join("\n") + "\n";
  const verification = `${metadata("migration-verification", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "migration inbox items are adopted, rejected, resolved, or marked needs-human-review")}
# Migration Verification

## TL;DR

- legacy root: ${legacyRoot}
- legacy rows: ${reviewedRows.length}
- mapped rows: ${reviewedRows.filter((row) => row.coverage === "mapped").length}
- coverage: ${reviewedRows.every((row) => row.coverage === "mapped") ? "pass" : "fail"}
- semantic migration complete: ${completionValue}
- pending: ${pending}
- needs-human-review: ${needsHuman}

${completionScopeSection(batchScope)}

| Legacy Source | Classification | New Wiki Target | Coverage | Semantic Status |
| --- | --- | --- | --- | --- |
${verificationRowsText}`;
  const results: ResultRow[] = [
    ["wiki/migration/review.md", writeManaged("wiki/migration/review.md", review)],
    ["wiki/migration/verification.md", writeManaged("wiki/migration/verification.md", verification)],
    ["wiki/migration/bulk-review.md", writeManaged("wiki/migration/bulk-review.md", bulkReview)],
  ];
  if (complete) {
    results.push(...pruneCompletedMigrationJunk(legacyRoot));
  }
  console.log("Project wiki migration review complete.");
  for (const [relativePath, status] of results) console.log(`${String(status).padEnd(7)} ${relativePath}`);
  console.log(`summary pending=${pending} needs-human-review=${needsHuman} complete=${complete ? "yes" : "no"}`);
}
