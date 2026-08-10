"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prdAreaTypes = exports.protectedMetaOperatingFiles = exports.v2WritableRoots = exports.legacyLifecycleRoots = exports.wikiLayoutVersion = void 0;
exports.isLegacyLifecyclePath = isLegacyLifecyclePath;
exports.classifyWikiPath = classifyWikiPath;
exports.isCurrentTruthPath = isCurrentTruthPath;
exports.isDecisionPath = isDecisionPath;
exports.isSourcePath = isSourcePath;
exports.expectedDocumentType = expectedDocumentType;
exports.wikiRoutePriority = wikiRoutePriority;
exports.validateWikiMetadataContext = validateWikiMetadataContext;
exports.validateMigrationTarget = validateMigrationTarget;
const workspace_1 = require("./workspace");
exports.wikiLayoutVersion = "v2";
exports.legacyLifecycleRoots = ["canonical", "roadmaps", "plans", "decisions", "sources"];
exports.v2WritableRoots = ["10-services", "20-shared", "30-portfolio", "meta"];
exports.protectedMetaOperatingFiles = new Set([
    "wiki/meta/decision-policy.md",
    "wiki/meta/document-taxonomy.md",
    "wiki/meta/operating-model.md",
    "wiki/meta/wiki-ops-v1-decisions.md",
    "wiki/meta/wiki-ops-v2-decisions.md",
]);
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
        [/^wiki\/migration\//, "migration", "migration", false],
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
function validateMigrationTarget(target, registrations, options = {}) {
    const normalized = normalizedWikiPath(target);
    const errors = [];
    if (!normalized.startsWith("wiki/") || normalized.includes("../") || normalized.startsWith("/") || !normalized.endsWith(".md")) {
        return [`migration target must be a contained wiki markdown path: ${target}`];
    }
    if (isLegacyLifecyclePath(normalized))
        return [`migration target uses a legacy lifecycle root: ${target}`];
    if (normalized.startsWith("wiki/90-archive/")) {
        if (options.activeTruth)
            return [`active truth cannot target the archive: ${target}`];
        return [`migration target root is not writable: ${target}`];
    }
    const root = normalized.split("/")[1] ?? "";
    if (!exports.v2WritableRoots.includes(root))
        return [`migration target root is not writable: ${target}`];
    const classification = classifyWikiPath(normalized);
    let leafType = classification.type;
    if (root === "10-services") {
        const prdLeaf = normalized.match(/^wiki\/10-services\/([^/]+)\/prds\/((PRD-\d+)[^/]*)\/(01-discovery|02-requirements|03-design|04-delivery|05-validation|06-operations|07-metrics|08-roadmap|09-decisions|10-sources|11-plans)\/(.+\.md)$/i);
        const serviceLeaf = normalized.match(/^wiki\/10-services\/([^/]+)\/(service-overview\.md|(operations|metrics)\/(.+\.md))$/i);
        if (!prdLeaf && !serviceLeaf) {
            errors.push(`migration target must be a service or PRD leaf document in a defined v2 area: ${target}`);
        }
        if (prdLeaf)
            leafType = exports.prdAreaTypes[prdLeaf[4] ?? ""] ?? "";
        if (serviceLeaf)
            leafType = serviceLeaf[2] === "service-overview.md" ? "service-overview" : (serviceLeaf[3] ?? "").toLowerCase();
    }
    else if (root === "20-shared") {
        if (!/^wiki\/20-shared\/(?!README\.md$).+\.md$/i.test(normalized))
            errors.push(`migration target must be a shared leaf document: ${target}`);
        leafType = "shared";
    }
    else if (root === "30-portfolio") {
        if (!/^wiki\/30-portfolio\/(?!README\.md$).+\.md$/i.test(normalized))
            errors.push(`migration target must be a portfolio leaf document: ${target}`);
        leafType = "portfolio";
    }
    else if (root === "meta") {
        if (!/^wiki\/meta\/(?!README\.md$).+\.md$/i.test(normalized))
            errors.push(`migration target must be a meta leaf document: ${target}`);
        if (exports.protectedMetaOperatingFiles.has(normalized))
            errors.push(`migration target is a protected wiki operating file: ${target}`);
        leafType = "wiki-meta";
    }
    if (classification.service && !registrations.services.has(classification.service)) {
        errors.push(`migration target uses an unregistered service: ${classification.service}`);
    }
    if (classification.prdRoot && !registrations.prds.has(`${classification.service}/${classification.prdRoot}`)) {
        errors.push(`migration target uses an unregistered PRD: ${classification.service}/${classification.prdRoot}`);
    }
    if (options.documentType && leafType && leafType !== options.documentType) {
        errors.push(`migration target area/type mismatch: ${classification.area} requires ${leafType}, received ${options.documentType}`);
    }
    return errors;
}
