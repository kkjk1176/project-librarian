import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { args, argValue } from "./args";

type AgentTarget = "codex" | "claude";
type InstallScope = "user" | "project";
type InstallStatus = "created" | "updated" | "exists" | "dry-run";
type InstallRow = [label: string, status: InstallStatus];

const skillName = "project-wiki-bootstrap";
const packageFiles = [
  "SKILL.md",
  "dist",
  "README.md",
  "README.ko.md",
  "README.ja.md",
  "README.zh.md",
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

function installAgents(): AgentTarget[] {
  const value = argValue("--agents") || "both";
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  const agents = new Set<AgentTarget>();
  for (const part of parts) {
    if (part === "both" || part === "all") {
      agents.add("codex");
      agents.add("claude");
    } else if (part === "codex" || part === "claude") {
      agents.add(part);
    } else {
      return fail(`invalid --agents entry: ${part}; expected codex, claude, or both`);
    }
  }
  return Array.from(agents);
}

function packageRoot(): string {
  return path.resolve(__dirname, "..");
}

function userAgentRoot(agent: AgentTarget): string {
  const home = os.homedir();
  if (agent === "codex") return process.env.CODEX_HOME || path.join(home, ".codex");
  return process.env.CLAUDE_HOME || path.join(home, ".claude");
}

function installTarget(agent: AgentTarget, scope: InstallScope): string {
  const base = scope === "user" ? userAgentRoot(agent) : path.join(process.cwd(), agent === "codex" ? ".codex" : ".claude");
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

export function runInstallSkillMode(): void {
  const scope = installScope();
  const agents = installAgents();
  const dryRun = args.has("--dry-run");
  const root = packageRoot();
  const rows: InstallRow[] = [];

  for (const agent of agents) {
    const targetRoot = installTarget(agent, scope);
    for (const relativePath of packageFiles) {
      const source = path.join(root, relativePath);
      const target = path.join(targetRoot, relativePath);
      rows.push([`${agent}:${scope}:${path.join(targetRoot, relativePath)}`, copyPath(source, target, dryRun)]);
    }
  }

  console.log(`Project wiki bootstrap skill ${dryRun ? "install dry-run" : "install"} complete.`);
  console.log(`scope: ${scope}`);
  console.log(`agents: ${agents.join(", ")}`);
  for (const [label, status] of rows) {
    console.log(`${status.padEnd(7)} ${label}`);
  }
}
