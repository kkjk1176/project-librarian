import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type AgentTarget, parseAgentTargets, registerProjectAgents } from "./agent-state";
import { args, argValue } from "./args";

type InstallScope = "user" | "project";
type InstallStatus = "created" | "updated" | "exists" | "dry-run";
type InstallRow = [label: string, status: InstallStatus];

const skillName = "project-librarian";
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

function installAgents(): { agents: AgentTarget[]; warnings: string[] } {
  const value = argValue("--agents") || "all";
  try {
    return parseAgentTargets(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
}

function packageRoot(): string {
  return path.resolve(__dirname, "..");
}

function userAgentRoot(agent: AgentTarget): string {
  const home = os.homedir();
  if (agent === "codex") return process.env.CODEX_HOME || path.join(home, ".codex");
  if (agent === "claude") return process.env.CLAUDE_HOME || path.join(home, ".claude");
  if (agent === "cursor") return process.env.CURSOR_HOME || path.join(home, ".cursor");
  return process.env.GEMINI_HOME || path.join(home, ".gemini");
}

function projectAgentRoot(agent: AgentTarget): string {
  if (agent === "codex") return ".codex";
  if (agent === "claude") return ".claude";
  if (agent === "cursor") return ".cursor";
  return ".gemini";
}

function installTarget(agent: AgentTarget, scope: InstallScope): string {
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

export function runInstallSkillMode(): void {
  const scope = installScope();
  const { agents, warnings } = installAgents();
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

  console.log(`Project Librarian skill ${dryRun ? "install dry-run" : "install"} complete.`);
  console.log(`scope: ${scope}`);
  for (const warning of warnings) console.log(`warn: ${warning}`);
  console.log(`agents: ${agents.join(", ")}`);
  if (scope === "project" && !dryRun) {
    const registration = registerProjectAgents(agents);
    console.log(`registered agents: ${registration.registered.join(", ")}`);
    console.log(`added registered agents: ${registration.added.length > 0 ? registration.added.join(", ") : "none"}`);
  } else if (scope === "project") {
    console.log("registered agents: dry-run");
  } else {
    console.log("registered agents: not recorded for user scope");
  }
  console.log("note: install-skill only installs the reusable skill files; it does not create or update AGENTS.md, CLAUDE.md, GEMINI.md, wiki/, .cursor/rules/, .cursor/hooks.json, .gemini/settings.json, .codex/hooks.json, or .claude/settings.json.");
  console.log("next: agents should run the installed local project-librarian runner from the target project root; direct shell users can still run `npx project-librarian` when registry access is available.");
  for (const [label, status] of rows) {
    console.log(`${status.padEnd(7)} ${label}`);
  }
}
