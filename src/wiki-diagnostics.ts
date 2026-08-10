import type { WikiDiagnostic } from "./types";
import { normalizeWikiLinkTarget, parseMarkdownTableRows } from "./wiki-files";
import { wikiCorpusGraph, wikiCorpusText, type WikiCorpus } from "./wiki-corpus";
import { wikiRouterRoot } from "./wiki-graph";
import { metadataValue, stripMetadataHeader } from "./workspace";
import { classifyWikiPath, isCurrentTruthPath, isSourcePath, validateWikiMetadataContext } from "./wiki-layout";

export const staleReviewAgeDays = 30;
export const topologyHubOverloadThreshold = 60;
export const topologyFanoutThreshold = 8;

function dateOnlyMillis(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(millis) ? null : millis;
}

export function staleReviewAge(updated: string, currentDate: string): number | null {
  const updatedMillis = dateOnlyMillis(updated);
  const currentMillis = dateOnlyMillis(currentDate);
  if (updatedMillis === null || currentMillis === null) return null;
  const ageDays = Math.floor((currentMillis - updatedMillis) / 86_400_000);
  return ageDays > staleReviewAgeDays ? ageDays : null;
}

function uniqueExisting(values: string[], fileSet: Set<string>): string[] {
  return Array.from(new Set(values.filter((value) => fileSet.has(value)))).sort();
}

function isGeneratedScopedRouter(file: string): boolean {
  return /^wiki\/indexes\/auto-[a-z0-9-]+(?:-\d+)?\.md$/.test(file);
}

function isCanonicalTruthPage(file: string, text: string): boolean {
  return isCurrentTruthPath(file) && metadataValue(text, "status") === "active";
}

function hasEvidenceClaimSignal(body: string): boolean {
  return /\b(source-backed|source backed|research-backed|external research|paper-backed|evidence-backed)\b/i.test(body);
}

function hasDecisionRefSignal(text: string): boolean {
  const decisionRef = metadataValue(text, "decision_ref").trim().toLowerCase();
  return decisionRef !== "" && decisionRef !== "none";
}

function hasFocusedAuthoritySignal(text: string, body: string): boolean {
  return hasDecisionRefSignal(text) || hasEvidenceClaimSignal(body);
}

function hasEvidenceLink(file: string, corpus: WikiCorpus, graph = wikiCorpusGraph(corpus)): boolean {
  const outgoingLinks = graph.outgoingLinks.get(file) ?? [];
  const sourceLink = outgoingLinks.some((link) => isSourcePath(link.normalizedTarget) && corpus.fileSet.has(link.normalizedTarget));
  const decisionRef = graph.outgoingDecisionRef.get(file);
  return sourceLink || Boolean(decisionRef && corpus.fileSet.has(decisionRef));
}

function isBroadReviewTrigger(trigger: string): boolean {
  const normalized = trigger.toLowerCase().trim();
  if (!normalized) return false;
  return normalized === "changes"
    || normalized === "project changes"
    || normalized === "routine review"
    || /^any\b.*changes$/.test(normalized)
    || /^general\b.*changes$/.test(normalized);
}

function isTopologyHub(file: string): boolean {
  return file === "wiki/index.md"
    || file.startsWith("wiki/00-index/")
    || file.startsWith("wiki/meta/")
    || /^wiki\/10-services\/[^/]+\/(?:README|prds\/[^/]+\/README)\.md$/.test(file)
    || /^wiki\/indexes\/(?!auto-)[^/]+\.md$/.test(file);
}

function registryRows(text: string, columns: number, header: string): string[][] {
  return parseMarkdownTableRows(text, columns)
    .filter((cells) => (cells[0] ?? "").trim().toLowerCase() !== header.toLowerCase());
}

function registryHub(sourceFile: string, cell: string): string {
  const wikiLink = cell.match(/\[\[([^\]\n]+)\]\]/)?.[1] ?? "";
  const markdownLink = cell.match(/\[[^\]\n]+\]\(([^)\n]+)\)/)?.[1] ?? "";
  const target = wikiLink || markdownLink;
  return target ? normalizeWikiLinkTarget(sourceFile, target) : "";
}

function collectLayoutDiagnostics(corpus: WikiCorpus): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = [];
  const prdHubs = corpus.files.filter((file) => /^wiki\/10-services\/[^/]+\/prds\/PRD-\d+[^/]*\/README\.md$/i.test(file));
  const serviceHubs = corpus.files.filter((file) => /^wiki\/10-services\/[^/]+\/README\.md$/.test(file));
  const prdById = new Map<string, string[]>();

  for (const file of corpus.files) {
    const text = wikiCorpusText(corpus, file);
    for (const message of validateWikiMetadataContext(file, text)) {
      diagnostics.push({
        code: message.startsWith("type must be") ? "area-type-mismatch" : "metadata-context-mismatch",
        severity: "warn",
        file,
        message,
      });
    }
  }

  for (const file of prdHubs) {
    const classification = classifyWikiPath(file);
    if (classification.prdId) {
      prdById.set(classification.prdId, [...(prdById.get(classification.prdId) ?? []), file]);
    }
  }

  for (const [prdId, hubs] of prdById) {
    if (hubs.length < 2) continue;
    for (const file of hubs) {
      diagnostics.push({
        code: "duplicate-prd-id",
        severity: "error",
        file,
        message: `${prdId} is also used by ${hubs.filter((hub) => hub !== file).join(", ")}`,
      });
    }
  }

  const prdRegistryFile = "wiki/00-index/prd-registry.md";
  const prdRegistryRows = corpus.fileSet.has(prdRegistryFile)
    ? registryRows(wikiCorpusText(corpus, prdRegistryFile), 5, "PRD ID")
    : [];
  const registeredPrdHubs = new Set<string>();
  const registryPrdIds = new Map<string, number>();
  for (const row of prdRegistryRows) {
    const prdId = (row[0] ?? "").trim().toUpperCase();
    const service = (row[1] ?? "").trim();
    const hub = registryHub(prdRegistryFile, row[3] ?? "");
    if (prdId) registryPrdIds.set(prdId, (registryPrdIds.get(prdId) ?? 0) + 1);
    if (!hub) {
      diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: prdRegistryFile, message: `${prdId || "registry row"} has no valid PRD hub link` });
      continue;
    }
    registeredPrdHubs.add(hub);
    const layout = classifyWikiPath(hub);
    if (layout.type !== "prd-hub" || layout.prdId !== prdId || layout.service !== service) {
      diagnostics.push({
        code: "registry-entry-mismatch",
        severity: "error",
        file: prdRegistryFile,
        message: `${prdId || "registry row"} service/hub identity does not match ${hub}`,
      });
    }
  }
  for (const [prdId, count] of registryPrdIds) {
    if (count > 1) diagnostics.push({ code: "duplicate-prd-id", severity: "error", file: prdRegistryFile, message: `${prdId} appears in ${count} registry rows` });
  }
  for (const file of prdHubs) {
    if (!registeredPrdHubs.has(file)) diagnostics.push({ code: "registry-hub-mismatch", severity: "warn", file, message: "PRD hub is not linked from wiki/00-index/prd-registry.md" });
  }
  for (const file of registeredPrdHubs) {
    if (/^wiki\/10-services\/[^/]+\/prds\//.test(file) && !corpus.fileSet.has(file)) diagnostics.push({ code: "registry-hub-mismatch", severity: "error", file: "wiki/00-index/prd-registry.md", message: `registered PRD hub is missing: ${file}` });
  }

  const serviceMapFile = "wiki/00-index/service-map.md";
  const serviceRows = corpus.fileSet.has(serviceMapFile)
    ? registryRows(wikiCorpusText(corpus, serviceMapFile), 4, "Service")
    : [];
  const registeredServiceHubs = new Set<string>();
  for (const row of serviceRows) {
    const service = (row[0] ?? "").trim();
    const hub = registryHub(serviceMapFile, row[2] ?? "");
    if (!hub) {
      diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: serviceMapFile, message: `${service || "registry row"} has no valid service hub link` });
      continue;
    }
    registeredServiceHubs.add(hub);
    const layout = classifyWikiPath(hub);
    if (layout.type !== "service-hub" || layout.service !== service) {
      diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: serviceMapFile, message: `${service || "registry row"} does not match service hub ${hub}` });
    }
    if (!corpus.fileSet.has(hub)) {
      diagnostics.push({ code: "registry-hub-mismatch", severity: "error", file: serviceMapFile, message: `registered service hub is missing: ${hub}` });
    }
  }
  for (const file of serviceHubs) {
    if (!registeredServiceHubs.has(file)) diagnostics.push({ code: "registry-hub-mismatch", severity: "warn", file, message: "service hub is not linked from wiki/00-index/service-map.md" });
  }
  return diagnostics;
}

export function collectTopologyDiagnostics(corpus: WikiCorpus): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = collectLayoutDiagnostics(corpus);
  const graph = wikiCorpusGraph(corpus);

  for (const file of corpus.files) {
    if (isGeneratedScopedRouter(file)) continue;
    const outgoing = uniqueExisting((graph.outgoingLinks.get(file) ?? [])
      .map((link) => link.normalizedTarget)
      .filter((target) => target !== file), corpus.fileSet);
    if (isTopologyHub(file) && outgoing.length > topologyHubOverloadThreshold) {
      diagnostics.push({
        code: "hub-overload",
        severity: "warn",
        file,
        message: `${outgoing.length} outgoing wiki links exceed the topology hub threshold ${topologyHubOverloadThreshold}; split or scope the route surface`,
      });
    }
  }

  for (const file of corpus.files) {
    const text = wikiCorpusText(corpus, file);
    if (isCanonicalTruthPage(file, text)) {
      const body = stripMetadataHeader(text);
      const incoming = uniqueExisting((graph.incomingLinks.get(file) ?? [])
        .map((link) => link.file)
        .filter((source) => source !== file), corpus.fileSet);
      if (incoming.length > 0 && incoming.every(isGeneratedScopedRouter) && hasFocusedAuthoritySignal(text, body)) {
        diagnostics.push({
          code: "weak-authority-route",
          severity: "warn",
          file,
          message: "active truth with authority signals is routed only by generated auto-index pages; add a focused service, PRD, or shared route",
        });
      }

      if (hasEvidenceClaimSignal(body) && !hasEvidenceLink(file, corpus, graph)) {
        diagnostics.push({
          code: "missing-evidence-link",
          severity: "warn",
          file,
          message: "current-truth page makes a source-backed claim but has no owning PRD/shared source link or decision_ref evidence link",
        });
      }
    }
  }

  for (const file of corpus.files) {
    if (file === wikiRouterRoot || isGeneratedScopedRouter(file)) continue;
    const text = wikiCorpusText(corpus, file);
    if (metadataValue(text, "status") !== "active") continue;
    const incoming = uniqueExisting((graph.incomingLinks.get(file) ?? [])
      .map((link) => link.file)
      .filter((source) => source !== file), corpus.fileSet);
    const reviewTrigger = metadataValue(text, "review_trigger");
    if (incoming.length >= topologyFanoutThreshold && isBroadReviewTrigger(reviewTrigger)) {
      diagnostics.push({
        code: "stale-fanout",
        severity: "warn",
        file,
        message: `${incoming.length} incoming links with broad review_trigger "${reviewTrigger}"; tighten review trigger before broad edits`,
      });
    }
  }

  return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}
