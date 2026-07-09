import type { WikiDiagnostic } from "./types";
import { wikiCorpusGraph, wikiCorpusText, type WikiCorpus } from "./wiki-corpus";
import { wikiRouterRoot } from "./wiki-graph";
import { metadataValue, stripMetadataHeader } from "./workspace";

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
  return file.startsWith("wiki/canonical/") && metadataValue(text, "status") === "active";
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
  const sourceLink = outgoingLinks.some((link) => link.normalizedTarget.startsWith("wiki/sources/") && corpus.fileSet.has(link.normalizedTarget));
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
    || file.startsWith("wiki/meta/")
    || /^wiki\/indexes\/(?!auto-)[^/]+\.md$/.test(file);
}

export function collectTopologyDiagnostics(corpus: WikiCorpus): WikiDiagnostic[] {
  const diagnostics: WikiDiagnostic[] = [];
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
          message: "active canonical page with authority signals is routed only by generated auto-index pages; add a focused route when this truth is durable",
        });
      }

      if (hasEvidenceClaimSignal(body) && !hasEvidenceLink(file, corpus, graph)) {
        diagnostics.push({
          code: "missing-evidence-link",
          severity: "warn",
          file,
          message: "canonical page makes a source-backed claim but has no source link or decision_ref evidence link",
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
