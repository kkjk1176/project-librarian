import type { WikiGraph, WikiPageInput } from "./wiki-graph";
import { buildWikiGraph } from "./wiki-graph";
import { read } from "./workspace";
import { wikiMarkdownFiles } from "./wiki-files";

export interface WikiCorpus {
  files: string[];
  fileSet: Set<string>;
  graph?: WikiGraph;
  pages: WikiPageInput[];
  textByFile: Map<string, string>;
}

export function loadWikiCorpus(): WikiCorpus {
  const files = wikiMarkdownFiles();
  const pages = files.map((file) => ({ file, text: read(file) }));
  return {
    files,
    fileSet: new Set(files),
    pages,
    textByFile: new Map(pages.map((page) => [page.file, page.text] as const)),
  };
}

export function wikiCorpusGraph(corpus: WikiCorpus): WikiGraph {
  corpus.graph ??= buildWikiGraph(corpus.pages);
  return corpus.graph;
}

export function wikiCorpusText(corpus: WikiCorpus | undefined, file: string): string {
  return corpus?.textByFile.get(file) ?? read(file);
}
