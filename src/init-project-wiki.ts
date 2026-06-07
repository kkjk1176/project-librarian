#!/usr/bin/env node

import { captureInboxMode, command, glossaryMode, lintMode, migrateMode, noGitConfigMode, pruneCheckMode, queryTerm, refreshIndexMode, reviewMigrationMode } from "./args";
import { hookScript, gitPrepareCommitMsgHook, gitWikiCommitTrailersScript, upsertClaudeHookConfig, upsertGitHooksPath, upsertHookConfig } from "./hooks";
import { runInstallSkillMode } from "./install-skill";
import { appendCaptureInbox, buildRefreshIndexBlock, runLintMode, runPruneCheckMode, runQueryMode } from "./modes";
import { prepareMigrationMode, runMigrationMode, runReviewMigrationMode } from "./migration";
import { agentsSection, claudeSection, decisionPolicy, glossary, glossaryIndexBlock, inboxIndexBlock, index, starterFiles, startup, wikiAgentsSection, wikiOperatingModel } from "./templates";
import type { MigrationState, ResultRow } from "./types";
import { deleteIfGenerated, makeExecutable, mkdirp, upsertMarkedSection, writeManaged, writeStarter } from "./workspace";
import { withPreservedMarkedSections } from "./wiki-files";

if (command === "install-skill") {
  runInstallSkillMode();
  process.exit(0);
}

if (queryTerm) {
  runQueryMode();
  process.exit(0);
}
if (pruneCheckMode) {
  runPruneCheckMode();
  process.exit(0);
}
if (reviewMigrationMode) {
  runReviewMigrationMode();
  process.exit(0);
}
if (lintMode) {
  runLintMode();
  process.exit(0);
}

const migrationState: MigrationState | null = migrateMode ? prepareMigrationMode() : null;
const results: ResultRow[] = [];
if (migrationState) results.push(["migration prepare", migrationState.note]);

mkdirp("wiki/canonical");
mkdirp("wiki/decisions");
mkdirp("wiki/inbox");
mkdirp("wiki/meta");
mkdirp("wiki/sources");
mkdirp(".codex/hooks");
mkdirp(".claude/hooks");
mkdirp(".githooks");

results.push(["AGENTS.md", upsertMarkedSection("AGENTS.md", "<!-- PROJECT-WIKI-FIRST:START -->", "<!-- PROJECT-WIKI-FIRST:END -->", agentsSection, "## Wiki-First Planning")]);
results.push(["CLAUDE.md", upsertMarkedSection("CLAUDE.md", "<!-- PROJECT-WIKI-CLAUDE:START -->", "<!-- PROJECT-WIKI-CLAUDE:END -->", claudeSection, "# Claude Code Project Instructions")]);
results.push(["wiki/AGENTS.md", upsertMarkedSection("wiki/AGENTS.md", "<!-- PROJECT-WIKI-INTERNAL:START -->", "<!-- PROJECT-WIKI-INTERNAL:END -->", wikiAgentsSection, "## Wiki Internal Rules")]);
results.push([".githooks/prepare-commit-msg", writeManaged(".githooks/prepare-commit-msg", gitPrepareCommitMsgHook)]);
makeExecutable(".githooks/prepare-commit-msg");
results.push([".githooks/wiki-commit-trailers.js", writeManaged(".githooks/wiki-commit-trailers.js", gitWikiCommitTrailersScript)]);
makeExecutable(".githooks/wiki-commit-trailers.js");
results.push(["git core.hooksPath", upsertGitHooksPath()]);
results.push([".codex/hooks.json", upsertHookConfig()]);
results.push([".codex/hooks/wiki-session-start.js", writeManaged(".codex/hooks/wiki-session-start.js", hookScript)]);
results.push([".claude/settings.json", upsertClaudeHookConfig()]);
results.push([".claude/hooks/wiki-session-start.js", writeManaged(".claude/hooks/wiki-session-start.js", hookScript)]);
results.push(["wiki/startup.md", writeManaged("wiki/startup.md", withPreservedMarkedSections("wiki/startup.md", startup, [["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"]]))]);
results.push(["wiki/index.md", writeManaged("wiki/index.md", withPreservedMarkedSections("wiki/index.md", index, [
  ["<!-- PROJECT-WIKI-MIGRATION:START -->", "<!-- PROJECT-WIKI-MIGRATION:END -->"],
  ["<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->"],
  ["<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->"],
  ["<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->"],
]))]);
results.push(["wiki/meta/operating-model.md", writeManaged("wiki/meta/operating-model.md", wikiOperatingModel)]);
results.push(["wiki/meta/decision-policy.md", writeManaged("wiki/meta/decision-policy.md", decisionPolicy)]);
results.push(["wiki/canonical/wiki-operating-model.md", deleteIfGenerated("wiki/canonical/wiki-operating-model.md", ["# Wiki Operating Model"])]);
results.push(["wiki/canonical/decision-policy.md", deleteIfGenerated("wiki/canonical/decision-policy.md", ["# Decision Policy"])]);
results.push(["wiki/decisions/wiki-v1-decisions.md", deleteIfGenerated("wiki/decisions/wiki-v1-decisions.md", ["# Wiki v1 Decisions", "# Wiki Operations v1 Decisions"])]);
for (const [relativePath, content] of Object.entries(starterFiles)) {
  results.push([relativePath, writeStarter(relativePath, content)]);
}
results.push(["wiki/meta/wiki-ops-v1-decisions.md", writeManaged("wiki/meta/wiki-ops-v1-decisions.md", starterFiles["wiki/meta/wiki-ops-v1-decisions.md"])]);
if (glossaryMode) {
  results.push(["wiki/canonical/glossary.md", writeStarter("wiki/canonical/glossary.md", glossary)]);
  results.push(["wiki/index.md glossary router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-GLOSSARY:START -->", "<!-- PROJECT-WIKI-GLOSSARY:END -->", glossaryIndexBlock)]);
}
if (captureInboxMode) {
  results.push(["wiki/inbox/project-candidates.md", appendCaptureInbox()]);
  results.push(["wiki/index.md inbox router", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", inboxIndexBlock)]);
}
if (refreshIndexMode) {
  results.push(["wiki/index.md auto-discovered pages", upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock())]);
}
if (migrateMode && migrationState) {
  const migration = runMigrationMode(migrationState);
  for (const result of migration.results) results.push(result);
  results.push(["migration summary", `${migration.total} files from ${migration.legacyPath || "no legacy"}`]);
}
const modes: string[] = [];
if (migrateMode) modes.push("migration");
if (glossaryMode) modes.push("glossary");
if (captureInboxMode) modes.push("capture-inbox");
if (refreshIndexMode) modes.push("refresh-index");
if (noGitConfigMode) modes.push("no-git-config");
console.log(modes.length > 0 ? `Project wiki bootstrap + ${modes.join(" + ")} complete.` : "Project wiki bootstrap complete.");
for (const [relativePath, status] of results) {
  console.log(`${String(status).padEnd(7)} ${relativePath}`);
}
