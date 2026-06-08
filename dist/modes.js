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
exports.buildRefreshIndexBlock = buildRefreshIndexBlock;
exports.runQueryMode = runQueryMode;
exports.projectCandidatesContent = projectCandidatesContent;
exports.appendCaptureInbox = appendCaptureInbox;
exports.runIssueDraftMode = runIssueDraftMode;
exports.runPruneCheckMode = runPruneCheckMode;
exports.collectLinkDiagnostics = collectLinkDiagnostics;
exports.collectQualityDiagnostics = collectQualityDiagnostics;
exports.runLinkCheckMode = runLinkCheckMode;
exports.runQualityCheckMode = runQualityCheckMode;
exports.runDoctorMode = runDoctorMode;
exports.runLintMode = runLintMode;
const fs = __importStar(require("node:fs"));
const childProcess = __importStar(require("node:child_process"));
const path = __importStar(require("node:path"));
const args_1 = require("./args");
const workspace_1 = require("./workspace");
const templates_1 = require("./templates");
const wiki_files_1 = require("./wiki-files");
function buildRefreshIndexBlock() {
    const indexText = (0, workspace_1.exists)("wiki/index.md") ? (0, workspace_1.read)("wiki/index.md") : "";
    const comparableIndex = (0, wiki_files_1.stripMarkedSection)(indexText, "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->");
    const files = (0, wiki_files_1.wikiMarkdownFiles)().filter((file) => !["wiki/index.md", "wiki/startup.md", "wiki/README.md"].includes(file));
    const missing = files.filter((file) => !comparableIndex.includes((0, wiki_files_1.wikiLinkForFile)(file)));
    const rows = missing.length === 0
        ? "| none | - | - | - |\n"
        : missing.map((file) => {
            const meta = (0, wiki_files_1.metadataSummary)(file, (0, workspace_1.read)(file));
            return `| ${(0, wiki_files_1.wikiLinkForFile)(file)} | ${meta.scope} | ${meta.status} | ${meta.budget} |`;
        }).join("\n") + "\n";
    return `<!-- PROJECT-WIKI-AUTO-INDEX:START -->
## Auto-Discovered Pages

This block is managed by \`--refresh-index\`. Move useful rows into a hand-written section when they become part of the normal route.

| Document | Scope | Status | Token Budget |
| --- | --- | --- | --- |
${rows}<!-- PROJECT-WIKI-AUTO-INDEX:END -->`;
}
function runQueryMode() {
    if (!args_1.queryTerm.trim()) {
        console.error("missing query: use --query \"search terms\"");
        process.exit(1);
    }
    const terms = args_1.queryTerm.toLowerCase().split(/\s+/).filter(Boolean);
    const results = (0, wiki_files_1.wikiMarkdownFiles)().map((file) => {
        const text = (0, workspace_1.read)(file);
        const body = (0, workspace_1.stripMetadataHeader)(text);
        const title = (0, wiki_files_1.wikiTitleForFile)(file, text);
        const meta = (0, wiki_files_1.metadataSummary)(file, text);
        const weighted = `${file}\n${title}\n${meta.scope}\n${(0, workspace_1.metadataValue)(text, "tags")}\n${body}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (weighted.split(term).length - 1) + (file.toLowerCase().includes(term) ? 3 : 0) + (title.toLowerCase().includes(term) ? 5 : 0), 0);
        return { file, title, score, ...meta };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 10);
    console.log(`Project wiki query: ${args_1.queryTerm}`);
    if (results.length === 0)
        console.log("no matches");
    for (const item of results)
        console.log(`${item.score.toString().padStart(3)}  ${item.file}  ${item.scope}  ${item.status}  ${item.title}`);
}
function projectCandidatesContent() {
    return `${(0, templates_1.metadata)("inbox", "on-demand", "wiki/meta/wiki-ops-v1-decisions.md", "candidates are adopted, rejected, or stale")}
# Project Candidates Inbox

## TL;DR

- This file temporarily stores project-canonical candidates from conversation.
- This file is not canonical truth.
- After review, move useful content into canonical/decision/source/meta docs or mark it rejected/resolved.

| Date | Title | Category | Content | Status |
| --- | --- | --- | --- | --- |
`;
}
function appendCaptureInbox() {
    (0, workspace_1.mkdirp)("wiki/inbox");
    const relativePath = "wiki/inbox/project-candidates.md";
    if (!(0, workspace_1.exists)(relativePath))
        (0, workspace_1.write)(relativePath, projectCandidatesContent());
    if (!args_1.captureTitle && !args_1.captureContent)
        return "created";
    const title = (args_1.captureTitle || "Untitled candidate").replace(/\|/g, "/");
    const content = (args_1.captureContent || "").replace(/\r?\n/g, "<br>").replace(/\|/g, "/");
    const row = `| ${workspace_1.today} | ${title} | ${args_1.captureCategory.replace(/\|/g, "/")} | ${content} | pending |`;
    const current = (0, workspace_1.read)(relativePath);
    if (current.includes(row))
        return "exists";
    (0, workspace_1.write)(relativePath, `${current.trimEnd()}\n${row}\n`);
    return "updated";
}
function gitOutput(args) {
    try {
        return childProcess.execFileSync("git", args, {
            cwd: workspace_1.root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    }
    catch {
        return "";
    }
}
function markdownList(items, empty) {
    if (items.length === 0)
        return `- ${empty}`;
    return items.map((item) => `- ${item}`).join("\n");
}
function redactedPath(value) {
    if (!value || value === "unset" || value === "not a git repository")
        return value;
    return path.isAbsolute(value) ? "<absolute-path>" : value;
}
function runtimePackageVersion() {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        return packageJson.version ?? "unknown";
    }
    catch {
        return "unknown";
    }
}
function existingFileList(files) {
    return files.map((file) => `${(0, workspace_1.exists)(file) ? "[x]" : "[ ]"} \`${file}\``);
}
function issueReportTitle() {
    const title = args_1.issueDraftTitle.replace(/\r?\n/g, " ").trim();
    if (title)
        return title;
    return "Report project-wiki-bootstrap problem or side effect";
}
function runIssueDraftMode() {
    const gitRepo = (0, workspace_1.isGitRepository)();
    const statusLines = gitRepo ? gitOutput(["status", "--short"]).split(/\r?\n/).filter(Boolean) : [];
    const branch = gitRepo ? gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown" : "not a git repository";
    const hooksPath = gitRepo ? gitOutput(["config", "--get", "core.hooksPath"]) || "unset" : "not a git repository";
    const remoteNames = gitRepo ? gitOutput(["remote"]).split(/\r?\n/).filter(Boolean) : [];
    const generatedFiles = existingFileList([
        "AGENTS.md",
        "CLAUDE.md",
        "wiki/AGENTS.md",
        "wiki/startup.md",
        "wiki/index.md",
        ".codex/hooks.json",
        ".codex/hooks/wiki-session-start.js",
        ".claude/settings.json",
        ".claude/hooks/wiki-session-start.js",
        ".githooks/prepare-commit-msg",
        ".githooks/wiki-commit-trailers.js",
    ]);
    const title = issueReportTitle();
    const environment = [
        `project-wiki-bootstrap version: ${runtimePackageVersion()}`,
        `node version: ${process.version}`,
        `working directory: ${redactedPath(workspace_1.root)}`,
        `git branch: ${branch}`,
        `git local changes: ${gitRepo ? statusLines.length : "not available"}`,
        `git remotes configured: ${remoteNames.length}`,
        `git core.hooksPath: ${redactedPath(hooksPath)}`,
    ];
    const verification = [
        "Run `npx project-wiki-bootstrap --lint` and paste the output.",
        "If generated wiki links or document quality are involved, run `npx project-wiki-bootstrap --doctor` and paste the output.",
        "If the problem involves code evidence indexing, include the exact `--code-*` command and whether the runtime supports `node:sqlite`.",
    ];
    console.log(`# ${title}

## Summary

Describe the problem, side effect, confusing behavior, or edge case found while using project-wiki-bootstrap.

## What You Were Trying To Do

- Command or natural-language skill request:
- Target project type:
- Expected project-wiki-bootstrap behavior:

## What Happened Instead

- Actual behavior:
- Error output or surprising generated content:
- Whether rerunning changed the result:

## Reproduction Steps

1. 
2. 
3. 

## Side Effects Or Risk

- Files unexpectedly changed:
- Existing content that may have been overwritten or moved:
- Hooks, git config, or agent startup context affected:
- User-visible confusion or workflow breakage:

## Affected Generated Files

${markdownList(generatedFiles, "No standard generated files detected yet.")}

## Environment

${markdownList(environment, "Environment unavailable.")}

## Diagnostics To Attach

${markdownList(verification, "Add the exact validation commands and results before filing.")}

## Workaround

- Current workaround, if any:
- Whether the workaround is safe to repeat:

## Notes

- This draft is read-only and does not create a GitHub issue.
- If local git changes are present, try to reproduce on a clean checkout before filing when practical.
`);
}
function runPruneCheckMode() {
    const candidates = [];
    for (const file of (0, wiki_files_1.wikiMarkdownFiles)()) {
        const text = (0, workspace_1.read)(file);
        const status = (0, workspace_1.metadataValue)(text, "status");
        const updated = (0, workspace_1.metadataValue)(text, "updated");
        const trigger = (0, workspace_1.metadataValue)(text, "review_trigger");
        const scope = (0, workspace_1.metadataValue)(text, "scope");
        const body = (0, workspace_1.stripMetadataHeader)(text);
        const reasons = [];
        const lifecycleScope = /project-canonical|project-decisions|inbox|migration-inbox/.test(scope);
        if (status === "active" && lifecycleScope && /pending|proposed|undecided|TODO|TBD|미정/i.test(body))
            reasons.push("contains pending/proposed/undecided signal");
        if (status === "active" && trigger && /stale|old|expired|due|오래|도래|만료/i.test(trigger))
            reasons.push(`review trigger: ${trigger}`);
        if (updated && updated < workspace_1.today && status === "active")
            reasons.push(`updated before today: ${updated}`);
        if (reasons.length > 0)
            candidates.push({ file, status, updated, reasons });
    }
    console.log("Project wiki prune-check");
    if (candidates.length === 0)
        console.log("no candidates");
    for (const item of candidates) {
        console.log(`${item.file}  status=${item.status || "-"}  updated=${item.updated || "-"}`);
        for (const reason of item.reasons)
            console.log(`  - ${reason}`);
    }
}
function printDiagnostics(title, diagnostics, checked) {
    console.log(title);
    for (const item of diagnostics) {
        console.log(`${item.severity} ${item.code} ${item.file} ${item.message}`);
    }
    const errors = diagnostics.filter((item) => item.severity === "error").length;
    const warnings = diagnostics.length - errors;
    if (errors > 0) {
        console.log(`failed: ${errors} errors, ${warnings} warnings, ${checked} wiki markdown files checked`);
        return false;
    }
    console.log(`passed: ${checked} wiki markdown files checked, ${warnings} warnings`);
    return true;
}
function collectWikiLinkReferences(files) {
    return files.flatMap((file) => (0, wiki_files_1.extractWikiLinks)(file, (0, workspace_1.read)(file)));
}
function collectLinkDiagnostics() {
    const diagnostics = [];
    const files = (0, wiki_files_1.wikiMarkdownFiles)();
    const fileSet = new Set(files);
    const links = collectWikiLinkReferences(files);
    for (const link of links) {
        if (!fileSet.has(link.normalizedTarget)) {
            diagnostics.push({
                code: "broken-link",
                severity: "error",
                file: link.file,
                message: `${link.kind} ${link.target} resolves to missing ${link.normalizedTarget}`,
            });
        }
    }
    if ((0, workspace_1.exists)("wiki/index.md")) {
        const indexLinks = (0, wiki_files_1.extractWikiLinks)("wiki/index.md", (0, workspace_1.read)("wiki/index.md"));
        const indexTargets = new Map();
        for (const link of indexLinks)
            indexTargets.set(link.normalizedTarget, (indexTargets.get(link.normalizedTarget) ?? 0) + 1);
        for (const [target, count] of indexTargets) {
            if (count > 1) {
                diagnostics.push({
                    code: "duplicate-route",
                    severity: "warn",
                    file: "wiki/index.md",
                    message: `${count} index routes resolve to ${target}`,
                });
            }
        }
    }
    const incoming = new Map();
    for (const link of links)
        incoming.set(link.normalizedTarget, (incoming.get(link.normalizedTarget) ?? 0) + 1);
    const orphanExemptions = new Set(["wiki/index.md", "wiki/startup.md", "wiki/README.md"]);
    for (const file of files) {
        if (orphanExemptions.has(file))
            continue;
        if ((incoming.get(file) ?? 0) === 0) {
            diagnostics.push({
                code: "orphan-page",
                severity: "warn",
                file,
                message: "no incoming wiki links; route it from wiki/index.md or remove/merge it",
            });
        }
    }
    return diagnostics.sort((a, b) => a.severity.localeCompare(b.severity) || a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}
function collectQualityDiagnostics() {
    const diagnostics = [];
    const files = (0, wiki_files_1.wikiMarkdownFiles)();
    const titles = new Map();
    for (const file of files) {
        const text = (0, workspace_1.read)(file);
        const body = (0, workspace_1.stripMetadataHeader)(text);
        const title = (0, wiki_files_1.wikiTitleForFile)(file, text).toLowerCase();
        titles.set(title, [...(titles.get(title) ?? []), file]);
        const status = (0, workspace_1.metadataValue)(text, "status");
        const updated = (0, workspace_1.metadataValue)(text, "updated");
        const scope = (0, workspace_1.metadataValue)(text, "scope");
        const budget = (0, workspace_1.metadataValue)(text, "read_budget");
        const tldrExpected = !/startup-router|wiki-router|wiki-entry|project-decision-template/.test(scope);
        if (tldrExpected && !/##\s+TL;DR/.test(body)) {
            diagnostics.push({ code: "missing-tldr", severity: "warn", file, message: "add a compact TL;DR near the top" });
        }
        if (status === "active" && updated && updated < workspace_1.today && /project-canonical|project-decisions|source-summary|wiki-meta/.test(scope)) {
            diagnostics.push({ code: "stale-review", severity: "warn", file, message: `updated before today: ${updated}` });
        }
        if (status === "active" && !/inbox|migration-inbox/.test(scope) && /proposed|undecided|TODO|TBD|미정/i.test(body)) {
            diagnostics.push({ code: "unresolved-signal", severity: "warn", file, message: "contains pending/proposed/undecided language" });
        }
        const shortLimit = file === "wiki/index.md" ? 4500 : 3500;
        if (budget === "short" && text.length > shortLimit) {
            diagnostics.push({ code: "budget-drift", severity: "warn", file, message: `${text.length}/${shortLimit} chars for short read_budget` });
        }
        else if (budget === "medium" && text.length > 8000) {
            diagnostics.push({ code: "budget-drift", severity: "warn", file, message: `${text.length}/8000 chars for medium read_budget` });
        }
        if (file.startsWith("wiki/canonical/") && /Code-proven behavior:/i.test(body) && !/evidence:\s*`?[\w./-]+/i.test(body)) {
            diagnostics.push({ code: "missing-evidence", severity: "warn", file, message: "code-proven canonical claims should cite concrete evidence paths" });
        }
        if (scope === "source-summary" && !/https?:\/\//.test(body)) {
            diagnostics.push({ code: "missing-source-link", severity: "warn", file, message: "source summaries should retain at least one source URL" });
        }
    }
    for (const [title, titleFiles] of titles) {
        if (titleFiles.length > 1) {
            for (const file of titleFiles) {
                diagnostics.push({ code: "duplicate-title", severity: "warn", file, message: `title also appears in ${titleFiles.filter((item) => item !== file).join(", ")}` });
            }
        }
    }
    return diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
}
function runLinkCheckMode() {
    const ok = printDiagnostics("Project wiki link-check", collectLinkDiagnostics(), (0, wiki_files_1.wikiMarkdownFiles)().length);
    if (!ok)
        process.exit(1);
}
function runQualityCheckMode() {
    const ok = printDiagnostics("Project wiki quality-check", collectQualityDiagnostics(), (0, wiki_files_1.wikiMarkdownFiles)().length);
    if (!ok)
        process.exit(1);
}
function runDoctorMode(fix) {
    if (fix) {
        console.log("Project wiki doctor --fix");
        if ((0, workspace_1.exists)("wiki/index.md")) {
            (0, workspace_1.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-AUTO-INDEX:START -->", "<!-- PROJECT-WIKI-AUTO-INDEX:END -->", buildRefreshIndexBlock());
            console.log("updated wiki/index.md auto-discovered pages");
        }
        else {
            console.log("skipped wiki/index.md auto-discovered pages: missing wiki/index.md");
        }
    }
    const files = (0, wiki_files_1.wikiMarkdownFiles)();
    const linkOk = printDiagnostics("Project wiki link-check", collectLinkDiagnostics(), files.length);
    const qualityOk = printDiagnostics("Project wiki quality-check", collectQualityDiagnostics(), files.length);
    runLintMode();
    if (!linkOk || !qualityOk)
        process.exit(1);
}
function runLintMode() {
    const errors = [];
    const warnings = [];
    const requiredFiles = [
        "AGENTS.md",
        "CLAUDE.md",
        "wiki/AGENTS.md",
        "wiki/startup.md",
        "wiki/index.md",
        "wiki/canonical/project-brief.md",
        "wiki/canonical/open-questions.md",
        "wiki/canonical/assumptions.md",
        "wiki/canonical/risks.md",
        "wiki/decisions/log.md",
        "wiki/decisions/recent.md",
        "wiki/meta/operating-model.md",
        "wiki/meta/decision-policy.md",
        "wiki/meta/wiki-ops-v1-decisions.md",
        ".githooks/prepare-commit-msg",
        ".githooks/wiki-commit-trailers.js",
        ".codex/hooks/wiki-session-start.js",
        ".codex/hooks.json",
        ".claude/hooks/wiki-session-start.js",
        ".claude/settings.json",
    ];
    for (const file of requiredFiles) {
        if (!(0, workspace_1.exists)(file))
            errors.push(`missing required file: ${file}`);
    }
    const files = (0, wiki_files_1.wikiMarkdownFiles)();
    const requiredMetadataKeys = ["status", "updated", "scope", "read_budget", "decision_ref", "review_trigger"];
    for (const file of files) {
        const text = (0, workspace_1.read)(file);
        if (!(0, workspace_1.hasMetadataHeader)(text)) {
            errors.push(`missing metadata header: ${file}`);
            continue;
        }
        for (const key of requiredMetadataKeys) {
            if (!(0, workspace_1.metadataValue)(text, key))
                errors.push(`missing metadata key ${key}: ${file}`);
        }
    }
    const startupLength = (0, workspace_1.exists)("wiki/startup.md") ? (0, workspace_1.read)("wiki/startup.md").length : 0;
    const indexLength = (0, workspace_1.exists)("wiki/index.md") ? (0, workspace_1.read)("wiki/index.md").length : 0;
    if (startupLength > 3500)
        warnings.push(`startup exceeds hook budget: ${startupLength}/3500 chars`);
    if (indexLength > 4500)
        warnings.push(`index exceeds hook budget: ${indexLength}/4500 chars`);
    if ((0, workspace_1.exists)("wiki/startup.md") && /##\s+Always Read First/.test((0, workspace_1.read)("wiki/startup.md")))
        warnings.push("startup uses Always Read First; prefer Read On Demand routing");
    if ((0, workspace_1.exists)("AGENTS.md") && !(0, workspace_1.read)("AGENTS.md").includes("wiki/AGENTS.md"))
        warnings.push("root AGENTS.md should point detailed wiki editing rules to wiki/AGENTS.md");
    if ((0, workspace_1.exists)("CLAUDE.md") && !(0, workspace_1.read)("CLAUDE.md").includes("@AGENTS.md"))
        errors.push("CLAUDE.md should import AGENTS.md for Claude Code compatibility");
    if ((0, workspace_1.exists)("wiki/AGENTS.md") && !(0, workspace_1.read)("wiki/AGENTS.md").includes("Language policy"))
        warnings.push("wiki/AGENTS.md is missing language policy");
    for (const legacyFile of ["wiki/canonical/wiki-operating-model.md", "wiki/canonical/decision-policy.md", "wiki/decisions/wiki-v1-decisions.md"]) {
        if ((0, workspace_1.exists)(legacyFile))
            errors.push(`legacy wiki-ops file must move out of project canonical/decisions: ${legacyFile}`);
    }
    if ((0, workspace_1.exists)(".codex/hooks/wiki-session-start.js")) {
        const hook = (0, workspace_1.read)(".codex/hooks/wiki-session-start.js");
        if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]'))
            errors.push("startup hook does not clearly inject only startup/index with expected budgets");
    }
    if ((0, workspace_1.exists)(".claude/hooks/wiki-session-start.js")) {
        const hook = (0, workspace_1.read)(".claude/hooks/wiki-session-start.js");
        if (!hook.includes('["wiki/startup.md", 3500]') || !hook.includes('["wiki/index.md", 4500]'))
            errors.push("Claude startup hook does not clearly inject only startup/index with expected budgets");
    }
    if ((0, workspace_1.exists)(".claude/settings.json")) {
        const command = "node .claude/hooks/wiki-session-start.js";
        try {
            const settings = (0, workspace_1.parseJson)(".claude/settings.json", { hooks: {} });
            if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
                throw new Error(".claude/settings.json has invalid hooks object");
            }
            const sessionStart = settings.hooks.SessionStart ?? [];
            const configuredMatchers = new Set(sessionStart
                .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.some((hook) => hook.command === command))
                .map((entry) => entry.matcher));
            for (const matcher of ["startup", "resume", "clear", "compact"]) {
                if (!configuredMatchers.has(matcher))
                    errors.push(`.claude/settings.json is missing the project wiki SessionStart hook for ${matcher}`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
        }
    }
    for (const file of [".githooks/prepare-commit-msg", ".githooks/wiki-commit-trailers.js"]) {
        if ((0, workspace_1.exists)(file) && (fs.statSync((0, workspace_1.abs)(file)).mode & 0o111) === 0)
            errors.push(`${file} is not executable`);
    }
    if ((0, workspace_1.isGitRepository)() && !args_1.noGitConfigMode) {
        let hooksPath = "";
        try {
            hooksPath = childProcess.execFileSync("git", ["config", "--get", "core.hooksPath"], {
                cwd: workspace_1.root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
        }
        catch {
            hooksPath = "";
        }
        if (hooksPath !== ".githooks")
            warnings.push(`git core.hooksPath is not .githooks: ${hooksPath || "unset"}`);
    }
    if ((0, workspace_1.exists)("wiki/index.md") && !(0, workspace_1.read)("wiki/index.md").includes("## Language Policy"))
        errors.push("index is missing Language Policy section");
    if ((0, workspace_1.exists)("wiki/canonical/glossary.md")) {
        const glossaryText = (0, workspace_1.read)("wiki/canonical/glossary.md");
        if (!(0, wiki_files_1.hasGlossaryTable)(glossaryText))
            errors.push("glossary is missing required table header: | Term | Definition | Avoid | Related Canonical Doc | Status |");
        if ((0, workspace_1.exists)("wiki/index.md") && !(0, workspace_1.read)("wiki/index.md").includes("[[canonical/glossary]]"))
            errors.push("glossary exists but index is missing glossary routing");
    }
    else if ((0, wiki_files_1.hasGlossaryNeedSignal)((0, wiki_files_1.canonicalBodyForLint)())) {
        warnings.push("project canonical docs contain naming/model signals; consider running --glossary-init");
    }
    if ((0, workspace_1.exists)("wiki/meta/wiki-ops-v1-decisions.md")) {
        const ops = (0, workspace_1.read)("wiki/meta/wiki-ops-v1-decisions.md");
        for (const phrase of ["metadata headers", "Read On Demand", "language", "--no-git-config", "needs-human-review", "Wiki-scope"]) {
            if (!ops.includes(phrase))
                warnings.push(`wiki ops decision pack may be missing decision phrase: ${phrase}`);
        }
    }
    console.log("Project wiki lint");
    for (const warning of warnings)
        console.log(`warn  ${warning}`);
    for (const error of errors)
        console.log(`error ${error}`);
    if (errors.length > 0) {
        console.log(`failed: ${errors.length} errors, ${warnings.length} warnings`);
        process.exit(1);
    }
    console.log(`passed: ${files.length} wiki markdown files checked, ${warnings.length} warnings`);
}
