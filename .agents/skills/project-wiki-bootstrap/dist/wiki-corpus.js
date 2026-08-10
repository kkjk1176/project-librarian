"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWikiCorpus = loadWikiCorpus;
exports.wikiCorpusGraph = wikiCorpusGraph;
exports.wikiCorpusText = wikiCorpusText;
const wiki_graph_1 = require("./wiki-graph");
const workspace_1 = require("./workspace");
const wiki_files_1 = require("./wiki-files");
function loadWikiCorpus() {
    const files = (0, wiki_files_1.wikiMarkdownFiles)();
    const pages = files.map((file) => ({ file, text: (0, workspace_1.read)(file) }));
    return {
        files,
        fileSet: new Set(files),
        pages,
        textByFile: new Map(pages.map((page) => [page.file, page.text])),
    };
}
function wikiCorpusGraph(corpus) {
    corpus.graph ??= (0, wiki_graph_1.buildWikiGraph)(corpus.pages);
    return corpus.graph;
}
function wikiCorpusText(corpus, file) {
    return corpus?.textByFile.get(file) ?? (0, workspace_1.read)(file);
}
