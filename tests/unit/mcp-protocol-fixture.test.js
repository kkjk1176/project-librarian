"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SUPPORTED_PROTOCOL_VERSION,
  TRUST_SENTENCE,
  handleLine,
} = require("../../dist/mcp-server.js");

function request(method, params = {}, id = method) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function responseFor(line) {
  const response = handleLine(line);
  return response === null ? null : JSON.parse(response);
}

test("MCP protocol fixture preserves initialize/list/ping response shape", () => {
  const responses = [
    responseFor(request("initialize", { protocolVersion: SUPPORTED_PROTOCOL_VERSION }, 1)),
    responseFor(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
    responseFor(request("tools/list", {}, 2)),
    responseFor(request("resources/list", {}, 3)),
    responseFor(request("prompts/list", {}, 4)),
    responseFor(request("ping", {}, 5)),
  ].filter(Boolean);

  assert.equal(responses.length, 5);
  const [init, tools, resources, prompts, ping] = responses;
  assert.equal(init.result.protocolVersion, SUPPORTED_PROTOCOL_VERSION);
  assert.deepEqual(init.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.deepEqual(tools.result.tools.map((tool) => tool.name).sort(), [
    "code_context_pack",
    "code_impact",
    "code_ownership",
    "code_search",
    "code_status",
    "code_workspace_graph",
  ]);
  for (const tool of tools.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert(tool.description.includes(TRUST_SENTENCE));
  }
  assert.deepEqual(resources.result.resources.map((resource) => resource.uri).sort(), [
    "project-librarian://code/status",
    "project-librarian://wiki/index",
    "project-librarian://wiki/startup",
  ]);
  assert.deepEqual(prompts.result.prompts.map((prompt) => prompt.name).sort(), [
    "code_impact_trace",
    "maintenance_improvement_review",
    "retrieval_quality_review",
    "wiki_taxonomy_update",
  ]);
  assert.deepEqual(ping.result, {});
});

test("MCP protocol fixture preserves JSON-RPC error codes for malformed and unknown messages", () => {
  assert.deepEqual(responseFor("{").error, { code: -32700, message: "parse error" });
  const unknown = responseFor(request("not/a-method", {}, 42));
  assert.equal(unknown.id, 42);
  assert.equal(unknown.error.code, -32601);
  assert.match(unknown.error.message, /method not found/);
});
