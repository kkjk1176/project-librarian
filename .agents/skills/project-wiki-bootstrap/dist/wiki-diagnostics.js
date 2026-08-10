"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.topologyFanoutThreshold = exports.topologyHubOverloadThreshold = exports.staleReviewAgeDays = void 0;
exports.staleReviewAge = staleReviewAge;
exports.collectTopologyDiagnostics = collectTopologyDiagnostics;
const wiki_files_1 = require("./wiki-files");
const wiki_corpus_1 = require("./wiki-corpus");
const wiki_graph_1 = require("./wiki-graph");
const workspace_1 = require("./workspace");
const wiki_layout_1 = require("./wiki-layout");
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
    return (0, wiki_layout_1.isCurrentTruthPath)(file) && (0, workspace_1.metadataValue)(text, "status") === "active";
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
    const sourceLink = outgoingLinks.some((link) => (0, wiki_layout_1.isSourcePath)(link.normalizedTarget) && corpus.fileSet.has(link.normalizedTarget));
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
        || file.startsWith("wiki/00-index/")
        || file.startsWith("wiki/meta/")
        || /^wiki\/10-services\/[^/]+\/(?:README|prds\/[^/]+\/README)\.md$/.test(file)
        || /^wiki\/indexes\/(?!auto-)[^/]+\.md$/.test(file);
}
function registryRows(text, columns, header) {
    return (0, wiki_files_1.parseMarkdownTableRows)(text, columns)
        .filter((cells) => (cells[0] ?? "").trim().toLowerCase() !== header.toLowerCase());
}
function registryHub(sourceFile, cell) {
    const wikiLink = cell.match(/\[\[([^\]\n]+)\]\]/)?.[1] ?? "";
    const markdownLink = cell.match(/\[[^\]\n]+\]\(([^)\n]+)\)/)?.[1] ?? "";
    const target = wikiLink || markdownLink;
    return target ? (0, wiki_files_1.normalizeWikiLinkTarget)(sourceFile, target) : "";
}
function collectLayoutDiagnostics(corpus) {
    const diagnostics = [];
    const prdHubs = corpus.files.filter((file) => /^wiki\/10-services\/[^/]+\/prds\/PRD-\d+[^/]*\/README\.md$/i.test(file));
    const serviceHubs = corpus.files.filter((file) => /^wiki\/10-services\/[^/]+\/README\.md$/.test(file));
    const prdById = new Map();
    for (const file of corpus.files) {
        const text = (0, wiki_corpus_1.wikiCorpusText)(corpus, file);
        for (const message of (0, wiki_layout_1.validateWikiMetadataContext)(file, text)) {
            diagnostics.push({
                code: message.startsWith("type must be") ? "area-type-mismatch" : "metadata-context-mismatch",
                severity: "warn",
                file,
                message,
            });
        }
    }
    for (const file of prdHubs) {
        const classification = (0, wiki_layout_1.classifyWikiPath)(file);
        if (classification.prdId) {
            prdById.set(classification.prdId, [...(prdById.get(classification.prdId) ?? []), file]);
        }
    }
    for (const [prdId, hubs] of prdById) {
        if (hubs.length < 2)
            continue;
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
        ? registryRows((0, wiki_corpus_1.wikiCorpusText)(corpus, prdRegistryFile), 5, "PRD ID")
        : [];
    const registeredPrdHubs = new Set();
    const registryPrdIds = new Map();
    for (const row of prdRegistryRows) {
        const prdId = (row[0] ?? "").trim().toUpperCase();
        const service = (row[1] ?? "").trim();
        const hub = registryHub(prdRegistryFile, row[3] ?? "");
        if (prdId)
            registryPrdIds.set(prdId, (registryPrdIds.get(prdId) ?? 0) + 1);
        if (!hub) {
            diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: prdRegistryFile, message: `${prdId || "registry row"} has no valid PRD hub link` });
            continue;
        }
        registeredPrdHubs.add(hub);
        const layout = (0, wiki_layout_1.classifyWikiPath)(hub);
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
        if (count > 1)
            diagnostics.push({ code: "duplicate-prd-id", severity: "error", file: prdRegistryFile, message: `${prdId} appears in ${count} registry rows` });
    }
    for (const file of prdHubs) {
        if (!registeredPrdHubs.has(file))
            diagnostics.push({ code: "registry-hub-mismatch", severity: "warn", file, message: "PRD hub is not linked from wiki/00-index/prd-registry.md" });
    }
    for (const file of registeredPrdHubs) {
        if (/^wiki\/10-services\/[^/]+\/prds\//.test(file) && !corpus.fileSet.has(file))
            diagnostics.push({ code: "registry-hub-mismatch", severity: "error", file: "wiki/00-index/prd-registry.md", message: `registered PRD hub is missing: ${file}` });
    }
    const serviceMapFile = "wiki/00-index/service-map.md";
    const serviceRows = corpus.fileSet.has(serviceMapFile)
        ? registryRows((0, wiki_corpus_1.wikiCorpusText)(corpus, serviceMapFile), 4, "Service")
        : [];
    const registeredServiceHubs = new Set();
    for (const row of serviceRows) {
        const service = (row[0] ?? "").trim();
        const hub = registryHub(serviceMapFile, row[2] ?? "");
        if (!hub) {
            diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: serviceMapFile, message: `${service || "registry row"} has no valid service hub link` });
            continue;
        }
        registeredServiceHubs.add(hub);
        const layout = (0, wiki_layout_1.classifyWikiPath)(hub);
        if (layout.type !== "service-hub" || layout.service !== service) {
            diagnostics.push({ code: "registry-entry-mismatch", severity: "error", file: serviceMapFile, message: `${service || "registry row"} does not match service hub ${hub}` });
        }
        if (!corpus.fileSet.has(hub)) {
            diagnostics.push({ code: "registry-hub-mismatch", severity: "error", file: serviceMapFile, message: `registered service hub is missing: ${hub}` });
        }
    }
    for (const file of serviceHubs) {
        if (!registeredServiceHubs.has(file))
            diagnostics.push({ code: "registry-hub-mismatch", severity: "warn", file, message: "service hub is not linked from wiki/00-index/service-map.md" });
    }
    return diagnostics;
}
function collectTopologyDiagnostics(corpus) {
    const diagnostics = collectLayoutDiagnostics(corpus);
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
