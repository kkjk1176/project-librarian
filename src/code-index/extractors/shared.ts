import type { IndexStatements } from "../schema";
import type { CodeFile } from "./types";

export function oneLine(text: string): string {
  let output = "";
  let pendingSpace = false;
  for (let index = 0; index < text.length && output.length < 240; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32) {
      if (output.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      output += " ";
      pendingSpace = false;
      if (output.length >= 240) break;
    }
    output += text[index];
  }
  return output;
}

export function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

export function insertSymbol(statements: IndexStatements, name: string, kind: string, file: CodeFile, line: number, signature: string): void {
  if (!name) return;
  statements.insertSymbol.run(name, kind, file.path, line, signature);
  statements.insertSymbolFts.run(name, kind, file.path, signature);
}

export function insertEdge(statements: IndexStatements, kind: string, sourceKind: string, source: string, targetKind: string, target: string, file: CodeFile, line: number, evidence: string): void {
  if (!target) return;
  statements.insertEdge.run(kind, sourceKind, source, targetKind, target, file.path, line, evidence);
}

export function insertMatches(file: CodeFile, regex: RegExp, insert: (match: RegExpExecArray, line: number) => void): void {
  for (const match of file.text.matchAll(regex)) {
    insert(match, lineNumber(file.text, match.index ?? 0));
  }
}

export function insertGoImport(file: CodeFile, statements: IndexStatements, toRef: string, imported: string, line: number, raw: string): void {
  if (!toRef) return;
  statements.insertImport.run(file.path, toRef, imported, line, raw);
  insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, raw);
}
