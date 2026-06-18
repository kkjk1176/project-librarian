import { docsSearchIndex } from "../src/search";
import { docsManifest } from "../src/manifest";

export function buildDocsIndex() {
  return {
    manifest: docsManifest(),
    index: docsSearchIndex(),
  };
}
