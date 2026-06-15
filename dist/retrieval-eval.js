"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRetrievalMetrics = computeRetrievalMetrics;
function bytesOf(text) {
    return Buffer.byteLength(text, "utf8");
}
function finiteNonNegativeInteger(value, fallback) {
    if (value === undefined || !Number.isFinite(value) || value < 0)
        return fallback;
    return Math.floor(value);
}
function itemKeys(item) {
    return new Set([item.id, item.sourceId ?? "", item.blockId ?? ""].filter(Boolean));
}
function itemMatches(item, expectedId) {
    return itemKeys(item).has(expectedId);
}
function ratio(numerator, denominator, emptyValue) {
    if (denominator === 0)
        return emptyValue;
    return numerator / denominator;
}
function uniqueNonEmptyStrings(values) {
    return [...new Set((values ?? []).filter((value) => value.length > 0))];
}
function answerCorrect(outputText, terms) {
    const requiredTerms = uniqueNonEmptyStrings(terms);
    if (requiredTerms.length === 0)
        return null;
    const lowered = outputText.toLowerCase();
    return requiredTerms.every((term) => lowered.includes(term.toLowerCase()));
}
function computeRetrievalMetrics(results, expectation, options = {}) {
    const topK = finiteNonNegativeInteger(options.topK, results.length);
    const considered = results.slice(0, topK);
    const requiredSourceIds = uniqueNonEmptyStrings(expectation.requiredSourceIds);
    const relevantSourceIds = expectation.relevantSourceIds === undefined
        ? requiredSourceIds
        : uniqueNonEmptyStrings(expectation.relevantSourceIds);
    const requiredHits = requiredSourceIds.filter((sourceId) => considered.some((item) => itemMatches(item, sourceId))).length;
    const relevantHits = relevantSourceIds.length === 0
        ? 0
        : considered.filter((item) => relevantSourceIds.some((sourceId) => itemMatches(item, sourceId))).length;
    const intactBlocks = considered.filter((item) => item.blockIntact !== false).length;
    const maxHop = considered.reduce((currentMax, item) => Math.max(currentMax, finiteNonNegativeInteger(item.hop, 0)), 0);
    const outputText = options.outputText ?? considered.map((item) => item.text ?? "").join("\n");
    const computedScanBytes = considered.reduce((sum, item) => {
        if (item.bytes !== undefined && Number.isFinite(item.bytes) && item.bytes >= 0)
            return sum + Math.floor(item.bytes);
        return sum + bytesOf(item.text ?? "");
    }, 0);
    const scanBytes = options.scanBytes === undefined
        ? computedScanBytes
        : finiteNonNegativeInteger(options.scanBytes, 0);
    return {
        answer_correct: answerCorrect(outputText, expectation.requiredAnswerTerms),
        block_integrity: ratio(intactBlocks, considered.length, 1),
        considered_results: considered.length,
        evidence_precision: ratio(relevantHits, considered.length, 0),
        max_hop_count: maxHop,
        output_bytes: bytesOf(outputText),
        required_source_count: requiredSourceIds.length,
        required_source_hits: requiredHits,
        scan_bytes: scanBytes,
        source_hit_rate: ratio(requiredHits, requiredSourceIds.length, 1),
        top_k: topK,
    };
}
