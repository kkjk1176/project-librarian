"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wikiAnswerTruncationNotice = exports.wikiAnswerCharCap = exports.wikiRouterExemptPages = exports.wikiRouterDepthBudget = exports.wikiRouterRoot = void 0;
exports.finalizeWikiAnswer = finalizeWikiAnswer;
exports.buildWikiGraph = buildWikiGraph;
exports.wikiReachableDepths = wikiReachableDepths;
exports.wikiRouterDepths = wikiRouterDepths;
exports.wikiQueryGraphEvidence = wikiQueryGraphEvidence;
exports.wikiImpactAnswer = wikiImpactAnswer;
exports.wikiNeighborhoodAnswer = wikiNeighborhoodAnswer;
const wiki_files_1 = require("./wiki-files");
const workspace_1 = require("./workspace");
// Router reachability budget. The benchmark fixture A1 assert guarantees
// startup -> index -> answer page within two hops; real wikis add one hop for
// generated scoped routers (startup -> index -> wiki/indexes/auto-*.md -> page),
// so the real-wiki budget is three hops from wiki/startup.md.
exports.wikiRouterRoot = "wiki/startup.md";
exports.wikiRouterDepthBudget = 3;
// startup is the BFS root; README is a human entry document that is deliberately
// unrouted (the same exemption the orphan-page rule uses).
exports.wikiRouterExemptPages = new Set([exports.wikiRouterRoot, "wiki/README.md"]);
// Answer-shape discipline for wiki-side query/impact output: answer-first text,
// hard char cap, explicit truncation notice (never silent). Mirrors the MCP
// server constants (src/mcp-server.ts MAX_RESPONSE_CHARS / TRUNCATION_NOTICE);
// kept separate so the MCP server module and its node:sqlite loading path stay
// out of the bootstrap/diagnostics path.
exports.wikiAnswerCharCap = 4000;
exports.wikiAnswerTruncationNotice = "[truncated — refine the query]";
function finalizeWikiAnswer(body) {
    if (body.length <= exports.wikiAnswerCharCap)
        return body;
    const budget = exports.wikiAnswerCharCap - exports.wikiAnswerTruncationNotice.length - 1;
    return `${body.slice(0, budget > 0 ? budget : 0).trimEnd()}\n${exports.wikiAnswerTruncationNotice}`;
}
// decision_ref is frontmatter, not a wiki link, so the link extractor never sees
// it; normalize it here into a page edge. "none"/"-" are the documented empty
// markers in generated metadata headers.
function normalizedDecisionRef(file, value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "none" || trimmed === "-")
        return "";
    return (0, wiki_files_1.normalizeWikiLinkTarget)(file, trimmed.replace(/^\[\[|\]\]$/g, ""));
}
function buildWikiGraph(pages) {
    const files = new Set(pages.map((page) => page.file));
    const links = [];
    const incomingLinks = new Map();
    const outgoingLinks = new Map();
    const incomingDecisionRefs = new Map();
    const outgoingDecisionRef = new Map();
    for (const page of pages) {
        for (const link of (0, wiki_files_1.extractWikiLinks)(page.file, page.text)) {
            links.push(link);
            outgoingLinks.set(page.file, [...(outgoingLinks.get(page.file) ?? []), link]);
            incomingLinks.set(link.normalizedTarget, [...(incomingLinks.get(link.normalizedTarget) ?? []), link]);
        }
        const ref = normalizedDecisionRef(page.file, (0, workspace_1.metadataValue)(page.text, "decision_ref"));
        if (ref && files.has(ref)) {
            outgoingDecisionRef.set(page.file, ref);
            incomingDecisionRefs.set(ref, [...(incomingDecisionRefs.get(ref) ?? []), page.file]);
        }
    }
    return { files, links, incomingLinks, outgoingLinks, incomingDecisionRefs, outgoingDecisionRef };
}
// BFS depths over existing pages from a caller-selected root (depth 0). Pages
// absent from the result are unreachable through that link chain. Only links
// whose target exists are traversed; broken links are the broken-link rule's job.
function wikiReachableDepths(graph, root) {
    const depths = new Map();
    if (!graph.files.has(root))
        return depths;
    depths.set(root, 0);
    const queue = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        const depth = depths.get(current) ?? 0;
        for (const link of graph.outgoingLinks.get(current) ?? []) {
            const target = link.normalizedTarget;
            if (!graph.files.has(target) || depths.has(target))
                continue;
            depths.set(target, depth + 1);
            queue.push(target);
        }
    }
    return depths;
}
function wikiRouterDepths(graph) {
    return wikiReachableDepths(graph, exports.wikiRouterRoot);
}
// Wiki impact: the --code-impact envelope shape applied to wiki maintenance.
// Given a page or term, report which pages link to it (review candidates when it
// changes), which pages cite it as decision_ref, what it depends on, and how the
// router reaches it. Bounded by sampling plus the shared answer cap.
const impactMatchCap = 5;
const impactListCap = 12;
function sampled(items, cap) {
    if (items.length === 0)
        return "none";
    const shown = items.slice(0, cap).join(", ");
    return items.length > cap ? `${shown}, …+${items.length - cap} more` : shown;
}
function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
}
function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function wikiQueryGraphEvidence(graph, file, depths = wikiRouterDepths(graph), listCap = 3) {
    const outgoing = uniqueSorted((graph.outgoingLinks.get(file) ?? [])
        .map((link) => link.normalizedTarget)
        .filter((target) => target !== file && graph.files.has(target)));
    const incoming = uniqueSorted((graph.incomingLinks.get(file) ?? [])
        .map((link) => link.file)
        .filter((source) => source !== file && graph.files.has(source)));
    const incomingRefs = uniqueSorted((graph.incomingDecisionRefs.get(file) ?? [])
        .filter((source) => source !== file && graph.files.has(source)));
    const outgoingRef = graph.outgoingDecisionRef.get(file);
    const depth = depths.get(file);
    const parts = [
        depth === undefined ? `router unreachable from ${exports.wikiRouterRoot}` : `router depth ${depth}`,
    ];
    if (outgoing.length > 0)
        parts.push(`links-out ${outgoing.length}: ${sampled(outgoing, listCap)}`);
    if (outgoingRef && outgoingRef !== file && graph.files.has(outgoingRef))
        parts.push(`decision_ref-> ${outgoingRef}`);
    if (incoming.length > 0)
        parts.push(`linked-by ${incoming.length}: ${sampled(incoming, listCap)}`);
    if (incomingRefs.length > 0)
        parts.push(`decision_ref-by ${incomingRefs.length}: ${sampled(incomingRefs, listCap)}`);
    return parts.join("; ");
}
function wikiImpactAnswer(pages, term, graph = buildWikiGraph(pages)) {
    const depths = wikiRouterDepths(graph);
    const textByFile = new Map(pages.map((page) => [page.file, page.text]));
    const lowered = term.toLowerCase();
    const exactTarget = (0, wiki_files_1.normalizeWikiLinkTarget)("wiki/index.md", term.replace(/^\[\[|\]\]$/g, ""));
    const matches = pages
        .map((page) => ({ file: page.file, title: (0, wiki_files_1.wikiTitleForFile)(page.file, page.text) }))
        .filter((page) => page.file === exactTarget || page.file.toLowerCase().includes(lowered) || page.title.toLowerCase().includes(lowered))
        .sort((a, b) => Number(b.file === exactTarget) - Number(a.file === exactTarget) || a.file.localeCompare(b.file));
    if (matches.length === 0)
        return `Wiki impact "${term}": no matching wiki pages.`;
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
        const trigger = (0, workspace_1.metadataValue)(text, "review_trigger");
        lines.push("");
        lines.push(`${match.file} — ${match.title}`);
        if (trigger)
            lines.push(`  review_trigger: ${trigger}`);
        lines.push(`  incoming links (${incoming.length}): ${sampled(incoming, impactListCap)}`);
        lines.push(`  decision_ref from (${refs.length}): ${sampled(refs, impactListCap)}`);
        lines.push(`  outgoing links (${outgoing.length}): ${sampled(outgoing, impactListCap)}`);
        lines.push(depth === undefined
            ? `  router: unreachable from ${exports.wikiRouterRoot}`
            : `  router: reachable at depth ${depth} (budget ${exports.wikiRouterDepthBudget})`);
    }
    return finalizeWikiAnswer(lines.join("\n"));
}
const neighborhoodReadCap = 5;
function pageClassPriority(file, scope) {
    if (file.startsWith("wiki/decisions/") || /decision/.test(scope))
        return 90;
    if (file.startsWith("wiki/sources/") || /source/.test(scope))
        return 80;
    if (file.startsWith("wiki/canonical/") || /canonical/.test(scope))
        return 70;
    if (file.startsWith("wiki/plans/") || /plan/.test(scope))
        return 50;
    if (file.startsWith("wiki/roadmaps/") || /roadmap/.test(scope))
        return 40;
    if (file.startsWith("wiki/meta/") || /wiki-meta/.test(scope))
        return 30;
    return 10;
}
function neighborhoodReasonRank(reason) {
    if (reason === "exact page match")
        return 1000;
    if (reason === "title/path match")
        return 900;
    if (reason === "decision_ref target")
        return 800;
    if (reason === "decision_ref citation")
        return 760;
    if (reason === "outgoing link target")
        return 700;
    if (reason === "incoming link source")
        return 650;
    return 0;
}
function isGeneratedScopedRouter(file) {
    return /^wiki\/indexes\/auto-[a-z0-9-]+(?:-\d+)?\.md$/.test(file);
}
function isRouterOnlySurface(file) {
    return file === exports.wikiRouterRoot || file === "wiki/index.md" || isGeneratedScopedRouter(file);
}
function addNeighborhoodCandidate(candidates, file, reason, bestFile, graph) {
    if (!graph.files.has(file) || (file !== bestFile && isRouterOnlySurface(file)))
        return;
    const existing = candidates.get(file);
    if (!existing || neighborhoodReasonRank(reason) > neighborhoodReasonRank(existing.reason)) {
        candidates.set(file, { file, reason });
    }
}
function wikiNeighborhoodAnswer(pages, term, graph = buildWikiGraph(pages)) {
    const depths = wikiRouterDepths(graph);
    const textByFile = new Map(pages.map((page) => [page.file, page.text]));
    const lowered = term.toLowerCase();
    const exactTarget = (0, wiki_files_1.normalizeWikiLinkTarget)("wiki/index.md", term.replace(/^\[\[|\]\]$/g, ""));
    const matches = pages
        .map((page) => ({ file: page.file, title: (0, wiki_files_1.wikiTitleForFile)(page.file, page.text), text: page.text }))
        .filter((page) => page.file === exactTarget || page.file.toLowerCase().includes(lowered) || page.title.toLowerCase().includes(lowered))
        .sort((a, b) => {
        const exactDelta = Number(b.file === exactTarget) - Number(a.file === exactTarget);
        if (exactDelta !== 0)
            return exactDelta;
        const titleDelta = Number(b.title.toLowerCase().includes(lowered)) - Number(a.title.toLowerCase().includes(lowered));
        if (titleDelta !== 0)
            return titleDelta;
        const aScope = (0, workspace_1.metadataValue)(a.text, "scope");
        const bScope = (0, workspace_1.metadataValue)(b.text, "scope");
        return pageClassPriority(b.file, bScope) - pageClassPriority(a.file, aScope) || a.file.localeCompare(b.file);
    });
    if (matches.length === 0)
        return `Wiki neighborhood "${term}": no matching wiki pages.`;
    const best = matches[0];
    const candidates = new Map();
    addNeighborhoodCandidate(candidates, best.file, best.file === exactTarget ? "exact page match" : "title/path match", best.file, graph);
    const outgoingRef = graph.outgoingDecisionRef.get(best.file);
    if (outgoingRef)
        addNeighborhoodCandidate(candidates, outgoingRef, "decision_ref target", best.file, graph);
    for (const source of graph.incomingDecisionRefs.get(best.file) ?? [])
        addNeighborhoodCandidate(candidates, source, "decision_ref citation", best.file, graph);
    for (const link of graph.outgoingLinks.get(best.file) ?? [])
        addNeighborhoodCandidate(candidates, link.normalizedTarget, "outgoing link target", best.file, graph);
    for (const link of graph.incomingLinks.get(best.file) ?? [])
        addNeighborhoodCandidate(candidates, link.file, "incoming link source", best.file, graph);
    const sorted = Array.from(candidates.values()).sort((a, b) => {
        const reasonDelta = neighborhoodReasonRank(b.reason) - neighborhoodReasonRank(a.reason);
        if (reasonDelta !== 0)
            return reasonDelta;
        const aText = textByFile.get(a.file) ?? "";
        const bText = textByFile.get(b.file) ?? "";
        const classDelta = pageClassPriority(b.file, (0, workspace_1.metadataValue)(bText, "scope")) - pageClassPriority(a.file, (0, workspace_1.metadataValue)(aText, "scope"));
        if (classDelta !== 0)
            return classDelta;
        const aDepth = depths.get(a.file) ?? Number.POSITIVE_INFINITY;
        const bDepth = depths.get(b.file) ?? Number.POSITIVE_INFINITY;
        return aDepth - bDepth || a.file.localeCompare(b.file);
    }).slice(0, neighborhoodReadCap);
    const lines = [
        `Wiki neighborhood "${term}": best match ${best.file} — ${best.title}; read ${sorted.length} nearby page${sorted.length === 1 ? "" : "s"}.`,
        "",
        "Read order:",
    ];
    sorted.forEach((candidate, index) => {
        const text = textByFile.get(candidate.file) ?? "";
        const depth = depths.get(candidate.file);
        const status = (0, workspace_1.metadataValue)(text, "status") || "unknown";
        const scope = (0, workspace_1.metadataValue)(text, "scope") || "unknown-scope";
        lines.push(`${index + 1}. ${candidate.file} — ${candidate.reason}; ${depth === undefined ? "router unreachable" : `router depth ${depth}`}; ${status} ${scope}`);
    });
    const incoming = uniqueSorted((graph.incomingLinks.get(best.file) ?? [])
        .map((link) => link.file)
        .filter((source) => source !== best.file && graph.files.has(source)));
    const outgoing = uniqueSorted((graph.outgoingLinks.get(best.file) ?? [])
        .map((link) => link.normalizedTarget)
        .filter((target) => target !== best.file && graph.files.has(target)));
    const incomingRefs = uniqueSorted((graph.incomingDecisionRefs.get(best.file) ?? [])
        .filter((source) => source !== best.file && graph.files.has(source)));
    const reviewTrigger = (0, workspace_1.metadataValue)(best.text, "review_trigger");
    lines.push("");
    lines.push("Why:");
    lines.push(`- incoming links: ${sampled(incoming, impactListCap)}`);
    lines.push(`- outgoing links: ${sampled(outgoing, impactListCap)}`);
    lines.push(`- decision_ref: ${outgoingRef && graph.files.has(outgoingRef) ? outgoingRef : "none"}`);
    lines.push(`- decision_ref citations: ${sampled(incomingRefs, impactListCap)}`);
    if (reviewTrigger)
        lines.push(`- review_trigger: ${reviewTrigger}`);
    return finalizeWikiAnswer(lines.join("\n"));
}
