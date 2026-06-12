"use strict";
// Hand-rolled MCP stdio server for the code-evidence index.
//
// Why hand-rolled: the product holds a zero-runtime-dependency posture (only
// node:sqlite plus optional tree-sitter grammars). Adopting @modelcontextprotocol/sdk
// would add a hard runtime dependency, so we implement the small slice of MCP we
// need directly: JSON-RPC 2.0 over newline-delimited JSON on stdio.
//
// Transport: MCP stdio transport carries one JSON-RPC message per line on stdin
// and stdout (newline-delimited JSON, "ndjson"); stderr is free for logging. We
// frame on \n and parse each non-empty line as one JSON-RPC message.
//
// Methods implemented exactly: initialize, notifications/initialized (no-op),
// ping, tools/list, tools/call. Unknown method -> JSON-RPC -32601. Parse error ->
// JSON-RPC -32700 with id null. These protocol error responses are MCP/JSON-RPC
// spec compliance, NOT fallback coding: a malformed frame or unknown method has a
// single spec-defined reply.
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
exports.TRUST_SENTENCE = exports.TRUNCATION_NOTICE = exports.MAX_RESPONSE_CHARS = exports.SUPPORTED_PROTOCOL_VERSION = void 0;
exports.scaleGuidanceLines = scaleGuidanceLines;
exports.runMcpServerMode = runMcpServerMode;
exports.handleLine = handleLine;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const code_index_1 = require("./code-index");
const code_index_file_policy_1 = require("./code-index-file-policy");
const workspace_1 = require("./workspace");
// Pinned MCP protocol version. This is the spec revision this server is written
// against; one constant so the supported version is auditable in a single place.
const SUPPORTED_PROTOCOL_VERSION = "2025-06-18";
exports.SUPPORTED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSION;
// JSON-RPC 2.0 standard error codes (subset we emit). Spec-defined, not tunable.
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
// Hard cap on a single tool-result text payload. The benchmark finding is that
// answer-shaped, bounded responses are the hypothesis under test; an unbounded
// dump would reintroduce the tool-output cost the boundary measured. When a body
// exceeds this, it is cut and an explicit notice is appended (never silent).
const MAX_RESPONSE_CHARS = 4000;
exports.MAX_RESPONSE_CHARS = MAX_RESPONSE_CHARS;
const TRUNCATION_NOTICE = "[truncated — refine the query]";
exports.TRUNCATION_NOTICE = TRUNCATION_NOTICE;
// The trust sentence appended to every tool description (B4 analogue). It tells
// the agent the index is authoritative for structure questions so it does not
// re-run repo-wide greps, gated on the staleness signal that code_status reports.
const TRUST_SENTENCE = "Results derive from the indexed code and are authoritative for structure questions — do not re-verify with repo-wide greps unless `code_status` reports staleness.";
exports.TRUST_SENTENCE = TRUST_SENTENCE;
// ---------------------------------------------------------------------------
// serverInfo from package.json (read at runtime; no version constant duplicated)
// ---------------------------------------------------------------------------
function serverInfo() {
    try {
        const raw = fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return {
            name: typeof parsed.name === "string" ? parsed.name : "project-librarian",
            version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
        };
    }
    catch {
        return { name: "project-librarian", version: "0.0.0" };
    }
}
// ---------------------------------------------------------------------------
// Answer-shape helpers
// ---------------------------------------------------------------------------
function requireStringArg(args, key) {
    const value = args[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new ToolArgumentError(`missing required string argument: ${key}`);
    }
    return value.trim();
}
// Thrown for bad tool arguments; surfaces as a JSON-RPC -32602 invalid params.
class ToolArgumentError extends Error {
}
// Prepend a single staleness warning line when the index is stale, then enforce
// the hard char cap with an explicit truncation notice. The warning is counted
// against the cap so the cap is a true ceiling on the returned text.
function finalizeAnswer(body, staleness) {
    const warning = staleness.stale
        ? `[stale index: ${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted — rerun \`project-librarian --code-index\`]\n`
        : "";
    const combined = warning + body;
    if (combined.length <= MAX_RESPONSE_CHARS)
        return combined;
    const budget = MAX_RESPONSE_CHARS - TRUNCATION_NOTICE.length - 1;
    const sliceEnd = budget > 0 ? budget : 0;
    return `${combined.slice(0, sliceEnd).trimEnd()}\n${TRUNCATION_NOTICE}`;
}
// Collapse a list to a bounded sample plus a "+N more" counter so repetitive
// items become counts instead of file bodies (paths/symbols/signatures only).
function sampleWithCount(items, limit, render) {
    const lines = items.slice(0, limit).map(render);
    if (items.length > limit)
        lines.push(`  …+${items.length - limit} more`);
    return lines;
}
function asRows(value) {
    return Array.isArray(value) ? value : [];
}
// ---------------------------------------------------------------------------
// Tools (answer-first text, grouped compact evidence)
// ---------------------------------------------------------------------------
function ownershipAnswer(filePath) {
    const rules = (0, code_index_1.codeownerRules)();
    const matched = (0, code_index_1.matchedCodeownerRules)(filePath, rules);
    const context = (0, code_index_1.ownershipContext)();
    const info = (0, code_index_1.ownershipInfo)(filePath, context);
    const effective = matched[matched.length - 1];
    const overridden = matched.slice(0, -1);
    const ownerStatement = effective
        ? `Owner of ${filePath} is ${effective.owners.join(" ")} (CODEOWNERS ${effective.file_path}:${effective.line} \`${effective.pattern}\`, last match); ${overridden.length} overridden rule${overridden.length === 1 ? "" : "s"}.`
        : `No CODEOWNERS rule matches ${filePath}; path-derived owner is ${info.owner} (${info.owner_source}).`;
    const lines = [ownerStatement];
    if (overridden.length > 0) {
        lines.push("Overridden rules (earlier matches, lower precedence):");
        lines.push(...sampleWithCount(overridden, 8, (rule) => `  ${rule.file_path}:${rule.line} \`${rule.pattern}\` -> ${rule.owners.join(" ")}`));
    }
    lines.push(`Workspace owner: ${info.owner} (source: ${info.owner_source})${info.codeowners ? `; codeowners ${info.codeowners}` : ""}.`);
    return lines.join("\n");
}
function impactAnswer(database, term) {
    const impact = (0, code_index_1.codeImpact)(database, term);
    const matches = (impact.matches ?? {});
    const edges = (impact.edges ?? {});
    const owners = asRows(impact.impacted_owners);
    const files = asRows(matches.files);
    const symbols = asRows(matches.symbols);
    const routes = asRows(matches.routes);
    const imports = asRows(matches.imports);
    const incoming = asRows(edges.incoming);
    const outgoing = asRows(edges.outgoing);
    const ownerLabel = owners.length === 0
        ? "no owners"
        : owners.slice(0, 3).map((o) => `${String(o.owner)} (${Number(o.files)} files)`).join(", ") + (owners.length > 3 ? `, +${owners.length - 3} more` : "");
    const lines = [
        `Impact of "${term}": ${files.length} files, ${symbols.length} symbols, ${routes.length} routes, ${imports.length} imports; ${incoming.length} incoming / ${outgoing.length} outgoing edges; owners: ${ownerLabel}.`,
    ];
    if (symbols.length > 0) {
        lines.push("Symbols:");
        lines.push(...sampleWithCount(symbols, 12, (row) => `  ${String(row.file_path)}:${String(row.line)} ${String(row.kind)} ${String(row.name)} — ${String(row.signature)}`));
    }
    if (routes.length > 0) {
        lines.push("Routes:");
        lines.push(...sampleWithCount(routes, 8, (row) => `  ${String(row.method)} ${String(row.route)} -> ${String(row.handler)} (${String(row.file_path)}:${String(row.line)})`));
    }
    if (imports.length > 0) {
        lines.push("Imports:");
        lines.push(...sampleWithCount(imports, 8, (row) => `  ${String(row.from_file)} -> ${String(row.to_ref)}`));
    }
    if (incoming.length > 0) {
        lines.push("Incoming edges (dependents):");
        lines.push(...sampleWithCount(incoming, 10, (row) => `  ${String(row.kind)}: ${String(row.source)} -> ${String(row.target)} (${String(row.file_path)}:${String(row.line)})`));
    }
    if (owners.length > 0) {
        lines.push("Owners:");
        lines.push(...sampleWithCount(owners, 8, (row) => `  ${String(row.owner)} (${String(row.owner_source)}, ${Number(row.files)} files)${row.codeowners ? ` ${String(row.codeowners)}` : ""}`));
    }
    return lines.join("\n");
}
function workspaceGraphAnswer(filter) {
    const graph = (0, code_index_1.workspaceDependencyGraph)();
    const workspaces = asRows(graph.workspaces);
    const internal = asRows(graph.internal_dependencies);
    const external = asRows(graph.external_dependency_hotspots);
    const lockfiles = asRows(graph.lockfiles);
    const packageManagers = Array.isArray(graph.package_managers) ? graph.package_managers : [];
    const scoped = filter
        ? internal.filter((edge) => String(edge.from_workspace).includes(filter) || String(edge.to_workspace).includes(filter) || String(edge.from_package).includes(filter) || String(edge.to_package).includes(filter))
        : internal;
    const lines = [
        `${filter ? `Workspace graph for "${filter}": ` : "Workspace graph: "}${workspaces.length} packages, ${scoped.length} internal dependency edge${scoped.length === 1 ? "" : "s"}, ${external.length} external hotspots; package managers: ${packageManagers.length > 0 ? packageManagers.join(", ") : "none"} (${lockfiles.length} lockfiles).`,
    ];
    if (workspaces.length > 0 && !filter) {
        lines.push("Packages:");
        lines.push(...sampleWithCount(workspaces, 12, (row) => `  ${String(row.name)} (${String(row.root)})`));
    }
    if (scoped.length > 0) {
        lines.push("Internal dependencies:");
        lines.push(...sampleWithCount(scoped, 15, (edge) => `  ${String(edge.from_package)} -> ${String(edge.to_package)} (${String(edge.dependency_type)} ${String(edge.version)})`));
    }
    if (external.length > 0) {
        lines.push("External hotspots:");
        lines.push(...sampleWithCount(external, 8, (row) => `  ${String(row.dependency)} (${String(row.dependency_type)}, ${Number(row.workspace_count)} workspaces)`));
    }
    return lines.join("\n");
}
function searchAnswer(database, term) {
    const rows = (0, code_index_1.searchSymbols)(database, term);
    const byKind = new Map();
    for (const row of rows)
        byKind.set(String(row.kind), (byKind.get(String(row.kind)) ?? 0) + 1);
    const kindSummary = Array.from(byKind.entries()).sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${count} ${kind}`).join(", ");
    const lines = [
        `Search "${term}": ${rows.length} matching symbol${rows.length === 1 ? "" : "s"}${rows.length >= 50 ? " (capped at 50)" : ""}${kindSummary ? ` — ${kindSummary}` : ""}.`,
    ];
    if (rows.length > 0) {
        lines.push("Symbols:");
        lines.push(...sampleWithCount(rows, 25, (row) => `  ${String(row.file_path)}:${String(row.line)} ${String(row.kind)} ${String(row.name)} — ${String(row.signature)}`));
    }
    return lines.join("\n");
}
// Scale-aware routing guidance for code_status (2026-06-12 decision, stageR1 /
// stage2d evidence): the indexed file count places the repo in a scale bracket,
// and the bracket tells the agent which question shapes the tools measured
// cheaper for. Exported as a pure function so both brackets are unit-testable.
function scaleGuidanceLines(indexedFileCount) {
    const bracket = indexedFileCount < code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD
        ? `Scale: small (${indexedFileCount} indexed files < ${code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD}) — at this scale direct reads measured cheaper for every benchmarked question; prefer direct reads for simple lookups and reserve these tools for expensive traversal questions.`
        : `Scale: large (${indexedFileCount} indexed files >= ${code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD}) — expensive traversal questions (impact tracing) measured cheaper through the index at this scale.`;
    return [
        bracket,
        "Ownership-style simple lookups measured cheaper via direct reads at every scale; prefer direct reads for those.",
    ];
}
function statusAnswer(database, relativePath, staleness) {
    const coverage = (0, code_index_1.evidenceCoverage)(database);
    const staleLabel = staleness.stale
        ? `STALE (${staleness.changed} changed, ${staleness.added} added, ${staleness.deleted} deleted)`
        : "fresh";
    const lines = [
        `Index ${relativePath} is ${staleLabel}; ${coverage.files ?? 0} files, ${coverage.symbols ?? 0} symbols, ${coverage.imports ?? 0} imports, ${coverage.routes ?? 0} routes, ${coverage.edges ?? 0} edges, ${coverage.configs ?? 0} configs.`,
        ...scaleGuidanceLines(Number(coverage.files ?? 0)),
    ];
    if (staleness.stale) {
        lines.push("Action: rerun `project-librarian --code-index` (or `--code-index --incremental`) before trusting structure answers.");
    }
    return lines.join("\n");
}
const TOOLS = [
    {
        name: "code_impact",
        description: `Impact of a file, symbol, route, or module term across the indexed code: matching symbols/signatures, routes, imports, dependent edges, and impacted owners. ${TRUST_SENTENCE}`,
        inputSchema: {
            type: "object",
            properties: { term: { type: "string", description: "File path, symbol name, route, or module to trace." } },
            required: ["term"],
        },
        run: (database, args) => impactAnswer(database, requireStringArg(args, "term")),
    },
    {
        name: "code_ownership",
        description: `Effective CODEOWNERS owner for a path under last-match-wins precedence, the rules it overrode, and the workspace owner. ${TRUST_SENTENCE}`,
        inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "Repo-relative file or directory path." } },
            required: ["path"],
        },
        run: (_database, args) => ownershipAnswer((0, workspace_1.normalizePath)(requireStringArg(args, "path"))),
    },
    {
        name: "code_workspace_graph",
        description: `Monorepo workspace dependency graph: packages, internal dependency edges, external hotspots, and package managers, optionally filtered to one workspace. ${TRUST_SENTENCE}`,
        inputSchema: {
            type: "object",
            properties: { workspace: { type: "string", description: "Optional workspace name or path substring to focus the graph." } },
        },
        run: (_database, args) => {
            const filter = typeof args.workspace === "string" ? args.workspace.trim() : "";
            return workspaceGraphAnswer(filter);
        },
    },
    {
        name: "code_search",
        description: `Search indexed symbols by name or signature substring; returns matching symbols with file, line, kind, and signature. ${TRUST_SENTENCE}`,
        inputSchema: {
            type: "object",
            properties: { term: { type: "string", description: "Symbol name or signature substring." } },
            required: ["term"],
        },
        run: (database, args) => searchAnswer(database, requireStringArg(args, "term")),
    },
    {
        name: "code_status",
        description: `Index freshness and coverage counts; reports whether the index is stale so callers know when re-verification is warranted. ${TRUST_SENTENCE}`,
        inputSchema: { type: "object", properties: {} },
        run: () => {
            throw new Error("code_status is handled with index metadata in callTool");
        },
    },
];
const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
// ---------------------------------------------------------------------------
// tools/call dispatch
// ---------------------------------------------------------------------------
function toolResultContent(text, isError = false) {
    return { content: [{ type: "text", text }], isError };
}
function callTool(name, rawArgs) {
    if (typeof name !== "string" || !TOOLS_BY_NAME.has(name)) {
        return toolResultContent(`unknown tool: ${String(name)}; available tools: ${TOOLS.map((tool) => tool.name).join(", ")}`, true);
    }
    const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
    let opened;
    try {
        opened = (0, code_index_1.openCodeEvidenceDatabaseForServing)();
    }
    catch (error) {
        if (error instanceof code_index_1.CodeEvidenceIndexUnavailableError) {
            return toolResultContent(error.message, true);
        }
        throw error;
    }
    try {
        const staleness = (0, code_index_1.codeIndexStaleness)(opened.database);
        const body = name === "code_status"
            ? statusAnswer(opened.database, opened.relativePath, staleness)
            : TOOLS_BY_NAME.get(name).run(opened.database, args);
        return toolResultContent(finalizeAnswer(body, staleness));
    }
    catch (error) {
        if (error instanceof ToolArgumentError)
            throw error;
        const message = error instanceof Error ? error.message : String(error);
        return toolResultContent(`code evidence tool error: ${message}`, true);
    }
    finally {
        opened.database.close();
    }
}
// ---------------------------------------------------------------------------
// JSON-RPC wiring
// ---------------------------------------------------------------------------
function successResponse(id, result) {
    return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function errorResponse(id, error) {
    return JSON.stringify({ jsonrpc: "2.0", id, error });
}
function negotiatedProtocolVersion(params) {
    const requested = params && typeof params === "object" ? params.protocolVersion : undefined;
    // Echo the client's version when it is the one we support; otherwise return our
    // pinned version so the client can decide whether to proceed (MCP negotiation).
    return requested === SUPPORTED_PROTOCOL_VERSION && typeof requested === "string" ? requested : SUPPORTED_PROTOCOL_VERSION;
}
function handleRequest(request) {
    const id = request.id ?? null;
    const method = request.method;
    // Notifications have no id and expect no response. notifications/initialized is
    // the only one we receive; treat any id-less message as a notification no-op.
    if (request.id === undefined) {
        return null;
    }
    switch (method) {
        case "initialize":
            return successResponse(id, {
                protocolVersion: negotiatedProtocolVersion(request.params),
                capabilities: { tools: {} },
                serverInfo: serverInfo(),
            });
        case "ping":
            return successResponse(id, {});
        case "tools/list":
            return successResponse(id, {
                tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
            });
        case "tools/call": {
            const params = request.params && typeof request.params === "object" ? request.params : {};
            try {
                return successResponse(id, callTool(params.name, params.arguments));
            }
            catch (error) {
                if (error instanceof ToolArgumentError) {
                    return errorResponse(id, { code: JSONRPC_INVALID_PARAMS, message: error.message });
                }
                throw error;
            }
        }
        default:
            return errorResponse(id, { code: JSONRPC_METHOD_NOT_FOUND, message: `method not found: ${String(method)}` });
    }
}
// Parse and route one ndjson line. A parse failure is answered with -32700 and a
// null id per JSON-RPC; this is the spec's defined reply for an invalid frame.
function handleLine(line) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return errorResponse(null, { code: JSONRPC_PARSE_ERROR, message: "parse error" });
    }
    if (!parsed || typeof parsed !== "object") {
        return errorResponse(null, { code: JSONRPC_PARSE_ERROR, message: "parse error" });
    }
    return handleRequest(parsed);
}
function runMcpServerMode() {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim() !== "") {
                const response = handleLine(line);
                if (response !== null)
                    process.stdout.write(`${response}\n`);
            }
            newlineIndex = buffer.indexOf("\n");
        }
    });
    process.stdin.on("end", () => {
        const remainder = buffer.trim();
        if (remainder !== "") {
            const response = handleLine(remainder);
            if (response !== null)
                process.stdout.write(`${response}\n`);
        }
        process.exit(0);
    });
}
