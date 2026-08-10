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
exports.evidenceCoverage = evidenceCoverage;
exports.workspaceSummary = workspaceSummary;
exports.workspaceDependencyGraph = workspaceDependencyGraph;
exports.validCodeReportSections = validCodeReportSections;
exports.resolveCodeReportSection = resolveCodeReportSection;
exports.invalidCodeReportSectionMessage = invalidCodeReportSectionMessage;
exports.codeReportMetadata = codeReportMetadata;
exports.codeReportForRequestedSection = codeReportForRequestedSection;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const workspace_1 = require("../workspace");
const ownership_1 = require("./ownership");
const schema_1 = require("./schema");
function evidenceCoverage(database) {
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
function incrementOwnerField(owners, context, filePath, field, increment = 1) {
    const info = (0, ownership_1.ownershipInfo)(filePath, context);
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
    if (info.codeowners && !current.codeowners.split(", ").includes(info.codeowners))
        current.codeowners = current.codeowners ? `${current.codeowners}; ${info.codeowners}` : info.codeowners;
    current[field] += increment;
    owners.set(key, current);
}
function ownershipSummary(database) {
    const files = database.prepare("SELECT path, language, profile, lines, bytes FROM files ORDER BY path").all();
    const context = (0, ownership_1.ownershipContext)();
    const owners = new Map();
    const ownerLanguages = new Map();
    for (const row of files) {
        const filePath = String(row.path);
        const key = (0, ownership_1.ownershipInfo)(filePath, context).owner;
        incrementOwnerField(owners, context, filePath, "file_count");
        incrementOwnerField(owners, context, filePath, "lines", Number(row.lines ?? 0));
        incrementOwnerField(owners, context, filePath, "bytes", Number(row.bytes ?? 0));
        const languages = ownerLanguages.get(key) ?? new Set();
        languages.add(String(row.language));
        ownerLanguages.set(key, languages);
    }
    for (const row of database.prepare("SELECT file_path, count(*) AS count FROM symbols GROUP BY file_path").all())
        incrementOwnerField(owners, context, String(row.file_path), "symbols", Number(row.count ?? 0));
    for (const row of database.prepare("SELECT file_path, count(*) AS count FROM routes GROUP BY file_path").all())
        incrementOwnerField(owners, context, String(row.file_path), "routes", Number(row.count ?? 0));
    for (const row of database.prepare("SELECT from_file, count(*) AS count FROM imports GROUP BY from_file").all())
        incrementOwnerField(owners, context, String(row.from_file), "imports", Number(row.count ?? 0));
    for (const row of database.prepare("SELECT file_path, count(*) AS count FROM configs GROUP BY file_path").all())
        incrementOwnerField(owners, context, String(row.file_path), "configs", Number(row.count ?? 0));
    return Array.from(owners.values()).map((owner) => ({
        ...owner,
        languages: Array.from(ownerLanguages.get(String(owner.owner)) ?? []).sort().join(", "),
    })).sort((left, right) => right.file_count - left.file_count || left.owner.localeCompare(right.owner)).slice(0, 25);
}
function languageProfileSummary(database) {
    return database.prepare("SELECT language, profile, count(*) AS files, sum(lines) AS lines, sum(bytes) AS bytes FROM files GROUP BY language, profile ORDER BY files DESC, language").all();
}
function parserBackendSummary(database, runtime) {
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
function workspaceSummary(database) {
    const context = (0, ownership_1.ownershipContext)();
    const counts = new Map();
    for (const workspace of context.workspaces) {
        counts.set(workspace.root, { ...workspace, bytes: 0, files: 0, lines: 0 });
    }
    for (const row of database.prepare("SELECT path, lines, bytes FROM files ORDER BY path").all()) {
        const workspace = (0, ownership_1.matchingWorkspace)(String(row.path), context.workspaces);
        if (!workspace)
            continue;
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
function packageManagerFromLockfile(filePath) {
    const base = path.basename(filePath);
    if (base === "package-lock.json" || base === "npm-shrinkwrap.json")
        return "npm";
    if (base === "pnpm-lock.yaml")
        return "pnpm";
    if (base === "yarn.lock")
        return "yarn";
    if (base === "bun.lockb" || base === "bun.lock")
        return "bun";
    return "unknown";
}
function workspaceDependencyGraph() {
    const workspaces = (0, ownership_1.workspacePackages)();
    const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
    const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]
        .filter((filePath) => fs.existsSync((0, workspace_1.abs)(filePath)))
        .map((filePath) => ({ file_path: filePath, package_manager: packageManagerFromLockfile(filePath), scope: "root" }));
    const workspaceRows = [];
    const internalEdges = [];
    const externalDependencies = new Map();
    for (const workspace of workspaces) {
        const packageJsonPath = (0, workspace_1.normalizePath)(path.join(workspace.root, "package.json"));
        const packageJson = (0, ownership_1.readJsonObject)(packageJsonPath);
        const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
        const dependencyCounts = {};
        const workspaceInternalEdges = [];
        for (const field of dependencyFields) {
            const dependencies = packageJson?.[field];
            if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
                continue;
            for (const [dependencyName, version] of Object.entries(dependencies)) {
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
                }
                else {
                    const key = `${dependencyName}\0${field}`;
                    const current = externalDependencies.get(key) ?? { dependency: dependencyName, dependency_type: field, workspaces: new Set() };
                    current.workspaces.add(workspace.root);
                    externalDependencies.set(key, current);
                }
            }
        }
        for (const lockfileName of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]) {
            const lockfilePath = (0, workspace_1.normalizePath)(path.join(workspace.root, lockfileName));
            if (fs.existsSync((0, workspace_1.abs)(lockfilePath))) {
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
function routeInventory(database) {
    return database.prepare("SELECT method, route, file_path, line, handler FROM routes ORDER BY file_path, line LIMIT 100").all();
}
function dependencyHotspots(database) {
    return {
        imports: database.prepare("SELECT to_ref, count(DISTINCT from_file) AS importing_files, count(*) AS reference_count FROM imports GROUP BY to_ref ORDER BY importing_files DESC, reference_count DESC, to_ref LIMIT 50").all(),
        package_dependencies: database.prepare("SELECT substr(key, 12) AS package, value AS version, file_path FROM configs WHERE key LIKE 'dependency:%' ORDER BY file_path, package LIMIT 100").all(),
    };
}
function configInventory(database) {
    return database.prepare("SELECT key, value, file_path, line FROM configs WHERE key LIKE 'script:%' OR key LIKE 'dependency:%' OR key LIKE 'devDependency:%' ORDER BY file_path, key LIMIT 150").all();
}
function edgeSummary(database) {
    return {
        by_kind: database.prepare("SELECT kind, count(*) AS edges FROM edges GROUP BY kind ORDER BY edges DESC, kind").all(),
        fanout: database.prepare("SELECT source_kind, source, kind, count(DISTINCT target) AS targets, file_path FROM edges GROUP BY source_kind, source, kind, file_path ORDER BY targets DESC, source LIMIT 50").all(),
    };
}
const reportSectionDefinitions = [
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
const reportSectionByKey = new Map(reportSectionDefinitions.map((section) => [section.key, section]));
const reportSectionByAlias = new Map(reportSectionDefinitions.flatMap((section) => section.aliases.map((alias) => [alias, section])));
function validCodeReportSections() {
    return reportSectionDefinitions.map((section) => section.key);
}
function resolveCodeReportSection(requestedSection) {
    const requested = requestedSection.trim().toLowerCase();
    if (!requested || requested === "all" || requested === "full")
        return "";
    return reportSectionByAlias.get(requested)?.key;
}
function invalidCodeReportSectionMessage(requestedSection) {
    return `invalid --code-report-section: ${requestedSection}; expected one of: ${validCodeReportSections().join(", ")}`;
}
function codeReportMetadata(database, runtime) {
    const staleness = runtime.staleness;
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        database: runtime.databaseRelativePath,
        scopes: (0, schema_1.indexedScopes)(database),
        parser_mode: (0, schema_1.indexedParserMode)(database),
        stale: {
            files: staleness.added + staleness.changed + staleness.deleted,
            changed: staleness.changed,
            added: staleness.added,
            deleted: staleness.deleted,
        },
    };
}
function codeReportSectionData(database, section, runtime) {
    const definition = reportSectionByKey.get(section);
    if (!definition)
        return undefined;
    return definition.render(database, runtime);
}
function codeReport(database, runtime) {
    const report = {
        ...codeReportMetadata(database, runtime),
        report_sections: reportSectionDefinitions.map((section) => section.outputKey),
    };
    for (const section of reportSectionDefinitions) {
        report[section.outputKey] = section.render(database, runtime);
    }
    return report;
}
function codeReportForRequestedSection(database, requestedSection, runtime) {
    const section = resolveCodeReportSection(requestedSection);
    if (section === undefined)
        return undefined;
    if (!section)
        return codeReport(database, runtime);
    return {
        ...codeReportMetadata(database, runtime),
        section,
        data: codeReportSectionData(database, section, runtime),
    };
}
