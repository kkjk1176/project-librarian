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
const sharedProjectSkillRelativeRoot = path.join(".agents", "skills", skillName);
const packageFiles = [
  "SKILL.md",
  "dist",
  "README.md",
  "README.ko.md",
  "LICENSE",
  "package.json",
  "agents",
];
const runtimeDependencyPackages = ["typescript"];

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

function runtimeDependencySource(packageName: string): string {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [packageRoot()] }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`missing runtime dependency ${packageName}: run npm install before installing the Project Librarian skill. Error: ${message}`);
  }
}

function runtimeDependencyTarget(packageName: string): string {
  return path.join("node_modules", ...packageName.split("/"));
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

export function sharedProjectSkillTarget(): string {
  return path.join(process.cwd(), sharedProjectSkillRelativeRoot);
}

function installTarget(agent: AgentSurface, scope: InstallScope): string {
  const base = scope === "user" ? userAgentRoot(agent) : path.join(process.cwd(), projectAgentRoot(agent));
  return path.join(base, "skills", skillName);
}

function assertNoTargetSymlink(targetRoot: string, target: string, includeLeaf: boolean): void {
  const rootResolved = path.resolve(targetRoot);
  const targetResolved = path.resolve(target);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(`${rootResolved}${path.sep}`)) {
    fail(`skill install target escaped target root: ${target}`);
  }
  if (fs.existsSync(rootResolved) && fs.lstatSync(rootResolved).isSymbolicLink()) {
    fail("skill install refuses to follow destination symlink: .");
  }
  const relative = path.relative(rootResolved, targetResolved);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  const checkedParts = includeLeaf ? parts : parts.slice(0, -1);
  let current = rootResolved;
  for (const part of checkedParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail(`skill install refuses to follow destination symlink: ${path.relative(rootResolved, current) || "."}`);
    }
    if (current !== targetResolved && !stat.isDirectory()) {
      fail(`skill install target has a non-directory path component: ${path.relative(rootResolved, current)}`);
    }
  }
}

function isInsidePath(base: string, target: string): boolean {
  const baseResolved = path.resolve(base);
  const targetResolved = path.resolve(target);
  return targetResolved === baseResolved || targetResolved.startsWith(`${baseResolved}${path.sep}`);
}

function mkdirFromBaseNoSymlink(base: string, target: string): void {
  const baseResolved = path.resolve(base);
  const targetResolved = path.resolve(target);
  if (!isInsidePath(baseResolved, targetResolved)) {
    fail(`skill install target escaped checked base: ${target}`);
  }
  let current = baseResolved;
  const parts = path.relative(baseResolved, targetResolved).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        fail(`skill install refuses to follow destination symlink: ${path.relative(baseResolved, current)}`);
      }
      if (!stat.isDirectory()) {
        fail(`skill install target has a non-directory path component: ${path.relative(baseResolved, current)}`);
      }
      continue;
    }
    fs.mkdirSync(current);
  }
}

function mkdirpNoTargetSymlink(targetRoot: string, target: string): void {
  const rootResolved = path.resolve(targetRoot);
  const targetResolved = path.resolve(target);
  const cwdResolved = path.resolve(process.cwd());
  if (isInsidePath(cwdResolved, rootResolved)) {
    mkdirFromBaseNoSymlink(cwdResolved, rootResolved);
  } else {
    fs.mkdirSync(rootResolved, { recursive: true });
  }
  const relative = path.relative(rootResolved, targetResolved);
  let current = rootResolved;
  if (!relative) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail("skill install refuses to follow destination symlink: .");
    }
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    return;
  }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        fail(`skill install refuses to follow destination symlink: ${path.relative(rootResolved, current)}`);
      }
      if (!stat.isDirectory()) {
        fail(`skill install target has a non-directory path component: ${path.relative(rootResolved, current)}`);
      }
      continue;
    }
    fs.mkdirSync(current);
  }
}

function sameFile(source: string, target: string): boolean {
  if (!fs.existsSync(target)) return false;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  return fs.readFileSync(source).equals(fs.readFileSync(target));
}

function copyPath(source: string, target: string, targetRoot: string, dryRun: boolean): InstallStatus {
  if (!fs.existsSync(source)) fail(`missing package file: ${source}`);
  const existed = fs.existsSync(target);
  if (dryRun) return "dry-run";
  const sourceStat = fs.statSync(source);
  assertNoTargetSymlink(targetRoot, target, true);
  if (sourceStat.isDirectory()) {
    mkdirpNoTargetSymlink(targetRoot, target);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPath(path.join(source, entry.name), path.join(target, entry.name), targetRoot, false);
    }
    return existed ? "updated" : "created";
  }
  mkdirpNoTargetSymlink(targetRoot, path.dirname(target));
  if (sameFile(source, target)) return "exists";
  fs.copyFileSync(source, target);
  fs.chmodSync(target, sourceStat.mode);
  return existed ? "updated" : "created";
}

export function installedProjectSkillSurfaces(): AgentSurface[] {
  return allAgentSurfaces.filter((agent) => fs.existsSync(path.join(projectSkillTarget(agent), "SKILL.md")));
}

export function hasSharedProjectSkillInstall(): boolean {
  return fs.existsSync(path.join(sharedProjectSkillTarget(), "SKILL.md"));
}

function copyPackageFiles(targetRoot: string, dryRun: boolean, labelRoot = targetRoot): InstallRow[] {
  const root = packageRoot();
  const packageRows: InstallRow[] = packageFiles.map((relativePath) => {
    const source = path.join(root, relativePath);
    const target = path.join(targetRoot, relativePath);
    return [path.join(labelRoot, relativePath), copyPath(source, target, targetRoot, dryRun)];
  });
  const dependencyRows: InstallRow[] = runtimeDependencyPackages.map((packageName) => {
    const relativePath = runtimeDependencyTarget(packageName);
    const source = runtimeDependencySource(packageName);
    const target = path.join(targetRoot, relativePath);
    return [path.join(labelRoot, relativePath), copyPath(source, target, targetRoot, dryRun)];
  });
  return [...packageRows, ...dependencyRows];
}

export function syncProjectSkillInstall(agent: AgentSurface): ResultRow[] {
  return copyPackageFiles(projectSkillTarget(agent), false, projectSkillRelativeRoot(agent)).map(([label, status]) => {
    if (status === "dry-run") throw new Error("project skill sync does not support dry-run status");
    return [label, status];
  });
}

export function syncSharedProjectSkillInstall(): ResultRow[] {
  return copyPackageFiles(sharedProjectSkillTarget(), false, sharedProjectSkillRelativeRoot).map(([label, status]) => {
    if (status === "dry-run") throw new Error("shared project skill sync does not support dry-run status");
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
  console.log("note: install only installs the reusable skill files and required local-runner runtime dependencies; it does not create or update AGENTS.md, CLAUDE.md, GEMINI.md, wiki/, .cursor/rules/, .cursor/hooks.json, .gemini/settings.json, .codex/hooks.json, or .claude/settings.json.");
  console.log("compatibility: install-skill remains supported as an alias for install.");
  console.log("next: ask your agent to use Project Librarian from the target project root; the installed skill resolves the local runner.");
  for (const [label, status] of rows) {
    console.log(`${status.padEnd(7)} ${label}`);
  }
}
