"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.topologyFanoutThreshold = exports.topologyHubOverloadThreshold = exports.staleReviewAgeDays = void 0;
exports.staleReviewAge = staleReviewAge;
exports.collectTopologyDiagnostics = collectTopologyDiagnostics;
const wiki_corpus_1 = require("./wiki-corpus");
const wiki_graph_1 = require("./wiki-graph");
const workspace_1 = require("./workspace");
exports.staleReviewAgeDays = 30;
exports.topologyHubOverloadThreshold = 60;
exports.topologyFanoutThreshold = 8;
function dateOnlyMillis(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const millis = Date.parse(`${value}T00:00:00Z`);
    return Number.isNaN(millis) ? null : millis;
}
function staleReviewAge(updated, currentDate) {
    const updatedMillis = dateOnlyMillis(updated);
    const currentMillis = dateOnlyMillis(currentDate);
    if (updatedMillis === null || currentMillis === null)
        return null;
    const ageDays = Math.floor((currentMillis - updatedMillis) / 86_400_000);
    return ageDays > exports.staleReviewAgeDays ? ageDays : null;
}
function uniqueExisting(values, fileSet) {
    return Array.from(new Set(values.filter((value) => fileSet.has(value)))).sort();
}
function isGeneratedScopedRouter(file) {
    return /^wiki\/indexes\/auto-[a-z0-9-]+(?:-\d+)?\.md$/.test(file);
}
function isCanonicalTruthPage(file, text) {
    return file.startsWith("wiki/canonical/") && (0, workspace_1.metadataValue)(text, "status") === "active";
}
function hasEvidenceClaimSignal(body) {
    return /\b(source-backed|source backed|research-backed|external research|paper-backed|evidence-backed)\b/i.test(body);
}
function hasDecisionRefSignal(text) {
    const decisionRef = (0, workspace_1.metadataValue)(text, "decision_ref").trim().toLowerCase();
    return decisionRef !== "" && decisionRef !== "none";
}
function hasFocusedAuthoritySignal(text, body) {
    return hasDecisionRefSignal(text) || hasEvidenceClaimSignal(body);
}
function hasEvidenceLink(file, corpus, graph = (0, wiki_corpus_1.wikiCorpusGraph)(corpus)) {
    const outgoingLinks = graph.outgoingLinks.get(file) ?? [];
    const sourceLink = outgoingLinks.some((link) => link.normalizedTarget.startsWith("wiki/sources/") && corpus.fileSet.has(link.normalizedTarget));
    const decisionRef = graph.outgoingDecisionRef.get(file);
    return sourceLink || Boolean(decisionRef && corpus.fileSet.has(decisionRef));
}
function isBroadReviewTrigger(trigger) {
    const normalized = trigger.toLowerCase().trim();
    if (!normalized)
        return false;
    return normalized === "changes"
        || normalized === "project changes"
        || normalized === "routine review"
        || /^any\b.*changes$/.test(normalized)
        || /^general\b.*changes$/.test(normalized);
}
function isTopologyHub(file) {
    return file === "wiki/index.md"
        || file.startsWith("wiki/meta/")
        || /^wiki\/indexes\/(?!auto-)[^/]+\.md$/.test(file);
}
function collectTopologyDiagnostics(corpus) {
    const diagnostics = [];
    const graph = (0, wiki_corpus_1.wikiCorpusGraph)(corpus);
    for (const file of corpus.files) {
        if (isGeneratedScopedRouter(file))
            continue;
        const outgoing = uniqueExisting((graph.outgoingLinks.get(file) ?? [])
            .map((link) => link.normalizedTarget)
            .filter((target) => target !== file), corpus.fileSet);
        if (isTopologyHub(file) && outgoing.length > exports.topologyHubOverloadThreshold) {
            diagnostics.push({
                code: "hub-overload",
                severity: "warn",
                file,
                message: `${outgoing.length} outgoing wiki links exceed the topology hub threshold ${exports.topologyHubOverloadThreshold}; split or scope the route surface`,
            });
        }
    }
    for (const file of corpus.files) {
        const text = (0, wiki_corpus_1.wikiCorpusText)(corpus, file);
        if (isCanonicalTruthPage(file, text)) {
            const body = (0, workspace_1.stripMetadataHeader)(text);
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
        if (file === wiki_graph_1.wikiRouterRoot || isGeneratedScopedRouter(file))
            continue;
        const text = (0, wiki_corpus_1.wikiCorpusText)(corpus, file);
        if ((0, workspace_1.metadataValue)(text, "status") !== "active")
            continue;
        const incoming = uniqueExisting((graph.incomingLinks.get(file) ?? [])
            .map((link) => link.file)
            .filter((source) => source !== file), corpus.fileSet);
        const reviewTrigger = (0, workspace_1.metadataValue)(text, "review_trigger");
        if (incoming.length >= exports.topologyFanoutThreshold && isBroadReviewTrigger(reviewTrigger)) {
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
