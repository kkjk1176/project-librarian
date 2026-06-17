import * as fs from "node:fs";
import * as path from "node:path";
import type { SqliteDatabase } from "../code-index-db";
import { abs, normalizePath } from "../workspace";
import { matchingWorkspace, ownershipContext, ownershipInfo, readJsonObject, workspacePackages, type OwnershipContext } from "./ownership";
import { indexedParserMode, indexedScopes } from "./schema";

export type CodeReportSection = "coverage" | "ownership" | "languages" | "parsers" | "workspaces" | "workspace-graph" | "routes" | "hotspots" | "configs" | "edges";

export interface CodeReportParserBackend {
  id: string;
  label: string;
  strength: string;
}

export interface CodeReportRuntime {
  databaseRelativePath: string;
  parserBackendForProfile(profile: string): CodeReportParserBackend;
  staleness: {
    added: number;
    changed: number;
    deleted: number;
  };
}

interface OwnerSummary {
  bytes: number;
  codeowners: string;
  configs: number;
  file_count: number;
  imports: number;
  languages: string;
  lines: number;
  owner: string;
  owner_source: string;
  routes: number;
  symbols: number;
}

type OwnerNumericField = "bytes" | "configs" | "file_count" | "imports" | "lines" | "routes" | "symbols";

interface CodeReportSectionDefinition {
  aliases: string[];
  key: CodeReportSection;
  outputKey: string;
  render(database: SqliteDatabase, runtime: CodeReportRuntime): unknown;
}

export function evidenceCoverage(database: SqliteDatabase): Record<string, number> {
  const rows = database.prepare(`
    SELECT 'files' AS table_name, count(*) AS rows FROM files
    UNION ALL SELECT 'symbols', count(*) FROM symbols
    UNION ALL SELECT 'imports', count(*) FROM imports
    UNION ALL SELECT 'routes', count(*) FROM routes
    UNION ALL SELECT 'configs', count(*) FROM configs
    UNION ALL SELECT 'edges', count(*) FROM edges
  `).all();
  return Object.fromEntries(rows.map((row) => [String(row.table_name), Number(row.rows ?? 0)]));
}

function incrementOwnerField(owners: Map<string, OwnerSummary>, context: OwnershipContext, filePath: string, field: OwnerNumericField, increment = 1): void {
  const info = ownershipInfo(filePath, context);
  const key = info.owner;
  const current = owners.get(key) ?? {
    bytes: 0,
    codeowners: info.codeowners,
    configs: 0,
    file_count: 0,
    imports: 0,
    languages: "",
    lines: 0,
    owner: key,
    owner_source: info.owner_source,
    routes: 0,
    symbols: 0,
  };
  if (info.codeowners && !current.codeowners.split(", ").includes(info.codeowners)) current.codeowners = current.codeowners ? `${current.codeowners}; ${info.codeowners}` : info.codeowners;
  current[field] += increment;
  owners.set(key, current);
}

function ownershipSummary(database: SqliteDatabase): OwnerSummary[] {
  const files = database.prepare("SELECT path, language, profile, lines, bytes FROM files ORDER BY path").all();
  const context = ownershipContext();
  const owners = new Map<string, OwnerSummary>();
  const ownerLanguages = new Map<string, Set<string>>();
  for (const row of files) {
    const filePath = String(row.path);
    const key = ownershipInfo(filePath, context).owner;
    incrementOwnerField(owners, context, filePath, "file_count");
    incrementOwnerField(owners, context, filePath, "lines", Number(row.lines ?? 0));
    incrementOwnerField(owners, context, filePath, "bytes", Number(row.bytes ?? 0));
    const languages = ownerLanguages.get(key) ?? new Set<string>();
    languages.add(String(row.language));
    ownerLanguages.set(key, languages);
  }
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM symbols GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "symbols", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM routes GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "routes", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT from_file, count(*) AS count FROM imports GROUP BY from_file").all()) incrementOwnerField(owners, context, String(row.from_file), "imports", Number(row.count ?? 0));
  for (const row of database.prepare("SELECT file_path, count(*) AS count FROM configs GROUP BY file_path").all()) incrementOwnerField(owners, context, String(row.file_path), "configs", Number(row.count ?? 0));
  return Array.from(owners.values()).map((owner) => ({
    ...owner,
    languages: Array.from(ownerLanguages.get(String(owner.owner)) ?? []).sort().join(", "),
  })).sort((left, right) => right.file_count - left.file_count || left.owner.localeCompare(right.owner)).slice(0, 25);
}

function languageProfileSummary(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all();
}

function parserBackendSummary(database: SqliteDatabase, runtime: CodeReportRuntime): Record<string, unknown>[] {
  return database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all().map((row) => {
    const profile = String(row.profile);
    const backend = runtime.parserBackendForProfile(profile);
    return {
      language: row.language,
      profile,
      backend: backend.id,
      label: backend.label,
      extraction_strength: backend.strength,
      files: row.files,
      lines: row.lines,
      bytes: row.bytes,
    };
  });
}

export function workspaceSummary(database: SqliteDatabase): Record<string, unknown> {
  const context = ownershipContext();
  const counts = new Map<string, { bytes: number; files: number; lines: number; name: string; root: string; source: string; workspace_pattern: string }>();
  for (const workspace of context.workspaces) {
    counts.set(workspace.root, { ...workspace, bytes: 0, files: 0, lines: 0 });
  }
  for (const row of database.prepare("SELECT path, lines, bytes FROM files ORDER BY path").all()) {
    const workspace = matchingWorkspace(String(row.path), context.workspaces);
    if (!workspace) continue;
    const current = counts.get(workspace.root) ?? { ...workspace, bytes: 0, files: 0, lines: 0 };
    current.files += 1;
    current.lines += Number(row.lines ?? 0);
    current.bytes += Number(row.bytes ?? 0);
    counts.set(workspace.root, current);
  }
  return {
    workspace_packages: Array.from(counts.values()).sort((left, right) => left.root.localeCompare(right.root)),
    codeowners: context.codeownerRules.map((rule) => ({
      file_path: rule.file_path,
      line: rule.line,
      pattern: rule.pattern,
      owners: rule.owners.join(", "),
    })),
  };
}

function packageManagerFromLockfile(filePath: string): string {
  const base = path.basename(filePath);
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") return "npm";
  if (base === "pnpm-lock.yaml") return "pnpm";
  if (base === "yarn.lock") return "yarn";
  if (base === "bun.lockb" || base === "bun.lock") return "bun";
  return "unknown";
}

export function workspaceDependencyGraph(): Record<string, unknown> {
  const workspaces = workspacePackages();
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace] as const));
  const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]
    .filter((filePath) => fs.existsSync(abs(filePath)))
    .map((filePath) => ({ file_path: filePath, package_manager: packageManagerFromLockfile(filePath), scope: "root" }));
  const workspaceRows: Record<string, unknown>[] = [];
  const internalEdges: Record<string, unknown>[] = [];
  const externalDependencies = new Map<string, { dependency: string; dependency_type: string; workspaces: Set<string> }>();

  for (const workspace of workspaces) {
    const packageJsonPath = normalizePath(path.join(workspace.root, "package.json"));
    const packageJson = readJsonObject(packageJsonPath);
    const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    const dependencyCounts: Record<string, number> = {};
    const workspaceInternalEdges: Record<string, unknown>[] = [];
    for (const field of dependencyFields) {
      const dependencies = packageJson?.[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
      for (const [dependencyName, version] of Object.entries(dependencies as Record<string, unknown>)) {
        dependencyCounts[field] = (dependencyCounts[field] ?? 0) + 1;
        const target = byName.get(dependencyName);
        if (target) {
          const edge = {
            from_workspace: workspace.root,
            from_package: workspace.name,
            to_workspace: target.root,
            to_package: target.name,
            dependency_type: field,
            version: typeof version === "string" ? version : String(version),
          };
          internalEdges.push(edge);
          workspaceInternalEdges.push(edge);
        } else {
          const key = `${dependencyName}\0${field}`;
          const current = externalDependencies.get(key) ?? { dependency: dependencyName, dependency_type: field, workspaces: new Set<string>() };
          current.workspaces.add(workspace.root);
          externalDependencies.set(key, current);
        }
      }
    }
    for (const lockfileName of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]) {
      const lockfilePath = normalizePath(path.join(workspace.root, lockfileName));
      if (fs.existsSync(abs(lockfilePath))) {
        lockfiles.push({ file_path: lockfilePath, package_manager: packageManagerFromLockfile(lockfilePath), scope: workspace.root });
      }
    }
    workspaceRows.push({
      name: workspace.name,
      root: workspace.root,
      dependency_counts: dependencyCounts,
      internal_dependency_count: workspaceInternalEdges.length,
    });
  }

  return {
    workspace_count: workspaces.length,
    package_managers: Array.from(new Set(lockfiles.map((lockfile) => lockfile.package_manager))).sort(),
    lockfiles,
    workspaces: workspaceRows.sort((left, right) => String(left.root).localeCompare(String(right.root))),
    internal_dependencies: internalEdges.sort((left, right) => String(left.from_workspace).localeCompare(String(right.from_workspace)) || String(left.to_workspace).localeCompare(String(right.to_workspace))),
    external_dependency_hotspots: Array.from(externalDependencies.values()).map((entry) => ({
      dependency: entry.dependency,
      dependency_type: entry.dependency_type,
      workspace_count: entry.workspaces.size,
      workspaces: Array.from(entry.workspaces).sort().join(", "),
    })).sort((left, right) => right.workspace_count - left.workspace_count || left.dependency.localeCompare(right.dependency)).slice(0, 100),
  };
}

function routeInventory(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT method, route, file_path, line, handler FROM routes ORDER BY file_path, line LIMIT 100").all();
}

function dependencyHotspots(database: SqliteDatabase): Record<string, unknown> {
  return {
    imports: database.prepare("SELECT to_ref, count(DISTINCT from_file) AS importing_files, count(*) AS reference_count FROM imports GROUP BY to_ref ORDER BY importing_files DESC, reference_count DESC, to_ref LIMIT 50").all(),
    package_dependencies: database.prepare("SELECT substr(key, 12) AS package, value AS version, file_path FROM configs WHERE key LIKE 'dependency:%' ORDER BY file_path, package LIMIT 100").all(),
  };
}

function configInventory(database: SqliteDatabase): Record<string, unknown>[] {
  return database.prepare("SELECT key, value, file_path, line FROM configs WHERE key LIKE 'script:%' OR key LIKE 'dependency:%' OR key LIKE 'devDependency:%' ORDER BY file_path, key LIMIT 150").all();
}

function edgeSummary(database: SqliteDatabase): Record<string, unknown> {
  return {
    by_kind: database.prepare("SELECT kind, count(*) AS edges FROM edges GROUP BY kind ORDER BY edges DESC, kind").all(),
    fanout: database.prepare("SELECT source_kind, source, kind, count(DISTINCT target) AS targets, file_path FROM edges GROUP BY source_kind, source, kind, file_path ORDER BY targets DESC, source LIMIT 50").all(),
  };
}

const reportSectionDefinitions: CodeReportSectionDefinition[] = [
  { key: "coverage", outputKey: "evidence_coverage", aliases: ["coverage", "evidence", "evidence_coverage"], render: (database) => evidenceCoverage(database) },
  { key: "ownership", outputKey: "ownership_summary", aliases: ["ownership", "ownership_summary"], render: (database) => ownershipSummary(database) },
  { key: "languages", outputKey: "language_profile_summary", aliases: ["language", "language_profile_summary", "languages"], render: (database) => languageProfileSummary(database) },
  { key: "parsers", outputKey: "parser_backend_summary", aliases: ["parser", "parser_backend_summary", "parser_backends", "parsers"], render: (database, runtime) => parserBackendSummary(database, runtime) },
  { key: "workspaces", outputKey: "workspace_summary", aliases: ["workspace", "workspace_summary", "workspaces"], render: (database) => workspaceSummary(database) },
  { key: "workspace-graph", outputKey: "workspace_dependency_graph", aliases: ["workspace_graph", "workspace-graph", "workspacegraph", "monorepo", "monorepo_graph"], render: () => workspaceDependencyGraph() },
  { key: "routes", outputKey: "route_inventory", aliases: ["route", "route_inventory", "routes"], render: (database) => routeInventory(database) },
  { key: "hotspots", outputKey: "dependency_hotspots", aliases: ["dependencies", "dependency", "dependency_hotspots", "hotspot", "hotspots"], render: (database) => dependencyHotspots(database) },
  { key: "configs", outputKey: "config_inventory", aliases: ["config", "configs"], render: (database) => configInventory(database) },
  { key: "edges", outputKey: "edge_summary", aliases: ["edge", "edge_summary", "edges"], render: (database) => edgeSummary(database) },
];

const reportSectionByKey = new Map(reportSectionDefinitions.map((section) => [section.key, section] as const));
const reportSectionByAlias = new Map(reportSectionDefinitions.flatMap((section) => section.aliases.map((alias) => [alias, section] as const)));

export function validCodeReportSections(): CodeReportSection[] {
  return reportSectionDefinitions.map((section) => section.key);
}

export function resolveCodeReportSection(requestedSection: string): CodeReportSection | "" | undefined {
  const requested = requestedSection.trim().toLowerCase();
  if (!requested || requested === "all" || requested === "full") return "";
  return reportSectionByAlias.get(requested)?.key;
}

export function invalidCodeReportSectionMessage(requestedSection: string): string {
  return `invalid --code-report-section: ${requestedSection}; expected one of: ${validCodeReportSections().join(", ")}`;
}

export function codeReportMetadata(database: SqliteDatabase, runtime: CodeReportRuntime): Record<string, unknown> {
  const staleness = runtime.staleness;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    database: runtime.databaseRelativePath,
    scopes: indexedScopes(database),
    parser_mode: indexedParserMode(database),
    stale: {
      files: staleness.added + staleness.changed + staleness.deleted,
      changed: staleness.changed,
      added: staleness.added,
      deleted: staleness.deleted,
    },
  };
}

function codeReportSectionData(database: SqliteDatabase, section: CodeReportSection, runtime: CodeReportRuntime): unknown {
  const definition = reportSectionByKey.get(section);
  if (!definition) return undefined;
  return definition.render(database, runtime);
}

function codeReport(database: SqliteDatabase, runtime: CodeReportRuntime): Record<string, unknown> {
  const report: Record<string, unknown> = {
    ...codeReportMetadata(database, runtime),
    report_sections: reportSectionDefinitions.map((section) => section.outputKey),
  };
  for (const section of reportSectionDefinitions) {
    report[section.outputKey] = section.render(database, runtime);
  }
  return report;
}

export function codeReportForRequestedSection(database: SqliteDatabase, requestedSection: string, runtime: CodeReportRuntime): Record<string, unknown> | undefined {
  const section = resolveCodeReportSection(requestedSection);
  if (section === undefined) return undefined;
  if (!section) return codeReport(database, runtime);
  return {
    ...codeReportMetadata(database, runtime),
    section,
    data: codeReportSectionData(database, section, runtime),
  };
}
