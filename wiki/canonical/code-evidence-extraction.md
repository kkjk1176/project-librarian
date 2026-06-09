---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: parser backend registry, supported languages, extraction profiles, workspace adapters, or CODEOWNERS behavior changes
---

# Code Evidence Extraction

## TL;DR

- Extraction is routed through a parser backend registry keyed by language/profile.
- Default extraction uses TypeScript compiler API for JavaScript-like files, lightweight extraction for Python/Go, config extraction for package/config files, and inventory rows for recognized unsupported files.
- Optional Tree-sitter mode gives structural extraction across supported JS/TS/TSX/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# files.
- Workspace and CODEOWNERS adapters provide ownership/routing hints, not authorization truth.

## Parser Backend Registry

Code-proven behavior:

- Extraction is routed through a parser backend registry keyed by extraction profile. Current backend IDs are `typescript-compiler`, `regex-light`, `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-php`, `tree-sitter-kotlin`, `tree-sitter-swift`, `tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-csharp`, `config-key-value`, and `inventory-only`; evidence: `ExtractionBackend`, `extractionBackends`, `extractionBackendForProfile`, and `indexCodeFile` in `src/code-index.ts`.
- JavaScript-like files are parsed with the TypeScript compiler API and can yield functions, classes, methods, variables, interfaces, types, enums, imports, exports, calls, `require()` imports, and common HTTP routes; evidence: `indexJavaScriptLike` in `src/code-index.ts`.
- Express-like `app/router/server.get|post|put|patch|delete|all` calls and decorator-style HTTP methods are captured into `routes` and `route_to_handler` edges; evidence: `routeFromCall`, `routeFromDecorator`, and `indexJavaScriptLike`.
- Python extraction captures top-level function/class patterns and import/from-import lines; evidence: `indexPythonLight`.
- Go extraction captures functions, methods, type declarations, const/var declarations, single imports, and import blocks; evidence: `indexGoLight`.
- `package.json` extraction records scripts, dependencies, and devDependencies as config rows; evidence: `indexConfigs`.

## Tree-Sitter Mode

Code-proven behavior:

- Tree-sitter parser mode uses optional `@sengac/tree-sitter`, `@sengac/tree-sitter-javascript`, `@sengac/tree-sitter-typescript`, `@sengac/tree-sitter-python`, `@sengac/tree-sitter-go`, `@sengac/tree-sitter-rust`, `@sengac/tree-sitter-java`, `@sengac/tree-sitter-php`, `@sengac/tree-sitter-kotlin`, `@sengac/tree-sitter-swift`, `@sengac/tree-sitter-c`, `@sengac/tree-sitter-cpp`, and `@sengac/tree-sitter-c-sharp` packages. Missing packages fail with an explicit package error instead of silently using the default backend; evidence: `requireTreeSitterPackage`, `treeSitterParserForProfile`, and `treeSitterGrammarForProfile`.
- Tree-sitter JavaScript/TypeScript/TSX extraction captures declarations, imports/exports, `require()` imports, calls, and common Express-like routes through syntax-tree traversal with node-text extraction for route/module literals; evidence: `indexTreeSitterJavaScriptLike`.
- Tree-sitter Python extraction captures function/class definitions and import/from-import statements; evidence: `indexTreeSitterPython`.
- Tree-sitter Go extraction captures functions, methods, type declarations, const/var declarations, and import specs; evidence: `indexTreeSitterGo`.
- Tree-sitter generic extraction captures major declarations and import/include/use nodes for Rust, Java, PHP, Kotlin, Swift, C, C++, and C# using grammar-specific node types plus source-text name extraction; evidence: `treeSitterGenericSymbol`, `treeSitterGenericImport`, and `indexTreeSitterGeneric`.

## Workspace And Ownership Adapters

Code-proven behavior:

- Workspace ownership adapters read root `package.json` workspace patterns and package-level `package.json` names, then prefer matching workspace roots over path heuristics in `ownership_summary`; evidence: `workspacePatternsFromRootPackage`, `workspacePackages`, `matchingWorkspace`, and `ownershipInfo`.
- CODEOWNERS adapters read `.github/CODEOWNERS`, `CODEOWNERS`, and `docs/CODEOWNERS`, parse non-comment pattern/owner rows, and attach the last matching owner hint to ownership summary rows where supported by the lightweight matcher; evidence: `codeownerRules`, `codeownerPatternMatches`, `matchingCodeowners`, and `ownershipInfo`.
- Workspace dependency graph adapters read root/workspace package manifests, package-manager lockfiles, internal workspace package edges, and external dependency hotspots; evidence: `packageManagerFromLockfile`, `workspaceDependencyGraph`, `codeReport`, and `codeReportSectionData`.
