import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentSurface } from "./agent-surfaces";
import { allAgentSurfaces } from "./agent-surfaces";
import { args, argValue } from "./args";
import type { ResultRow } from "./types";

type InstallScope = "user" | "project";
type InstallStatus = "created" | "updated" | "exists" | "dry-run";
type InstallRow = [label: string, status: InstallStatus];

const skillName = "project-librarian";
const packageFiles = [
  "SKILL.md",
  "dist",
  "README.md",
  "README.ko.md",
  "LICENSE",
  "package.json",
  "agents",
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function installScope(): InstallScope {
  const scope = argValue("--scope") || "user";
  if (scope === "user" || scope === "project") return scope;
  return fail(`invalid --scope: ${scope}; expected user or project`);
}

function installAgents(): AgentSurface[] {
  const value = argValue("--agents") || "all";
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  const agents = new Set<AgentSurface>();
  for (const part of parts) {
    if (part === "all") {
      for (const agent of allAgentSurfaces) agents.add(agent);
    } else if ((allAgentSurfaces as readonly string[]).includes(part)) {
      agents.add(part as AgentSurface);
    } else {
      return fail(`invalid --agents entry: ${part}; expected codex, claude, cursor, gemini, or all`);
    }
  }
  return Array.from(agents);
}

function packageRoot(): string {
  return path.resolve(__dirname, "..");
}

function userAgentRoot(agent: AgentSurface): string {
  const home = os.homedir();
  if (agent === "codex") return process.env.CODEX_HOME || path.join(home, ".codex");
  if (agent === "claude") return process.env.CLAUDE_HOME || path.join(home, ".claude");
  if (agent === "cursor") return process.env.CURSOR_HOME || path.join(home, ".cursor");
  return process.env.GEMINI_HOME || path.join(home, ".gemini");
}

function projectAgentRoot(agent: AgentSurface): string {
  if (agent === "codex") return ".codex";
  if (agent === "claude") return ".claude";
  if (agent === "cursor") return ".cursor";
  return ".gemini";
}

function projectSkillRelativeRoot(agent: AgentSurface): string {
  return path.join(projectAgentRoot(agent), "skills", skillName);
}

export function projectSkillTarget(agent: AgentSurface): string {
  return path.join(process.cwd(), projectSkillRelativeRoot(agent));
}

function installTarget(agent: AgentSurface, scope: InstallScope): string {
  const base = scope === "user" ? userAgentRoot(agent) : path.join(process.cwd(), projectAgentRoot(agent));
  return path.join(base, "skills", skillName);
}

function sameFile(source: string, target: string): boolean {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  return fs.readFileSync(source).equals(fs.readFileSync(target));
}

function copyPath(source: string, target: string, dryRun: boolean): InstallStatus {
  if (!fs.existsSync(source)) fail(`missing package file: ${source}`);
  const existed = fs.existsSync(target);
  if (dryRun) return "dry-run";
  const sourceStat = fs.statSync(source);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPath(path.join(source, entry.name), path.join(target, entry.name), false);
    }
    return existed ? "updated" : "created";
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (sameFile(source, target)) return "exists";
  fs.copyFileSync(source, target);
  fs.chmodSync(target, sourceStat.mode);
  return existed ? "updated" : "created";
}

export function installedProjectSkillSurfaces(): AgentSurface[] {
  return allAgentSurfaces.filter((agent) => fs.existsSync(path.join(projectSkillTarget(agent), "SKILL.md")));
}

function copyPackageFiles(targetRoot: string, dryRun: boolean, labelRoot = targetRoot): InstallRow[] {
  const root = packageRoot();
  return packageFiles.map((relativePath) => {
    const source = path.join(root, relativePath);
    const target = path.join(targetRoot, relativePath);
    return [path.join(labelRoot, relativePath), copyPath(source, target, dryRun)];
  });
}

export function syncProjectSkillInstall(agent: AgentSurface): ResultRow[] {
  return copyPackageFiles(projectSkillTarget(agent), false, projectSkillRelativeRoot(agent)).map(([label, status]) => {
    if (status === "dry-run") throw new Error("project skill sync does not support dry-run status");
    return [label, status];
  });
}

export function runInstallSkillMode(): void {
  const scope = installScope();
  const agents = installAgents();
  const dryRun = args.has("--dry-run");
  const rows: InstallRow[] = [];

  for (const agent of agents) {
    const targetRoot = installTarget(agent, scope);
    rows.push(...copyPackageFiles(targetRoot, dryRun).map(([label, status]) => [`${agent}:${scope}:${label}`, status] as InstallRow));
  }

  console.log(`Project Librarian skill ${dryRun ? "install dry-run" : "install"} complete.`);
  console.log(`scope: ${scope}`);
  console.log(`agents: ${agents.join(", ")}`);
  console.log("note: install only installs the reusable skill files; it does not create or update AGENTS.md, CLAUDE.md, GEMINI.md, wiki/, .cursor/rules/, .cursor/hooks.json, .gemini/settings.json, .codex/hooks.json, or .claude/settings.json.");
  console.log("compatibility: install-skill remains supported as an alias for install.");
  console.log("next: ask your agent to use Project Librarian from the target project root; the installed skill resolves the local runner.");
  for (const [label, status] of rows) {
    console.log(`${status.padEnd(7)} ${label}`);
  }
}
