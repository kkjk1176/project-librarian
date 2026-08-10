"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericLightProfileByLanguage = void 0;
exports.indexPythonLight = indexPythonLight;
exports.indexGoLight = indexGoLight;
exports.indexGenericLight = indexGenericLight;
const shared_1 = require("./shared");
exports.genericLightProfileByLanguage = {
    c: "c-light",
    cpp: "cpp-light",
    csharp: "csharp-light",
    java: "java-light",
    kotlin: "kotlin-light",
    php: "php-light",
    rust: "rust-light",
    swift: "swift-light",
};
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
function indexGenericLight(file, statements, language) {
    let phpTypeDepth = 0;
    for (const [index, rawLine] of file.text.split("\n").entries()) {
        const line = rawLine.replace(/\r$/, "");
        const lineNumberOneBased = index + 1;
        const trimmed = normalizeGenericLightLine(line, language);
        if (!trimmed || genericLineIsComment(trimmed, language)) {
            phpTypeDepth += braceDelta(trimmed);
            continue;
        }
        const imported = genericLightImport(trimmed, language);
        if (imported) {
            statements.insertImport.run(file.path, imported.toRef, imported.imported, lineNumberOneBased, imported.raw);
            (0, shared_1.insertEdge)(statements, imported.edgeKind, "file", file.path, "module", imported.toRef, file, lineNumberOneBased, imported.raw);
        }
        const symbol = genericLightSymbol(trimmed, language, phpTypeDepth > 0);
        if (symbol)
            (0, shared_1.insertSymbol)(statements, symbol.name, symbol.kind, file, lineNumberOneBased, symbol.signature);
        phpTypeDepth += braceDelta(trimmed);
    }
}
function normalizeGenericLightLine(line, language) {
    const trimmed = line.trim();
    if (language === "php")
        return trimmed.replace(/^<\?php\s*/, "");
    if (language === "java" || language === "kotlin" || language === "swift")
        return stripLeadingAtAnnotations(trimmed);
    return trimmed;
}
function stripLeadingAtAnnotations(line) {
    let rest = line;
    while (true) {
        const match = rest.match(/^@[A-Za-z_][\w.]*(:[A-Za-z_]\w*)?(?:\([^)]*\))?\s*/);
        if (!match)
            return rest;
        rest = rest.slice(match[0].length).trimStart();
    }
}
function genericLineIsComment(line, language) {
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*"))
        return true;
    if (language === "php" && line.startsWith("#"))
        return true;
    return false;
}
function braceDelta(line) {
    let delta = 0;
    let quote = "";
    let escaped = false;
    for (const ch of line) {
        if (quote) {
            if (escaped)
                escaped = false;
            else if (ch === "\\")
                escaped = true;
            else if (ch === quote)
                quote = "";
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") {
            quote = ch;
            continue;
        }
        if (ch === "{")
            delta += 1;
        else if (ch === "}")
            delta -= 1;
    }
    return delta;
}
function genericLightImport(line, language) {
    if (language === "c" || language === "cpp") {
        const include = line.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
        if (include?.[1])
            return { edgeKind: "import", imported: "", raw: include[0], toRef: include[1] };
        if (language === "cpp") {
            const using = line.match(/^using\s+(?:namespace\s+)?([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*;?/);
            if (using?.[1])
                return { edgeKind: "import", imported: "", raw: line.replace(/;$/, ""), toRef: using[1] };
        }
        return null;
    }
    if (language === "rust") {
        const rustUse = line.match(/^use\s+(.+?)\s*;?$/);
        if (rustUse?.[1])
            return { edgeKind: "use", imported: "", raw: line.replace(/;$/, ""), toRef: rustUse[1].replace(/\s+/g, " ").trim() };
        return null;
    }
    if (language === "php") {
        const phpUse = line.match(/^use\s+([^;]+)\s*;?/);
        if (phpUse?.[1])
            return { edgeKind: "import", imported: "", raw: line.replace(/;$/, ""), toRef: phpUse[1].replace(/\s+/g, " ").trim() };
        return null;
    }
    if (language === "csharp") {
        const using = line.match(/^using\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;?/);
        if (using?.[1])
            return { edgeKind: "import", imported: "", raw: line.replace(/;$/, ""), toRef: using[1] };
        return null;
    }
    if (language === "swift") {
        const imported = line.match(/^import\s+([A-Za-z_]\w*)/);
        if (imported?.[1])
            return { edgeKind: "import", imported: "", raw: imported[0], toRef: imported[1] };
        return null;
    }
    const imported = line.match(/^import\s+([A-Za-z_]\w*(?:[.*$][A-Za-z_]\w*)*(?:\.\*)?)\s*;?/);
    if (imported?.[1])
        return { edgeKind: "import", imported: "", raw: line.replace(/;$/, ""), toRef: imported[1] };
    return null;
}
function genericLightSymbol(line, language, phpInsideType) {
    if (language === "rust")
        return rustLightSymbol(line);
    if (language === "kotlin")
        return kotlinLightSymbol(line);
    if (language === "swift")
        return swiftLightSymbol(line);
    if (language === "php")
        return phpLightSymbol(line, phpInsideType);
    if (language === "c" || language === "cpp")
        return cFamilyLightSymbol(line, language);
    if (language === "java" || language === "csharp")
        return jvmOrCsharpLightSymbol(line, language);
    return null;
}
function rustLightSymbol(line) {
    const fn = line.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/);
    if (fn?.[1])
        return symbol("function", fn[1], line);
    for (const [keyword, kind] of [["struct", "struct"], ["enum", "enum"], ["trait", "trait"]]) {
        const found = line.match(new RegExp(`^(?:pub(?:\\([^)]*\\))?\\s+)?${keyword}\\s+([A-Za-z_]\\w*)`));
        if (found?.[1])
            return symbol(kind, found[1], line);
    }
    const implName = rustImplName(line);
    if (implName)
        return symbol("impl", implName, line);
    return null;
}
function rustImplName(line) {
    let rest = line.replace(/^unsafe\s+/, "");
    if (!rest.startsWith("impl"))
        return "";
    rest = rest.slice("impl".length);
    if (rest.startsWith("<")) {
        const genericEnd = matchingAngleEnd(rest);
        if (genericEnd <= 1)
            return "";
        const afterGeneric = rest.slice(genericEnd + 1);
        if (!/^\s+/.test(afterGeneric))
            return "";
        rest = afterGeneric.trimStart();
    }
    else if (/^\s+/.test(rest)) {
        rest = rest.trimStart();
    }
    else {
        return "";
    }
    const forIndex = rest.lastIndexOf(" for ");
    if (forIndex !== -1) {
        const afterForName = rest.slice(forIndex + " for ".length).trimStart().match(/^([A-Za-z_]\w*)/);
        if (afterForName?.[1])
            return afterForName[1];
        rest = rest.slice(0, forIndex).trimEnd();
    }
    return rest.match(/^([A-Za-z_]\w*)/)?.[1] ?? "";
}
function matchingAngleEnd(text) {
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const ch = text[index];
        if (ch === "<")
            depth += 1;
        else if (ch === ">") {
            depth -= 1;
            if (depth === 0)
                return index;
        }
    }
    return -1;
}
function kotlinLightSymbol(line) {
    const fn = line.match(/^(?:[\w\s]+\s+)?fun\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)/);
    if (fn?.[1])
        return symbol("function", fn[1], line);
    const klass = line.match(/^(?:[\w\s]+\s+)?(?:data\s+|sealed\s+|open\s+)?(class|interface)\s+([A-Za-z_]\w*)/);
    if (klass?.[2])
        return symbol(klass[1] === "interface" ? "interface" : "class", klass[2], line);
    const object = line.match(/^(?:[\w\s]+\s+)?object\s+([A-Za-z_]\w*)/);
    if (object?.[1])
        return symbol("object", object[1], line);
    return null;
}
function swiftLightSymbol(line) {
    const fn = line.match(/^(?:[\w\s]+\s+)?func\s+([A-Za-z_]\w*)/);
    if (fn?.[1])
        return symbol("function", fn[1], line);
    for (const [keyword, kind] of [["class", "class"], ["struct", "struct"], ["protocol", "protocol"], ["enum", "enum"]]) {
        const found = line.match(new RegExp(`^(?:[\\w\\s]+\\s+)?${keyword}\\s+([A-Za-z_]\\w*)`));
        if (found?.[1])
            return symbol(kind, found[1], line);
    }
    return null;
}
function phpLightSymbol(line, insideType) {
    for (const [keyword, kind] of [["class", "class"], ["interface", "interface"], ["trait", "trait"]]) {
        const found = line.match(new RegExp(`^(?:abstract\\s+|final\\s+)?${keyword}\\s+([A-Za-z_]\\w*)`));
        if (found?.[1])
            return symbol(kind, found[1], line);
    }
    const fn = line.match(/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*function\s+&?\s*([A-Za-z_]\w*)/);
    if (fn?.[1])
        return symbol(insideType ? "method" : "function", fn[1], line);
    return null;
}
function cFamilyLightSymbol(line, language) {
    if (language === "cpp") {
        const namespace = line.match(/^namespace\s+([A-Za-z_]\w*)/);
        if (namespace?.[1])
            return symbol("namespace", namespace[1], line);
        const klass = line.match(/^(?:template\s*<[^>]+>\s*)?(class|struct)\s+([A-Za-z_]\w*)/);
        if (klass?.[2])
            return symbol(klass[1] === "class" ? "class" : "struct", klass[2], line);
        const enumMatch = line.match(/^enum(?:\s+class)?\s+([A-Za-z_]\w*)/);
        if (enumMatch?.[1])
            return symbol("enum", enumMatch[1], line);
    }
    else {
        const struct = line.match(/^struct\s+([A-Za-z_]\w*)/);
        if (struct?.[1])
            return symbol("struct", struct[1], line);
        const enumMatch = line.match(/^enum\s+([A-Za-z_]\w*)/);
        if (enumMatch?.[1])
            return symbol("enum", enumMatch[1], line);
    }
    const functionName = cLikeFunctionName(line);
    if (functionName)
        return symbol("function", functionName, line);
    return null;
}
function jvmOrCsharpLightSymbol(line, language) {
    for (const [keyword, kind] of [
        ["class", "class"],
        ["interface", "interface"],
        ["enum", "enum"],
        ...(language === "csharp" ? [["struct", "struct"]] : []),
    ]) {
        const found = line.match(new RegExp(`^(?:[\\w\\s]+\\s+)?${keyword}\\s+([A-Za-z_]\\w*)`));
        if (found?.[1])
            return symbol(kind, found[1], line);
    }
    const methodName = cLikeFunctionName(line);
    if (methodName)
        return symbol("method", methodName, line);
    return null;
}
function cLikeFunctionName(line) {
    if (!line.includes("(") || line.endsWith(";") || line.startsWith("#"))
        return "";
    const firstToken = line.split(/\s+/, 1)[0] ?? "";
    if (["if", "for", "while", "switch", "catch", "return", "new", "throw"].includes(firstToken))
        return "";
    const beforeParen = line.slice(0, line.indexOf("(")).trim();
    const name = beforeParen.match(/(?:^|[\s:*&~])([A-Za-z_]\w*)$/)?.[1] ?? "";
    if (["if", "for", "while", "switch", "catch", "return", "sizeof"].includes(name))
        return "";
    return name;
}
function symbol(kind, name, line) {
    return { kind, name, signature: (0, shared_1.oneLine)(line) };
}
