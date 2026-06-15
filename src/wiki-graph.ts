import type { WikiLinkReference } from "./types";
import { extractWikiLinks, normalizeWikiLinkTarget, wikiTitleForFile } from "./wiki-files";
import { metadataValue } from "./workspace";

// Wiki link graph: the code-evidence edges/impact model applied to the wiki's own
// link structure (2026-06-12 method-transfer decision). Everything here is a pure
// function over provided page texts so graph behavior is unit-testable without
// filesystem state; src/modes.ts feeds it from disk.

export interface WikiPageInput {
  file: string;
  text: string;
}

export interface WikiGraph {
  files: Set<string>;
  links: WikiLinkReference[];
  incomingLinks: Map<string, WikiLinkReference[]>;
  outgoingLinks: Map<string, WikiLinkReference[]>;
  incomingDecisionRefs: Map<string, string[]>;
  outgoingDecisionRef: Map<string, string>;
}

// Router reachability budget. The benchmark fixture A1 assert guarantees
// startup -> index -> answer page within two hops; real wikis add one hop for
// generated scoped routers (startup -> index -> wiki/indexes/auto-*.md -> page),
// so the real-wiki budget is three hops from wiki/startup.md.
export const wikiRouterRoot = "wiki/startup.md";
export const wikiRouterDepthBudget = 3;
// startup is the BFS root; README is a human entry document that is deliberately
// unrouted (the same exemption the orphan-page rule uses).
export const wikiRouterExemptPages: Set<string> = new Set([wikiRouterRoot, "wiki/README.md"]);

// Answer-shape discipline for wiki-side query/impact output: answer-first text,
// hard char cap, explicit truncation notice (never silent). Mirrors the MCP
// server constants (src/mcp-server.ts MAX_RESPONSE_CHARS / TRUNCATION_NOTICE);
// kept separate so the MCP server module and its node:sqlite loading path stay
// out of the bootstrap/diagnostics path.
export const wikiAnswerCharCap = 4000;
export const wikiAnswerTruncationNotice = "[truncated — refine the query]";

export function finalizeWikiAnswer(body: string): string {
  if (body.length <= wikiAnswerCharCap) return body;
  const budget = wikiAnswerCharCap - wikiAnswerTruncationNotice.length - 1;
  return `${body.slice(0, budget > 0 ? budget : 0).trimEnd()}\n${wikiAnswerTruncationNotice}`;
}

// decision_ref is frontmatter, not a wiki link, so the link extractor never sees
// it; normalize it here into a page edge. "none"/"-" are the documented empty
// markers in generated metadata headers.
function normalizedDecisionRef(file: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || trimmed === "-") return "";
  return normalizeWikiLinkTarget(file, trimmed.replace(/^\[\[|\]\]$/g, ""));
}

export function buildWikiGraph(pages: WikiPageInput[]): WikiGraph {
  const files = new Set(pages.map((page) => page.file));
  const links: WikiLinkReference[] = [];
  const incomingLinks = new Map<string, WikiLinkReference[]>();
  const outgoingLinks = new Map<string, WikiLinkReference[]>();
  const incomingDecisionRefs = new Map<string, string[]>();
  const outgoingDecisionRef = new Map<string, string>();
  for (const page of pages) {
    for (const link of extractWikiLinks(page.file, page.text)) {
      links.push(link);
      outgoingLinks.set(page.file, [...(outgoingLinks.get(page.file) ?? []), link]);
      incomingLinks.set(link.normalizedTarget, [...(incomingLinks.get(link.normalizedTarget) ?? []), link]);
    }
    const ref = normalizedDecisionRef(page.file, metadataValue(page.text, "decision_ref"));
    if (ref && files.has(ref)) {
      outgoingDecisionRef.set(page.file, ref);
      incomingDecisionRefs.set(ref, [...(incomingDecisionRefs.get(ref) ?? []), page.file]);
    }
  }
  return { files, links, incomingLinks, outgoingLinks, incomingDecisionRefs, outgoingDecisionRef };
}

// BFS depths over existing pages from wiki/startup.md (depth 0). Pages absent
// from the result are unreachable through the router chain. Only links whose
// target exists are traversed; broken links are the broken-link rule's job.
export function wikiRouterDepths(graph: WikiGraph): Map<string, number> {
  const depths = new Map<string, number>();
  if (!graph.files.has(wikiRouterRoot)) return depths;
  depths.set(wikiRouterRoot, 0);
  const queue: string[] = [wikiRouterRoot];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const depth = depths.get(current) ?? 0;
    for (const link of graph.outgoingLinks.get(current) ?? []) {
      const target = link.normalizedTarget;
      if (!graph.files.has(target) || depths.has(target)) continue;
      depths.set(target, depth + 1);
      queue.push(target);
    }
  }
  return depths;
}

// Wiki impact: the --code-impact envelope shape applied to wiki maintenance.
// Given a page or term, report which pages link to it (review candidates when it
// changes), which pages cite it as decision_ref, what it depends on, and how the
// router reaches it. Bounded by sampling plus the shared answer cap.
const impactMatchCap = 5;
const impactListCap = 12;

function sampled(items: string[], cap: number): string {
  if (items.length === 0) return "none";
  const shown = items.slice(0, cap).join(", ");
  return items.length > cap ? `${shown}, …+${items.length - cap} more` : shown;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function wikiImpactAnswer(pages: WikiPageInput[], term: string): string {
  const graph = buildWikiGraph(pages);
  const depths = wikiRouterDepths(graph);
  const textByFile = new Map(pages.map((page) => [page.file, page.text]));
  const lowered = term.toLowerCase();
  const exactTarget = normalizeWikiLinkTarget("wiki/index.md", term.replace(/^\[\[|\]\]$/g, ""));
  const matches = pages
    .map((page) => ({ file: page.file, title: wikiTitleForFile(page.file, page.text) }))
    .filter((page) => page.file === exactTarget || page.file.toLowerCase().includes(lowered) || page.title.toLowerCase().includes(lowered))
    .sort((a, b) => Number(b.file === exactTarget) - Number(a.file === exactTarget) || a.file.localeCompare(b.file));
  if (matches.length === 0) return `Wiki impact "${term}": no matching wiki pages.`;
  const shown = matches.slice(0, impactMatchCap);
  // Headline counts are unions across the shown matches, not sums: a page that
  // links two matched targets is one review candidate, not two.
  const incomingUnion = new Set(shown.flatMap((match) => (graph.incomingLinks.get(match.file) ?? []).map((link) => link.file)));
  const refUnion = new Set(shown.flatMap((match) => graph.incomingDecisionRefs.get(match.file) ?? []));
  const lines = [
    `Wiki impact "${term}": ${plural(matches.length, "matching page")}${matches.length > impactMatchCap ? ` (top ${impactMatchCap} shown)` : ""}; review the ${plural(incomingUnion.size, "linking page")} and ${plural(refUnion.size, "decision_ref citation")} below when ${matches.length === 1 ? "this page changes" : "these pages change"}.`,
  ];
  for (const match of shown) {
    const text = textByFile.get(match.file) ?? "";
    const incoming = uniqueSorted((graph.incomingLinks.get(match.file) ?? []).map((link) => link.file));
    const refs = uniqueSorted(graph.incomingDecisionRefs.get(match.file) ?? []);
    const outgoing = uniqueSorted((graph.outgoingLinks.get(match.file) ?? []).map((link) => link.normalizedTarget));
    const depth = depths.get(match.file);
    const trigger = metadataValue(text, "review_trigger");
    lines.push("");
    lines.push(`${match.file} — ${match.title}`);
    if (trigger) lines.push(`  review_trigger: ${trigger}`);
    lines.push(`  incoming links (${incoming.length}): ${sampled(incoming, impactListCap)}`);
    lines.push(`  decision_ref from (${refs.length}): ${sampled(refs, impactListCap)}`);
    lines.push(`  outgoing links (${outgoing.length}): ${sampled(outgoing, impactListCap)}`);
    lines.push(depth === undefined
      ? `  router: unreachable from ${wikiRouterRoot}`
      : `  router: reachable at depth ${depth} (budget ${wikiRouterDepthBudget})`);
  }
  return finalizeWikiAnswer(lines.join("\n"));
}
