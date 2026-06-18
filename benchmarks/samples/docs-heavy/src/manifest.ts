import searchConfig from "../config/search.json";

export function docsManifest() {
  return {
    sectionCount: searchConfig.sources.length,
    defaultRoute: "/docs/architecture",
  };
}
