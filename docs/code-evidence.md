# Code Evidence

Project Librarian can build a disposable SQLite index under `.project-wiki/` and serve it through read-only CLI and MCP surfaces. This is optional; the planning wiki works without it.

## Freshness Contract

Before citing `--code-report`, `--code-impact`, `--code-context-pack`, or MCP tool output as current code-structure evidence, run:

```bash
project-librarian --code-status
```

or MCP `code_status`, and require `stale_files: 0`. Stale reports are pointers for rebuild, not authoritative project truth.

## Scale Gate

The code-evidence index is measured as a scale crossover, not a universal win. Below ~5k indexable files, `--code-index` halts unless `--acknowledge-small-repo` is passed. Bootstrap skips MCP auto-registration unless an existing `.project-wiki` SQLite index shows the user already opted in.

Measured release evidence:

| Question | excalidraw (~1.2k files) | backstage (~11.8k files) |
| --- | --- | --- |
| impact_trace | 117% more | **27.7% less** |
| workspace_graph | 106% more | 2.6% less |
| ownership_lookup | - | 99% more |

The index pays off only on genuinely large repositories for expensive traversal questions. Cheap lookups can lose even at larger scale.

## MCP Server

`project-librarian mcp` runs a hand-rolled stdio MCP server (JSON-RPC 2.0 over newline-delimited JSON, no MCP SDK dependency) that serves the existing `.project-wiki` code-evidence index read-only. The package's hard runtime dependency is `typescript`; code evidence also uses Node's `node:sqlite`, with Tree-sitter grammars remaining optional.

The server exposes answer-shaped tools:

- `code_context_pack`
- `code_impact`
- `code_ownership`
- `code_workspace_graph`
- `code_search`
- `code_status`

Responses lead with a one-line answer, follow with compact path/symbol/signature evidence, cap each reply, and prepend a warning when `code_status` reports the index is stale.

The server also exposes fixed resources:

- `project-librarian://wiki/startup`
- `project-librarian://wiki/index`
- `project-librarian://code/status`

It includes prompt templates for wiki taxonomy updates, code impact traces, maintenance improvement reviews, and retrieval quality reviews. Resource reads come from a fixed URI registry rather than arbitrary filesystem paths.

Bootstrap registers the server for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), and Gemini CLI (`mcpServers` in `.gemini/settings.json`), preserving any existing servers and keys and reporting `exists` on a re-run. When the repository contains a local runner the registration uses `node <runner> mcp`; otherwise it uses the installed `project-librarian mcp` binary.

Codex registers MCP servers at the user level only (`codex mcp add`), so bootstrap does not write a project-level Codex MCP config. To use the server with Codex, run it once per machine:

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## Language Support Matrix

The matrix lists languages with implemented symbol/import extraction. Other recognized extensions are inventory-only. Default mode uses `typescript-ast`, `*-light` extraction for the listed non-JS languages, config extraction, and inventory rows. `--code-parser tree-sitter` switches supported source files to `tree-sitter-*` profiles.

| Language | Extensions | Default extraction | Tree-sitter extraction | Indexed evidence |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | functions, classes, methods, variables, interfaces, types, enums, imports, exports, calls, common HTTP routes |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | functions, classes, methods, variables, imports, exports, `require()` calls, calls, common HTTP routes |
| Python | `.py` | `python-light` | `tree-sitter-python` | functions, classes, `import`, `from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | functions, methods, types, consts, vars, single imports, import blocks |
| Rust | `.rs` | `rust-light` | `tree-sitter-rust` | functions, structs, enums, traits, impls, `use` imports |
| Java | `.java` | `java-light` | `tree-sitter-java` | classes, interfaces, enums, methods, imports |
| PHP | `.php` | `php-light` | `tree-sitter-php` | functions, classes, interfaces, traits, methods, namespace uses |
| Kotlin | `.kt`, `.kts` | `kotlin-light` | `tree-sitter-kotlin` | functions, classes, objects, imports |
| Swift | `.swift` | `swift-light` | `tree-sitter-swift` | functions, classes, structs, protocols, enums, imports |
| C | `.c`, `.h` | `c-light` | `tree-sitter-c` | functions, structs, enums, includes |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | `cpp-light` | `tree-sitter-cpp` | functions, classes/structs, namespaces, enums, includes/usings |
| C# | `.cs` | `csharp-light` | `tree-sitter-csharp` | classes, interfaces, structs, enums, methods, usings |

Recognized but inventory-only extensions include `.rb`, `.vue`, and `.css`. Config files (`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`, `Dockerfile`, and `Makefile`) are indexed as configuration or inventory evidence.

## Schema Migration

The code evidence index is disposable, but Project Librarian still treats schema-version changes as an explicit migration boundary. If an existing `.project-wiki/code-evidence.sqlite` has a different schema version, `--code-index` stops before replacing the database and prints a migration-required message with the approval command.

Run `project-librarian --code-index-health` to inspect the current index. To approve replacing an incompatible-schema index, rerun the build with `--code-index --code-index-migrate` plus the same scope/parser options you want for the new index. `--incremental` cannot migrate schema versions.

## Native Helper Policy

Experimental `--code-index-engine native-rust` runs the native helper for `typescript-ast`, `config`, the listed `*-light` profiles, and inventory-only source files. Omitted `--code-index-engine` means `auto`; full-index auto uses the native helper when a helper is available and at least one structurally extracted native profile is present, while config-only or inventory-only repositories stay on TypeScript. Compatible incremental auto uses the Rust direct-writer when a helper is available and the changed files are native-eligible.

Helper resolution checks `PROJECT_LIBRARIAN_NATIVE_INDEXER` first, then `dist/native/<platform>-<arch>/project-librarian-indexer` or `.exe`; Linux musl installs resolve to `dist/native/linux-<arch>-musl/`.

Public releases must not ship only one staged helper. `release:check` accepts either no packaged native helper or a complete supported matrix (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`, `linux-x64-musl`, `win32-arm64`, `win32-x64`), checks helper executable bits, Mach-O/ELF/PE platform headers, and the packaged-helper SHA-256 manifest. The GitHub publish workflow builds the supported helper matrix, runs `npm run native:package-manifest`, verifies `npm run native:package-audit:matrix`, and publishes only after the final helper-including package passes `npm run release:check`.
