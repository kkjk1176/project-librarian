"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexPythonLight = indexPythonLight;
exports.indexGoLight = indexGoLight;
const shared_1 = require("./shared");
function indexPythonLight(file, statements) {
    const symbolPatterns = [
        [/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => `def ${match[1] ?? ""}(${match[2] ?? ""})`],
        [/^\s*class\s+([A-Za-z_]\w*)/gm, "class", (match) => `class ${match[1] ?? ""}`],
    ];
    for (const [regex, kind, signature] of symbolPatterns) {
        (0, shared_1.insertMatches)(file, regex, (match, line) => (0, shared_1.insertSymbol)(statements, match[1] ?? "", kind, file, line, signature(match)));
    }
    const importPatterns = [
        [/^\s*from\s+([A-Za-z0-9_.$]+)\s+import\s+(.+)$/gm, (match) => [match[1] ?? "", match[2] ?? ""]],
        [/^\s*import\s+([A-Za-z0-9_.$, \t]+)$/gm, (match) => [match[1] ?? "", ""]],
    ];
    for (const [regex, fields] of importPatterns) {
        (0, shared_1.insertMatches)(file, regex, (match, line) => {
            const [toRef, imported] = fields(match);
            statements.insertImport.run(file.path, toRef, imported.trim(), line, match[0].trim());
            (0, shared_1.insertEdge)(statements, "import", "file", file.path, "module", toRef, file, line, match[0].trim());
        });
    }
}
function indexGoLight(file, statements) {
    const symbolPatterns = [
        [/^\s*func\s*\(\s*[^)]*\)\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "method", (match) => match[1] ?? "", (match) => `func (...) ${match[1] ?? ""}(${match[2] ?? ""})`],
        [/^\s*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => match[1] ?? "", (match) => `func ${match[1] ?? ""}(${match[2] ?? ""})`],
        [/^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)?/gm, "type", (match) => match[1] ?? "", (match) => `type ${match[1] ?? ""} ${match[2] ?? ""}`.trim()],
        [/^\s*const\s+([A-Za-z_]\w*)\b/gm, "constant", (match) => match[1] ?? "", (match) => `const ${match[1] ?? ""}`],
        [/^\s*var\s+([A-Za-z_]\w*)\b/gm, "variable", (match) => match[1] ?? "", (match) => `var ${match[1] ?? ""}`],
    ];
    for (const [regex, kind, name, signature] of symbolPatterns) {
        (0, shared_1.insertMatches)(file, regex, (match, line) => (0, shared_1.insertSymbol)(statements, name(match), kind, file, line, signature(match)));
    }
    (0, shared_1.insertMatches)(file, /^\s*import\s+(?:(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"|`([^`]+)`)/gm, (match, line) => {
        const imported = match[1] ?? "";
        const toRef = match[2] ?? match[3] ?? "";
        (0, shared_1.insertGoImport)(file, statements, toRef, imported, line, match[0].trim());
    });
    (0, shared_1.insertMatches)(file, /^\s*import\s*\(([\s\S]*?)^\s*\)/gm, (blockMatch) => {
        const block = blockMatch[1] ?? "";
        const blockStart = blockMatch.index ?? 0;
        for (const lineMatch of block.matchAll(/^\s*(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"/gm)) {
            const imported = lineMatch[1] ?? "";
            const toRef = lineMatch[2] ?? "";
            const line = (0, shared_1.lineNumber)(file.text, blockStart + (lineMatch.index ?? 0));
            (0, shared_1.insertGoImport)(file, statements, toRef, imported, line, lineMatch[0].trim());
        }
    });
}
