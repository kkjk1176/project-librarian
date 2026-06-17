"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.oneLine = oneLine;
exports.lineNumber = lineNumber;
exports.insertSymbol = insertSymbol;
exports.insertEdge = insertEdge;
exports.insertMatches = insertMatches;
exports.insertGoImport = insertGoImport;
function oneLine(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 240);
}
function lineNumber(text, index) {
    return text.slice(0, index).split(/\r?\n/).length;
}
function insertSymbol(statements, name, kind, file, line, signature) {
    if (!name)
        return;
    statements.insertSymbol.run(name, kind, file.path, line, signature);
    statements.insertSymbolFts.run(name, kind, file.path, signature);
}
function insertEdge(statements, kind, sourceKind, source, targetKind, target, file, line, evidence) {
    if (!target)
        return;
    statements.insertEdge.run(kind, sourceKind, source, targetKind, target, file.path, line, evidence);
}
function insertMatches(file, regex, insert) {
    for (const match of file.text.matchAll(regex)) {
        insert(match, lineNumber(file.text, match.index ?? 0));
    }
}
function insertGoImport(file, statements, toRef, imported, line, raw) {
    if (!toRef)
        return;
    statements.insertImport.run(file.path, toRef, imported, line, raw);
    insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, raw);
}
