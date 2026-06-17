import type { IndexStatements } from "../schema";
import { insertEdge, insertGoImport, insertSymbol, oneLine } from "./shared";
import type { CodeFile, ExtractionBackend } from "./types";

type TreeSitterGenericLanguage = "c" | "cpp" | "csharp" | "java" | "kotlin" | "php" | "rust" | "swift";
type Fail = (message: string) => never;

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

function createTreeSitterParserResolver(fail: Fail): (profile: string) => TreeSitterParser {
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

  return (profile: string): TreeSitterParser => {
    const cached = treeSitterParsers.get(profile);
    if (cached) return cached;
    const Parser = requireTreeSitterPackage<TreeSitterParserConstructor>("@sengac/tree-sitter");
    const parser = new Parser();
    parser.setLanguage(treeSitterGrammarForProfile(profile));
    treeSitterParsers.set(profile, parser);
    return parser;
  };
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

function indexTreeSitterJavaScriptLike(file: CodeFile, statements: IndexStatements, parserForProfile: (profile: string) => TreeSitterParser): void {
  const tree = parserForProfile(file.profile).parse(file.text);

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

function indexTreeSitterPython(file: CodeFile, statements: IndexStatements, parserForProfile: (profile: string) => TreeSitterParser): void {
  const tree = parserForProfile(file.profile).parse(file.text);
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

function indexTreeSitterGo(file: CodeFile, statements: IndexStatements, parserForProfile: (profile: string) => TreeSitterParser): void {
  const tree = parserForProfile(file.profile).parse(file.text);
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

function treeSitterGenericLanguage(file: CodeFile, fail: Fail): TreeSitterGenericLanguage {
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
    c: [[["function_definition"], "function", [/\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/]], [["struct_specifier"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]], [["enum_specifier"], "enum", [/\benum\s+([A-Za-z_]\w*)/]]],
    cpp: [[["function_definition"], "function", [/\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/]], [["class_specifier"], "class", [/\bclass\s+([A-Za-z_]\w*)/, /\bstruct\s+([A-Za-z_]\w*)/]], [["namespace_definition"], "namespace", [/\bnamespace\s+([A-Za-z_]\w*)/]], [["enum_specifier"], "enum", [/\benum(?:\s+class)?\s+([A-Za-z_]\w*)/]]],
    csharp: [[["method_declaration", "constructor_declaration"], "method", [/\b([A-Za-z_]\w*)\s*\(/]], [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]], [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]], [["struct_declaration"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]], [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]]],
    java: [[["method_declaration", "constructor_declaration"], "method", [/\b([A-Za-z_]\w*)\s*\(/]], [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]], [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]], [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]]],
    kotlin: [[["function_declaration"], "function", [/\bfun\s+([A-Za-z_]\w*)/]], [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/, /\binterface\s+([A-Za-z_]\w*)/]], [["object_declaration"], "object", [/\bobject\s+([A-Za-z_]\w*)/]]],
    php: [[["function_definition"], "function", [/\bfunction\s+([A-Za-z_]\w*)/]], [["method_declaration"], "method", [/\bfunction\s+([A-Za-z_]\w*)/]], [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]], [["interface_declaration"], "interface", [/\binterface\s+([A-Za-z_]\w*)/]], [["trait_declaration"], "trait", [/\btrait\s+([A-Za-z_]\w*)/]]],
    rust: [[["function_item"], "function", [/\bfn\s+([A-Za-z_]\w*)/]], [["struct_item"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]], [["enum_item"], "enum", [/\benum\s+([A-Za-z_]\w*)/]], [["trait_item"], "trait", [/\btrait\s+([A-Za-z_]\w*)/]], [["impl_item"], "impl", [/\bimpl(?:\s*<[^>]+>)?\s+([A-Za-z_]\w*)/]]],
    swift: [[["function_declaration"], "function", [/\bfunc\s+([A-Za-z_]\w*)/]], [["class_declaration"], "class", [/\bclass\s+([A-Za-z_]\w*)/]], [["struct_declaration"], "struct", [/\bstruct\s+([A-Za-z_]\w*)/]], [["protocol_declaration"], "protocol", [/\bprotocol\s+([A-Za-z_]\w*)/]], [["enum_declaration"], "enum", [/\benum\s+([A-Za-z_]\w*)/]]],
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

function indexTreeSitterGeneric(file: CodeFile, statements: IndexStatements, parserForProfile: (profile: string) => TreeSitterParser, fail: Fail): void {
  const language = treeSitterGenericLanguage(file, fail);
  const tree = parserForProfile(file.profile).parse(file.text);
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

export function treeSitterBackends(fail: Fail): ExtractionBackend[] {
  const parserForProfile = createTreeSitterParserResolver(fail);
  return [
    { id: "tree-sitter-javascript", index: (file, statements) => indexTreeSitterJavaScriptLike(file, statements, parserForProfile), label: "Tree-sitter JavaScript grammar", profile: "tree-sitter-javascript", strength: "structural" },
    { id: "tree-sitter-typescript", index: (file, statements) => indexTreeSitterJavaScriptLike(file, statements, parserForProfile), label: "Tree-sitter TypeScript grammar", profile: "tree-sitter-typescript", strength: "structural" },
    { id: "tree-sitter-typescript", index: (file, statements) => indexTreeSitterJavaScriptLike(file, statements, parserForProfile), label: "Tree-sitter TSX grammar", profile: "tree-sitter-tsx", strength: "structural" },
    { id: "tree-sitter-python", index: (file, statements) => indexTreeSitterPython(file, statements, parserForProfile), label: "Tree-sitter Python grammar", profile: "tree-sitter-python", strength: "structural" },
    { id: "tree-sitter-go", index: (file, statements) => indexTreeSitterGo(file, statements, parserForProfile), label: "Tree-sitter Go grammar", profile: "tree-sitter-go", strength: "structural" },
    { id: "tree-sitter-c", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter C grammar", profile: "tree-sitter-c", strength: "structural" },
    { id: "tree-sitter-cpp", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter C++ grammar", profile: "tree-sitter-cpp", strength: "structural" },
    { id: "tree-sitter-csharp", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter C# grammar", profile: "tree-sitter-csharp", strength: "structural" },
    { id: "tree-sitter-java", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter Java grammar", profile: "tree-sitter-java", strength: "structural" },
    { id: "tree-sitter-kotlin", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter Kotlin grammar", profile: "tree-sitter-kotlin", strength: "structural" },
    { id: "tree-sitter-php", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter PHP grammar", profile: "tree-sitter-php", strength: "structural" },
    { id: "tree-sitter-rust", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter Rust grammar", profile: "tree-sitter-rust", strength: "structural" },
    { id: "tree-sitter-swift", index: (file, statements) => indexTreeSitterGeneric(file, statements, parserForProfile, fail), label: "Tree-sitter Swift grammar", profile: "tree-sitter-swift", strength: "structural" },
  ];
}
