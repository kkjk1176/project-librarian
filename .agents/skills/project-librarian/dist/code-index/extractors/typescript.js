"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexJavaScriptLike = indexJavaScriptLike;
const path = __importStar(require("node:path"));
const ts = __importStar(require("typescript"));
const shared_1 = require("./shared");
const httpMethods = new Set(["all", "delete", "get", "patch", "post", "put"]);
function scriptKindForPath(relativePath) {
    const extension = path.extname(relativePath).toLowerCase();
    if (extension === ".tsx")
        return ts.ScriptKind.TSX;
    if (extension === ".jsx")
        return ts.ScriptKind.JSX;
    if ([".ts", ".mts", ".cts"].includes(extension))
        return ts.ScriptKind.TS;
    return ts.ScriptKind.JS;
}
function tsLine(sourceFile, node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
function nodeName(node, sourceFile) {
    if (ts.isIdentifier(node))
        return node.text;
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
        return node.text;
    if (ts.isPrivateIdentifier(node))
        return node.text;
    return (0, shared_1.oneLine)(node.getText(sourceFile));
}
function propertyNameText(name, sourceFile) {
    if (!name)
        return "";
    return nodeName(name, sourceFile);
}
function callTarget(expression, sourceFile) {
    if (ts.isIdentifier(expression))
        return expression.text;
    if (ts.isPropertyAccessExpression(expression))
        return (0, shared_1.oneLine)(expression.getText(sourceFile));
    if (ts.isElementAccessExpression(expression))
        return (0, shared_1.oneLine)(expression.getText(sourceFile));
    return (0, shared_1.oneLine)(expression.getText(sourceFile));
}
function importBindingText(importClause, sourceFile) {
    if (!importClause)
        return "";
    const names = [];
    if (importClause.name)
        names.push(importClause.name.text);
    const namedBindings = importClause.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings))
        names.push(`* as ${namedBindings.name.text}`);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements)
            names.push(element.name.text);
    }
    return names.join(", ") || (0, shared_1.oneLine)(importClause.getText(sourceFile));
}
function stringArg(node) {
    if (!node)
        return "";
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : "";
}
function handlerArg(node, sourceFile) {
    if (!node)
        return "";
    return callTarget(node, sourceFile);
}
function routeFromCall(node, sourceFile) {
    if (!ts.isPropertyAccessExpression(node.expression))
        return null;
    const method = node.expression.name.text.toLowerCase();
    if (!httpMethods.has(method))
        return null;
    const receiver = node.expression.expression;
    if (!ts.isIdentifier(receiver) || !["app", "router", "server"].includes(receiver.text))
        return null;
    const route = stringArg(node.arguments[0]);
    if (!route)
        return null;
    return {
        handler: handlerArg(node.arguments[1], sourceFile),
        method: method.toUpperCase(),
        route,
    };
}
function routeFromDecorator(node, sourceFile) {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
    const routes = [];
    for (const decorator of decorators) {
        const expression = decorator.expression;
        if (!ts.isCallExpression(expression))
            continue;
        const callee = expression.expression;
        if (!ts.isIdentifier(callee))
            continue;
        const method = callee.text.toLowerCase();
        if (!httpMethods.has(method))
            continue;
        routes.push({ method: method.toUpperCase(), route: stringArg(expression.arguments[0]) || "/" });
    }
    return routes;
}
function signatureFor(node, sourceFile) {
    return (0, shared_1.oneLine)(node.getText(sourceFile));
}
function indexJavaScriptLike(file, statements) {
    const sourceFile = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKindForPath(file.path));
    function visit(node, context) {
        let nextContext = context;
        if (ts.isFunctionDeclaration(node)) {
            const name = node.name?.text ?? "";
            (0, shared_1.insertSymbol)(statements, name, "function", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            if (name)
                nextContext = name;
        }
        else if (ts.isClassDeclaration(node)) {
            const name = node.name?.text ?? "";
            (0, shared_1.insertSymbol)(statements, name, "class", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            if (name)
                nextContext = name;
        }
        else if (ts.isInterfaceDeclaration(node)) {
            (0, shared_1.insertSymbol)(statements, node.name.text, "interface", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
        else if (ts.isTypeAliasDeclaration(node)) {
            (0, shared_1.insertSymbol)(statements, node.name.text, "type", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
        else if (ts.isEnumDeclaration(node)) {
            (0, shared_1.insertSymbol)(statements, node.name.text, "enum", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
        else if (ts.isMethodDeclaration(node)) {
            const name = propertyNameText(node.name, sourceFile);
            (0, shared_1.insertSymbol)(statements, name, "method", file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            for (const route of routeFromDecorator(node, sourceFile)) {
                statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), name);
                (0, shared_1.insertEdge)(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", name, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            }
            if (name)
                nextContext = name;
        }
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            const symbolKind = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? "function" : "variable";
            (0, shared_1.insertSymbol)(statements, node.name.text, symbolKind, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            if (symbolKind === "function")
                nextContext = node.name.text;
        }
        else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const imported = importBindingText(node.importClause, sourceFile);
            statements.insertImport.run(file.path, node.moduleSpecifier.text, imported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            (0, shared_1.insertEdge)(statements, "import", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const exported = node.exportClause ? (0, shared_1.oneLine)(node.exportClause.getText(sourceFile)) : "";
            statements.insertImport.run(file.path, node.moduleSpecifier.text, exported, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            (0, shared_1.insertEdge)(statements, "export", "file", file.path, "module", node.moduleSpecifier.text, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
        }
        else if (ts.isCallExpression(node)) {
            const route = routeFromCall(node, sourceFile);
            if (route) {
                statements.insertRoute.run(route.method, route.route, file.path, tsLine(sourceFile, node), route.handler);
                (0, shared_1.insertEdge)(statements, "route_to_handler", "route", `${route.method} ${route.route}`, "symbol", route.handler, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            }
            if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
                const moduleName = stringArg(node.arguments[0]);
                if (moduleName) {
                    statements.insertImport.run(file.path, moduleName, "", tsLine(sourceFile, node), signatureFor(node, sourceFile));
                    (0, shared_1.insertEdge)(statements, "import", "file", file.path, "module", moduleName, file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
                }
            }
            else {
                (0, shared_1.insertEdge)(statements, "call", context ? "symbol" : "file", context || file.path, "symbol", callTarget(node.expression, sourceFile), file, tsLine(sourceFile, node), signatureFor(node, sourceFile));
            }
        }
        ts.forEachChild(node, (child) => visit(child, nextContext));
    }
    visit(sourceFile, "");
}
