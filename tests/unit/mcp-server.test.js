"use strict";

// Product evolution (2026-06-12): hand-rolled stdio MCP server exposing
// answer-shaped code-evidence tools, the code-evidence trust contract in the
// managed AGENTS.md block, and bootstrap-managed per-agent MCP registration.
//
// All CLI runs that WRITE use tmp dirs (never this repo root; a repo-root write
// destroyed the wiki on 2026-06-10). The protocol handshake/list/call/error
// paths are exercised by spawning the built server and exchanging ndjson over
// stdio; each tool runs against a tmp fixture indexed via the CLI first.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const {
  MAX_RESPONSE_CHARS,
  MAX_RESOURCE_CHARS,
  MAX_PROMPT_CHARS,
  PROMPT_TRUNCATION_NOTICE,
  RESOURCE_TRUNCATION_NOTICE,
  SUPPORTED_PROTOCOL_VERSION,
  TRUNCATION_NOTICE,
  TRUST_SENTENCE,
  handleLine,
} = require("../../dist/mcp-server.js");
const codeIndex = require("../../dist/code-index.js");
const distTemplates = require("../../dist/templates.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Run the CLI in a tmp cwd (build-index / bootstrap helpers). Throws on failure.
function runCli(cwd, args = []) {
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`CLI ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

// Spawn the built MCP server, write every ndjson request line, close stdin, and
// return the parsed JSON-RPC responses from stdout in order. stderr is ignored
// (node:sqlite emits an ExperimentalWarning there; the protocol channel is
// stdout only).
function mcpExchange(cwd, requestObjects) {
  const input = requestObjects.map((object) => JSON.stringify(object)).join("\n") + "\n";
  const result = childProcess.spawnSync(process.execPath, [cliPath, "mcp"], {
    cwd,
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `mcp server exited ${result.status}: ${result.stderr}`);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Send raw ndjson text (for malformed-frame tests) and parse stdout responses.
function mcpExchangeRaw(cwd, rawInput) {
  const result = childProcess.spawnSync(process.execPath, [cliPath, "mcp"], {
    cwd,
    input: rawInput,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `mcp server exited ${result.status}: ${result.stderr}`);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Build a representative code-evidence fixture (workspaces, CODEOWNERS with
// last-match precedence, a route) and index it via the CLI inside `cwd`.
function buildFixtureIndex(cwd) {
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "apps", "web"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "packages", "api"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".github"), { recursive: true });
  childProcess.spawnSync("git", ["init", "-q"], { cwd });

  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    workspaces: ["apps/*", "packages/*"],
    dependencies: { express: "^4.18.0" },
  }, null, 2));
  fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({ name: "x", lockfileVersion: 3, packages: {} }, null, 2));
  // Overlapping rules: last match (src/app.js) wins over * and src/.
  fs.writeFileSync(path.join(cwd, ".github", "CODEOWNERS"), "* @org/default\nsrc/ @platform-team\nsrc/app.js @app-owners\n");
  fs.writeFileSync(path.join(cwd, "apps", "web", "package.json"), JSON.stringify({
    name: "@example/web",
    dependencies: { "@example/api": "workspace:*", express: "^4.18.0" },
  }, null, 2));
  fs.writeFileSync(path.join(cwd, "packages", "api", "package.json"), JSON.stringify({
    name: "@example/api",
    dependencies: { zod: "^3.22.0" },
  }, null, 2));
  fs.writeFileSync(path.join(cwd, "apps", "web", "route.js"), "export function webRoute() { return \"ok\"; }\n");
  fs.writeFileSync(path.join(cwd, "src", "app.js"), [
    "const express = require(\"express\");",
    "const app = express();",
    "function healthHandler(req, res) { res.json({ ok: true }); }",
    "app.get(\"/health\", healthHandler);",
    "",
  ].join("\n"));

  runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "apps/web", "--code-scope", "packages/api", "--code-scope", "package.json"]);
}

function toolResultText(response) {
  assert.ok(response.result && Array.isArray(response.result.content), "expected a tool result with content");
  return response.result.content[0].text;
}

// ---------------------------------------------------------------------------
// Protocol handshake / list / error paths
// ---------------------------------------------------------------------------

test("initialize negotiates the pinned protocol version and advertises MCP capabilities", () => {
  const cwd = makeTmpDir("mcp-init-");
  try {
    const [init] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: SUPPORTED_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    ]);
    assert.equal(init.id, 1);
    assert.equal(init.result.protocolVersion, SUPPORTED_PROTOCOL_VERSION);
    assert.deepEqual(init.result.capabilities, { tools: {}, resources: {}, prompts: {} });
    assert.equal(init.result.serverInfo.name, "project-librarian");
    assert.equal(typeof init.result.serverInfo.version, "string");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("initialize returns the pinned version when the client requests an unsupported one", () => {
  const cwd = makeTmpDir("mcp-init-neg-");
  try {
    const [init] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    ]);
    assert.equal(init.result.protocolVersion, SUPPORTED_PROTOCOL_VERSION);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("ping returns an empty result and notifications/initialized produces no response", () => {
  const cwd = makeTmpDir("mcp-ping-");
  try {
    const responses = mcpExchange(cwd, [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ]);
    // Only the ping (with an id) gets a response; the notification is a no-op.
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 7);
    assert.deepEqual(responses[0].result, {});
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("resources/list exposes fixed resources and read surfaces missing backing state", () => {
  const cwd = makeTmpDir("mcp-resources-missing-");
  try {
    const responses = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "resources/list" },
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "project-librarian://wiki/startup" } },
      { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "project-librarian://code/status" } },
      { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "project-librarian://wiki/../../secret" } },
    ]);
    const resources = responses[0].result.resources;
    assert.deepEqual(resources.map((resource) => resource.uri).sort(), [
      "project-librarian://code/status",
      "project-librarian://wiki/index",
      "project-librarian://wiki/startup",
    ]);
    assert.match(responses[1].result.contents[0].text, /Resource unavailable: wiki\/startup\.md is missing/);
    assert.match(responses[2].result.contents[0].text, /Code status unavailable: missing code evidence index/);
    assert.equal(responses[3].error.code, -32002);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("resources/read returns current wiki and code status resources with hard caps", () => {
  const cwd = makeTmpDir("mcp-resources-read-");
  try {
    runCli(cwd, ["--no-git-config"]);
    buildFixtureIndex(cwd);
    const hugeStartup = [
      "---",
      "status: active",
      "updated: 2026-06-15",
      "scope: project-canonical",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: resource cap test",
      "---",
      "",
      "# Huge Startup",
      "",
      "## TL;DR",
      "",
      `- ${"large context ".repeat(800)}`,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(cwd, "wiki", "startup.md"), hugeStartup);
    const responses = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "project-librarian://wiki/startup" } },
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "project-librarian://wiki/index" } },
      { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "project-librarian://code/status" } },
    ]);
    const startup = responses[0].result.contents[0].text;
    assert.ok(startup.length <= MAX_RESOURCE_CHARS, `resource ${startup.length} exceeds cap ${MAX_RESOURCE_CHARS}`);
    assert.ok(startup.endsWith(RESOURCE_TRUNCATION_NOTICE));
    assert.match(responses[1].result.contents[0].text, /Language Policy/);
    assert.match(responses[2].result.contents[0].text, /^Index \.project-wiki\/code-evidence\.sqlite is fresh/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("prompts/list and prompts/get expose bounded workflow templates", () => {
  const cwd = makeTmpDir("mcp-prompts-");
  try {
    const responses = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "prompts/list" },
      { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "code_impact_trace", arguments: { term: "healthHandler" } } },
      { jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "retrieval_quality_review", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "not_real", arguments: {} } },
    ]);
    assert.deepEqual(responses[0].result.prompts.map((prompt) => prompt.name).sort(), [
      "code_impact_trace",
      "retrieval_quality_review",
      "wiki_taxonomy_update",
    ]);
    const impactPrompt = responses[1].result.messages[0].content.text;
    assert.match(impactPrompt, /Build a code impact trace for "healthHandler"/);
    assert.match(impactPrompt, /Call code_context_pack first/);
    assert.equal(responses[2].error.code, -32602);
    assert.match(responses[2].error.message, /missing required string argument: query/);
    assert.equal(responses[3].error.code, -32002);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("prompts/get hard-caps oversized prompt arguments with an explicit notice", () => {
  const cwd = makeTmpDir("mcp-prompt-cap-");
  try {
    const hugeContent = "planning evidence ".repeat(800);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "wiki_taxonomy_update", arguments: { content: hugeContent } } },
    ]);
    const text = response.result.messages[0].content.text;
    assert.ok(text.length <= MAX_PROMPT_CHARS, `prompt ${text.length} exceeds cap ${MAX_PROMPT_CHARS}`);
    assert.ok(text.endsWith(PROMPT_TRUNCATION_NOTICE));
    assert.match(text.split("\n")[0], /^Use the Project Librarian wiki contract/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("tools/list returns all six answer-shaped tools each carrying the trust sentence", () => {
  const cwd = makeTmpDir("mcp-list-");
  try {
    const [list] = mcpExchange(cwd, [{ jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    const names = list.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["code_context_pack", "code_impact", "code_ownership", "code_search", "code_status", "code_workspace_graph"]);
    for (const tool of list.result.tools) {
      assert.ok(tool.description.includes(TRUST_SENTENCE), `${tool.name} description must end with the trust sentence`);
      assert.equal(tool.inputSchema.type, "object");
    }
    // Tools requiring an argument declare it required.
    const impact = list.result.tools.find((tool) => tool.name === "code_impact");
    assert.deepEqual(impact.inputSchema.required, ["term"]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("tools/list works even without an index (only tools/call reports the missing index)", () => {
  const cwd = makeTmpDir("mcp-noindex-");
  try {
    const responses = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "code_status", arguments: {} } },
    ]);
    assert.equal(responses[0].result.tools.length, 6);
    assert.equal(responses[1].result.isError, true);
    assert.match(toolResultText(responses[1]), /run `project-librarian --code-index`/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("unknown method returns JSON-RPC -32601 and a malformed frame returns -32700 with null id", () => {
  const cwd = makeTmpDir("mcp-errors-");
  try {
    const responses = mcpExchangeRaw(cwd, [
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "nonexistent/method" }),
      "this is not valid json",
      "",
    ].join("\n") + "\n");
    const methodNotFound = responses.find((r) => r.id === 8);
    assert.equal(methodNotFound.error.code, -32601);
    const parseError = responses.find((r) => r.error && r.error.code === -32700);
    assert.ok(parseError, "expected a parse-error response");
    assert.equal(parseError.id, null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("tools/call with a missing required argument returns JSON-RPC -32602 invalid params", () => {
  const cwd = makeTmpDir("mcp-badargs-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "code_ownership", arguments: {} } },
    ]);
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /missing required string argument: path/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("an unknown tool name returns an isError result (not a protocol error)", () => {
  const cwd = makeTmpDir("mcp-badtool-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "made_up_tool", arguments: {} } },
    ]);
    assert.equal(response.result.isError, true);
    assert.match(toolResultText(response), /unknown tool: made_up_tool/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("MCP code context and impact tools reuse one staleness calculation per call", () => {
  const originals = {
    openCodeEvidenceDatabaseForServing: codeIndex.openCodeEvidenceDatabaseForServing,
    codeIndexStaleness: codeIndex.codeIndexStaleness,
    codeContextPack: codeIndex.codeContextPack,
    codeImpact: codeIndex.codeImpact,
  };
  const staleness = { stale: false, changed: 0, added: 0, deleted: 0 };
  const database = { closeCalls: 0, close() { this.closeCalls += 1; } };
  let stalenessCalls = 0;
  let contextCalls = 0;
  let impactCalls = 0;
  try {
    codeIndex.openCodeEvidenceDatabaseForServing = () => ({
      database,
      relativePath: ".project-wiki/code-evidence.sqlite",
    });
    codeIndex.codeIndexStaleness = (actualDatabase) => {
      stalenessCalls += 1;
      assert.equal(actualDatabase, database);
      return staleness;
    };
    codeIndex.codeContextPack = (actualDatabase, term, options) => {
      contextCalls += 1;
      assert.equal(actualDatabase, database);
      assert.equal(term, "healthHandler");
      assert.equal(options.staleness, staleness);
      return "context body";
    };
    codeIndex.codeImpact = (actualDatabase, term, options) => {
      impactCalls += 1;
      assert.equal(actualDatabase, database);
      assert.equal(term, "healthHandler");
      assert.equal(options.staleness, staleness);
      return {
        matches: { files: [], symbols: [], routes: [], imports: [] },
        edges: { incoming: [], outgoing: [] },
        impacted_owners: [],
      };
    };

    const contextResponse = JSON.parse(handleLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "code_context_pack", arguments: { term: "healthHandler" } },
    })));
    const impactResponse = JSON.parse(handleLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "code_impact", arguments: { term: "healthHandler" } },
    })));

    assert.equal(contextResponse.id, 1);
    assert.equal(toolResultText(contextResponse), "context body");
    assert.equal(impactResponse.id, 2);
    assert.match(toolResultText(impactResponse).split("\n")[0], /^Impact of "healthHandler": 0 files/);
    assert.equal(stalenessCalls, 2);
    assert.equal(contextCalls, 1);
    assert.equal(impactCalls, 1);
    assert.equal(database.closeCalls, 2);
  } finally {
    Object.assign(codeIndex, originals);
  }
});

// ---------------------------------------------------------------------------
// Answer-shaped tool outputs against a tmp fixture
// ---------------------------------------------------------------------------

test("code_ownership answers with last-match-wins precedence and overridden-rule evidence", () => {
  const cwd = makeTmpDir("mcp-own-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_ownership", arguments: { path: "src/app.js" } } },
    ]);
    const text = toolResultText(response);
    const firstLine = text.split("\n")[0];
    // First line is a direct one-line answer naming the effective owner + rule.
    assert.match(firstLine, /^Owner of src\/app\.js is @app-owners /);
    assert.match(firstLine, /last match\); 2 overridden rules\./);
    // Compact grouped evidence: the overridden rules with paths/patterns only.
    assert.match(text, /Overridden rules \(earlier matches, lower precedence\):/);
    assert.match(text, /CODEOWNERS:1 `\*` -> @org\/default/);
    assert.match(text, /CODEOWNERS:2 `src\/` -> @platform-team/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code_impact answers with a mechanism summary plus grouped symbol/route/edge evidence", () => {
  const cwd = makeTmpDir("mcp-impact-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_impact", arguments: { term: "healthHandler" } } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /^Impact of "healthHandler": /);
    assert.match(text, /Symbols:/);
    assert.match(text, /src\/app\.js:\d+ function healthHandler/);
    assert.match(text, /GET \/health -> healthHandler/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code_context_pack answers with budgeted structural context and no source snippets", () => {
  const cwd = makeTmpDir("mcp-context-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_context_pack", arguments: { term: "healthHandler" } } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /^Code context pack "healthHandler": /);
    assert.match(text, /Symbols:/);
    assert.match(text, /symbol-match src\/app\.js:\d+ function healthHandler/);
    assert.match(text, /route-match GET \/health -> healthHandler/);
    assert.match(text, /Evidence is structural only/);
    assert.doesNotMatch(text, /res\.json\(\{ ok: true \}\)/);
    assert.ok(text.length <= MAX_RESPONSE_CHARS, `response ${text.length} exceeds cap ${MAX_RESPONSE_CHARS}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code_workspace_graph answers with package counts and internal dependency edges", () => {
  const cwd = makeTmpDir("mcp-graph-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_workspace_graph", arguments: {} } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /^Workspace graph: 2 packages, 1 internal dependency edge/);
    assert.match(text, /@example\/web -> @example\/api/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code_search answers with a count summary and matching symbol signatures", () => {
  const cwd = makeTmpDir("mcp-search-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_search", arguments: { term: "Handler" } } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /^Search "Handler": \d+ matching symbol/);
    assert.match(text, /healthHandler/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code_status answers fresh with coverage counts on a just-built index", () => {
  const cwd = makeTmpDir("mcp-status-");
  try {
    buildFixtureIndex(cwd);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_status", arguments: {} } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /is fresh; \d+ files,/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Answer-shape caps: staleness warning + explicit truncation notice
// ---------------------------------------------------------------------------

test("a stale index prepends one explicit staleness warning line to tool answers", () => {
  const cwd = makeTmpDir("mcp-stale-");
  try {
    buildFixtureIndex(cwd);
    // Mutate the source after indexing so the staleness check trips.
    fs.appendFileSync(path.join(cwd, "src", "app.js"), "\nexport const added = true;\n");
    fs.writeFileSync(path.join(cwd, "src", "added.js"), "export function newSym() {}\n");
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_status", arguments: {} } },
    ]);
    const text = toolResultText(response);
    assert.match(text.split("\n")[0], /^\[stale index: \d+ changed, \d+ added, \d+ deleted/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("an oversized tool body is hard-capped with an explicit truncation notice", () => {
  const cwd = makeTmpDir("mcp-trunc-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    childProcess.spawnSync("git", ["init", "-q"], { cwd });
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ dependencies: {} }, null, 2));
    // Many symbols with long signatures force the sampled body past the cap.
    let big = "";
    for (let i = 0; i < 40; i += 1) {
      const args = Array.from({ length: 12 }, (_, j) => `verylongParameterNameNumber${j}_in_function_${i}: SomeReasonablyLongTypeName${j}`).join(", ");
      big += `export function commonPrefixHandler${i}(${args}): Promise<SomeReasonablyLongReturnTypeName${i}> { return null; }\n`;
    }
    fs.writeFileSync(path.join(cwd, "src", "big.ts"), big);
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"]);
    const [response] = mcpExchange(cwd, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "code_search", arguments: { term: "commonPrefixHandler" } } },
    ]);
    const text = toolResultText(response);
    assert.ok(text.length <= MAX_RESPONSE_CHARS, `response ${text.length} exceeds cap ${MAX_RESPONSE_CHARS}`);
    assert.ok(text.trimEnd().endsWith(TRUNCATION_NOTICE), "truncated response must end with the explicit notice");
    // First-line answer survives truncation.
    assert.match(text.split("\n")[0], /^Search "commonPrefixHandler": /);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bootstrap-managed MCP registration: merge / preserve / idempotency
// ---------------------------------------------------------------------------

// The scale gate skips MCP auto-registration on sub-threshold repos UNLESS a
// .project-wiki index already exists (standing consent: below the threshold it
// can only be built via --code-index --acknowledge-small-repo). These merge /
// preserve / idempotency tests run on tiny tmp fixtures, so they plant an index
// stub to take the registering branch; the gate itself is covered in
// code-scale-gate.test.js.
function stubCodeEvidenceIndex(cwd) {
  fs.mkdirSync(path.join(cwd, ".project-wiki"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".project-wiki", "code-evidence.sqlite"), "");
}

test("bootstrap registers the MCP server in .mcp.json, .cursor/mcp.json, and .gemini/settings.json", () => {
  const cwd = makeTmpDir("mcp-reg-");
  try {
    stubCodeEvidenceIndex(cwd);
    runCli(cwd, ["--no-git-config"]);
    const claude = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.ok(claude.mcpServers["project-librarian"], "Claude .mcp.json must register project-librarian");
    assert.deepEqual(claude.mcpServers["project-librarian"].args, ["mcp"]);

    const cursor = JSON.parse(fs.readFileSync(path.join(cwd, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cursor.mcpServers["project-librarian"], "Cursor .cursor/mcp.json must register project-librarian");

    const gemini = JSON.parse(fs.readFileSync(path.join(cwd, ".gemini", "settings.json"), "utf8"));
    assert.ok(gemini.mcpServers["project-librarian"], "Gemini settings.json must register project-librarian in mcpServers");
    // The MCP registration must coexist with the Gemini SessionStart hook config.
    assert.ok(Array.isArray(gemini.hooks.SessionStart), "Gemini hooks.SessionStart must survive the MCP merge");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("registration preserves a user-authored .mcp.json with another server and unknown keys", () => {
  const cwd = makeTmpDir("mcp-preserve-");
  try {
    stubCodeEvidenceIndex(cwd);
    fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({
      mcpServers: { "my-existing-server": { command: "node", args: ["other.js"] } },
      someUnknownTopLevelKey: { keep: true },
    }, null, 2) + "\n");
    runCli(cwd, ["--no-git-config"]);
    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.deepEqual(config.mcpServers["my-existing-server"].args, ["other.js"], "existing server must survive");
    assert.deepEqual(config.someUnknownTopLevelKey, { keep: true }, "unknown top-level keys must survive");
    assert.ok(config.mcpServers["project-librarian"], "our server must be merged in");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("a second bootstrap run reports the MCP registrations as exists (idempotent)", () => {
  const cwd = makeTmpDir("mcp-idem-");
  try {
    stubCodeEvidenceIndex(cwd);
    runCli(cwd, ["--no-git-config"]);
    const rerun = runCli(cwd, ["--no-git-config"]);
    assert.match(rerun, /exists {2}\.mcp\.json/);
    assert.match(rerun, /exists {2}\.cursor\/mcp\.json/);
    assert.match(rerun, /exists {2}\.gemini\/settings\.json mcpServers/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("the registered command uses the local runner when the repo contains one", () => {
  const cwd = makeTmpDir("mcp-runner-");
  try {
    stubCodeEvidenceIndex(cwd);
    runCli(cwd, ["install-skill", "--scope", "project", "--agents", "claude"]);
    runCli(cwd, ["--no-git-config"]);
    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    const entry = config.mcpServers["project-librarian"];
    assert.equal(entry.command, "node");
    assert.equal(entry.args[0], ".claude/skills/project-librarian/dist/init-project-wiki.js");
    assert.equal(entry.args[1], "mcp");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Code-evidence trust contract in the managed AGENTS.md block (B4 analogue)
// ---------------------------------------------------------------------------

test("the managed AGENTS.md block carries the code-evidence trust sentence", () => {
  const cwd = makeTmpDir("mcp-trust-");
  try {
    runCli(cwd, ["--no-git-config"]);
    const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(distTemplates.codeEvidenceTrustContract), "AGENTS.md must include the code-evidence trust sentence");
    assert.match(agents, /`--code-status`\/`code_status` reports staleness/);
    // It is a single sentence next to the wiki trust contract, not a new section.
    assert.ok(agents.includes(distTemplates.wikiTrustContract), "the wiki trust contract must still be present");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
