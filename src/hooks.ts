import * as childProcess from "node:child_process";
import { noGitConfigMode } from "./args";
import type { CursorHookCommand, CursorHookConfig, FileStatus, HookCommand, HookConfig, SessionStartHook } from "./types";
import { exists, isGitRepository, parseJson, read, root, write } from "./workspace";

export function upsertGitHooksPath(): FileStatus {
  if (noGitConfigMode) return "skipped-no-git-config";
  if (!isGitRepository()) return "skipped-no-git";
  let previous = "";
  try {
    previous = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    previous = "";
  }
  if (previous === ".githooks") return "exists";
  if (previous) return `skipped-existing-hooksPath ${previous}`;
  childProcess.execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: root,
    stdio: "ignore",
  });
  return previous ? `updated from ${previous}` : "configured";
}


function buildHookCommand(command: string, timeout?: number): HookCommand {
  const hook: HookCommand = { type: "command", command };
  if (typeof timeout === "number") hook.timeout = timeout;
  return hook;
}

function upsertSessionStartHookConfig(relativePath: string, command: string, matchers: string[], timeout?: number): FileStatus {
  const config = parseJson<HookConfig>(relativePath, { hooks: {} });
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  if (!Array.isArray(config.hooks.SessionStart)) config.hooks.SessionStart = [];

  const sessionStart = config.hooks.SessionStart.flatMap((entry: SessionStartHook) => {
    if (!Array.isArray(entry?.hooks)) return [entry];
    const hooks = entry.hooks.filter((hook) => hook?.command !== command);
    return hooks.length > 0 ? [{ ...entry, hooks }] : [];
  });
  for (const matcher of matchers) {
    const existing = sessionStart.find((entry) => entry?.matcher === matcher && Array.isArray(entry.hooks));
    if (existing) {
      existing.hooks = [...existing.hooks, buildHookCommand(command, timeout)];
    } else {
      sessionStart.push({
        matcher,
        hooks: [buildHookCommand(command, timeout)],
      });
    }
  }
  config.hooks.SessionStart = sessionStart;

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const previous = exists(relativePath) ? read(relativePath) : "";
  write(relativePath, next);
  return previous === next ? "exists" : previous ? "updated" : "created";
}

export function upsertHookConfig(): FileStatus {
  return upsertSessionStartHookConfig(".codex/hooks.json", "node .codex/hooks/wiki-session-start.js", ["startup|resume|clear"], 10);
}

export function upsertClaudeHookConfig(): FileStatus {
  return upsertSessionStartHookConfig(".claude/settings.json", "node .claude/hooks/wiki-session-start.js", ["startup", "resume", "clear", "compact"]);
}

export function upsertGeminiHookConfig(): FileStatus {
  return upsertSessionStartHookConfig(".gemini/settings.json", 'node "$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js"', ["startup", "resume", "clear"]);
}

function isCursorHookCommand(value: unknown): value is CursorHookCommand {
  return Boolean(value) && typeof value === "object" && typeof (value as CursorHookCommand).command === "string";
}

export function upsertCursorHookConfig(): FileStatus {
  const relativePath = ".cursor/hooks.json";
  const command = "node .cursor/hooks/wiki-session-start.js";
  const config = parseJson<CursorHookConfig>(relativePath, { version: 1, hooks: {} });
  if (typeof config.version !== "number") config.version = 1;
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  const existing = Array.isArray(config.hooks.sessionStart) ? config.hooks.sessionStart.filter(isCursorHookCommand) : [];
  config.hooks.sessionStart = [
    ...existing.filter((hook) => hook.command !== command),
    { command },
  ];

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const previous = exists(relativePath) ? read(relativePath) : "";
  write(relativePath, next);
  return previous === next ? "exists" : previous ? "updated" : "created";
}

function buildStartupHookScript(output: string): string {
  return `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function readHookInput() {
  try {
    const stat = fs.fstatSync(0);
    if (!stat.isFIFO() && !stat.isFile()) return {};
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const hookInput = readHookInput();
const cwd = process.env.GEMINI_PROJECT_DIR || process.env.CODEX_WORKSPACE_DIR || process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd();

function readIfExists(relativePath, maxChars) {
  const filePath = path.join(cwd, relativePath);
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (text.length <= maxChars) return text;
    return \`\${text.slice(0, maxChars)}\\n\\n[truncated: \${relativePath}]\`;
  } catch {
    return "";
  }
}

const files = [
  ["wiki/startup.md", 3500],
  ["wiki/index.md", 4500],
];

const sections = files
  .map(([relativePath, maxChars]) => {
    const text = readIfExists(relativePath, maxChars);
    if (!text) return "";
    return \`## \${relativePath}\\n\\n\${text}\`;
  })
  .filter(Boolean);

const additionalContext = [
  "[Project wiki startup review]",
  "Injected context: wiki/startup.md and wiki/index.md are ALREADY included below this line.",
  "Do not re-read these two files this session; route any further reads through the index.",
  "Use ./wiki as the project-planning source of truth only. Start with compact routing context; read detailed project canonical, decision, or meta files on demand.",
  "Project canonical content language is selected from user/project context; do not assume a fixed default language.",
  "When project planning content is added, changed, or removed, update ./wiki in the same turn.",
  "Do not put non-project LLM memory or collaboration instructions in project canonical/decision docs; use AGENTS.md, wiki/AGENTS.md, hooks, or skills.",
  "",
  ...sections,
].join("\\n");

process.stdout.write(JSON.stringify({
${output}
}));
`;
}

export const hookScript = buildStartupHookScript(`  continue: true,
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
`);

export const cursorHookScript = buildStartupHookScript(`  additional_context: additionalContext,
`);

export const gitPrepareCommitMsgHook = `#!/bin/sh
MSG_FILE="$1"
SOURCE="$2"

case "$SOURCE" in
  merge|squash|commit)
    exit 0
    ;;
esac

if command -v node >/dev/null 2>&1 && [ -f ".githooks/wiki-commit-trailers.js" ]; then
  node .githooks/wiki-commit-trailers.js "$MSG_FILE"
fi
`;

export const gitWikiCommitTrailersScript = `#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const messagePath = process.argv[2];
if (!messagePath) process.exit(0);

function runGit(args) {
  try {
    return childProcess.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function commandOk(command, args) {
  try {
    childProcess.execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function existingFile(relativePath) {
  try {
    return fs.readFileSync(relativePath, "utf8");
  } catch {
    return "";
  }
}

function truncateList(items) {
  if (items.length === 0) return "none";
  if (items.length <= 3) return items.join(", ");
  return items.slice(0, 3).join(", ") + ", +" + String(items.length - 3);
}

function metadataLine(text, label) {
  const match = text.match(new RegExp("^- " + label + ":\\\\s*(.+)$", "m"));
  return match ? match[1].trim() : "";
}

function migrationStatus(files) {
  const hasMigration = files.some((file) => file.startsWith("wiki/migration/") || file.endsWith("/migration-inbox.md"));
  if (!hasMigration) return "n/a";
  const text = existingFile("wiki/migration/verification.md") + "\\n" + existingFile("wiki/migration/review.md");
  const coverage = metadataLine(text, "coverage") || "unknown";
  const semantic = metadataLine(text, "semantic migration complete") || "unknown";
  const pending = metadataLine(text, "pending") || "unknown";
  const needsHuman = metadataLine(text, "needs-human-review") || "unknown";
  return "coverage " + coverage + "; semantic complete " + semantic + "; pending " + pending + "; needs-human-review " + needsHuman;
}

function wikiScope(files) {
  const scopes = [];
  const add = (name) => {
    if (!scopes.includes(name)) scopes.push(name);
  };
  for (const file of files) {
    if (file.startsWith("wiki/canonical/")) add("canonical");
    else if (file.startsWith("wiki/decisions/")) add("decisions");
    else if (file.startsWith("wiki/meta/")) add("meta");
    else if (file.startsWith("wiki/sources/")) add("sources");
    else if (file.startsWith("wiki/migration/") || file.endsWith("/migration-inbox.md")) add("migration");
    else if (file === "wiki/startup.md") add("startup");
    else if (file === "wiki/index.md") add("index");
    else if (file.startsWith(".codex/hooks/") || file === ".codex/hooks.json") add("codex-hooks");
    else if (file.startsWith(".claude/hooks/") || file === ".claude/settings.json") add("claude-hooks");
    else if (file.startsWith(".cursor/hooks/") || file === ".cursor/hooks.json") add("cursor-hooks");
    else if (file.startsWith(".cursor/rules/")) add("cursor-rules");
    else if (file.startsWith(".gemini/hooks/") || file === ".gemini/settings.json") add("gemini-hooks");
    else if (file === "AGENTS.md" || file === "CLAUDE.md" || file === "GEMINI.md") add("agents");
    else if (file.startsWith(".githooks/")) add("git-hooks");
    else if (file.startsWith("tools/project-librarian/")) add("skill");
  }
  return scopes.length === 0 ? "none" : scopes.join(", ");
}

function installedAgents() {
  const allAgents = ["codex", "claude", "cursor", "gemini"];
  try {
    const state = JSON.parse(existingFile(".project-librarian/install-state.json"));
    const agents = allAgents.filter((agent) => state && state.agents && state.agents[agent] && state.agents[agent].installed === true);
    if (agents.length > 0) return agents;
  } catch {
  }
  const inferred = [];
  if (fs.existsSync(".codex/hooks/wiki-session-start.js") || fs.existsSync(".codex/hooks.json")) inferred.push("codex");
  if (fs.existsSync("CLAUDE.md") || fs.existsSync(".claude/hooks/wiki-session-start.js") || fs.existsSync(".claude/settings.json")) inferred.push("claude");
  if (fs.existsSync(".cursor/rules/project-librarian.mdc") || fs.existsSync(".cursor/hooks/wiki-session-start.js") || fs.existsSync(".cursor/hooks.json")) inferred.push("cursor");
  if (fs.existsSync("GEMINI.md") || fs.existsSync(".gemini/hooks/wiki-session-start.js") || fs.existsSync(".gemini/settings.json")) inferred.push("gemini");
  return inferred.length > 0 ? inferred : allAgents;
}

function validationTrailers() {
  const agents = installedAgents();
  const hasAgent = (name) => agents.includes(name);
  const home = process.env.HOME || "";
  const lintScript = [
    "tools/project-librarian/dist/init-project-wiki.js",
    path.join(home, ".codex/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".claude/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".cursor/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".gemini/skills/project-librarian/dist/init-project-wiki.js"),
  ].find((candidate) => fs.existsSync(candidate));
  const lintOk = Boolean(lintScript) && commandOk("node", [lintScript, "--lint"]);
  const codexSessionHookOk = !hasAgent("codex") || (fs.existsSync(".codex/hooks/wiki-session-start.js") && commandOk("node", [".codex/hooks/wiki-session-start.js"]));
  const claudeSessionHookOk = !hasAgent("claude") || (fs.existsSync(".claude/hooks/wiki-session-start.js") && commandOk("node", [".claude/hooks/wiki-session-start.js"]));
  const cursorSessionHookOk = !hasAgent("cursor") || (fs.existsSync(".cursor/hooks/wiki-session-start.js") && commandOk("node", [".cursor/hooks/wiki-session-start.js"]));
  const cursorHookConfigOk = !hasAgent("cursor") || (fs.existsSync(".cursor/hooks.json") && existingFile(".cursor/hooks.json").includes("node .cursor/hooks/wiki-session-start.js"));
  const geminiSessionHookOk = !hasAgent("gemini") || (fs.existsSync(".gemini/hooks/wiki-session-start.js") && commandOk("node", [".gemini/hooks/wiki-session-start.js"]));
  const geminiHookConfigOk = !hasAgent("gemini") || (fs.existsSync(".gemini/settings.json") && existingFile(".gemini/settings.json").includes('node "$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js"'));
  const geminiInstructionsOk = !hasAgent("gemini") || (fs.existsSync("GEMINI.md") && existingFile("GEMINI.md").includes("@AGENTS.md"));
  const cursorRuleOk = !hasAgent("cursor") || (fs.existsSync(".cursor/rules/project-librarian.mdc") && existingFile(".cursor/rules/project-librarian.mdc").includes("@AGENTS.md"));
  if (lintOk && codexSessionHookOk && claudeSessionHookOk && cursorSessionHookOk && cursorHookConfigOk && geminiSessionHookOk && geminiHookConfigOk && geminiInstructionsOk && cursorRuleOk) {
    const tested = ["project wiki lint"];
    if (hasAgent("codex")) tested.push("Codex wiki session-start hook");
    if (hasAgent("claude")) tested.push("Claude wiki session-start hook");
    if (hasAgent("cursor")) tested.push("Cursor wiki session-start hook and project rule");
    if (hasAgent("gemini")) tested.push("Gemini wiki SessionStart hook and instructions");
    return { tested: tested.join("; "), notTested: "none" };
  }
  const gaps = [];
  if (!lintOk) gaps.push("project wiki lint");
  if (hasAgent("codex") && !codexSessionHookOk) gaps.push("Codex wiki session-start hook");
  if (hasAgent("claude") && !claudeSessionHookOk) gaps.push("Claude wiki session-start hook");
  if (hasAgent("cursor") && !cursorSessionHookOk) gaps.push("Cursor wiki session-start hook");
  if (hasAgent("cursor") && !cursorHookConfigOk) gaps.push("Cursor hook config");
  if (hasAgent("gemini") && !geminiSessionHookOk) gaps.push("Gemini wiki SessionStart hook");
  if (hasAgent("gemini") && !geminiHookConfigOk) gaps.push("Gemini hook config");
  if (hasAgent("cursor") && !cursorRuleOk) gaps.push("Cursor project rule");
  if (hasAgent("gemini") && !geminiInstructionsOk) gaps.push("Gemini instructions");
  return { tested: "prepare-commit-msg generated wiki trailers", notTested: gaps.join("; ") || "unknown" };
}

const staged = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
  .split(/\\r?\\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const wikiFiles = staged.filter((file) => {
  return file.startsWith("wiki/")
    || file === "AGENTS.md"
    || file === "CLAUDE.md"
    || file === "GEMINI.md"
    || file === ".codex/hooks.json"
    || file.startsWith(".codex/hooks/")
    || file === ".claude/settings.json"
    || file.startsWith(".claude/hooks/")
    || file.startsWith(".cursor/rules/")
    || file === ".cursor/hooks.json"
    || file.startsWith(".cursor/hooks/")
    || file === ".gemini/settings.json"
    || file.startsWith(".gemini/hooks/")
    || file.startsWith(".githooks/")
    || file.startsWith("tools/project-librarian/");
});

if (wikiFiles.length === 0) process.exit(0);

let message = fs.readFileSync(messagePath, "utf8");
if (/^Wiki-scope:/m.test(message)) process.exit(0);

const decisionRefs = wikiFiles.filter((file) => file.startsWith("wiki/decisions/") || file === "wiki/meta/wiki-ops-v1-decisions.md");
const validation = validationTrailers();
const trailers = [
  ["Wiki-scope", wikiScope(wikiFiles)],
  ["Canonical-updated", truncateList(wikiFiles.filter((file) => file.startsWith("wiki/canonical/") && !file.endsWith("/migration-inbox.md")))],
  ["Decision-ref", truncateList(decisionRefs)],
  ["Startup-updated", wikiFiles.includes("wiki/startup.md") ? "yes" : "no"],
  ["Index-updated", wikiFiles.includes("wiki/index.md") ? "yes" : "no"],
  ["Migration-status", migrationStatus(wikiFiles)],
  ["Tested", validation.tested],
  ["Not-tested", validation.notTested],
];

const lines = [];
for (const [key, value] of trailers) {
  if (!new RegExp("^" + key + ":", "m").test(message)) lines.push(key + ": " + value);
}
if (lines.length > 0) fs.writeFileSync(messagePath, message.replace(/\\s*$/, "") + "\\n\\n" + lines.join("\\n") + "\\n");
`;
