import type { SqliteDatabase } from "../code-index-db";
import { ownershipContext, ownershipInfo } from "./ownership";
import { containsLikePattern, searchFiles, searchSymbols } from "./search";

export interface CodeEvidenceCollectorOptions {
  edgeLimit: number;
  fileLimit: number;
  includeEdgeEvidenceMatches: boolean;
  includeOwnerCodeowners: boolean;
  includeRouteEdges: boolean;
  importLimit: number;
  ownerSampleLimit: number;
  routeEdgeLimit: number;
  routeLimit: number;
  symbolLimit: number;
}

export interface CodeEvidenceOwnerRow {
  codeowners?: string;
  files: number;
  owner: string;
  owner_source: string;
  sample_files: string[];
}

export interface CodeEvidenceBundle {
  files: Record<string, unknown>[];
  imports: Record<string, unknown>[];
  incomingEdges: Record<string, unknown>[];
  owners: CodeEvidenceOwnerRow[];
  relatedFilePaths: string[];
  outgoingEdges: Record<string, unknown>[];
  routeEdges: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  symbols: Record<string, unknown>[];
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function ownerRowsForFilePaths(filePaths: string[], options: Pick<CodeEvidenceCollectorOptions, "includeOwnerCodeowners" | "ownerSampleLimit">): CodeEvidenceOwnerRow[] {
  const ownership = ownershipContext();
  const ownersByName = new Map<string, { codeowners: Set<string>; files: number; owner: string; owner_source: string; sample_files: string[] }>();
  for (const filePath of filePaths) {
    const info = ownershipInfo(filePath, ownership);
    const current = ownersByName.get(info.owner) ?? {
      codeowners: new Set<string>(),
      files: 0,
      owner: info.owner,
      owner_source: info.owner_source,
      sample_files: [],
    };
    current.files += 1;
    if (current.sample_files.length < options.ownerSampleLimit) current.sample_files.push(filePath);
    if (options.includeOwnerCodeowners && info.codeowners) {
      for (const owner of info.codeowners.split(", ").filter(Boolean)) current.codeowners.add(owner);
    }
    ownersByName.set(info.owner, current);
  }
  return Array.from(ownersByName.values()).map((owner) => {
    const row: CodeEvidenceOwnerRow = {
      files: owner.files,
      owner: owner.owner,
      owner_source: owner.owner_source,
      sample_files: owner.sample_files,
    };
    if (options.includeOwnerCodeowners) row.codeowners = Array.from(owner.codeowners).sort().join(", ");
    return row;
  }).sort((left, right) => right.files - left.files || left.owner.localeCompare(right.owner));
}

export function collectCodeEvidence(database: SqliteDatabase, query: string, options: CodeEvidenceCollectorOptions): CodeEvidenceBundle {
  const normalized = query.trim();
  const like = containsLikePattern(normalized);
  const files = searchFiles(database, normalized, options.fileLimit);
  const symbols = searchSymbols(database, normalized, options.symbolLimit);
  const routes = database.prepare("SELECT method, route, file_path, line, handler FROM routes WHERE route LIKE ? ESCAPE '\\' OR handler LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT ?").all(like, like, like, options.routeLimit);
  const imports = database.prepare("SELECT from_file, to_ref, imported, line, raw FROM imports WHERE from_file LIKE ? ESCAPE '\\' OR to_ref LIKE ? ESCAPE '\\' OR imported LIKE ? ESCAPE '\\' ORDER BY from_file, line LIMIT ?").all(like, like, like, options.importLimit);
  const outgoingEdges = options.includeEdgeEvidenceMatches
    ? database.prepare("SELECT kind, source_kind, source, target_kind, target, file_path, line, evidence FROM edges WHERE file_path LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR evidence LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT ?").all(like, like, like, options.edgeLimit)
    : database.prepare("SELECT kind, source_kind, source, target_kind, target, file_path, line, evidence FROM edges WHERE file_path LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT ?").all(like, like, options.edgeLimit);
  const incomingEdges = options.includeEdgeEvidenceMatches
    ? database.prepare("SELECT kind, source_kind, source, target_kind, target, file_path, line, evidence FROM edges WHERE target LIKE ? ESCAPE '\\' OR evidence LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT ?").all(like, like, options.edgeLimit)
    : database.prepare("SELECT kind, source_kind, source, target_kind, target, file_path, line, evidence FROM edges WHERE target LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT ?").all(like, options.edgeLimit);
  const routeTargets = routes.map((row) => `${String(row.method)} ${String(row.route)}`);
  const routeEdges = options.includeRouteEdges && routeTargets.length > 0
    ? database.prepare(`SELECT kind, source_kind, source, target_kind, target, file_path, line, evidence FROM edges WHERE source IN (${routeTargets.map(() => "?").join(", ")}) ORDER BY file_path, line LIMIT ?`).all(...routeTargets, options.routeEdgeLimit)
    : [];
  const relatedFilePaths = sortedUnique([
    ...files.map((row) => String(row.path ?? "")),
    ...symbols.map((row) => String(row.file_path ?? "")),
    ...routes.map((row) => String(row.file_path ?? "")),
    ...imports.map((row) => String(row.from_file ?? "")),
    ...outgoingEdges.map((row) => String(row.file_path ?? "")),
    ...incomingEdges.map((row) => String(row.file_path ?? "")),
    ...routeEdges.map((row) => String(row.file_path ?? "")),
  ]);
  return {
    files,
    imports,
    incomingEdges,
    owners: ownerRowsForFilePaths(relatedFilePaths, options),
    relatedFilePaths,
    outgoingEdges,
    routeEdges,
    routes,
    symbols,
  };
}
