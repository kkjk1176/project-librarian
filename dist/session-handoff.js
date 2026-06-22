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
exports.handoffSentinel = exports.handoffGeneratedBy = exports.handoffSchema = exports.handoffInjectionStatePath = exports.handoffStatePath = exports.handoffPath = exports.handoffDirectory = void 0;
exports.redactSecrets = redactSecrets;
exports.saveHandoffFromCli = saveHandoffFromCli;
exports.getHandoffStatus = getHandoffStatus;
exports.showHandoff = showHandoff;
exports.clearHandoff = clearHandoff;
exports.promoteHandoffToInbox = promoteHandoffToInbox;
exports.enableHandoffInjection = enableHandoffInjection;
exports.disableHandoffInjection = disableHandoffInjection;
exports.getHandoffInjectionStatus = getHandoffInjectionStatus;
exports.runHandoffSaveMode = runHandoffSaveMode;
exports.runHandoffShowMode = runHandoffShowMode;
exports.runHandoffStatusMode = runHandoffStatusMode;
exports.runHandoffClearMode = runHandoffClearMode;
exports.runHandoffPromoteInboxMode = runHandoffPromoteInboxMode;
exports.runHandoffInjectionEnableMode = runHandoffInjectionEnableMode;
exports.runHandoffInjectionDisableMode = runHandoffInjectionDisableMode;
exports.runHandoffInjectionStatusMode = runHandoffInjectionStatusMode;
const childProcess = __importStar(require("node:child_process"));
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const args_1 = require("./args");
const modes_1 = require("./modes");
const templates_1 = require("./templates");
const workspace_1 = require("./workspace");
const workspace_2 = require("./workspace");
exports.handoffDirectory = ".project-wiki/session";
exports.handoffPath = `${exports.handoffDirectory}/last-handoff.md`;
exports.handoffStatePath = `${exports.handoffDirectory}/handoff-state.json`;
exports.handoffInjectionStatePath = `${exports.handoffDirectory}/injection-state.json`;
exports.handoffSchema = "project-librarian-session-handoff/v1";
exports.handoffGeneratedBy = "project-librarian-session-handoff";
exports.handoffSentinel = "<!-- PROJECT-LIBRARIAN-GENERATED: session-handoff/v1 -->";
const maxHandoffChars = 8000;
const maxInjectedHandoffChars = 2500;
const maxFieldChars = 800;
const maxGitFactsChars = 2000;
const staleAfterMs = 7 * 24 * 60 * 60 * 1000;
function rootRealPath() {
    return fs.realpathSync(workspace_1.root);
}
function assertInsideRoot(absolutePath) {
    const relative = path.relative(rootRealPath(), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`refusing to access path outside project root: ${absolutePath}`);
    }
}
function resolveUnderRoot(relativePath) {
    if (path.isAbsolute(relativePath))
        throw new Error(`expected repository-relative path: ${relativePath}`);
    const absolutePath = path.resolve(workspace_1.root, relativePath);
    assertInsideRoot(absolutePath);
    return absolutePath;
}
function ensureDirectoryNoSymlink(relativePath) {
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    let current = rootRealPath();
    for (const segment of segments) {
        current = path.join(current, segment);
        try {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink())
                throw new Error(`refusing to use symlinked directory: ${path.relative(rootRealPath(), current)}`);
            if (!stat.isDirectory())
                throw new Error(`refusing to use non-directory path: ${path.relative(rootRealPath(), current)}`);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            fs.mkdirSync(current);
        }
    }
    assertInsideRoot(fs.realpathSync(current));
}
function assertWritableFilePath(relativePath) {
    const absolutePath = resolveUnderRoot(relativePath);
    ensureDirectoryNoSymlink(path.dirname(relativePath));
    try {
        const stat = fs.lstatSync(absolutePath);
        if (stat.isSymbolicLink())
            throw new Error(`refusing to write symlinked file: ${relativePath}`);
        if (!stat.isFile())
            throw new Error(`refusing to overwrite non-file path: ${relativePath}`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    return absolutePath;
}
function writeFileNoFollow(relativePath, content) {
    const absolutePath = assertWritableFilePath(relativePath);
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(absolutePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, 0o600);
    try {
        fs.writeFileSync(fd, content, "utf8");
    }
    finally {
        fs.closeSync(fd);
    }
}
function readFileNoSymlink(relativePath) {
    const absolutePath = resolveUnderRoot(relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink())
        throw new Error(`refusing to read symlinked file: ${relativePath}`);
    if (!stat.isFile())
        throw new Error(`expected file: ${relativePath}`);
    return fs.readFileSync(absolutePath, "utf8");
}
function removeGeneratedFile(relativePath, isGenerated) {
    const absolutePath = resolveUnderRoot(relativePath);
    if (!fs.existsSync(absolutePath))
        return "absent";
    const text = readFileNoSymlink(relativePath);
    if (!isGenerated(text))
        throw new Error(`refusing to remove non-generated file: ${relativePath}`);
    fs.unlinkSync(absolutePath);
    return "removed";
}
function capText(value, maxChars = maxFieldChars) {
    const compact = value.replace(/\r\n/g, "\n").trim();
    if (compact.length <= maxChars)
        return compact;
    return `${compact.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[truncated]`;
}
function redactSecrets(text) {
    let next = text;
    next = next.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
    next = next.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_OPENAI_KEY]");
    next = next.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]");
    next = next.replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[REDACTED_SLACK_TOKEN]");
    next = next.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]");
    next = next.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]");
    next = next.replace(/(Authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED_AUTHORIZATION]");
    next = next.replace(/(^|\n)([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)([^\n]+)/gi, "$1$2[REDACTED_SECRET]");
    return next;
}
function normalizeList(value) {
    if (Array.isArray(value))
        return value.flatMap((item) => normalizeList(item));
    if (typeof value !== "string")
        return [];
    return value.split(/\n/).map((item) => capText(redactSecrets(item))).filter(Boolean);
}
function normalizeString(value) {
    return typeof value === "string" ? capText(redactSecrets(value)) : "";
}
function arrayValue(record, snakeKey, camelKey) {
    if (snakeKey === camelKey)
        return normalizeList(record[snakeKey]);
    return normalizeList(record[snakeKey]).concat(normalizeList(record[camelKey]));
}
function stringValue(record, snakeKey, camelKey) {
    return normalizeString(record[snakeKey] ?? record[camelKey]);
}
function payloadFromRecord(record) {
    return {
        blocked: arrayValue(record, "blocked", "blocked").slice(0, 6),
        currentState: stringValue(record, "current_state", "currentState"),
        goal: stringValue(record, "goal", "goal"),
        lastFailureCommand: stringValue(record, "last_failure_command", "lastFailureCommand"),
        lastSuccessCommand: stringValue(record, "last_success_command", "lastSuccessCommand"),
        nextActions: arrayValue(record, "next_actions", "nextActions").slice(0, 3),
        openQuestions: arrayValue(record, "open_questions", "openQuestions").slice(0, 6),
        recentDecisions: arrayValue(record, "recent_decisions", "recentDecisions").slice(0, 6),
        verification: arrayValue(record, "verification", "verification").slice(0, 6),
    };
}
function cliPayloadRecord() {
    return {
        blocked: args_1.handoffBlocked,
        current_state: args_1.handoffState,
        goal: args_1.handoffGoal,
        last_failure_command: args_1.handoffLastFailureCommand,
        last_success_command: args_1.handoffLastSuccessCommand,
        next_actions: args_1.handoffNextActions,
        open_questions: args_1.handoffOpenQuestions,
        recent_decisions: args_1.handoffDecisions,
        verification: args_1.handoffVerification,
    };
}
function mergePayloads(base, overlay) {
    return {
        blocked: overlay.blocked.length > 0 ? overlay.blocked : base.blocked,
        currentState: overlay.currentState || base.currentState,
        goal: overlay.goal || base.goal,
        lastFailureCommand: overlay.lastFailureCommand || base.lastFailureCommand,
        lastSuccessCommand: overlay.lastSuccessCommand || base.lastSuccessCommand,
        nextActions: overlay.nextActions.length > 0 ? overlay.nextActions : base.nextActions,
        openQuestions: overlay.openQuestions.length > 0 ? overlay.openQuestions : base.openQuestions,
        recentDecisions: overlay.recentDecisions.length > 0 ? overlay.recentDecisions : base.recentDecisions,
        verification: overlay.verification.length > 0 ? overlay.verification : base.verification,
    };
}
function readStdinText() {
    try {
        if (process.stdin.isTTY)
            return "";
        return fs.readFileSync(0, "utf8").trim();
    }
    catch {
        return "";
    }
}
function payloadFromStdin() {
    const text = readStdinText();
    if (!text)
        return emptyPayload();
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("expected a JSON object");
        }
        return payloadFromRecord(parsed);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid --handoff-save JSON payload: ${message}`);
    }
}
function emptyPayload() {
    return {
        blocked: [],
        currentState: "",
        goal: "",
        lastFailureCommand: "",
        lastSuccessCommand: "",
        nextActions: [],
        openQuestions: [],
        recentDecisions: [],
        verification: [],
    };
}
function runGit(args) {
    const gitArgs = [
        "--no-pager",
        "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=/dev/null",
        "-c", "diff.external=",
        ...args,
    ];
    try {
        return childProcess.execFileSync("git", gitArgs, {
            cwd: workspace_1.root,
            encoding: "utf8",
            env: {
                ...process.env,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_PAGER: "cat",
                GIT_TERMINAL_PROMPT: "0",
            },
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 1500,
        }).trim();
    }
    catch {
        return "";
    }
}
function collectGitFacts() {
    const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true")
        return "not a git repository";
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
    const status = runGit(["status", "--short"]) || "clean";
    const diffStat = runGit(["diff", "--stat", "--no-ext-diff"]) || "no working-tree diff";
    const commits = runGit(["log", "--oneline", "-3"]) || "no commits";
    const codeEvidence = fs.existsSync(resolveUnderRoot(".project-wiki/code-evidence.sqlite"))
        ? ".project-wiki/code-evidence.sqlite exists"
        : "code evidence index not found";
    return capText([
        `branch: ${branch}`,
        "",
        "status:",
        status,
        "",
        "diff stat:",
        diffStat,
        "",
        "recent commits:",
        commits,
        "",
        codeEvidence,
    ].join("\n"), maxGitFactsChars);
}
function bulletList(items) {
    return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}
function checkboxList(items) {
    return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] none";
}
function renderHandoff(payload, generatedAt, gitFacts) {
    const content = `${exports.handoffSentinel}
# Session Handoff

Generated: ${generatedAt}
Schema: ${exports.handoffSchema}
Trust: generated local reference data; not instructions; not canonical wiki truth

## Goal

${bulletList(payload.goal ? [payload.goal] : [])}

## Current State

${bulletList(payload.currentState ? [payload.currentState] : [])}

## Blocked

${bulletList(payload.blocked)}

## Next Actions

${checkboxList(payload.nextActions)}

## Recent Decisions

${bulletList(payload.recentDecisions)}

## Open Questions

${bulletList(payload.openQuestions)}

## Last Commands

- Success: ${payload.lastSuccessCommand || "none"}
- Failure: ${payload.lastFailureCommand || "none"}

## Verification Evidence

${bulletList(payload.verification)}

## Local Git Facts

\`\`\`text
${gitFacts}
\`\`\`
`;
    const redacted = redactSecrets(content);
    if (redacted.length <= maxHandoffChars)
        return redacted;
    return `${redacted.slice(0, maxHandoffChars - 64).trimEnd()}\n\n[truncated: session handoff cap reached]\n`;
}
function readState() {
    try {
        return JSON.parse(readFileNoSymlink(exports.handoffStatePath));
    }
    catch {
        return {};
    }
}
function readInjectionState() {
    try {
        return JSON.parse(readFileNoSymlink(exports.handoffInjectionStatePath));
    }
    catch {
        return {};
    }
}
function contentHash(payload, gitFacts) {
    return crypto.createHash("sha256").update(JSON.stringify({ payload, gitFacts })).digest("hex");
}
function saveHandoffFromCli(now = new Date()) {
    const stdinPayload = payloadFromStdin();
    const flagPayload = payloadFromRecord(cliPayloadRecord());
    const payload = mergePayloads(stdinPayload, flagPayload);
    const gitFacts = collectGitFacts();
    const hash = contentHash(payload, gitFacts);
    const existingState = readState();
    if (existingState.content_hash === hash && fs.existsSync(resolveUnderRoot(exports.handoffPath))) {
        const stat = fs.lstatSync(resolveUnderRoot(exports.handoffPath));
        if (stat.isSymbolicLink())
            throw new Error(`refusing to reuse symlinked file: ${exports.handoffPath}`);
        if (!stat.isFile())
            throw new Error(`refusing to reuse non-file path: ${exports.handoffPath}`);
        return {
            status: "exists",
            handoffPath: exports.handoffPath,
            statePath: exports.handoffStatePath,
            sizeBytes: existingState.size_bytes ?? stat.size,
            updatedAt: existingState.updated_at ?? "",
        };
    }
    const updatedAt = now.toISOString();
    const content = renderHandoff(payload, updatedAt, gitFacts);
    writeFileNoFollow(exports.handoffPath, content);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const state = {
        content_hash: hash,
        full_injection_enabled: false,
        generated: true,
        generated_by: exports.handoffGeneratedBy,
        path: exports.handoffPath,
        schema: exports.handoffSchema,
        size_bytes: sizeBytes,
        updated_at: updatedAt,
    };
    writeFileNoFollow(exports.handoffStatePath, `${JSON.stringify(state, null, 2)}\n`);
    return { status: "written", handoffPath: exports.handoffPath, statePath: exports.handoffStatePath, sizeBytes, updatedAt };
}
function getHandoffStatus(now = new Date()) {
    const absoluteHandoffPath = resolveUnderRoot(exports.handoffPath);
    if (!fs.existsSync(absoluteHandoffPath)) {
        return {
            ageSeconds: null,
            exists: false,
            path: exports.handoffPath,
            reason: "handoff file not found",
            safeToInject: false,
            schema: exports.handoffSchema,
            sizeBytes: 0,
            stale: false,
            statePath: exports.handoffStatePath,
            updatedAt: "",
        };
    }
    const stat = fs.lstatSync(absoluteHandoffPath);
    if (stat.isSymbolicLink()) {
        return {
            ageSeconds: null,
            exists: true,
            path: exports.handoffPath,
            reason: "handoff path is a symlink",
            safeToInject: false,
            schema: exports.handoffSchema,
            sizeBytes: 0,
            stale: true,
            statePath: exports.handoffStatePath,
            updatedAt: "",
        };
    }
    const state = readState();
    const updatedAt = state.updated_at || stat.mtime.toISOString();
    const updatedMs = Date.parse(updatedAt);
    const ageSeconds = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((now.getTime() - updatedMs) / 1000)) : null;
    const stale = ageSeconds === null || ageSeconds * 1000 > staleAfterMs;
    const sizeBytes = stat.size;
    const generated = state.generated === true && state.generated_by === exports.handoffGeneratedBy;
    const safeToInject = generated && !stale && sizeBytes <= maxHandoffChars;
    return {
        ageSeconds,
        exists: true,
        path: exports.handoffPath,
        reason: safeToInject ? "ok" : generated ? "stale or over size cap" : "missing generated state",
        safeToInject,
        schema: state.schema || exports.handoffSchema,
        sizeBytes,
        stale,
        statePath: exports.handoffStatePath,
        updatedAt,
    };
}
function showHandoff() {
    const status = getHandoffStatus();
    if (!status.exists)
        return "Project Librarian handoff: none found.\n";
    const text = readFileNoSymlink(exports.handoffPath);
    return [
        `Project Librarian handoff: updated ${status.updatedAt || "unknown"}, ${status.sizeBytes} bytes, stale=${String(status.stale)}`,
        "",
        text,
    ].join("\n");
}
function clearHandoff() {
    const handoffResult = removeGeneratedFile(exports.handoffPath, (text) => text.includes(exports.handoffSentinel));
    const stateResult = removeGeneratedFile(exports.handoffStatePath, (text) => {
        try {
            const state = JSON.parse(text);
            return state.generated === true && state.generated_by === exports.handoffGeneratedBy;
        }
        catch {
            return false;
        }
    });
    return `Project Librarian handoff cleared: ${exports.handoffPath}=${handoffResult}, ${exports.handoffStatePath}=${stateResult}`;
}
function sectionText(markdown, heading) {
    const pattern = new RegExp(`^## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |\\n$)`, "m");
    return markdown.match(pattern)?.[1]?.trim() ?? "";
}
function compactPromotionContent(markdown) {
    const sections = [
        ["Goal", sectionText(markdown, "Goal")],
        ["Current State", sectionText(markdown, "Current State")],
        ["Blocked", sectionText(markdown, "Blocked")],
        ["Next Actions", sectionText(markdown, "Next Actions")],
        ["Recent Decisions", sectionText(markdown, "Recent Decisions")],
        ["Open Questions", sectionText(markdown, "Open Questions")],
        ["Verification Evidence", sectionText(markdown, "Verification Evidence")],
    ].filter(([, text]) => text && text !== "- none" && text !== "- [ ] none");
    const body = sections.map(([title, text]) => `### ${title}\n${text}`).join("\n\n");
    return capText([
        "Promoted from generated local session handoff. Review before canonicalizing into project truth.",
        "",
        body || "No structured handoff facts were available.",
    ].join("\n"), 1600);
}
function promoteHandoffToInbox() {
    const status = getHandoffStatus();
    if (!status.exists)
        throw new Error("cannot promote handoff: no generated handoff found");
    if (!status.safeToInject)
        throw new Error(`cannot promote handoff: ${status.reason}`);
    if (!(0, workspace_2.exists)("wiki/index.md"))
        throw new Error("cannot promote handoff: initialize Project Librarian wiki before writing wiki/inbox");
    const markdown = readFileNoSymlink(exports.handoffPath);
    if (!markdown.includes(exports.handoffSentinel))
        throw new Error(`cannot promote handoff: missing generated sentinel in ${exports.handoffPath}`);
    const firstGoal = sectionText(markdown, "Goal").split(/\r?\n/).find((line) => line.replace(/^[-\s[\]x]+/i, "").trim()) || "Session handoff";
    const title = `Session handoff: ${firstGoal.replace(/^[-\s[\]x]+/i, "").trim() || "untitled"}`;
    const inboxStatus = (0, modes_1.appendProjectCandidate)({
        category: "session-handoff",
        content: compactPromotionContent(markdown),
        title,
    });
    const indexStatus = (0, workspace_2.upsertMarkedSection)("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", templates_1.inboxIndexBlock);
    return `Project Librarian handoff promoted to wiki inbox: wiki/inbox/project-candidates.md=${inboxStatus}, wiki/index.md inbox router=${indexStatus}`;
}
function enableHandoffInjection(now = new Date()) {
    const updatedAt = now.toISOString();
    const state = {
        content_hash: "",
        full_injection_enabled: true,
        generated: true,
        generated_by: exports.handoffGeneratedBy,
        path: exports.handoffInjectionStatePath,
        schema: exports.handoffSchema,
        size_bytes: 0,
        updated_at: updatedAt,
    };
    const content = `${JSON.stringify(state, null, 2)}\n`;
    state.size_bytes = Buffer.byteLength(content, "utf8");
    writeFileNoFollow(exports.handoffInjectionStatePath, `${JSON.stringify(state, null, 2)}\n`);
    return `Project Librarian handoff full injection enabled: ${exports.handoffInjectionStatePath}`;
}
function disableHandoffInjection() {
    const result = removeGeneratedFile(exports.handoffInjectionStatePath, (text) => {
        try {
            const state = JSON.parse(text);
            return state.generated === true && state.generated_by === exports.handoffGeneratedBy;
        }
        catch {
            return false;
        }
    });
    return `Project Librarian handoff full injection disabled: ${exports.handoffInjectionStatePath}=${result}`;
}
function getHandoffInjectionStatus() {
    const state = readInjectionState();
    const enabled = state.generated === true && state.generated_by === exports.handoffGeneratedBy && state.full_injection_enabled === true;
    const handoff = getHandoffStatus();
    const safeToInject = enabled && handoff.exists && !handoff.stale && handoff.reason === "ok";
    return {
        enabled,
        handoffPath: exports.handoffPath,
        maxInjectedChars: maxInjectedHandoffChars,
        path: exports.handoffInjectionStatePath,
        reason: !enabled ? "full injection is not enabled" : safeToInject ? "ok" : handoff.reason,
        safeToInject,
        updatedAt: state.updated_at || "",
    };
}
function runHandoffSaveMode() {
    const result = saveHandoffFromCli();
    console.log(`Project Librarian handoff ${result.status}: ${result.handoffPath}`);
    console.log(`State: ${result.statePath}`);
    console.log(`Size: ${result.sizeBytes} bytes`);
    console.log("Resume: project-librarian --handoff-show");
}
function runHandoffShowMode() {
    process.stdout.write(showHandoff());
}
function runHandoffStatusMode() {
    console.log(JSON.stringify(getHandoffStatus(), null, 2));
}
function runHandoffClearMode() {
    console.log(clearHandoff());
}
function runHandoffPromoteInboxMode() {
    console.log(promoteHandoffToInbox());
}
function runHandoffInjectionEnableMode() {
    console.log(enableHandoffInjection());
}
function runHandoffInjectionDisableMode() {
    console.log(disableHandoffInjection());
}
function runHandoffInjectionStatusMode() {
    console.log(JSON.stringify(getHandoffInjectionStatus(), null, 2));
}
