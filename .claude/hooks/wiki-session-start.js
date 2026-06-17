#!/usr/bin/env node

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
    return `${text.slice(0, maxChars)}\n\n[truncated: ${relativePath}]`;
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
    return `## ${relativePath}\n\n${text}`;
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
].join("\n");

process.stdout.write(JSON.stringify({
  continue: true,
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },

}));
