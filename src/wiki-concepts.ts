import { compactSummary, firstTldrBullet, wikiMarkdownFiles, wikiTitleForFile } from "./wiki-files";
import { metadataValue, read } from "./workspace";

export interface WikiConcept {
  budget: string;
  conceptId: string;
  description: string;
  file: string;
  reviewTrigger: string;
  scope: string;
  status: string;
  timestamp: string;
  title: string;
  type: string;
}

export function conceptIdForFile(file: string): string {
  return file.replace(/^wiki\//, "").replace(/\.(md|mdx)$/i, "");
}

export function wikiConceptType(file: string, scope: string): string {
  if (scope === "startup-router" || file === "wiki/startup.md") return "Startup Router";
  if (scope === "wiki-router" || file === "wiki/index.md" || /^wiki\/indexes\//.test(file)) return "Wiki Router";
  if (scope === "project-canonical" || /^wiki\/canonical\//.test(file)) return "Project Canonical Concept";
  if (scope === "project-decisions" || /^wiki\/decisions\//.test(file)) return "Project Decision";
  if (scope === "source-summary" || /^wiki\/sources\//.test(file)) return "Source Summary";
  if (scope === "wiki-meta" || /^wiki\/meta\//.test(file)) return "Wiki Operations Concept";
  if (/^migration-/.test(scope) || /^wiki\/migration\//.test(file)) return "Migration Ledger";
  if (scope === "inbox" || /^wiki\/inbox\//.test(file)) return "Project Candidate";
  return "Wiki Concept";
}

export function conceptFromPage(file: string, text: string): WikiConcept {
  const scope = metadataValue(text, "scope") || "-";
  const tldr = firstTldrBullet(text);
  return {
    budget: metadataValue(text, "read_budget") || "-",
    conceptId: conceptIdForFile(file),
    description: tldr || compactSummary(text),
    file,
    reviewTrigger: metadataValue(text, "review_trigger"),
    scope,
    status: metadataValue(text, "status") || "-",
    timestamp: metadataValue(text, "updated"),
    title: wikiTitleForFile(file, text),
    type: wikiConceptType(file, scope),
  };
}

export function readWikiConcepts(files: string[] = wikiMarkdownFiles()): WikiConcept[] {
  return files.map((file) => conceptFromPage(file, read(file)));
}
