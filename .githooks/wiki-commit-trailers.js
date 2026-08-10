#!/usr/bin/env node

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

function wikiScope(files) {
  const scopes = [];
  const add = (name) => {
    if (!scopes.includes(name)) scopes.push(name);
  };
  for (const file of files) {
    if (file.startsWith("wiki/00-index/")) add("index");
    else if (file.startsWith("wiki/01-governance/")) add("governance");
    else if (file.startsWith("wiki/10-services/")) add("services-prds");
    else if (file.startsWith("wiki/20-shared/")) add("shared");
    else if (file.startsWith("wiki/30-portfolio/")) add("portfolio");
    else if (file.startsWith("wiki/90-archive/")) add("archive");
    else if (file.startsWith("wiki/canonical/")) add("legacy-canonical");
    else if (file.startsWith("wiki/decisions/")) add("decisions");
    else if (file.startsWith("wiki/meta/")) add("meta");
    else if (file.startsWith("wiki/sources/")) add("sources");
    else if (file === "wiki/startup.md") add("startup");
    else if (file === "wiki/index.md") add("index");
    else if (file.startsWith(".codex/hooks/") || file === ".codex/hooks.json") add("codex-hooks");
    else if (file.startsWith(".claude/hooks/") || file === ".claude/settings.json") add("claude-hooks");
    else if (file.startsWith(".cursor/hooks/") || file === ".cursor/hooks.json") add("cursor-hooks");
    else if (file.startsWith(".cursor/rules/")) add("cursor-rules");
    else if (file.startsWith(".gemini/hooks/") || file === ".gemini/settings.json") add("gemini-hooks");
    else if (file === "AGENTS.md" || file === "CLAUDE.md" || file === "GEMINI.md") add("agents");
    else if (file.startsWith(".githooks/")) add("git-hooks");
    else if (file.startsWith("tools/project-librarian/") || file.startsWith(".agents/skills/project-librarian/")) add("skill");
  }
  return scopes.length === 0 ? "none" : scopes.join(", ");
}

function validationTrailers() {
  const home = process.env.HOME || "";
  const lintScript = [
    "tools/project-librarian/dist/init-project-wiki.js",
    ".agents/skills/project-librarian/dist/init-project-wiki.js",
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
  .split(/\r?\n/)
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
    || file.startsWith("tools/project-librarian/")
    || file.startsWith(".agents/skills/project-librarian/");
});

if (wikiFiles.length === 0) process.exit(0);

let message = fs.readFileSync(messagePath, "utf8");
if (/^Wiki-scope:/m.test(message)) process.exit(0);

const decisionRefs = wikiFiles.filter((file) => file.startsWith("wiki/decisions/") || /\/09-decisions\//.test(file) || file === "wiki/meta/wiki-ops-v1-decisions.md" || file === "wiki/meta/wiki-ops-v2-decisions.md");
const validation = validationTrailers();
const trailers = [
  ["Wiki-scope", wikiScope(wikiFiles)],
  ["Canonical-updated", truncateList(wikiFiles.filter((file) => file.startsWith("wiki/10-services/") || file.startsWith("wiki/20-shared/") || file.startsWith("wiki/canonical/")))],
  ["Decision-ref", truncateList(decisionRefs)],
  ["Startup-updated", wikiFiles.includes("wiki/startup.md") ? "yes" : "no"],
  ["Index-updated", wikiFiles.includes("wiki/index.md") ? "yes" : "no"],
  ["Tested", validation.tested],
  ["Not-tested", validation.notTested],
];

const lines = [];
for (const [key, value] of trailers) {
  if (!new RegExp("^" + key + ":", "m").test(message)) lines.push(key + ": " + value);
}
if (lines.length > 0) fs.writeFileSync(messagePath, message.replace(/\s*$/, "") + "\n\n" + lines.join("\n") + "\n");
