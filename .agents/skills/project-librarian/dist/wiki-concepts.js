"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conceptIdForFile = conceptIdForFile;
exports.wikiConceptType = wikiConceptType;
exports.conceptFromPage = conceptFromPage;
exports.readWikiConcepts = readWikiConcepts;
const wiki_files_1 = require("./wiki-files");
const workspace_1 = require("./workspace");
function conceptIdForFile(file) {
    return file.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "");
}
function wikiConceptType(file, scope) {
    if (scope === "startup-router" || file === "wiki/startup.md")
        return "Startup Router";
    if (scope === "wiki-router" || file === "wiki/index.md" || /^wiki\/indexes\//.test(file))
        return "Wiki Router";
    if (scope === "project-canonical" || /^wiki\/canonical\//.test(file))
        return "Project Canonical Concept";
    if (scope === "project-decisions" || /^wiki\/decisions\//.test(file))
        return "Project Decision";
    if (scope === "source-summary" || /^wiki\/sources\//.test(file))
        return "Source Summary";
    if (scope === "wiki-meta" || /^wiki\/meta\//.test(file))
        return "Wiki Operations Concept";
    if (/^migration-/.test(scope) || /^wiki\/migration\//.test(file))
        return "Migration Ledger";
    if (scope === "inbox" || /^wiki\/inbox\//.test(file))
        return "Project Candidate";
    return "Wiki Concept";
}
function conceptFromPage(file, text) {
    const scope = (0, workspace_1.metadataValue)(text, "scope") || "-";
    const tldr = (0, wiki_files_1.firstTldrBullet)(text);
    return {
        budget: (0, workspace_1.metadataValue)(text, "read_budget") || "-",
        conceptId: conceptIdForFile(file),
        description: tldr || (0, wiki_files_1.compactSummary)(text),
        file,
        reviewTrigger: (0, workspace_1.metadataValue)(text, "review_trigger"),
        scope,
        status: (0, workspace_1.metadataValue)(text, "status") || "-",
        timestamp: (0, workspace_1.metadataValue)(text, "updated"),
        title: (0, wiki_files_1.wikiTitleForFile)(file, text),
        type: wikiConceptType(file, scope),
    };
}
function readWikiConcepts(files = (0, wiki_files_1.wikiMarkdownFiles)()) {
    return files.map((file) => conceptFromPage(file, (0, workspace_1.read)(file)));
}
