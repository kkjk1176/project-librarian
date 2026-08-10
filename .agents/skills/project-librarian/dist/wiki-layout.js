"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prdAreaTypes = exports.legacyLifecycleRoots = exports.wikiLayoutVersion = void 0;
exports.isLegacyLifecyclePath = isLegacyLifecyclePath;
exports.classifyWikiPath = classifyWikiPath;
exports.isCurrentTruthPath = isCurrentTruthPath;
exports.isDecisionPath = isDecisionPath;
exports.isSourcePath = isSourcePath;
exports.expectedDocumentType = expectedDocumentType;
exports.wikiRoutePriority = wikiRoutePriority;
exports.validateWikiMetadataContext = validateWikiMetadataContext;
const workspace_1 = require("./workspace");
exports.wikiLayoutVersion = "v2";
exports.legacyLifecycleRoots = ["canonical", "roadmaps", "plans", "decisions", "sources"];
exports.prdAreaTypes = Object.freeze({
    "01-discovery": "discovery",
    "02-requirements": "requirements",
    "03-design": "design",
    "04-delivery": "delivery",
    "05-validation": "validation",
    "06-operations": "operations",
    "07-metrics": "metrics",
    "08-roadmap": "roadmap",
    "09-decisions": "decision",
    "10-sources": "source",
    "11-plans": "plan",
});
function normalizedWikiPath(file) {
    return file.replace(/\\/g, "/").replace(/^\.\//, "");
}
function isLegacyLifecyclePath(file) {
    const normalized = normalizedWikiPath(file);
    return exports.legacyLifecycleRoots.some((root) => normalized === `wiki/${root}` || normalized.startsWith(`wiki/${root}/`));
}
function classifyWikiPath(file) {
    const normalized = normalizedWikiPath(file);
    if (isLegacyLifecyclePath(normalized)) {
        const root = normalized.split("/")[1] ?? "legacy";
        return { area: root, currentTruth: root === "canonical", legacy: true, prdId: "", prdRoot: "", service: "", type: root, version: "legacy" };
    }
    const prdMatch = normalized.match(/^wiki\/10-services\/([^/]+)\/prds\/((PRD-\d+)[^/]*)\/(?:([^/]+)(?:\/|$))?/i);
    if (prdMatch) {
        const service = prdMatch[1] ?? "";
        const prdRoot = prdMatch[2] ?? "";
        const prdId = (prdMatch[3] ?? "").toUpperCase();
        const segment = prdMatch[4] ?? "README.md";
        const area = segment === "README.md"
            ? "hub"
            : segment === "09-decisions"
                ? "decisions"
                : segment === "10-sources"
                    ? "sources"
                    : segment === "11-plans"
                        ? "plans"
                        : (exports.prdAreaTypes[segment] ?? segment.replace(/\.md$/, ""));
        const type = segment === "README.md" ? "prd-hub" : (exports.prdAreaTypes[segment] ?? "prd-artifact");
        const currentTruth = !["08-roadmap", "09-decisions", "10-sources", "11-plans"].includes(segment);
        return { area, currentTruth, legacy: false, prdId, prdRoot, service, type, version: "v2" };
    }
    const serviceMatch = normalized.match(/^wiki\/10-services\/([^/]+)\/(.*)$/);
    if (serviceMatch && serviceMatch[1] !== "README.md") {
        const service = serviceMatch[1] ?? "";
        const tail = serviceMatch[2] ?? "";
        const area = tail.startsWith("operations/") ? "operations" : tail.startsWith("metrics/") ? "metrics" : tail === "README.md" ? "hub" : tail.replace(/\.md$/, "");
        const type = tail === "README.md" ? "service-hub" : tail === "service-overview.md" ? "service-overview" : area;
        return { area, currentTruth: true, legacy: false, prdId: "", prdRoot: "", service, type, version: "v2" };
    }
    const roots = [
        [/^wiki\/00-index\//, "index", "router", false],
        [/^wiki\/01-governance\//, "governance", "governance", true],
        [/^wiki\/10-services\//, "services", "service-registry", true],
        [/^wiki\/20-shared\//, "shared", "shared", true],
        [/^wiki\/30-portfolio\//, "portfolio", "portfolio", false],
        [/^wiki\/90-archive\//, "archive", "archive", false],
        [/^wiki\/meta\//, "meta", "wiki-meta", false],
        [/^wiki\/inbox\//, "inbox", "candidate", false],
        [/^wiki\/indexes\//, "indexes", "router", false],
    ];
    for (const [pattern, area, type, currentTruth] of roots) {
        if (pattern.test(normalized))
            return { area, currentTruth, legacy: false, prdId: "", prdRoot: "", service: "", type, version: "v2" };
    }
    return { area: "other", currentTruth: false, legacy: false, prdId: "", prdRoot: "", service: "", type: "other", version: "other" };
}
function isCurrentTruthPath(file) {
    return classifyWikiPath(file).currentTruth;
}
function isDecisionPath(file) {
    const classification = classifyWikiPath(file);
    return classification.area === "decisions" || classification.area === "decision";
}
function isSourcePath(file) {
    const classification = classifyWikiPath(file);
    return classification.area === "sources" || classification.area === "source";
}
function expectedDocumentType(file) {
    return classifyWikiPath(file).type;
}
function wikiRoutePriority(file, text = "") {
    const pathClass = classifyWikiPath(file);
    const status = (0, workspace_1.metadataValue)(text, "status");
    if (pathClass.version === "v2" && pathClass.type === "prd-hub")
        return 120;
    if (pathClass.version === "v2" && pathClass.currentTruth && status === "active")
        return 110;
    if (pathClass.version === "v2" && pathClass.area === "decisions")
        return 100;
    if (pathClass.version === "v2" && pathClass.area === "sources")
        return 90;
    if (pathClass.version === "v2" && pathClass.area === "plans")
        return 70;
    if (pathClass.version === "v2")
        return 60;
    if (pathClass.legacy && status === "active")
        return 35;
    if (pathClass.legacy)
        return 20;
    return 10;
}
function validateWikiMetadataContext(file, text) {
    const classification = classifyWikiPath(file);
    if (classification.version !== "v2")
        return [];
    const errors = [];
    for (const key of ["status", "updated", "scope", "type", "read_budget", "decision_ref", "review_trigger"]) {
        if (!(0, workspace_1.metadataValue)(text, key))
            errors.push(`missing ${key} metadata`);
    }
    const actualType = (0, workspace_1.metadataValue)(text, "type");
    if (classification.type && classification.type !== "other" && actualType && actualType !== classification.type) {
        errors.push(`type must be ${classification.type} for ${classification.area}`);
    }
    if (classification.service) {
        const service = (0, workspace_1.metadataValue)(text, "service");
        if (service !== classification.service)
            errors.push(`service must be ${classification.service}`);
        const owner = (0, workspace_1.metadataValue)(text, "owner");
        if (!owner || /^(none|unassigned|unknown)$/i.test(owner))
            errors.push("owner must identify the owning role or team");
    }
    if (classification.prdId) {
        const prdId = (0, workspace_1.metadataValue)(text, "prd_id").toUpperCase();
        if (prdId !== classification.prdId)
            errors.push(`prd_id must be ${classification.prdId}`);
    }
    return errors;
}
