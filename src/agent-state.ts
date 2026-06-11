import * as fs from "node:fs";
import * as path from "node:path";
import { argValue } from "./args";
import { abs, exists, read, root, write } from "./workspace";

export type AgentTarget = "codex" | "claude" | "cursor" | "gemini";

export interface AgentSelection {
  agents: AgentTarget[];
  warnings: string[];
}

interface AgentInstallRecord {
  installed: boolean;
  installedAt?: string;
  updatedAt?: string;
}

interface InstallState {
  version: 1;
  agents: Partial<Record<AgentTarget, AgentInstallRecord>>;
}

export const installStatePath = ".project-librarian/install-state.json";
export const allAgentTargets: AgentTarget[] = ["codex", "claude", "cursor", "gemini"];
const legacyBothAgentTargets: AgentTarget[] = ["codex", "claude"];

export const commonRequiredFiles = [
  "AGENTS.md",
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
];

export const agentRequiredFiles: Record<AgentTarget, string[]> = {
  codex: [
    ".codex/hooks/wiki-session-start.js",
    ".codex/hooks.json",
  ],
  claude: [
    "CLAUDE.md",
    ".claude/hooks/wiki-session-start.js",
    ".claude/settings.json",
  ],
  cursor: [
    ".cursor/rules/project-librarian.mdc",
    ".cursor/hooks/wiki-session-start.js",
    ".cursor/hooks.json",
  ],
  gemini: [
    "GEMINI.md",
    ".gemini/hooks/wiki-session-start.js",
    ".gemini/settings.json",
  ],
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(): InstallState {
  return { version: 1, agents: {} };
}

function sortedAgents(agents: Iterable<AgentTarget>): AgentTarget[] {
  const selected = new Set(agents);
  return allAgentTargets.filter((agent) => selected.has(agent));
}

export function parseAgentTargets(value: string): AgentSelection {
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  const agents = new Set<AgentTarget>();
  const warnings: string[] = [];
  for (const part of parts.length > 0 ? parts : ["all"]) {
    if (part === "all") {
      for (const agent of allAgentTargets) agents.add(agent);
    } else if (part === "both") {
      warnings.push("--agents both is deprecated; use --agents codex,claude");
      for (const agent of legacyBothAgentTargets) agents.add(agent);
    } else if (allAgentTargets.includes(part as AgentTarget)) {
      agents.add(part as AgentTarget);
    } else {
      throw new Error(`invalid --agents entry: ${part}; expected codex, claude, cursor, gemini, all, or legacy both`);
    }
  }
  return { agents: sortedAgents(agents), warnings };
}

export function explicitAgentSelection(): AgentSelection | null {
  const value = argValue("--agents");
  return value ? parseAgentTargets(value) : null;
}

export function readInstallState(): InstallState | null {
  if (!exists(installStatePath)) return null;
  const parsed = JSON.parse(read(installStatePath)) as Partial<InstallState>;
  if (parsed.version !== 1 || !parsed.agents || typeof parsed.agents !== "object") {
    throw new Error(`${installStatePath} has an unsupported install-state format`);
  }
  return { version: 1, agents: parsed.agents };
}

export function registeredAgentsFromState(state: InstallState): AgentTarget[] {
  return allAgentTargets.filter((agent) => state.agents[agent]?.installed === true);
}

export function inferInstalledAgentsFromProject(): AgentTarget[] {
  return allAgentTargets.filter((agent) => agentRequiredFiles[agent].some((file) => exists(file)));
}

export function resolveProjectAgents(defaultAgents: AgentTarget[] = allAgentTargets): AgentSelection & { source: "explicit" | "state" | "inferred" | "default" } {
  const explicit = explicitAgentSelection();
  if (explicit) return { ...explicit, source: "explicit" };
  const state = readInstallState();
  if (state) return { agents: registeredAgentsFromState(state), warnings: [], source: "state" };
  const inferred = inferInstalledAgentsFromProject();
  if (inferred.length > 0) {
    return {
      agents: inferred,
      warnings: [`${installStatePath} is missing; inferred registered agents: ${inferred.join(", ")}`],
      source: "inferred",
    };
  }
  return { agents: defaultAgents, warnings: [], source: "default" };
}

export function registerProjectAgents(agents: AgentTarget[]): { added: AgentTarget[]; registered: AgentTarget[] } {
  const current = readInstallState() ?? emptyState();
  const before = new Set(registeredAgentsFromState(current));
  const timestamp = nowIso();
  for (const agent of agents) {
    const previous = current.agents[agent];
    current.agents[agent] = {
      installed: true,
      installedAt: previous?.installedAt ?? timestamp,
      updatedAt: timestamp,
    };
  }
  write(installStatePath, `${JSON.stringify(current, null, 2)}\n`);
  const registered = registeredAgentsFromState(current);
  return { added: registered.filter((agent) => !before.has(agent)), registered };
}

export function removeEmptyInstallStateDir(): void {
  const dir = path.dirname(abs(installStatePath));
  if (dir === root || !fs.existsSync(dir)) return;
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}
