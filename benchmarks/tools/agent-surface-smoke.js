#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const cliPath = path.join(repoRoot, "dist", "init-project-wiki.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runCli(cwd, args) {
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`project-librarian ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function assertFile(root, relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`missing ${relativePath}`);
}

function assertHookContext(root, relativePath) {
  const output = childProcess.execFileSync(process.execPath, [path.join(root, relativePath)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GEMINI_PROJECT_DIR: root },
  });
  const payload = JSON.parse(output);
  const context = payload.hookSpecificOutput ? payload.hookSpecificOutput.additionalContext : payload.additional_context;
  if (typeof context !== "string" || !context.includes("ALREADY included")) fail(`${relativePath} missing injected-context marker`);
  if (!context.includes("Do not re-read these two files this session")) fail(`${relativePath} missing duplicate-read guard`);
}

function buildFixture(root) {
  childProcess.spawnSync("git", ["init", "-q"], { cwd: root });
  writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "agent-surface-smoke",
    private: true,
    workspaces: ["apps/*", "packages/*"],
    dependencies: { express: "^4.18.0" },
  }, null, 2) + "\n");
  writeFile(path.join(root, "package-lock.json"), JSON.stringify({ name: "agent-surface-smoke", lockfileVersion: 3, packages: {} }, null, 2) + "\n");
  writeFile(path.join(root, ".github", "CODEOWNERS"), "* @org/default\nsrc/ @platform-team\nsrc/app.js @app-owners\n");
  writeFile(path.join(root, "src", "app.js"), [
    "const express = require(\"express\");",
    "const app = express();",
    "function healthHandler(req, res) { res.json({ ok: true }); }",
    "app.get(\"/health\", healthHandler);",
    "",
  ].join("\n"));
  writeFile(path.join(root, "apps", "web", "package.json"), JSON.stringify({
    name: "@example/web",
    dependencies: { "@example/api": "workspace:*" },
  }, null, 2) + "\n");
  writeFile(path.join(root, "apps", "web", "route.js"), "export function webRoute() { return \"ok\"; }\n");
  writeFile(path.join(root, "packages", "api", "package.json"), JSON.stringify({ name: "@example/api" }, null, 2) + "\n");
}

function assertMcpRegistrations(root) {
  const claude = readJson(path.join(root, ".mcp.json"));
  if (!claude.mcpServers?.["project-librarian"]) fail("missing Claude .mcp.json project-librarian server");
  const cursor = readJson(path.join(root, ".cursor", "mcp.json"));
  if (!cursor.mcpServers?.["project-librarian"]) fail("missing Cursor .cursor/mcp.json project-librarian server");
  const gemini = readJson(path.join(root, ".gemini", "settings.json"));
  if (!gemini.mcpServers?.["project-librarian"]) fail("missing Gemini mcpServers project-librarian server");
  if (!Array.isArray(gemini.hooks?.SessionStart)) fail("Gemini SessionStart hook was lost during MCP merge");
}

function main() {
  if (!fs.existsSync(cliPath)) fail(`missing built CLI at ${cliPath}; run npm run build first`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-agent-surface-"));
  try {
    buildFixture(root);
    runCli(root, ["--no-git-config", "--agents", "all"]);
    runCli(root, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "apps/web", "--code-scope", "packages/api", "--code-scope", "package.json"]);
    runCli(root, ["--no-git-config", "--agents", "all"]);

    for (const file of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".cursor/rules/project-librarian.mdc",
      ".codex/hooks.json",
      ".codex/hooks/wiki-session-start.js",
      ".claude/settings.json",
      ".claude/hooks/wiki-session-start.js",
      ".cursor/hooks.json",
      ".cursor/hooks/wiki-session-start.js",
      ".gemini/settings.json",
      ".gemini/hooks/wiki-session-start.js",
    ]) {
      assertFile(root, file);
    }
    for (const hook of [
      ".codex/hooks/wiki-session-start.js",
      ".claude/hooks/wiki-session-start.js",
      ".cursor/hooks/wiki-session-start.js",
      ".gemini/hooks/wiki-session-start.js",
    ]) {
      assertHookContext(root, hook);
    }
    assertMcpRegistrations(root);
    console.log(JSON.stringify({
      ok: true,
      surfaces: ["codex", "claude", "cursor", "gemini"],
      hooks_checked: 4,
      mcp_registrations_checked: ["claude", "cursor", "gemini"],
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
