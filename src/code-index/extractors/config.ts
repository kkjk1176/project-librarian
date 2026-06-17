import * as path from "node:path";
import type { SqliteStatement } from "../../code-index-db";
import { insertMatches } from "./shared";
import type { CodeFile } from "./types";

export function indexConfigs(file: CodeFile, insertConfig: SqliteStatement): void {
  if (path.basename(file.path) === "package.json") {
    try {
      const parsed = JSON.parse(file.text) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, value] of Object.entries(parsed.scripts ?? {})) insertConfig.run(`script:${name}`, value, file.path, 1);
      for (const [name, value] of Object.entries(parsed.dependencies ?? {})) insertConfig.run(`dependency:${name}`, value, file.path, 1);
      for (const [name, value] of Object.entries(parsed.devDependencies ?? {})) insertConfig.run(`devDependency:${name}`, value, file.path, 1);
    } catch {
      insertConfig.run("parse-error", "package.json is not valid JSON", file.path, 1);
    }
    return;
  }
  insertMatches(file, /^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/gm, (match, line) => {
    insertConfig.run(match[1] ?? "", (match[2] ?? "").trim(), file.path, line);
  });
}
