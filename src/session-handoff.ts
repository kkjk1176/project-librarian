import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  handoffBlocked,
  handoffDecisions,
  handoffGoal,
  handoffLastFailureCommand,
  handoffLastSuccessCommand,
  handoffNextActions,
  handoffOpenQuestions,
  handoffState,
  handoffVerification,
} from "./args";
import { appendProjectCandidate } from "./modes";
import { inboxIndexBlock } from "./templates";
import { root } from "./workspace";
import { exists, upsertMarkedSection } from "./workspace";

export const handoffDirectory = ".project-wiki/session";
export const handoffPath = `${handoffDirectory}/last-handoff.md`;
export const handoffStatePath = `${handoffDirectory}/handoff-state.json`;
export const handoffInjectionStatePath = `${handoffDirectory}/injection-state.json`;
export const handoffSchema = "project-librarian-session-handoff/v1";
export const handoffGeneratedBy = "project-librarian-session-handoff";
export const handoffSentinel = "<!-- PROJECT-LIBRARIAN-GENERATED: session-handoff/v1 -->";

const maxHandoffChars = 8000;
const maxInjectedHandoffChars = 2500;
const maxFieldChars = 800;
const maxGitFactsChars = 2000;
const staleAfterMs = 7 * 24 * 60 * 60 * 1000;

export interface HandoffPayload {
  blocked: string[];
  currentState: string;
  goal: string;
  lastFailureCommand: string;
  lastSuccessCommand: string;
  nextActions: string[];
  openQuestions: string[];
  recentDecisions: string[];
  verification: string[];
}

interface HandoffStateFile {
  content_hash?: string;
  generated?: boolean;
  generated_by?: string;
  full_injection_enabled?: boolean;
  path?: string;
  schema?: string;
  size_bytes?: number;
  updated_at?: string;
}

export interface HandoffStatus {
  ageSeconds: number | null;
  exists: boolean;
  path: string;
  reason: string;
  safeToInject: boolean;
  schema: string;
  sizeBytes: number;
  stale: boolean;
  statePath: string;
  updatedAt: string;
}

interface SaveResult {
  status: "written" | "exists";
  handoffPath: string;
  statePath: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface HandoffInjectionStatus {
  enabled: boolean;
  handoffPath: string;
  maxInjectedChars: number;
  path: string;
  reason: string;
  safeToInject: boolean;
  updatedAt: string;
}

function rootRealPath(): string {
  return fs.realpathSync(root);
}

function assertInsideRoot(absolutePath: string): void {
  const relative = path.relative(rootRealPath(), absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to access path outside project root: ${absolutePath}`);
  }
}

function resolveUnderRoot(relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`expected repository-relative path: ${relativePath}`);
  const absolutePath = path.resolve(root, relativePath);
  assertInsideRoot(absolutePath);
  return absolutePath;
}

function ensureDirectoryNoSymlink(relativePath: string): void {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let current = rootRealPath();
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`refusing to use symlinked directory: ${path.relative(rootRealPath(), current)}`);
      if (!stat.isDirectory()) throw new Error(`refusing to use non-directory path: ${path.relative(rootRealPath(), current)}`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fs.mkdirSync(current);
    }
  }
  assertInsideRoot(fs.realpathSync(current));
}

function assertWritableFilePath(relativePath: string): string {
  const absolutePath = resolveUnderRoot(relativePath);
  ensureDirectoryNoSymlink(path.dirname(relativePath));
  try {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`refusing to write symlinked file: ${relativePath}`);
    if (!stat.isFile()) throw new Error(`refusing to overwrite non-file path: ${relativePath}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}

function writeFileNoFollow(relativePath: string, content: string): void {
  const absolutePath = assertWritableFilePath(relativePath);
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(absolutePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readFileNoSymlink(relativePath: string): string {
  const absolutePath = resolveUnderRoot(relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`refusing to read symlinked file: ${relativePath}`);
  if (!stat.isFile()) throw new Error(`expected file: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function removeGeneratedFile(relativePath: string, isGenerated: (text: string) => boolean): "absent" | "removed" {
  const absolutePath = resolveUnderRoot(relativePath);
  if (!fs.existsSync(absolutePath)) return "absent";
  const text = readFileNoSymlink(relativePath);
  if (!isGenerated(text)) throw new Error(`refusing to remove non-generated file: ${relativePath}`);
  fs.unlinkSync(absolutePath);
  return "removed";
}

function capText(value: string, maxChars = maxFieldChars): string {
  const compact = value.replace(/\r\n/g, "\n").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[truncated]`;
}

export function redactSecrets(text: string): string {
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

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  if (typeof value !== "string") return [];
  return value.split(/\n/).map((item) => capText(redactSecrets(item))).filter(Boolean);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? capText(redactSecrets(value)) : "";
}

function arrayValue(record: Record<string, unknown>, snakeKey: string, camelKey: string): string[] {
  if (snakeKey === camelKey) return normalizeList(record[snakeKey]);
  return normalizeList(record[snakeKey]).concat(normalizeList(record[camelKey]));
}

function stringValue(record: Record<string, unknown>, snakeKey: string, camelKey: string): string {
  return normalizeString(record[snakeKey] ?? record[camelKey]);
}

function payloadFromRecord(record: Record<string, unknown>): HandoffPayload {
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

function cliPayloadRecord(): Record<string, unknown> {
  return {
    blocked: handoffBlocked,
    current_state: handoffState,
    goal: handoffGoal,
    last_failure_command: handoffLastFailureCommand,
    last_success_command: handoffLastSuccessCommand,
    next_actions: handoffNextActions,
    open_questions: handoffOpenQuestions,
    recent_decisions: handoffDecisions,
    verification: handoffVerification,
  };
}

function mergePayloads(base: HandoffPayload, overlay: HandoffPayload): HandoffPayload {
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

function readStdinText(): string {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function payloadFromStdin(): HandoffPayload {
  const text = readStdinText();
  if (!text) return emptyPayload();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return payloadFromRecord(parsed as Record<string, unknown>);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid --handoff-save JSON payload: ${message}`);
  }
}

function emptyPayload(): HandoffPayload {
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

function runGit(args: string[]): string {
  const gitArgs = [
    "--no-pager",
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "diff.external=",
    ...args,
  ];
  try {
    return childProcess.execFileSync("git", gitArgs, {
      cwd: root,
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
  } catch {
    return "";
  }
}

function collectGitFacts(): string {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return "not a git repository";
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

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function checkboxList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- [ ] ${item}`).join("\n") : "- [ ] none";
}

function renderHandoff(payload: HandoffPayload, generatedAt: string, gitFacts: string): string {
  const content = `${handoffSentinel}
# Session Handoff

Generated: ${generatedAt}
Schema: ${handoffSchema}
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
  if (redacted.length <= maxHandoffChars) return redacted;
  return `${redacted.slice(0, maxHandoffChars - 64).trimEnd()}\n\n[truncated: session handoff cap reached]\n`;
}

function readState(): HandoffStateFile {
  try {
    return JSON.parse(readFileNoSymlink(handoffStatePath)) as HandoffStateFile;
  } catch {
    return {};
  }
}

function readInjectionState(): HandoffStateFile {
  try {
    return JSON.parse(readFileNoSymlink(handoffInjectionStatePath)) as HandoffStateFile;
  } catch {
    return {};
  }
}

function contentHash(payload: HandoffPayload, gitFacts: string): string {
  return crypto.createHash("sha256").update(JSON.stringify({ payload, gitFacts })).digest("hex");
}

export function saveHandoffFromCli(now = new Date()): SaveResult {
  const stdinPayload = payloadFromStdin();
  const flagPayload = payloadFromRecord(cliPayloadRecord());
  const payload = mergePayloads(stdinPayload, flagPayload);
  const gitFacts = collectGitFacts();
  const hash = contentHash(payload, gitFacts);
  const existingState = readState();
  if (existingState.content_hash === hash && fs.existsSync(resolveUnderRoot(handoffPath))) {
    const stat = fs.lstatSync(resolveUnderRoot(handoffPath));
    if (stat.isSymbolicLink()) throw new Error(`refusing to reuse symlinked file: ${handoffPath}`);
    if (!stat.isFile()) throw new Error(`refusing to reuse non-file path: ${handoffPath}`);
    return {
      status: "exists",
      handoffPath,
      statePath: handoffStatePath,
      sizeBytes: existingState.size_bytes ?? stat.size,
      updatedAt: existingState.updated_at ?? "",
    };
  }
  const updatedAt = now.toISOString();
  const content = renderHandoff(payload, updatedAt, gitFacts);
  writeFileNoFollow(handoffPath, content);
  const sizeBytes = Buffer.byteLength(content, "utf8");
  const state: Required<HandoffStateFile> = {
    content_hash: hash,
    full_injection_enabled: false,
    generated: true,
    generated_by: handoffGeneratedBy,
    path: handoffPath,
    schema: handoffSchema,
    size_bytes: sizeBytes,
    updated_at: updatedAt,
  };
  writeFileNoFollow(handoffStatePath, `${JSON.stringify(state, null, 2)}\n`);
  return { status: "written", handoffPath, statePath: handoffStatePath, sizeBytes, updatedAt };
}

export function getHandoffStatus(now = new Date()): HandoffStatus {
  const absoluteHandoffPath = resolveUnderRoot(handoffPath);
  if (!fs.existsSync(absoluteHandoffPath)) {
    return {
      ageSeconds: null,
      exists: false,
      path: handoffPath,
      reason: "handoff file not found",
      safeToInject: false,
      schema: handoffSchema,
      sizeBytes: 0,
      stale: false,
      statePath: handoffStatePath,
      updatedAt: "",
    };
  }
  const stat = fs.lstatSync(absoluteHandoffPath);
  if (stat.isSymbolicLink()) {
    return {
      ageSeconds: null,
      exists: true,
      path: handoffPath,
      reason: "handoff path is a symlink",
      safeToInject: false,
      schema: handoffSchema,
      sizeBytes: 0,
      stale: true,
      statePath: handoffStatePath,
      updatedAt: "",
    };
  }
  const state = readState();
  const updatedAt = state.updated_at || stat.mtime.toISOString();
  const updatedMs = Date.parse(updatedAt);
  const ageSeconds = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((now.getTime() - updatedMs) / 1000)) : null;
  const stale = ageSeconds === null || ageSeconds * 1000 > staleAfterMs;
  const sizeBytes = stat.size;
  const generated = state.generated === true && state.generated_by === handoffGeneratedBy;
  const safeToInject = generated && !stale && sizeBytes <= maxHandoffChars;
  return {
    ageSeconds,
    exists: true,
    path: handoffPath,
    reason: safeToInject ? "ok" : generated ? "stale or over size cap" : "missing generated state",
    safeToInject,
    schema: state.schema || handoffSchema,
    sizeBytes,
    stale,
    statePath: handoffStatePath,
    updatedAt,
  };
}

export function showHandoff(): string {
  const status = getHandoffStatus();
  if (!status.exists) return "Project Librarian handoff: none found.\n";
  const text = readFileNoSymlink(handoffPath);
  return [
    `Project Librarian handoff: updated ${status.updatedAt || "unknown"}, ${status.sizeBytes} bytes, stale=${String(status.stale)}`,
    "",
    text,
  ].join("\n");
}

export function clearHandoff(): string {
  const handoffResult = removeGeneratedFile(handoffPath, (text) => text.includes(handoffSentinel));
  const stateResult = removeGeneratedFile(handoffStatePath, (text) => {
    try {
      const state = JSON.parse(text) as HandoffStateFile;
      return state.generated === true && state.generated_by === handoffGeneratedBy;
    } catch {
      return false;
    }
  });
  return `Project Librarian handoff cleared: ${handoffPath}=${handoffResult}, ${handoffStatePath}=${stateResult}`;
}

function sectionText(markdown: string, heading: string): string {
  const pattern = new RegExp(`^## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |\\n$)`, "m");
  return markdown.match(pattern)?.[1]?.trim() ?? "";
}

function compactPromotionContent(markdown: string): string {
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

export function promoteHandoffToInbox(): string {
  const status = getHandoffStatus();
  if (!status.exists) throw new Error("cannot promote handoff: no generated handoff found");
  if (!status.safeToInject) throw new Error(`cannot promote handoff: ${status.reason}`);
  if (!exists("wiki/index.md")) throw new Error("cannot promote handoff: initialize Project Librarian wiki before writing wiki/inbox");
  const markdown = readFileNoSymlink(handoffPath);
  if (!markdown.includes(handoffSentinel)) throw new Error(`cannot promote handoff: missing generated sentinel in ${handoffPath}`);
  const firstGoal = sectionText(markdown, "Goal").split(/\r?\n/).find((line) => line.replace(/^[-\s[\]x]+/i, "").trim()) || "Session handoff";
  const title = `Session handoff: ${firstGoal.replace(/^[-\s[\]x]+/i, "").trim() || "untitled"}`;
  const inboxStatus = appendProjectCandidate({
    category: "session-handoff",
    content: compactPromotionContent(markdown),
    title,
  });
  const indexStatus = upsertMarkedSection("wiki/index.md", "<!-- PROJECT-WIKI-INBOX:START -->", "<!-- PROJECT-WIKI-INBOX:END -->", inboxIndexBlock);
  return `Project Librarian handoff promoted to wiki inbox: wiki/inbox/project-candidates.md=${inboxStatus}, wiki/index.md inbox router=${indexStatus}`;
}

export function enableHandoffInjection(now = new Date()): string {
  const updatedAt = now.toISOString();
  const state: Required<HandoffStateFile> = {
    content_hash: "",
    full_injection_enabled: true,
    generated: true,
    generated_by: handoffGeneratedBy,
    path: handoffInjectionStatePath,
    schema: handoffSchema,
    size_bytes: 0,
    updated_at: updatedAt,
  };
  const content = `${JSON.stringify(state, null, 2)}\n`;
  state.size_bytes = Buffer.byteLength(content, "utf8");
  writeFileNoFollow(handoffInjectionStatePath, `${JSON.stringify(state, null, 2)}\n`);
  return `Project Librarian handoff full injection enabled: ${handoffInjectionStatePath}`;
}

export function disableHandoffInjection(): string {
  const result = removeGeneratedFile(handoffInjectionStatePath, (text) => {
    try {
      const state = JSON.parse(text) as HandoffStateFile;
      return state.generated === true && state.generated_by === handoffGeneratedBy;
    } catch {
      return false;
    }
  });
  return `Project Librarian handoff full injection disabled: ${handoffInjectionStatePath}=${result}`;
}

export function getHandoffInjectionStatus(): HandoffInjectionStatus {
  const state = readInjectionState();
  const enabled = state.generated === true && state.generated_by === handoffGeneratedBy && state.full_injection_enabled === true;
  const handoff = getHandoffStatus();
  const safeToInject = enabled && handoff.exists && !handoff.stale && handoff.reason === "ok";
  return {
    enabled,
    handoffPath,
    maxInjectedChars: maxInjectedHandoffChars,
    path: handoffInjectionStatePath,
    reason: !enabled ? "full injection is not enabled" : safeToInject ? "ok" : handoff.reason,
    safeToInject,
    updatedAt: state.updated_at || "",
  };
}

export function runHandoffSaveMode(): void {
  const result = saveHandoffFromCli();
  console.log(`Project Librarian handoff ${result.status}: ${result.handoffPath}`);
  console.log(`State: ${result.statePath}`);
  console.log(`Size: ${result.sizeBytes} bytes`);
  console.log("Resume: project-librarian --handoff-show");
}

export function runHandoffShowMode(): void {
  process.stdout.write(showHandoff());
}

export function runHandoffStatusMode(): void {
  console.log(JSON.stringify(getHandoffStatus(), null, 2));
}

export function runHandoffClearMode(): void {
  console.log(clearHandoff());
}

export function runHandoffPromoteInboxMode(): void {
  console.log(promoteHandoffToInbox());
}

export function runHandoffInjectionEnableMode(): void {
  console.log(enableHandoffInjection());
}

export function runHandoffInjectionDisableMode(): void {
  console.log(disableHandoffInjection());
}

export function runHandoffInjectionStatusMode(): void {
  console.log(JSON.stringify(getHandoffInjectionStatus(), null, 2));
}
