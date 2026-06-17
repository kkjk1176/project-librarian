import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { acknowledgeSmallRepoMode, codeContextPackMode, codeContextPackTarget, codeFilesMode, codeImpactMode, codeImpactTarget, codeIndexFullMode, codeIndexIncrementalMode, codeIndexOutput, codeIndexScopes, codeIndexMode, codeParser, codeQuerySql, codeReportMode, codeReportSection, codeSearchSymbol, codeStatusMode } from "./args";
import { openDatabase as openSqliteDatabase, type SqliteDatabase, type SqliteStatement, type SqliteValue } from "./code-index-db";
import { codeEvidenceDirectory, discoverCodeFiles, fileLanguage, isJavaScriptLike, maxIndexedBytes, SMALL_REPO_FILE_THRESHOLD, smallRepoCodeIndexGate } from "./code-index-file-policy";
import { isReadOnlySql } from "./code-index-sql";
import { collectCodeEvidence } from "./code-index/evidence";
import { codeownerRules, matchedCodeownerRules, matchingWorkspace, ownershipContext, ownershipInfo, readJsonObject, workspacePackages, type MatchedCodeownerRule, type OwnershipContext, type OwnershipInfo } from "./code-index/ownership";
import { searchSymbols } from "./code-index/search";
import { abs, mkdirp, normalizePath, root } from "./workspace";

export { codeownerRules, matchedCodeownerRules, ownershipContext, ownershipInfo, searchSymbols };
export type { MatchedCodeownerRule, OwnershipContext, OwnershipInfo };

interface CodeFile {
  bytes: number;
  hash: string;
  language: string;
  lines: number;
  path: string;
  profile: string;
  text: string;
}

interface IndexStatements {
  deleteConfig: SqliteStatement;
  deleteEdge: SqliteStatement;
  deleteFile: SqliteStatement;
  deleteFileFts: SqliteStatement;
  deleteImport: SqliteStatement;
  deleteRoute: SqliteStatement;
  deleteSymbol: SqliteStatement;
  deleteSymbolFts: SqliteStatement;
  insertConfig: SqliteStatement;
  insertEdge: SqliteStatement;
  insertFile: SqliteStatement;
  insertFileFts: SqliteStatement;
  insertImport: SqliteStatement;
  insertMeta: SqliteStatement;
  insertRoute: SqliteStatement;
  insertSymbol: SqliteStatement;
  insertSymbolFts: SqliteStatement;
}

export interface CodeIndexStaleness {
  added: number;
  changed: number;
  deleted: number;
  stale: boolean;
}

interface OwnerSummary {
  bytes: number;
  codeowners: string;
  configs: number;
  file_count: number;
  imports: number;
  languages: string;
  lines: number;
  owner: string;
  owner_source: string;
  routes: number;
  symbols: number;
}

type CodeReportSection = "coverage" | "ownership" | "languages" | "parsers" | "workspaces" | "workspace-graph" | "routes" | "hotspots" | "configs" | "edges";
type CodeParserMode = "default" | "tree-sitter";
type ExtractionStrength = "structural" | "light" | "config" | "inventory";
type TreeSitterGenericLanguage = "c" | "cpp" | "csharp" | "java" | "kotlin" | "php" | "rust" | "swift";

interface CodeEvidenceModeFlags {
  codeContextPackTarget: string;
  codeFilesMode: boolean;
  codeImpactMode: boolean;
  codeIndexMode: boolean;
  codeQuerySql: string;
  codeReportMode: boolean;
  codeSearchSymbol: string;
  codeStatusMode: boolean;
}

export const codeContextPackCharCap = 4000;
export const codeContextPackTruncationNotice = "[truncated - refine the query]";

interface TreeSitterPoint {
  column: number;
  row: number;
}

interface TreeSitterNode {
  childForFieldName(name: string): TreeSitterNode | null;
  child(index: number): TreeSitterNode | null;
  childCount: number;
  namedChild(index: number): TreeSitterNode | null;
  namedChildCount: number;
  startPosition: TreeSitterPoint;
  text: string;
  type: string;
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

interface TreeSitterParser {
  parse(text: string): TreeSitterTree;
  setLanguage(language: unknown): void;
}

type TreeSitterParserConstructor = new () => TreeSitterParser;

interface ExtractionBackend {
  id: string;
  index(file: CodeFile, statements: IndexStatements): void;
  label: string;
  profile: string;
  strength: ExtractionStrength;
}

const codeIndexSchemaVersion = "3";
const httpMethods = new Set(["all", "delete", "get", "patch", "post", "put"]);
const treeSitterGrammarPackages: Record<string, string> = {
  "tree-sitter-c": "@sengac/tree-sitter-c",
  "tree-sitter-cpp": "@sengac/tree-sitter-cpp",
  "tree-sitter-csharp": "@sengac/tree-sitter-c-sharp",
  "tree-sitter-go": "@sengac/tree-sitter-go",
  "tree-sitter-java": "@sengac/tree-sitter-java",
  "tree-sitter-javascript": "@sengac/tree-sitter-javascript",
  "tree-sitter-kotlin": "@sengac/tree-sitter-kotlin",
  "tree-sitter-php": "@sengac/tree-sitter-php",
  "tree-sitter-python": "@sengac/tree-sitter-python",
  "tree-sitter-rust": "@sengac/tree-sitter-rust",
  "tree-sitter-swift": "@sengac/tree-sitter-swift",
};
const codeReportSectionAliases: Record<string, CodeReportSection> = {
  config: "configs",
  configs: "configs",
  coverage: "coverage",
  dependencies: "hotspots",
  dependency: "hotspots",
  dependency_hotspots: "hotspots",
  edge: "edges",
  edge_summary: "edges",
  edges: "edges",
  evidence: "coverage",
  evidence_coverage: "coverage",
  hotspot: "hotspots",
  hotspots: "hotspots",
  language: "languages",
  language_profile_summary: "languages",
  languages: "languages",
  ownership: "ownership",
  ownership_summary: "ownership",
  parser: "parsers",
  parser_backend_summary: "parsers",
  parser_backends: "parsers",
  parsers: "parsers",
  route: "routes",
  route_inventory: "routes",
  routes: "routes",
  workspace: "workspaces",
  workspace_graph: "workspace-graph",
  "workspace-graph": "workspace-graph",
  workspacegraph: "workspace-graph",
  monorepo: "workspace-graph",
  monorepo_graph: "workspace-graph",
  workspace_summary: "workspaces",
  workspaces: "workspaces",
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function normalizeProjectRelative(input: string, label: string): string {
  const raw = input.trim() || ".";
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    fail(`${label} must stay inside the project root: ${input}`);
  }
  return normalizePath(path.relative(rootResolved, resolved)) || ".";
}

function codeEvidenceDatabasePath(): { absolutePath: string; relativePath: string } {
  const raw = codeIndexOutput.trim() || `${codeEvidenceDirectory}/code-evidence.sqlite`;
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const evidenceRoot = path.resolve(root, codeEvidenceDirectory);
  if (absolutePath === evidenceRoot || !absolutePath.startsWith(`${evidenceRoot}${path.sep}`)) {
    fail(`--code-index-out must stay inside ${codeEvidenceDirectory}/`);
  }
  return {
    absolutePath,
    relativePath: normalizePath(path.relative(root, absolutePath)),
  };
}

function selectedCodeParserMode(): CodeParserMode {
  const requested = codeParser.trim().toLowerCase();
  if (!requested || requested === "default") return "default";
  if (requested === "tree-sitter" || requested === "treesitter") return "tree-sitter";
  fail(`invalid --code-parser: ${codeParser}; expected one of: default, tree-sitter`);
}

function treeSitterProfile(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  const language = fileLanguage(relativePath);
  if (language === "c") return "tree-sitter-c";
  if (language === "cpp") return "tree-sitter-cpp";
  if (language === "csharp") return "tree-sitter-csharp";
  if ([".js", ".jsx", ".cjs", ".mjs"].includes(extension)) return "tree-sitter-javascript";
  if ([".ts", ".mts", ".cts"].includes(extension)) return "tree-sitter-typescript";
  if (extension === ".tsx") return "tree-sitter-tsx";
  if (language === "java") return "tree-sitter-java";
  if (language === "kotlin") return "tree-sitter-kotlin";
  if (language === "php") return "tree-sitter-php";
  if (language === "python") return "tree-sitter-python";
  if (language === "go") return "tree-sitter-go";
  if (language === "rust") return "tree-sitter-rust";
  if (language === "swift") return "tree-sitter-swift";
  if (language === "config") return "config";
  return "inventory-only";
}

function extractionProfile(relativePath: string, parserMode: CodeParserMode): string {
  if (parserMode === "tree-sitter") return treeSitterProfile(relativePath);
  if (isJavaScriptLike(relativePath)) return "typescript-ast";
  if (fileLanguage(relativePath) === "python") return "python-light";
  if (fileLanguage(relativePath) === "go") return "go-light";
  if (fileLanguage(relativePath) === "config") return "config";
  return "inventory-only";
}

function readCodeFile(relativePath: string, parserMode: CodeParserMode = "default"): CodeFile {
  const text = fs.readFileSync(abs(relativePath), "utf8");
  return {
    bytes: Buffer.byteLength(text),
    hash: crypto.createHash("sha256").update(text).digest("hex"),
    language: fileLanguage(relativePath) || "config",
    lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
    path: relativePath,
    profile: extractionProfile(relativePath, parserMode),
    text,
  };
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".ts", ".mts", ".cts"].includes(extension)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function setupDatabase(database: SqliteDatabase): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      profile TEXT NOT NULL,
      kind TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE TABLE symbols (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      signature TEXT NOT NULL
    );
    CREATE TABLE imports (
      id INTEGER PRIMARY KEY,
      from_file TEXT NOT NULL,
      to_ref TEXT NOT NULL,
      imported TEXT NOT NULL,
      line INTEGER NOT NULL,
      raw TEXT NOT NULL
    );
    CREATE TABLE routes (
      id INTEGER PRIMARY KEY,
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      handler TEXT NOT NULL
    );
    CREATE TABLE configs (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      evidence TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content);
    CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature);
    CREATE INDEX idx_symbols_file ON symbols(file_path);
    CREATE INDEX idx_symbols_name ON symbols(name);
    CREATE INDEX idx_imports_from ON imports(from_file);
    CREATE INDEX idx_routes_path ON routes(route);
    CREATE INDEX idx_configs_file ON configs(file_path);
    CREATE INDEX idx_edges_source ON edges(source_kind, source);
    CREATE INDEX idx_edges_target ON edges(target_kind, target);
    CREATE INDEX idx_edges_kind ON edges(kind);
  `);
}

function createIndexStatements(database: SqliteDatabase): IndexStatements {
  return {
    deleteConfig: database.prepare("DELETE FROM configs WHERE file_path = ?"),
    deleteEdge: database.prepare("DELETE FROM edges WHERE file_path = ?"),
    deleteFile: database.prepare("DELETE FROM files WHERE path = ?"),
    deleteFileFts: database.prepare("DELETE FROM files_fts WHERE path = ?"),
    deleteImport: database.prepare("DELETE FROM imports WHERE from_file = ?"),
    deleteRoute: database.prepare("DELETE FROM routes WHERE file_path = ?"),
    deleteSymbol: database.prepare("DELETE FROM symbols WHERE file_path = ?"),
    deleteSymbolFts: database.prepare("DELETE FROM symbols_fts WHERE file_path = ?"),
    insertConfig: database.prepare("INSERT INTO configs (key, value, file_path, line) VALUES (?, ?, ?, ?)"),
    insertEdge: database.prepare("INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    insertFile: database.prepare("INSERT INTO files (path, language, profile, kind, bytes, lines, hash) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    insertFileFts: database.prepare("INSERT INTO files_fts (path, language, profile, content) VALUES (?, ?, ?, ?)"),
    insertImport: database.prepare("INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES (?, ?, ?, ?, ?)"),
    insertMeta: database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    insertRoute: database.prepare("INSERT INTO routes (method, route, file_path, line, handler) VALUES (?, ?, ?, ?, ?)"),
    insertSymbol: database.prepare("INSERT INTO symbols (name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?)"),
    insertSymbolFts: database.prepare("INSERT INTO symbols_fts (name, kind, file_path, signature) VALUES (?, ?, ?, ?)"),
  };
}

function removeIndexedFile(filePath: string, statements: IndexStatements): void {
  statements.deleteConfig.run(filePath);
  statements.deleteEdge.run(filePath);
  statements.deleteImport.run(filePath);
  statements.deleteRoute.run(filePath);
  statements.deleteSymbol.run(filePath);
  statements.deleteSymbolFts.run(filePath);
  statements.deleteFileFts.run(filePath);
  statements.deleteFile.run(filePath);
}

const treeSitterParsers = new Map<string, TreeSitterParser>();

function requireTreeSitterPackage<T>(packageName: string): T {
  try {
    return require(packageName) as T;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`--code-parser tree-sitter requires optional package ${packageName}; install project optional dependencies with npm install. Error: ${message}`);
  }
}

function treeSitterGrammarForProfile(profile: string): unknown {
  if (profile === "tree-sitter-typescript" || profile === "tree-sitter-tsx") {
    const grammars = requireTreeSitterPackage<{ tsx?: unknown; typescript?: unknown }>("@sengac/tree-sitter-typescript");
    const grammar = profile === "tree-sitter-tsx" ? grammars.tsx : grammars.typescript;
    if (!grammar) fail(`tree-sitter-typescript did not expose the expected ${profile === "tree-sitter-tsx" ? "tsx" : "typescript"} grammar`);
    return grammar;
  }
  const packageName = treeSitterGrammarPackages[profile];
  if (packageName) {
    const grammarModule = requireTreeSitterPackage<Record<string, unknown>>(packageName);
    const grammar = profile === "tree-sitter-php"
      ? grammarModule.php ?? grammarModule.php_only
      : grammarModule;
    if (!grammar) fail(`${packageName} did not expose a Tree-sitter grammar for ${profile}`);
    return grammar;
  }
  fail(`missing Tree-sitter grammar for profile: ${profile}`);
}

function treeSitterParserForProfile(profile: string): TreeSitterParser {
  const cached = treeSitterParsers.get(profile);
  if (cached) return cached;
  const Parser = requireTreeSitterPackage<TreeSitterParserConstructor>("@sengac/tree-sitter");
  const parser = new Parser();
  parser.setLanguage(treeSitterGrammarForProfile(profile));
  treeSitterParsers.set(profile, parser);
  return parser;
}

function treeSitterLine(node: TreeSitterNode): number {
  return node.startPosition.row + 1;
}

function treeSitterFieldText(node: TreeSitterNode, fieldName: string): string {
  return node.childForFieldName(fieldName)?.text ?? "";
}

function treeSitterSignature(node: TreeSitterNode): string {
  return oneLine(node.text);
}

function unquoteLiteral(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'") || (first === "`" && last === "`")) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function forEachNamedTreeSitterNode(node: TreeSitterNode, visit: (child: TreeSitterNode) => void): void {
  visit(node);
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child) forEachNamedTreeSitterNode(child, visit);
  }
}

function firstNamedChildOfType(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child?.type === type) return child;
  }
  return null;
}

function treeSitterModuleSpecifier(node: TreeSitterNode): string {
  const source = treeSitterFieldText(node, "source");
  if (source) return unquoteLiteral(source);
  const raw = node.text;
  return raw.match(/\bfrom\s*["'`]([^"'`]+)["'`]/)?.[1]
    ?? raw.match(/^\s*import\s*["'`]([^"'`]+)["'`]/)?.[1]
    ?? raw.match(/\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/)?.[1]
    ?? "";
}

function indexTreeSitterJavaScriptLike(file: CodeFile, statements: IndexStatements): void {
  const tree = treeSitterParserForProfile(file.profile).parse(file.text);

  function visit(node: TreeSitterNode, context: string): void {
    let nextContext = context;
    if (node.type === "function_declaration") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "function", file, treeSitterLine(node), treeSitterSignature(node));
      if (name) nextContext = name;
    } else if (node.type === "class_declaration") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "class", file, treeSitterLine(node), treeSitterSignature(node));
      if (name) nextContext = name;
    } else if (node.type === "method_definition" || node.type === "method_signature") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "method", file, treeSitterLine(node), treeSitterSignature(node));
      if (name) nextContext = name;
    } else if (node.type === "interface_declaration") {
      insertSymbol(statements, treeSitterFieldText(node, "name"), "interface", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "type_alias_declaration") {
      insertSymbol(statements, treeSitterFieldText(node, "name"), "type", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "enum_declaration") {
      insertSymbol(statements, treeSitterFieldText(node, "name"), "enum", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "variable_declarator") {
      const name = treeSitterFieldText(node, "name");
      const valueType = node.childForFieldName("value")?.type ?? "";
      const symbolKind = ["arrow_function", "function", "function_expression"].includes(valueType) ? "function" : "variable";
      insertSymbol(statements, name, symbolKind, file, treeSitterLine(node), treeSitterSignature(node));
      if (symbolKind === "function" && name) nextContext = name;
    } else if (node.type === "import_statement" || node.type === "export_statement") {
      const toRef = treeSitterModuleSpecifier(node);
      if (toRef) {
        const imported = node.text.match(/^\s*import\s+(.+?)\s+from\s*["'`]/)?.[1] ?? node.text.match(/^\s*export\s+(.+?)\s+from\s*["'`]/)?.[1] ?? "";
        statements.insertImport.run(file.path, toRef, oneLine(imported), treeSitterLine(node), treeSitterSignature(node));
        insertEdge(statements, node.type === "export_statement" ? "export" : "import", "file", file.path, "module", toRef, file, treeSitterLine(node), treeSitterSignature(node));
      }
    } else if (node.type === "call_expression") {
      const raw = node.text;
      const routeMatch = raw.match(/^(?:app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*([^,)]+)/);
      if (routeMatch) {
        const method = (routeMatch[1] ?? "").toUpperCase();
        const route = routeMatch[2] ?? "";
        const handler = oneLine(routeMatch[3] ?? "");
        statements.insertRoute.run(method, route, file.path, treeSitterLine(node), handler);
        insertEdge(statements, "route_to_handler", "route", `${method} ${route}`, "symbol", handler, file, treeSitterLine(node), treeSitterSignature(node));
      }
      const requireRef = treeSitterModuleSpecifier(node);
      if (requireRef) {
        statements.insertImport.run(file.path, requireRef, "", treeSitterLine(node), treeSitterSignature(node));
        insertEdge(statements, "import", "file", file.path, "module", requireRef, file, treeSitterLine(node), treeSitterSignature(node));
      } else {
        const target = treeSitterFieldText(node, "function");
        insertEdge(statements, "call", context ? "symbol" : "file", context || file.path, "symbol", target, file, treeSitterLine(node), treeSitterSignature(node));
      }
    }

    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (child) visit(child, nextContext);
    }
  }

  visit(tree.rootNode, "");
}

function indexTreeSitterPython(file: CodeFile, statements: IndexStatements): void {
  const tree = treeSitterParserForProfile(file.profile).parse(file.text);
  forEachNamedTreeSitterNode(tree.rootNode, (node) => {
    if (node.type === "function_definition") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "function", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "class_definition") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "class", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "import_statement" || node.type === "import_from_statement") {
      const raw = node.text.trim();
      const fromMatch = raw.match(/^from\s+([A-Za-z0-9_.$]+)\s+import\s+(.+)$/);
      const importMatch = raw.match(/^import\s+(.+)$/);
      const toRef = fromMatch?.[1] ?? importMatch?.[1] ?? "";
      const imported = fromMatch?.[2] ?? "";
      if (toRef) {
        statements.insertImport.run(file.path, toRef, imported.trim(), treeSitterLine(node), raw);
        insertEdge(statements, "import", "file", file.path, "module", toRef, file, treeSitterLine(node), raw);
      }
    }
  });
}

function indexTreeSitterGo(file: CodeFile, statements: IndexStatements): void {
  const tree = treeSitterParserForProfile(file.profile).parse(file.text);
  forEachNamedTreeSitterNode(tree.rootNode, (node) => {
    if (node.type === "function_declaration") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "function", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "method_declaration") {
      const name = treeSitterFieldText(node, "name");
      insertSymbol(statements, name, "method", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "type_declaration") {
      const spec = firstNamedChildOfType(node, "type_spec");
      const name = spec ? treeSitterFieldText(spec, "name") : "";
      insertSymbol(statements, name, "type", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "const_declaration" || node.type === "var_declaration") {
      const spec = firstNamedChildOfType(node, node.type === "const_declaration" ? "const_spec" : "var_spec");
      const name = spec ? treeSitterFieldText(spec, "name") : "";
      insertSymbol(statements, name, node.type === "const_declaration" ? "constant" : "variable", file, treeSitterLine(node), treeSitterSignature(node));
    } else if (node.type === "import_spec") {
      const toRef = unquoteLiteral(treeSitterFieldText(node, "path") || (node.text.match(/"([^"]+)"/)?.[1] ?? ""));
      const imported = treeSitterFieldText(node, "name");
      insertGoImport(file, statements, toRef, imported, treeSitterLine(node), treeSitterSignature(node));
    }
  });
}

function treeSitterGenericLanguage(file: CodeFile): TreeSitterGenericLanguage {
  const normalized = file.profile.replace(/^tree-sitter-/, "");
  if (["c", "cpp", "csharp", "java", "kotlin", "php", "rust", "swift"].includes(normalized)) return normalized as TreeSitterGenericLanguage;
  fail(`unsupported generic Tree-sitter profile: ${file.profile}`);
}

function symbolNameFromPatterns(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function treeSitterGenericSymbol(node: TreeSitterNode, language: TreeSitterGenericLanguage): { kind: string; name: string } | null {
  const raw = node.text;
  const fieldName = treeSitterFieldText(node, "name");
  const patterns: Partial<Record<TreeSitterGenericLanguage, Array<[string[], string, RegExp[]]>>> = {
    c: [
      [["function_definition"], "function", [/\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/]],
      [["struct_specifier"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]],
      [["enum_specifier"], "enum", [/\benum\s+([A-Za-z_]\w*)/]],
    ],
    cpp: [
      [["function_definition"], "function", [/\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/]],
      [["class_specifier"], "class", [/\bclass\s+([A-Za-z_]\w*)/, /\bstruct\s+([A-Za-z_]\w*)/]],
      [["namespace_definition"], "namespace", [/\bnamespace\s+([A-Za-z_]\w*)/]],
      [["enum_specifier"], "enum", [/\benum(?:\s+class)?\s+([A-Za-z_]\w*)/]],
    ],
    csharp: [
      [["method_declaration", "constructor_declaration"], "method", [/\b([A-Za-z_]\w*)\s*\(/]],
      [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]],
      [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]],
      [["struct_declaration"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]],
      [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]],
    ],
    java: [
      [["method_declaration", "constructor_declaration"], "method", [/\b([A-Za-z_]\w*)\s*\(/]],
      [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]],
      [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]],
      [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]],
    ],
    kotlin: [
      [["function_declaration"], "function", [/\bfun\s+([A-Za-z_]\w*)/]],
      [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/, /\binterface\s+([A-Za-z_]\w*)/]],
      [["object_declaration"], "object", [/\bobject\s+([A-Za-z_]\w*)/]],
    ],
    php: [
      [["function_definition"], "function", [/\bfunction\s+([A-Za-z_]\w*)/]],
      [["method_declaration"], "method", [/\bfunction\s+([A-Za-z_]\w*)/]],
      [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]],
      [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]],
      [["trait_declaration"], "trait", [/\btrait\s+([A-Za-z_]\w*)/]],
    ],
    rust: [
      [["function_item"], "function", [/\bfn\s+([A-Za-z_]\w*)/]],
      [["struct_item"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]],
      [["enum_item"], "enum", [/\benum\s+([A-Za-z_]\w*)/]],
      [["trait_item"], "trait", [/\btrait\s+([A-Za-z_]\w*)/]],
      [["impl_item"], "impl", [/\bimpl(?:\s*<[^>]+>)?\s+([A-Za-z_]\w*)/]],
    ],
    swift: [
      [["function_declaration"], "function", [/\bfunc\s+([A-Za-z_]\w*)/]],
      [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]],
      [["struct_declaration"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]],
      [["protocol_declaration"], "protocol", [/\bprotocol\s+([A-Za-z_]\w*)/]],
      [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]],
    ],
  };
  for (const [types, kind, regexes] of patterns[language] ?? []) {
    if (!types.includes(node.type)) continue;
    const name = fieldName || symbolNameFromPatterns(raw, regexes);
    return name ? { kind, name } : null;
  }
  return null;
}

function treeSitterGenericImport(node: TreeSitterNode, language: TreeSitterGenericLanguage): { imported: string; kind: string; toRef: string } | null {
  const raw = node.text.trim();
  const importTypes: Partial<Record<TreeSitterGenericLanguage, string[]>> = {
    c: ["preproc_include"],
    cpp: ["preproc_include", "using_declaration", "namespace_alias_definition"],
    csharp: ["using_directive"],
    java: ["import_declaration"],
    kotlin: ["import_header"],
    php: ["namespace_use_declaration"],
    rust: ["use_declaration"],
    swift: ["import_declaration"],
  };
  if (!(importTypes[language] ?? []).includes(node.type)) return null;
  const toRef = raw.match(/#include\s*[<"]([^>"]+)[>"]/)?.[1]
    ?? raw.match(/\bimport\s+([A-Za-z0-9_.*.$\\/-]+)/)?.[1]
    ?? raw.match(/\busing\s+([A-Za-z0-9_.*.$\\/-]+)/)?.[1]
    ?? raw.match(/\buse\s+([A-Za-z0-9_:{}*,\s]+);?/)?.[1]?.replace(/\s+/g, " ").trim()
    ?? "";
  return toRef ? { imported: "", kind: language === "rust" ? "use" : "import", toRef } : null;
}

function indexTreeSitterGeneric(file: CodeFile, statements: IndexStatements): void {
  const language = treeSitterGenericLanguage(file);
  const tree = treeSitterParserForProfile(file.profile).parse(file.text);
  forEachNamedTreeSitterNode(tree.rootNode, (node) => {
    const symbol = treeSitterGenericSymbol(node, language);
    if (symbol) insertSymbol(statements, symbol.name, symbol.kind, file, treeSitterLine(node), treeSitterSignature(node));
    const imported = treeSitterGenericImport(node, language);
    if (imported) {
      statements.insertImport.run(file.path, imported.toRef, imported.imported, treeSitterLine(node), treeSitterSignature(node));
      insertEdge(statements, imported.kind, "file", file.path, "module", imported.toRef, file, treeSitterLine(node), treeSitterSignature(node));
    }
  });
}

const extractionBackends: ExtractionBackend[] = [
  {
    id: "typescript-compiler",
    index: indexJavaScriptLike,
    label: "TypeScript compiler API",
    profile: "typescript-ast",
    strength: "structural",
  },
  {
    id: "regex-light",
    index: indexPythonLight,
    label: "Python lightweight regex",
    profile: "python-light",
    strength: "light",
  },
  {
    id: "regex-light",
    index: indexGoLight,
    label: "Go lightweight regex",
    profile: "go-light",
    strength: "light",
  },
  {
    id: "tree-sitter-javascript",
    index: indexTreeSitterJavaScriptLike,
    label: "Tree-sitter JavaScript grammar",
    profile: "tree-sitter-javascript",
    strength: "structural",
  },
  {
    id: "tree-sitter-typescript",
    index: indexTreeSitterJavaScriptLike,
    label: "Tree-sitter TypeScript grammar",
    profile: "tree-sitter-typescript",
    strength: "structural",
  },
  {
    id: "tree-sitter-typescript",
    index: indexTreeSitterJavaScriptLike,
    label: "Tree-sitter TSX grammar",
    profile: "tree-sitter-tsx",
    strength: "structural",
  },
  {
    id: "tree-sitter-python",
    index: indexTreeSitterPython,
    label: "Tree-sitter Python grammar",
    profile: "tree-sitter-python",
    strength: "structural",
  },
  {
    id: "tree-sitter-go",
    index: indexTreeSitterGo,
    label: "Tree-sitter Go grammar",
    profile: "tree-sitter-go",
    strength: "structural",
  },
  {
    id: "tree-sitter-c",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter C grammar",
    profile: "tree-sitter-c",
    strength: "structural",
  },
  {
    id: "tree-sitter-cpp",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter C++ grammar",
    profile: "tree-sitter-cpp",
    strength: "structural",
  },
  {
    id: "tree-sitter-csharp",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter C# grammar",
    profile: "tree-sitter-csharp",
    strength: "structural",
  },
  {
    id: "tree-sitter-java",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter Java grammar",
    profile: "tree-sitter-java",
    strength: "structural",
  },
  {
    id: "tree-sitter-kotlin",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter Kotlin grammar",
    profile: "tree-sitter-kotlin",
    strength: "structural",
  },
  {
    id: "tree-sitter-php",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter PHP grammar",
    profile: "tree-sitter-php",
    strength: "structural",
  },
  {
    id: "tree-sitter-rust",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter Rust grammar",
    profile: "tree-sitter-rust",
    strength: "structural",
  },
  {
    id: "tree-sitter-swift",
    index: indexTreeSitterGeneric,
    label: "Tree-sitter Swift grammar",
    profile: "tree-sitter-swift",
    strength: "structural",
  },
  {
    id: "config-key-value",
    index: (file, statements) => indexConfigs(file, statements.insertConfig),
    label: "Configuration key/value extractor",
    profile: "config",
    strength: "config",
  },
  {
    id: "inventory-only",
    index: () => undefined,
    label: "Inventory-only file listing",
    profile: "inventory-only",
    strength: "inventory",
  },
];

const extractionBackendsByProfile = new Map(extractionBackends.map((backend) => [backend.profile, backend] as const));

function extractionBackendForProfile(profile: string): ExtractionBackend {
  const backend = extractionBackendsByProfile.get(profile);
  if (!backend) fail(`missing extraction backend for profile: ${profile}`);
  return backend;
}

function indexCodeFile(file: CodeFile, statements: IndexStatements): void {
  statements.insertFile.run(file.path, file.language, file.profile, file.language === "config" ? "config" : "source", file.bytes, file.lines, file.hash);
  statements.insertFileFts.run(file.path, file.language, file.profile, file.text);
  extractionBackendForProfile(file.profile).index(file, statements);
}

function writeIndexMetadata(scopes: string[], parserMode: CodeParserMode, statements: IndexStatements): void {
  statements.insertMeta.run("schema_version", codeIndexSchemaVersion);
  statements.insertMeta.run("updated_at", new Date().toISOString());
  statements.insertMeta.run("root", root);
  statements.insertMeta.run("scopes", scopes.join(", "));
  statements.insertMeta.run("scopes_json", JSON.stringify(scopes));
  statements.insertMeta.run("parser_mode", parserMode);
  statements.insertMeta.run("terminology", "code evidence index");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function printRows(rows: Record<string, unknown>[]): void {
  console.log(JSON.stringify(rows, null, 2));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function tsLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isPrivateIdentifier(node)) return node.text;
  return oneLine(node.getText(sourceFile));
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined, sourceFile: ts.SourceFile): string {
  if (!name) return "";
  return nodeName(name, sourceFile);
}

function callTarget(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return oneLine(expression.getText(sourceFile));
  if (ts.isElementAccessExpression(expression)) return oneLine(expression.getText(sourceFile));
  return oneLine(expression.getText(sourceFile));
}

function insertSymbol(statements: IndexStatements, name: string, kind: string, file: CodeFile, line: number, signature: string): void {
  if (!name) return;
  statements.insertSymbol.run(name, kind, file.path, line, signature);
  statements.insertSymbolFts.run(name, kind, file.path, signature);
}

function insertEdge(statements: IndexStatements, kind: string, sourceKind: string, source: string, targetKind: string, target: string, file: CodeFile, line: number, evidence: string): void {
  if (!target) return;
  statements.insertEdge.run(kind, sourceKind, source, targetKind, target, file.path, line, evidence);
}

function importBindingText(importClause: ts.ImportClause | undefined, sourceFile: ts.SourceFile): string {
  if (!importClause) return "";
  const names: string[] = [];
  if (importClause.name) names.push(importClause.name.text);
  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) names.push(`* as ${namedBindings.name.text}`);
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) names.push(element.name.text);
  }
  return names.join(", ") || oneLine(importClause.getText(sourceFile));
}

function stringArg(node: ts.Expression | undefined): string {
  if (!node) return "";
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : "";
}

function handlerArg(node: ts.Expression | undefined, sourceFile: ts.SourceFile): string {
  if (!node) return "";
  return callTarget(node, sourceFile);
}

function routeFromCall(node: ts.CallExpression, sourceFile: ts.SourceFile): { handler: string; method: string; route: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text.toLowerCase();
  if (!httpMethods.has(method)) return null;
  const receiver = node.expression.expression;
  if (!ts.isIdentifier(receiver) || !["app", "router", "server"].includes(receiver.text)) return null;
  const route = stringArg(node.arguments[0]);
  if (!route) return null;
  return {
    handler: handlerArg(node.arguments[1], sourceFile),
    method: method.toUpperCase(),
    route,
  };
}

function routeFromDecorator(node: ts.MethodDeclaration, sourceFile: ts.SourceFile): { method: string; route: string }[] {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  const routes: { method: string; route: string }[] = [];
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    const callee = expression.expression;
    if (!ts.isIdentifier(callee)) continue;
    const method = callee.text.toLowerCase();
    if (!httpMethods.has(method)) continue;
    routes.push({ method: method.toUpperCase(), route: stringArg(expression.arguments[0]) || "/" });
  }
  return routes;
}

function signatureFor(node: ts.Node, sourceFile: ts.SourceFile): string {
  return oneLine(node.getText(sourceFile));
}

function indexJavaScriptLike(file: CodeFile, statements: IndexStatements): void {
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKindForPath(file.path));

  function visit(node: ts.Node, context: string): void {
    let nextContext = context;
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? "";
      insertSymbol(statements, name, "function", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (name) nextContext = name;
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? "";
      insertSymbol(statements, name, "class", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (name) nextContext = name;
    } else if (ts.isInterfaceDeclaration(node)) {
      insertSymbol(statements, node.name.text, "interface", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isTypeAliasDeclaration(node)) {
      insertSymbol(statements, node.name.text, "type", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isEnumDeclaration(node)) {
      insertSymbol(statements, node.name.text, "enum", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isMethodDeclaration(node)) {
      const name = propertyNameText(node.name, sourceFile);
      insertSymbol(statements, name, "method", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      for (const route of routeFromDecorator(node, sourceFile)) {
        statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), name);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", name, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
      if (name) nextContext = name;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const symbolKind = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? "function" : "variable";
      insertSymbol(statements, node.name.text, symbolKind, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      if (symbolKind === "function") nextContext = node.name.text;
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = importBindingText(node.importClause, sourceFile);
      statements.insertImport.run(file.path, node.moduleSpecifier.text, imported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      insertEdge(statements, "import", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const exported = node.exportClause ? oneLine(node.exportClause.getText(sourceFile)) : "";
      statements.insertImport.run(file.path, node.moduleSpecifier.text, exported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      insertEdge(statements, "export", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isCallExpression(node)) {
      const route = routeFromCall(node, sourceFile);
      if (route) {
        statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), route.handler);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", route.handler, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const moduleName = stringArg(node.arguments[0]);
        if (moduleName) {
          statements.insertImport.run(file.path, moduleName, "", tsLine(sourceFile, node), signatureFor(node, sourceFile));
          insertEdge(statements, "import", "file", file.path, "module", moduleName, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
      } else {
        insertEdge(statements, "call", context ? "symbol" : "file", context || file.path, "symbol", callTarget(node.expression, sourceFile), file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextContext));
  }

  visit(sourceFile, "");
}

function insertMatches(file: CodeFile, regex: RegExp, insert: (match: RegExpExecArray, line: number) => void): void {
  for (const match of file.text.matchAll(regex)) {
    insert(match, lineNumber(file.text, match.index ?? 0));
  }
}

function indexPythonLight(file: CodeFile, statements: IndexStatements): void {
  const symbolPatterns: Array<[RegExp, string, (match: RegExpExecArray) => string]> = [
    [/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => `def ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*class\s+([A-Za-z_]\w*)/gm, "class", (match) => `class ${match[1] ?? ""}`],
  ];
  for (const [regex, kind, signature] of symbolPatterns) {
    insertMatches(file, regex, (match, line) => insertSymbol(statements, match[1] ?? "", kind, file, line, signature(match)));
  }
  const importPatterns: Array<[RegExp, (match: RegExpExecArray) => [string, string]]> = [
    [/^\s*from\s+([A-Za-z0-9_.$]+)\s+import\s+(.+)$/gm, (match) => [match[1] ?? "", match[2] ?? ""]],
    [/^\s*import\s+([A-Za-z0-9_.$, \t]+)$/gm, (match) => [match[1] ?? "", ""]],
  ];
  for (const [regex, fields] of importPatterns) {
    insertMatches(file, regex, (match, line) => {
      const [toRef, imported] = fields(match);
      statements.insertImport.run(file.path, toRef, imported.trim(), line, match[0].trim());
      insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, match[0].trim());
    });
  }
}

function insertGoImport(file: CodeFile, statements: IndexStatements, toRef: string, imported: string, line: number, raw: string): void {
  if (!toRef) return;
  statements.insertImport.run(file.path, toRef, imported, line, raw);
  insertEdge(statements, "import", "file", file.path, "module", toRef, file, line, raw);
}

function indexGoLight(file: CodeFile, statements: IndexStatements): void {
  const symbolPatterns: Array<[RegExp, string, (match: RegExpExecArray) => string, (match: RegExpExecArray) => string]> = [
    [/^\s*func\s*\(\s*[^)]*\)\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "method", (match) => match[1] ?? "", (match) => `func (...) ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm, "function", (match) => match[1] ?? "", (match) => `func ${match[1] ?? ""}(${match[2] ?? ""})`],
    [/^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)?/gm, "type", (match) => match[1] ?? "", (match) => `type ${match[1] ?? ""} ${match[2] ?? ""}`.trim()],
    [/^\s*const\s+([A-Za-z_]\w*)\b/gm, "constant", (match) => match[1] ?? "", (match) => `const ${match[1] ?? ""}`],
    [/^\s*var\s+([A-Za-z_]\w*)\b/gm, "variable", (match) => match[1] ?? "", (match) => `var ${match[1] ?? ""}`],
  ];
  for (const [regex, kind, name, signature] of symbolPatterns) {
    insertMatches(file, regex, (match, line) => insertSymbol(statements, name(match), kind, file, line, signature(match)));
  }

  insertMatches(file, /^\s*import\s+(?:(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"|`([^`]+)`)/gm, (match, line) => {
    const imported = match[1] ?? "";
    const toRef = match[2] ?? match[3] ?? "";
    insertGoImport(file, statements, toRef, imported, line, match[0].trim());
  });

  insertMatches(file, /^\s*import\s*\(([\s\S]*?)^\s*\)/gm, (blockMatch) => {
    const block = blockMatch[1] ?? "";
    const blockStart = blockMatch.index ?? 0;
    for (const lineMatch of block.matchAll(/^\s*(?:([A-Za-z_]\w*|[_.])\s+)?\"([^\"]+)\"/gm)) {
      const imported = lineMatch[1] ?? "";
      const toRef = lineMatch[2] ?? "";
      const line = lineNumber(file.text, blockStart + (lineMatch.index ?? 0));
      insertGoImport(file, statements, toRef, imported, line, lineMatch[0].trim());
    }
  });
}

function indexConfigs(file: CodeFile, insertConfig: SqliteStatement): void {
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

function codeScopes(): string[] {
  const scopes = codeIndexScopes.length > 0 ? codeIndexScopes : ["."];
  return scopes.map((scope) => normalizeProjectRelative(scope, "--code-scope"));
}

function openDatabase(databasePath: string): SqliteDatabase {
  return openSqliteDatabase(databasePath, fail);
}

function requireExistingIndex(): void {
  const databasePath = codeEvidenceDatabasePath();
  if (!fs.existsSync(databasePath.absolutePath)) {
    console.error(`missing code evidence index: ${databasePath.relativePath}; run --code-index first`);
    process.exit(1);
  }
}

function readMetaValue(database: SqliteDatabase, key: string): string {
  const rows = database.prepare("SELECT value FROM meta WHERE key = ?").all(key);
  const value = rows[0]?.value;
  return typeof value === "string" ? value : "";
}

function indexedScopes(database: SqliteDatabase): string[] {
  const scopesJson = readMetaValue(database, "scopes_json");
  if (scopesJson) {
    try {
      const parsed = JSON.parse(scopesJson);
      if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) return parsed;
    } catch {
      // Fall back to the legacy comma-separated scope metadata below.
    }
  }
  return readMetaValue(database, "scopes")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function indexedParserMode(database: SqliteDatabase): CodeParserMode {
  const mode = readMetaValue(database, "parser_mode");
  return mode === "tree-sitter" ? "tree-sitter" : "default";
}

function scopesMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

function incrementalCompatibility(database: SqliteDatabase, scopes: string[], parserMode: CodeParserMode): { compatible: boolean; reason: string } {
  const existingSchemaVersion = readMetaValue(database, "schema_version");
  if (existingSchemaVersion !== codeIndexSchemaVersion) {
    return {
      compatible: false,
      reason: `existing schema version ${existingSchemaVersion || "(missing)"} does not match ${codeIndexSchemaVersion}`,
    };
  }
  const existingScopes = indexedScopes(database);
  if (!scopesMatch(existingScopes, scopes)) {
    return {
      compatible: false,
      reason: `indexed scopes do not match requested scopes: indexed [${existingScopes.join(", ")}], requested [${scopes.join(", ")}]`,
    };
  }
  const existingParserMode = indexedParserMode(database);
  if (existingParserMode !== parserMode) {
    return {
      compatible: false,
      reason: `indexed parser mode ${existingParserMode} does not match requested parser mode ${parserMode}`,
    };
  }
  return { compatible: true, reason: "" };
}

function removeDatabaseFiles(databasePath: string): void {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export function codeIndexStaleness(database: SqliteDatabase): CodeIndexStaleness {
  const scopes = indexedScopes(database);
  const parserMode = indexedParserMode(database);
  const current = new Map(discoverCodeFiles(scopes.length > 0 ? scopes : ["."]).map((file) => {
    const codeFile = readCodeFile(file, parserMode);
    return [codeFile.path, codeFile.hash] as const;
  }));
  const indexed = new Map(database.prepare("SELECT path, hash FROM files").all().map((row) => [String(row.path), String(row.hash)] as const));

  let changed = 0;
  let deleted = 0;
  for (const [filePath, hash] of indexed) {
    const currentHash = current.get(filePath);
    if (!currentHash) deleted += 1;
    else if (currentHash !== hash) changed += 1;
  }

  let added = 0;
  for (const filePath of current.keys()) {
    if (!indexed.has(filePath)) added += 1;
  }

  return {
    added,
    changed,
    deleted,
    stale: added > 0 || changed > 0 || deleted > 0,
  };
}

function warnIfCodeIndexStale(database: SqliteDatabase): void {
  const staleness = codeIndexStaleness(database);
  if (!staleness.stale) return;
  console.error(`code evidence index may be stale: ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted; rerun --code-index`);
}

type OwnerNumericField = "bytes" | "configs" | "file_count" | "imports" | "lines" | "routes" | "symbols";

function incrementOwnerField(owners: Map<string, OwnerSummary>, context: OwnershipContext, filePath: string, field: OwnerNumericField, increment = 1): void {
  const info = ownershipInfo(filePath, context);
  const key = info.owner;
  const current = owners.get(key) ?? {
    bytes: 0,
    codeowners: info.codeowners,
    configs: 0,
    file_count: 0,
    imports: 0,
    languages: "",
    lines: 0,
    owner: key,
    owner_source: info.owner_source,
    routes: 0,
    symbols: 0,
  };
  if (info.codeowners && !current.codeowners.split(", ").includes(info.codeowners)) current.codeowners = current.codeowners ? `${current.codeowners}; ${info.codeowners}` : info.codeowners;
  current[field] += increment;
  owners.set(key, current);
}

export function evidenceCoverage(database: SqliteDatabase): Record<string, number> {
  const rows = database.prepare(`
    SELECT 'files' AS table_name, count(*) AS rows FROM files
    UNION ALL SELECT 'symbols', count(*) FROM symbols
    UNION ALL SELECT 'imports', count(*) FROM imports
    UNION ALL SELECT 'routes', count(*) FROM routes
    UNION ALL SELECT 'configs', count(*) FROM configs
    UNION ALL SELECT 'edges', count(*) FROM edges
  `).all();
  return Object.fromEntries(rows.map((row) => [String(row.table_name), Number(row.rows ?? 0)]));
}

function ownershipSummary(database: SqliteDatabase): OwnerSummary[] {
  const files = database.prepare("SELECT path, language, profile, lines, bytes FROM files ORDER BY path").all();
  const context = ownershipContext();
  const owners = new Map<string, OwnerSummary>();
  const ownerLanguages = new Map<string, Set<string>>();
  for (const row of files) {
    const filePath = String(row.path);
    const key = ownershipInfo(filePath, context).owner;
    incrementOwnerField(owners, context, filePath, "file_count");
    incrementOwnerField(owners, context, filePath, "lines", Number(row.lines ?? 0));
    incrementOwnerField(owners, context, filePath, "bytes", Number(row.bytes ?? 0));
    const languages = ownerLanguages.get(key) ?? new Set<string>();
    languages.add(String(row.language));
    ownerLanguages.set(key, languages);
  }
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM symbols GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "symbols", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM routes GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "routes", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT from_file, count(*) AS count FROM imports GROUP BY from_file").all()) incrementOwnerField(owners, context, String(row.from_file), "imports", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM configs GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "configs", Number(row.count ?? 0));
  return Array.from(owners.values()).map((owner) => ({
    ...owner,
    languages: Array.from(ownerLanguages.get(String(owner.owner)) ?? []).sort().join(", "),
  })).sort((left, right) => right.file_count - left.file_count || left.owner.localeCompare(right.owner)).slice(0, 25);
}

function languageProfileSummary(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all();
}

function parserBackendSummary(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all().map((row) => {
    const profile = String(row.profile);
    const backend = extractionBackendForProfile(profile);
    return {
      language: row.language,
      profile,
      backend: backend.id,
      label: backend.label,
      extraction_strength: backend.strength,
      files: row.files,
      lines: row.lines,
      bytes: row.bytes,
    };
  });
}

export function workspaceSummary(database: SqliteDatabase): Record<string, unknown> {
  const context = ownershipContext();
  const counts = new Map<string, { bytes: number; files: number; lines: number; name: string; root: string; source: string; workspace_pattern: string }>();
  for (const workspace of context.workspaces) {
    counts.set(workspace.root, { ...workspace, bytes: 0, files: 0, lines: 0 });
  }
  for (const row of database.prepare("SELECT path, lines, bytes FROM files ORDER BY path").all()) {
    const workspace = matchingWorkspace(String(row.path), context.workspaces);
    if (!workspace) continue;
    const current = counts.get(workspace.root) ?? { ...workspace, bytes: 0, files: 0, lines: 0 };
    current.files += 1;
    current.lines += Number(row.lines ?? 0);
    current.bytes += Number(row.bytes ?? 0);
    counts.set(workspace.root, current);
  }
  return {
    workspace_packages: Array.from(counts.values()).sort((left, right) => left.root.localeCompare(right.root)),
    codeowners: context.codeownerRules.map((rule) => ({
      file_path: rule.file_path,
      line: rule.line,
      pattern: rule.pattern,
      owners: rule.owners.join(", "),
    })),
  };
}

function packageManagerFromLockfile(filePath: string): string {
  const base = path.basename(filePath);
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "npm";
  if (base === "pnpm-lock.yaml") return "pnpm";
  if (base === "yarn.lock") return "yarn";
  if (base === "bun.lockb" || base === "bun.lock") return "bun";
  return "unknown";
}

export function workspaceDependencyGraph(): Record<string, unknown> {
  const workspaces = workspacePackages();
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace] as const));
  const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]
    .filter((filePath) => fs.existsSync(abs(filePath)))
    .map((filePath) => ({ file_path: filePath, package_manager: packageManagerFromLockfile(filePath), scope: "root" }));
  const workspaceRows: Record<string, unknown>[] = [];
  const internalEdges: Record<string, unknown>[] = [];
  const externalDependencies = new Map<string, { dependency: string; dependency_type: string; workspaces: Set<string> }>();

  for (const workspace of workspaces) {
    const packageJsonPath = normalizePath(path.join(workspace.root, "package.json"));
    const packageJson = readJsonObject(packageJsonPath);
    const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    const dependencyCounts: Record<string, number> = {};
    const workspaceInternalEdges: Record<string, unknown>[] = [];
    for (const field of dependencyFields) {
      const dependencies = packageJson?.[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
      for (const [dependencyName, version] of Object.entries(dependencies as Record<string, unknown>)) {
        dependencyCounts[field] = (dependencyCounts[field] ?? 0) + 1;
        const target = byName.get(dependencyName);
        if (target) {
          const edge = {
            from_workspace: workspace.root,
            from_package: workspace.name,
            to_workspace: target.root,
            to_package: target.name,
            dependency_type: field,
            version: typeof version === "string" ? version : String(version),
          };
          internalEdges.push(edge);
          workspaceInternalEdges.push(edge);
        } else {
          const key = `${dependencyName}\0${field}`;
          const current = externalDependencies.get(key) ?? { dependency: dependencyName, dependency_type: field, workspaces: new Set<string>() };
          current.workspaces.add(workspace.root);
          externalDependencies.set(key, current);
        }
      }
    }
    for (const lockfileName of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]) {
      const lockfilePath = normalizePath(path.join(workspace.root, lockfileName));
      if (fs.existsSync(abs(lockfilePath))) {
        lockfiles.push({ file_path: lockfilePath, package_manager: packageManagerFromLockfile(lockfilePath), scope: workspace.root });
      }
    }
    workspaceRows.push({
      name: workspace.name,
      root: workspace.root,
      dependency_counts: dependencyCounts,
      internal_dependency_count: workspaceInternalEdges.length,
    });
  }

  return {
    workspace_count: workspaces.length,
    package_managers: Array.from(new Set(lockfiles.map((lockfile) => lockfile.package_manager))).sort(),
    lockfiles,
    workspaces: workspaceRows.sort((left, right) => String(left.root).localeCompare(String(right.root))),
    internal_dependencies: internalEdges.sort((left, right) => String(left.from_workspace).localeCompare(String(right.from_workspace)) || String(left.to_workspace).localeCompare(String(right.to_workspace))),
    external_dependency_hotspots: Array.from(externalDependencies.values()).map((entry) => ({
      dependency: entry.dependency,
      dependency_type: entry.dependency_type,
      workspace_count: entry.workspaces.size,
      workspaces: Array.from(entry.workspaces).sort().join(", "),
    })).sort((left, right) => right.workspace_count - left.workspace_count || left.dependency.localeCompare(right.dependency)).slice(0, 100),
  };
}

function routeInventory(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT method, route, file_path, line, handler FROM routes ORDER BY file_path, line LIMIT 100").all();
}

function dependencyHotspots(database: SqliteDatabase): Record<string, unknown> {
  return {
    imports: database.prepare("SELECT to_ref, count(DISTINCT from_file) AS importing_files, count(*) AS reference_count FROM imports GROUP BY to_ref ORDER BY importing_files DESC, reference_count DESC, to_ref LIMIT 50").all(),
    package_dependencies: database.prepare("SELECT substr(key, 12) AS package, value AS version, file_path FROM configs WHERE key LIKE 'dependency:%' ORDER BY file_path, package LIMIT 100").all(),
  };
}

function configInventory(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT key, value, file_path, line FROM configs WHERE key LIKE 'script:%' OR key LIKE 'dependency:%' OR key LIKE 'devDependency:%' ORDER BY file_path, key LIMIT 150").all();
}

function edgeSummary(database: SqliteDatabase): Record<string, unknown> {
  return {
    by_kind: database.prepare("SELECT kind, count(*) AS edges FROM edges GROUP BY kind ORDER BY edges DESC, kind").all(),
    fanout: database.prepare("SELECT source_kind, source, kind, count(DISTINCT target) AS targets, file_path FROM edges GROUP BY source_kind, source, kind, file_path ORDER BY targets DESC, source LIMIT 50").all(),
  };
}

function codeReportSectionData(database: SqliteDatabase, section: CodeReportSection): unknown {
  switch (section) {
    case "coverage":
      return evidenceCoverage(database);
    case "ownership":
      return ownershipSummary(database);
    case "languages":
      return languageProfileSummary(database);
    case "parsers":
      return parserBackendSummary(database);
    case "workspaces":
      return workspaceSummary(database);
    case "workspace-graph":
      return workspaceDependencyGraph();
    case "routes":
      return routeInventory(database);
    case "hotspots":
      return dependencyHotspots(database);
    case "configs":
      return configInventory(database);
    case "edges":
      return edgeSummary(database);
  }
}

export function codeReportMetadata(database: SqliteDatabase): Record<string, unknown> {
  const databasePath = codeEvidenceDatabasePath();
  const staleness = codeIndexStaleness(database);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    database: databasePath.relativePath,
    scopes: indexedScopes(database),
    parser_mode: indexedParserMode(database),
    stale: {
      files: staleness.added + staleness.changed + staleness.deleted,
      changed: staleness.changed,
      added: staleness.added,
      deleted: staleness.deleted,
    },
  };
}

function codeReport(database: SqliteDatabase): Record<string, unknown> {
  return {
    ...codeReportMetadata(database),
    report_sections: ["evidence_coverage", "ownership_summary", "language_profile_summary", "parser_backend_summary", "workspace_summary", "workspace_dependency_graph", "route_inventory", "dependency_hotspots", "config_inventory", "edge_summary"],
    evidence_coverage: evidenceCoverage(database),
    ownership_summary: ownershipSummary(database),
    language_profile_summary: languageProfileSummary(database),
    parser_backend_summary: parserBackendSummary(database),
    workspace_summary: workspaceSummary(database),
    workspace_dependency_graph: workspaceDependencyGraph(),
    route_inventory: routeInventory(database),
    dependency_hotspots: dependencyHotspots(database),
    config_inventory: configInventory(database),
    edge_summary: edgeSummary(database),
  };
}

function selectedCodeReportSection(): CodeReportSection | "" {
  const requested = codeReportSection.trim().toLowerCase();
  if (!requested || requested === "all" || requested === "full") return "";
  const section = codeReportSectionAliases[requested];
  if (!section) {
    const valid = ["coverage", "ownership", "languages", "parsers", "workspaces", "workspace-graph", "routes", "hotspots", "configs", "edges"].join(", ");
    fail(`invalid --code-report-section: ${codeReportSection}; expected one of: ${valid}`);
  }
  return section;
}

function codeReportForRequestedSection(database: SqliteDatabase): Record<string, unknown> {
  const section = selectedCodeReportSection();
  if (!section) return codeReport(database);
  return {
    ...codeReportMetadata(database),
    section,
    data: codeReportSectionData(database, section),
  };
}

export function codeImpact(database: SqliteDatabase, target: string): Record<string, unknown> {
  const normalized = target.trim();
  const evidence = collectCodeEvidence(database, normalized, {
    edgeLimit: 100,
    fileLimit: 25,
    includeEdgeEvidenceMatches: false,
    includeOwnerCodeowners: true,
    includeRouteEdges: true,
    importLimit: 75,
    ownerSampleLimit: 10,
    routeEdgeLimit: 100,
    routeLimit: 50,
    symbolLimit: 50,
  });
  return {
    ...codeReportMetadata(database),
    target,
    matches: {
      files: evidence.files,
      symbols: evidence.symbols,
      routes: evidence.routes,
      imports: evidence.imports,
    },
    edges: {
      outgoing: evidence.outgoingEdges,
      incoming: evidence.incomingEdges,
      routes: evidence.routeEdges,
    },
    impacted_owners: evidence.owners,
  };
}

function sampleLines<T>(items: T[], limit: number, render: (item: T) => string): string[] {
  const lines = items.slice(0, limit).map(render);
  if (items.length > limit) lines.push(`  ...+${items.length - limit} more`);
  return lines;
}

function pushBudgetedLine(lines: string[], line: string): boolean {
  const candidate = [...lines, line].join("\n");
  if (candidate.length > codeContextPackCharCap) return false;
  lines.push(line);
  return true;
}

function pushBudgetedSection<T>(lines: string[], title: string, items: T[], limit: number, render: (item: T) => string): void {
  if (items.length === 0) return;
  if (!pushBudgetedLine(lines, title)) return;
  for (const line of sampleLines(items, limit, render)) {
    if (!pushBudgetedLine(lines, line)) {
      pushBudgetedLine(lines, "  ...more omitted; refine the query");
      return;
    }
  }
}

function finalizeCodeContextPack(body: string): string {
  if (body.length <= codeContextPackCharCap) return body;
  const budget = codeContextPackCharCap - codeContextPackTruncationNotice.length - 1;
  return `${body.slice(0, budget > 0 ? budget : 0).trimEnd()}\n${codeContextPackTruncationNotice}`;
}

function codeContextScaleLine(fileCount: number): string {
  return fileCount < SMALL_REPO_FILE_THRESHOLD
    ? `scale small (${fileCount} indexed files < ${SMALL_REPO_FILE_THRESHOLD}); direct reads are usually cheaper for simple lookups`
    : `scale large (${fileCount} indexed files >= ${SMALL_REPO_FILE_THRESHOLD}); indexed traversal is useful for impact-style context`;
}

function structuralSignature(value: unknown): string {
  const signature = oneLine(String(value ?? ""));
  const bodyStart = signature.indexOf("{");
  return bodyStart >= 0 ? signature.slice(0, bodyStart).trimEnd() : signature;
}

export function codeContextPack(database: SqliteDatabase, query: string): string {
  const normalized = query.trim();
  if (!normalized) return 'Code context pack: missing query; use --code-context-pack "path-or-symbol-or-route".';
  const evidence = collectCodeEvidence(database, normalized, {
    edgeLimit: 30,
    fileLimit: 12,
    includeEdgeEvidenceMatches: true,
    includeOwnerCodeowners: false,
    includeRouteEdges: false,
    importLimit: 30,
    ownerSampleLimit: 4,
    routeEdgeLimit: 0,
    routeLimit: 20,
    symbolLimit: 20,
  });
  const staleness = codeIndexStaleness(database);
  const coverage = evidenceCoverage(database);
  const staleLabel = staleness.stale
    ? `STALE ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted`
    : "fresh";

  const lines = [
    `Code context pack "${normalized}": ${evidence.files.length} file matches, ${evidence.symbols.length} symbols, ${evidence.routes.length} routes, ${evidence.imports.length} imports, ${evidence.incomingEdges.length} incoming / ${evidence.outgoingEdges.length} outgoing edges; index ${staleLabel}; ${codeContextScaleLine(Number(coverage.files ?? 0))}.`,
    "Evidence is structural only: paths, lines, signatures, routes, imports, edges, and owners; no source snippets are included.",
  ];
  pushBudgetedSection(lines, "Files:", evidence.files, 8, (row) => `  file-match ${String(row.path)} (${String(row.language)}, ${String(row.profile)}, ${Number(row.lines ?? 0)} lines)`);
  pushBudgetedSection(lines, "Symbols:", evidence.symbols, 12, (row) => `  symbol-match ${String(row.file_path)}:${String(row.line)} ${String(row.kind)} ${String(row.name)} - ${structuralSignature(row.signature)}`);
  pushBudgetedSection(lines, "Routes:", evidence.routes, 8, (row) => `  route-match ${String(row.method)} ${String(row.route)} -> ${String(row.handler)} (${String(row.file_path)}:${String(row.line)})`);
  pushBudgetedSection(lines, "Imports:", evidence.imports, 8, (row) => `  import-match ${String(row.from_file)}:${String(row.line)} -> ${String(row.to_ref)}${row.imported ? ` (${String(row.imported)})` : ""}`);
  pushBudgetedSection(lines, "Incoming edges:", evidence.incomingEdges, 8, (row) => `  edge-in ${String(row.kind)} ${String(row.source)} -> ${String(row.target)} (${String(row.file_path)}:${String(row.line)})`);
  pushBudgetedSection(lines, "Outgoing edges:", evidence.outgoingEdges, 8, (row) => `  edge-out ${String(row.kind)} ${String(row.source)} -> ${String(row.target)} (${String(row.file_path)}:${String(row.line)})`);
  pushBudgetedSection(lines, "Owners:", evidence.owners, 6, (row) => `  owner ${row.owner} (${row.owner_source}, ${row.files} files): ${row.sample_files.join(", ")}`);
  return finalizeCodeContextPack(lines.join("\n"));
}

export type CodeIndexSnapshotRow = Record<string, SqliteValue>;

export interface CodeIndexSnapshot {
  configs: CodeIndexSnapshotRow[];
  edges: CodeIndexSnapshotRow[];
  files: CodeIndexSnapshotRow[];
  imports: CodeIndexSnapshotRow[];
  routes: CodeIndexSnapshotRow[];
  symbols: CodeIndexSnapshotRow[];
}

function snapshotRows(database: SqliteDatabase, sql: string): CodeIndexSnapshotRow[] {
  return database.prepare(sql).all().map((row) => {
    const normalized: CodeIndexSnapshotRow = {};
    for (const key of Object.keys(row).sort()) {
      const value = row[key];
      normalized[key] = typeof value === "string" || typeof value === "number" || value === null ? value : String(value);
    }
    return normalized;
  });
}

export function codeIndexSnapshot(database: SqliteDatabase): CodeIndexSnapshot {
  return {
    configs: snapshotRows(database, "SELECT file_path, line, key, value FROM configs ORDER BY file_path, line, key, value"),
    edges: snapshotRows(database, "SELECT file_path, line, kind, source_kind, source, target_kind, target, evidence FROM edges ORDER BY file_path, line, kind, source, target, evidence"),
    files: snapshotRows(database, "SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path"),
    imports: snapshotRows(database, "SELECT from_file, line, to_ref, imported, raw FROM imports ORDER BY from_file, line, to_ref, imported, raw"),
    routes: snapshotRows(database, "SELECT file_path, line, method, route, handler FROM routes ORDER BY file_path, line, method, route, handler"),
    symbols: snapshotRows(database, "SELECT file_path, line, kind, name, signature FROM symbols ORDER BY file_path, line, kind, name, signature"),
  };
}

// Error thrown when the code-evidence index is missing or schema-incompatible.
// The MCP server catches this to return an isError tool result (tools/list still
// works); CLI modes keep their own process.exit path via requireExistingIndex.
export class CodeEvidenceIndexUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeEvidenceIndexUnavailableError";
  }
}

// Open the existing .project-wiki code-evidence index READ-ONLY for serving:
// validates existence and schema version, then pins PRAGMA query_only = ON. Uses
// the same path resolution and schema constant as the indexer so the server and
// the writer share one contract. Throws CodeEvidenceIndexUnavailableError (never
// exits) so the MCP server can answer with guidance to run --code-index.
export function openCodeEvidenceDatabaseForServing(): { database: SqliteDatabase; relativePath: string } {
  const databasePath = codeEvidenceDatabasePath();
  if (!fs.existsSync(databasePath.absolutePath)) {
    throw new CodeEvidenceIndexUnavailableError(`missing code evidence index: ${databasePath.relativePath}; run \`project-librarian --code-index\` first`);
  }
  const database = openDatabase(databasePath.absolutePath);
  let schemaVersion = "";
  try {
    schemaVersion = readMetaValue(database, "schema_version");
  } catch (error: unknown) {
    database.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new CodeEvidenceIndexUnavailableError(`code evidence index at ${databasePath.relativePath} is not readable; rebuild with \`project-librarian --code-index\`. Error: ${message}`);
  }
  if (schemaVersion !== codeIndexSchemaVersion) {
    database.close();
    throw new CodeEvidenceIndexUnavailableError(`code evidence index schema version ${schemaVersion || "(missing)"} is incompatible with ${codeIndexSchemaVersion}; rebuild with \`project-librarian --code-index\``);
  }
  database.exec("PRAGMA query_only = ON");
  return { database, relativePath: databasePath.relativePath };
}

function prepareOutputPath(): void {
  const databasePath = codeEvidenceDatabasePath();
  mkdirp(path.dirname(databasePath.relativePath));
  mkdirp(codeEvidenceDirectory);
  fs.writeFileSync(abs(`${codeEvidenceDirectory}/.gitignore`), "*\n!.gitignore\n");
}

export function runCodeIndexMode(): void {
  const databasePath = codeEvidenceDatabasePath();
  const scopes = codeScopes();
  const parserMode = selectedCodeParserMode();
  // Scale gate before ANY write or database work: below the measured threshold
  // the build halts with the evidence-citing warning unless --acknowledge-small-repo
  // was passed (2026-06-12 scale-aware guidance decision).
  const discoveredFiles = discoverCodeFiles(scopes);
  const scaleGate = smallRepoCodeIndexGate(discoveredFiles.length, acknowledgeSmallRepoMode);
  if (!scaleGate.proceed) fail(scaleGate.warning);
  const existingIndex = fs.existsSync(databasePath.absolutePath);
  if (codeIndexIncrementalMode && !existingIndex) {
    fail(`--incremental requires an existing compatible code evidence index: ${databasePath.relativePath}`);
  }
  let incremental = false;
  if (existingIndex && !codeIndexFullMode) {
    let compatibility = { compatible: false, reason: "compatibility was not checked" };
    const existingDatabase = openDatabase(databasePath.absolutePath);
    try {
      compatibility = incrementalCompatibility(existingDatabase, scopes, parserMode);
    } finally {
      existingDatabase.close();
    }
    incremental = !codeIndexFullMode && compatibility.compatible;
    if (codeIndexIncrementalMode && !compatibility.compatible) fail(`--incremental cannot update ${databasePath.relativePath}: ${compatibility.reason}`);
  }
  prepareOutputPath();
  if (!incremental) removeDatabaseFiles(databasePath.absolutePath);
  const database = openDatabase(databasePath.absolutePath);
  try {
    if (!incremental) setupDatabase(database);
    const statements = createIndexStatements(database);
    const currentFiles = discoveredFiles.map((filePath) => readCodeFile(filePath, parserMode));
    const currentByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
    const indexed = incremental ? new Map(database.prepare("SELECT path, hash FROM files").all().map((row) => [String(row.path), String(row.hash)] as const)) : new Map<string, string>();
    const deletedPaths = incremental ? Array.from(indexed.keys()).filter((filePath) => !currentByPath.has(filePath)) : [];
    const reindexedFiles = incremental
      ? currentFiles.filter((file) => indexed.get(file.path) !== file.hash)
      : currentFiles;
    const unchangedFiles = incremental ? currentFiles.length - reindexedFiles.length : 0;

    database.exec("BEGIN");
    if (!incremental) statements.insertMeta.run("created_at", new Date().toISOString());
    writeIndexMetadata(scopes, parserMode, statements);
    for (const filePath of deletedPaths) removeIndexedFile(filePath, statements);
    for (const file of reindexedFiles) {
      if (incremental && indexed.has(file.path)) removeIndexedFile(file.path, statements);
      indexCodeFile(file, statements);
    }
    database.exec("COMMIT");
    console.log("Project wiki code evidence index complete.");
    console.log(`database: ${databasePath.relativePath}`);
    console.log(`mode: ${incremental ? "incremental" : "full"}`);
    console.log(`parser_mode: ${parserMode}`);
    console.log(`scopes: ${scopes.join(", ")}`);
    console.log(`files: ${currentFiles.length}`);
    console.log(`reindexed_files: ${reindexedFiles.length}`);
    console.log(`deleted_files: ${deletedPaths.length}`);
    console.log(`unchanged_files: ${unchangedFiles}`);
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after setup errors.
    }
    throw error;
  } finally {
    database.close();
  }
}

export function runCodeQueryMode(): void {
  if (!codeQuerySql.trim()) {
    console.error("missing SQL: use --code-query \"select ...\"");
    process.exit(1);
  }
  requireExistingIndex();
  if (!isReadOnlySql(codeQuerySql)) {
    console.error("code queries must be read-only SQL starting with SELECT or WITH");
    process.exit(1);
  }
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    database.exec("PRAGMA query_only = ON");
    warnIfCodeIndexStale(database);
    printRows(database.prepare(codeQuerySql).all());
  } finally {
    database.close();
  }
}

export function runCodeReportMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printJson(codeReportForRequestedSection(database));
  } finally {
    database.close();
  }
}

export function runCodeStatusMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    const rows = database.prepare(`
      SELECT 'files' AS metric, count(*) AS value FROM files
      UNION ALL SELECT 'symbols', count(*) FROM symbols
      UNION ALL SELECT 'imports', count(*) FROM imports
      UNION ALL SELECT 'routes', count(*) FROM routes
      UNION ALL SELECT 'edges', count(*) FROM edges
      UNION ALL SELECT 'configs', count(*) FROM configs
    `).all();
    const staleness = codeIndexStaleness(database);
    rows.push(
      { metric: "stale_files", value: staleness.added + staleness.changed + staleness.deleted },
      { metric: "stale_changed_files", value: staleness.changed },
      { metric: "stale_added_files", value: staleness.added },
      { metric: "stale_deleted_files", value: staleness.deleted },
    );
    printRows(rows);
  } finally {
    database.close();
  }
}

export function runCodeFilesMode(): void {
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printRows(database.prepare("SELECT path, language, profile, kind, lines, bytes FROM files ORDER BY path").all());
  } finally {
    database.close();
  }
}

export function runCodeImpactMode(): void {
  if (!codeImpactTarget.trim()) {
    console.error("missing impact target: use --code-impact \"path-or-symbol-or-module\"");
    process.exit(1);
  }
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printJson(codeImpact(database, codeImpactTarget.trim()));
  } finally {
    database.close();
  }
}

export function runCodeContextPackMode(): void {
  if (!codeContextPackTarget.trim()) {
    console.error("missing context pack query: use --code-context-pack \"path-or-symbol-or-route\"");
    process.exit(1);
  }
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    console.log(codeContextPack(database, codeContextPackTarget.trim()));
  } finally {
    database.close();
  }
}

export function runCodeSearchSymbolMode(): void {
  if (!codeSearchSymbol.trim()) {
    console.error("missing symbol search term: use --code-search-symbol \"term\"");
    process.exit(1);
  }
  requireExistingIndex();
  const database = openDatabase(codeEvidenceDatabasePath().absolutePath);
  try {
    warnIfCodeIndexStale(database);
    printRows(searchSymbols(database, codeSearchSymbol.trim()));
  } finally {
    database.close();
  }
}

export function isCodeEvidenceMode(): boolean {
  return isCodeEvidenceModeFor({ codeContextPackTarget, codeFilesMode, codeImpactMode, codeIndexMode, codeQuerySql, codeReportMode, codeSearchSymbol, codeStatusMode });
}

export function isCodeEvidenceModeFor(flags: CodeEvidenceModeFlags): boolean {
  return Boolean(flags.codeContextPackTarget)
    || flags.codeIndexMode
    || Boolean(flags.codeQuerySql)
    || flags.codeReportMode
    || flags.codeStatusMode
    || flags.codeFilesMode
    || flags.codeImpactMode
    || Boolean(flags.codeSearchSymbol);
}
