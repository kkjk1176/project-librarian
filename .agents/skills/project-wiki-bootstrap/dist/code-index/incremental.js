"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planIndexUpdate = planIndexUpdate;
function planIndexUpdate(currentFiles, indexedHashes) {
    const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
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
