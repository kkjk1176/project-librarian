import * as path from "node:path";
import * as ts from "typescript";
import type { IndexStatements } from "../schema";
import { insertEdge, insertSymbol, oneLine } from "./shared";
import type { CodeFile } from "./types";

const httpMethods = new Set(["all", "delete", "get", "patch", "post", "put"]);

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".ts", ".mts", ".cts"].includes(extension)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
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

export function indexJavaScriptLike(file: CodeFile, statements: IndexStatements): void {
  const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, false, scriptKindForPath(file.path));

  function visit(node: ts.Node, context: string): void {
    let nextContext = context;
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? "";
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      insertSymbol(statements, name, "function", file, line, signature);
      if (name) nextContext = name;
    } else if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? "";
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      insertSymbol(statements, name, "class", file, line, signature);
      if (name) nextContext = name;
    } else if (ts.isInterfaceDeclaration(node)) {
      insertSymbol(statements, node.name.text, "interface", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isTypeAliasDeclaration(node)) {
      insertSymbol(statements, node.name.text, "type", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isEnumDeclaration(node)) {
      insertSymbol(statements, node.name.text, "enum", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
    } else if (ts.isMethodDeclaration(node)) {
      const name = propertyNameText(node.name, sourceFile);
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      insertSymbol(statements, name, "method", file, line, signature);
      for (const route of routeFromDecorator(node, sourceFile)) {
        statements.insertRoute.run(route.method, route.route, file.path, line, name);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", name, file, line, signature);
      }
      if (name) nextContext = name;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const symbolKind = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? "function" : "variable";
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      insertSymbol(statements, node.name.text, symbolKind, file, line, signature);
      if (symbolKind === "function") nextContext = node.name.text;
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = importBindingText(node.importClause, sourceFile);
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      statements.insertImport.run(file.path, node.moduleSpecifier.text, imported, line, signature);
      insertEdge(statements, "import", "file", file.path, "module", node.moduleSpecifier.text, file, line, signature);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const exported = node.exportClause ? oneLine(node.exportClause.getText(sourceFile)) : "";
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      statements.insertImport.run(file.path, node.moduleSpecifier.text, exported, line, signature);
      insertEdge(statements, "export", "file", file.path, "module", node.moduleSpecifier.text, file, line, signature);
    } else if (ts.isCallExpression(node)) {
      const line = tsLine(sourceFile, node);
      const signature = signatureFor(node, sourceFile);
      const route = routeFromCall(node, sourceFile);
      if (route) {
        statements.insertRoute.run(route.method, route.route, file.path, line, route.handler);
        insertEdge(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", route.handler, file, line, signature);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const moduleName = stringArg(node.arguments[0]);
        if (moduleName) {
          statements.insertImport.run(file.path, moduleName, "", line, signature);
          insertEdge(statements, "import", "file", file.path, "module", moduleName, file, line, signature);
        }
      } else {
        insertEdge(statements, "call", context ? "symbol" : "file", context || file.path, "symbol", callTarget(node.expression, sourceFile), file, line, signature);
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextContext));
  }

  visit(sourceFile, "");
}
