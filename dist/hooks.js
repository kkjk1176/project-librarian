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
exports.gitWikiCommitTrailersScript = exports.gitPrepareCommitMsgHook = exports.cursorHookScript = exports.hookScript = void 0;
exports.upsertGitHooksPath = upsertGitHooksPath;
exports.upsertHookConfig = upsertHookConfig;
exports.upsertClaudeHookConfig = upsertClaudeHookConfig;
exports.upsertGeminiHookConfig = upsertGeminiHookConfig;
exports.upsertCursorHookConfig = upsertCursorHookConfig;
const childProcess = __importStar(require("node:child_process"));
const args_1 = require("./args");
const workspace_1 = require("./workspace");
function upsertGitHooksPath() {
    if (args_1.noGitConfigMode)
        return "skipped-no-git-config";
    if (!(0, workspace_1.isGitRepository)())
        return "skipped-no-git";
    let previous = "";
    try {
        previous = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
            cwd: workspace_1.root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    }
    catch {
        previous = "";
    }
    if (previous === ".githooks")
        return "exists";
    if (previous)
        return `skipped-existing-hooksPath ${previous}`;
    childProcess.execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
        cwd: workspace_1.root,
        stdio: "ignore",
    });
    return previous ? `updated from ${previous}` : "configured";
}
function buildHookCommand(command, timeout) {
    const hook = { type: "command", command };
    if (typeof timeout === "number")
        hook.timeout = timeout;
    return hook;
}
function upsertSessionStartHookConfig(relativePath, command, matchers, timeout) {
    const config = (0, workspace_1.parseJson)(relativePath, { hooks: {} });
    if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
        config.hooks = {};
    }
    if (!Array.isArray(config.hooks.SessionStart))
        config.hooks.SessionStart = [];
    const sessionStart = config.hooks.SessionStart.flatMap((entry) => {
        if (!Array.isArray(entry?.hooks))
            return [entry];
        const hooks = entry.hooks.filter((hook) => hook?.command !== command);
        return hooks.length > 0 ? [{ ...entry, hooks }] : [];
    });
    for (const matcher of matchers) {
        const existing = sessionStart.find((entry) => entry?.matcher === matcher && Array.isArray(entry.hooks));
        if (existing) {
            existing.hooks = [...existing.hooks, buildHookCommand(command, timeout)];
        }
        else {
            sessionStart.push({
                matcher,
                hooks: [buildHookCommand(command, timeout)],
            });
        }
    }
    config.hooks.SessionStart = sessionStart;
    const next = `${JSON.stringify(config, null, 2)}\n`;
    const previous = (0, workspace_1.exists)(relativePath) ? (0, workspace_1.read)(relativePath) : "";
    (0, workspace_1.write)(relativePath, next);
    return previous === next ? "exists" : previous ? "updated" : "created";
}
function upsertHookConfig() {
    return upsertSessionStartHookConfig(".codex/hooks.json", "node .codex/hooks/wiki-session-start.js", ["startup|resume|clear"], 10);
}
function upsertClaudeHookConfig() {
    return upsertSessionStartHookConfig(".claude/settings.json", "node .claude/hooks/wiki-session-start.js", ["startup", "resume", "clear", "compact"]);
}
function upsertGeminiHookConfig() {
    return upsertSessionStartHookConfig(".gemini/settings.json", 'node "$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js"', ["startup", "resume", "clear"]);
}
function isCursorHookCommand(value) {
    return Boolean(value) && typeof value === "object" && typeof value.command === "string";
}
function upsertCursorHookConfig() {
    const relativePath = ".cursor/hooks.json";
    const command = "node .cursor/hooks/wiki-session-start.js";
    const config = (0, workspace_1.parseJson)(relativePath, { version: 1, hooks: {} });
    if (typeof config.version !== "number")
        config.version = 1;
    if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
        config.hooks = {};
    }
    const existing = Array.isArray(config.hooks.sessionStart) ? config.hooks.sessionStart.filter(isCursorHookCommand) : [];
    config.hooks.sessionStart = [
        ...existing.filter((hook) => hook.command !== command),
        { command },
    ];
    const next = `${JSON.stringify(config, null, 2)}\n`;
    const previous = (0, workspace_1.exists)(relativePath) ? (0, workspace_1.read)(relativePath) : "";
    (0, workspace_1.write)(relativePath, next);
    return previous === next ? "exists" : previous ? "updated" : "created";
}
function buildStartupHookScript(output) {
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
exports.hookScript = buildStartupHookScript(`  continue: true,
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
`);
exports.cursorHookScript = buildStartupHookScript(`  additional_context: additionalContext,
`);
exports.gitPrepareCommitMsgHook = `#!/bin/sh
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
exports.gitWikiCommitTrailersScript = `#!/usr/bin/env node

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

function validationTrailers() {
  const home = process.env.HOME || "";
  const lintScript = [
    "tools/project-librarian/dist/init-project-wiki.js",
    path.join(home, ".codex/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".claude/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".cursor/skills/project-librarian/dist/init-project-wiki.js"),
    path.join(home, ".gemini/skills/project-librarian/dist/init-project-wiki.js"),
  ].find((candidate) => fs.existsSync(candidate));
  const lintOk = Boolean(lintScript) && commandOk("node", [lintScript, "--lint"]);
  const codexSessionHookOk = fs.existsSync(".codex/hooks/wiki-session-start.js") && commandOk("node", [".codex/hooks/wiki-session-start.js"]);
  const claudeSessionHookOk = fs.existsSync(".claude/hooks/wiki-session-start.js") && commandOk("node", [".claude/hooks/wiki-session-start.js"]);
  const cursorSessionHookOk = fs.existsSync(".cursor/hooks/wiki-session-start.js") && commandOk("node", [".cursor/hooks/wiki-session-start.js"]);
  const cursorHookConfigOk = fs.existsSync(".cursor/hooks.json") && existingFile(".cursor/hooks.json").includes("node .cursor/hooks/wiki-session-start.js");
  const geminiSessionHookOk = fs.existsSync(".gemini/hooks/wiki-session-start.js") && commandOk("node", [".gemini/hooks/wiki-session-start.js"]);
  const geminiHookConfigOk = fs.existsSync(".gemini/settings.json") && existingFile(".gemini/settings.json").includes('node "$GEMINI_PROJECT_DIR/.gemini/hooks/wiki-session-start.js"');
  const geminiInstructionsOk = fs.existsSync("GEMINI.md") && existingFile("GEMINI.md").includes("@AGENTS.md");
  const cursorRuleOk = fs.existsSync(".cursor/rules/project-librarian.mdc") && existingFile(".cursor/rules/project-librarian.mdc").includes("@AGENTS.md");
  if (lintOk && codexSessionHookOk && claudeSessionHookOk && cursorSessionHookOk && cursorHookConfigOk && geminiSessionHookOk && geminiHookConfigOk && geminiInstructionsOk && cursorRuleOk) {
    return { tested: "project wiki lint; Codex, Claude, Cursor, and Gemini wiki session-start hooks; Cursor and Gemini instruction files", notTested: "none" };
  }
  const gaps = [];
  if (!lintOk) gaps.push("project wiki lint");
  if (!codexSessionHookOk) gaps.push("Codex wiki session-start hook");
  if (!claudeSessionHookOk) gaps.push("Claude wiki session-start hook");
  if (!cursorSessionHookOk) gaps.push("Cursor wiki session-start hook");
  if (!cursorHookConfigOk) gaps.push("Cursor hook config");
  if (!geminiSessionHookOk) gaps.push("Gemini wiki SessionStart hook");
  if (!geminiHookConfigOk) gaps.push("Gemini hook config");
  if (!cursorRuleOk) gaps.push("Cursor project rule");
  if (!geminiInstructionsOk) gaps.push("Gemini instructions");
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
