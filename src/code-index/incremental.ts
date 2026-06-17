export interface IndexedCodeFile {
  hash: string;
  path: string;
}

export interface CodeIndexUpdatePlan<TFile extends IndexedCodeFile> {
  addedFiles: TFile[];
  changedFiles: TFile[];
  currentByPath: Map<string, TFile>;
  deletedPaths: string[];
  reindexedFiles: TFile[];
  unchangedFiles: number;
}

export function planIndexUpdate<TFile extends IndexedCodeFile>(currentFiles: TFile[], indexedHashes: Map<string, string>): CodeIndexUpdatePlan<TFile> {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
  const deletedPaths = Array.from(indexedHashes.keys()).filter((filePath) => !currentByPath.has(filePath));
  const reindexedFiles = currentFiles.filter((file) => indexedHashes.get(file.path) !== file.hash);
  return {
    addedFiles: reindexedFiles.filter((file) => !indexedHashes.has(file.path)),
    changedFiles: reindexedFiles.filter((file) => indexedHashes.has(file.path)),
    currentByPath,
    deletedPaths,
    reindexedFiles,
    unchangedFiles: currentFiles.length - reindexedFiles.length,
  };
}
