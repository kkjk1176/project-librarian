import * as fs from "node:fs";
import * as path from "node:path";
import { abs, containedProjectDirectoryStat, containedProjectFileStat, normalizePath, read } from "../workspace";

export interface CodeownerRule {
  file_path: string;
  line: number;
  owners: string[];
  pattern: string;
}

export interface WorkspacePackage {
  name: string;
  root: string;
  source: string;
  workspace_pattern: string;
}

export interface OwnershipContext {
  codeownerRules: CodeownerRule[];
  workspaces: WorkspacePackage[];
}

export interface OwnershipInfo {
  codeowners: string;
  owner: string;
  owner_source: string;
}

// A single CODEOWNERS rule that matched a path, kept in file order so the MCP
// server can report last-match-wins precedence (which rule won, how many were
// overridden) without re-deriving the matching logic.
export interface MatchedCodeownerRule {
  file_path: string;
  line: number;
  owners: string[];
  pattern: string;
}

function pathOwnerKey(filePath: string): string {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length === 0) return ".";
  if (["apps", "libs", "packages", "services"].includes(parts[0] ?? "") && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? ".";
}

export function readJsonObject(relativePath: string): Record<string, unknown> | null {
  if (!containedProjectFileStat(relativePath)) return null;
  try {
    const parsed = JSON.parse(read(relativePath)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function workspacePatternsFromRootPackage(): string[] {
  const rootPackage = readJsonObject("package.json");
  const workspaces = rootPackage?.workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((value): value is string => typeof value === "string");
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) return packages.filter((value): value is string => typeof value === "string");
  }
  return [];
}

function workspacePatternCandidates(pattern: string): string[] {
  const normalized = normalizePath(pattern).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.includes("..")) return [];
  if (!normalized.includes("*")) return [normalized];
  const starIndex = normalized.indexOf("*");
  const prefix = normalized.slice(0, starIndex).replace(/\/+$/, "");
  const suffix = normalized.slice(starIndex + 1).replace(/^\/+/, "");
  const base = prefix || ".";
  const basePath = abs(base);
  if (!containedProjectDirectoryStat(base)) return [];
  return fs.readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizePath(path.join(base, entry.name, suffix)))
    .filter((candidate) => containedProjectDirectoryStat(candidate));
}

export function workspacePackages(): WorkspacePackage[] {
  const packages = new Map<string, WorkspacePackage>();
  for (const pattern of workspacePatternsFromRootPackage()) {
    for (const candidate of workspacePatternCandidates(pattern)) {
      const packageJsonPath = normalizePath(path.join(candidate, "package.json"));
      if (!containedProjectFileStat(packageJsonPath)) continue;
      const packageJson = readJsonObject(packageJsonPath);
      const packageName = typeof packageJson?.name === "string" ? packageJson.name : candidate;
      packages.set(candidate, {
        name: packageName,
        root: candidate,
        source: "package.json workspaces",
        workspace_pattern: pattern,
      });
    }
  }
  return Array.from(packages.values()).sort((left, right) => left.root.localeCompare(right.root));
}

export function matchingWorkspace(filePath: string, workspaces: WorkspacePackage[]): WorkspacePackage | null {
  const normalized = normalizePath(filePath);
  return workspaces
    .filter((workspace) => normalized === workspace.root || normalized.startsWith(`${workspace.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

export function codeownerRules(): CodeownerRule[] {
  const files = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  const rules: CodeownerRule[] = [];
  for (const filePath of files) {
    if (!containedProjectFileStat(filePath)) continue;
    const lines = read(filePath).split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const parts = trimmed.split(/\s+/);
      const pattern = parts[0] ?? "";
      const owners = parts.slice(1);
      if (!pattern || owners.length === 0) return;
      rules.push({ file_path: filePath, line: index + 1, owners, pattern });
    });
  }
  return rules;
}

function codeownerPatternRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\/+/, "");
  const source = normalized
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  if (normalized.endsWith("/")) return new RegExp(`^${source}.*$`);
  return new RegExp(`^${source}(?:/.*)?$`);
}

function codeownerPatternMatches(pattern: string, filePath: string): boolean {
  const normalized = normalizePath(pattern).replace(/^\/+/, "");
  const target = normalizePath(filePath);
  if (normalized === "*") return true;
  if (normalized.startsWith("*.")) return path.basename(target).endsWith(normalized.slice(1));
  return codeownerPatternRegex(normalized).test(target);
}

function matchingCodeowners(filePath: string, rules: CodeownerRule[]): string[] {
  const matches = rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
  return matches[matches.length - 1]?.owners ?? [];
}

// Return every CODEOWNERS rule that matches a path, in file order. The last entry
// is the effective owner under last-match-wins; earlier entries are overridden.
// Reuses the same matcher as matchingCodeowners so precedence answers stay
// consistent with --code-report / --code-impact.
export function matchedCodeownerRules(filePath: string, rules: CodeownerRule[]): MatchedCodeownerRule[] {
  return rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
}

export function ownershipContext(): OwnershipContext {
  return {
    codeownerRules: codeownerRules(),
    workspaces: workspacePackages(),
  };
}

export function ownershipInfo(filePath: string, context: OwnershipContext): OwnershipInfo {
  const workspace = matchingWorkspace(filePath, context.workspaces);
  const owners = matchingCodeowners(filePath, context.codeownerRules);
  return {
    codeowners: owners.join(", "),
    owner: workspace?.root ?? pathOwnerKey(filePath),
    owner_source: workspace ? "workspace" : "path",
  };
}
