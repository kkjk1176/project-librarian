export type FileStatus =
  | "absent"
  | "configured"
  | "created"
  | "exists"
  | "manual-review"
  | "removed"
  | "skipped-no-git"
  | "skipped-no-git-config"
  | `skipped-existing-hooksPath ${string}`
  | `skipped-small-repo ${string}`
  | "updated"
  | `updated from ${string}`
  | `moved wiki to ${string}`
  | "using existing wiki_legacy"
  | "no existing wiki directory to migrate"
  | `${number} files from ${string}`;
export type ResultRow = [label: string, status: FileStatus];
export type WikiBudget = "short" | "medium" | "on-demand";
export type WikiStatus = "active" | "template";
export type MigrationKind = "canonical" | "decision" | "source" | "meta" | "other";
export type MigrationStorage = "canonical" | "decisions" | "sources" | "meta";
export type MigrationConfidence = "high" | "medium" | "low";
export type MigrationInboxStatus = "adopted" | "rejected" | "resolved" | "needs-human-review" | "pending";
export type MigrationCoverageStatus = MigrationInboxStatus | "merged" | "superseded";
export type SemanticStatus = MigrationInboxStatus | "pending semantic rewrite";

export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

export interface SessionStartHook {
  matcher: string;
  hooks: HookCommand[];
  [key: string]: unknown;
}

export interface HookConfig {
  hooks: {
    SessionStart?: SessionStartHook[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface McpServerEntry {
  command: string;
  args: string[];
  [key: string]: unknown;
}

export interface McpServersConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export interface CursorHookCommand {
  command: string;
  [key: string]: unknown;
}

export interface CursorHookConfig {
  version?: number;
  hooks: {
    sessionStart?: CursorHookCommand[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MarkdownFileInfo {
  path: string;
  basePath: string;
}

export interface MigrationItem {
  path: string;
  legacyPath: string;
  kind: MigrationKind;
  title: string;
  summary: string;
  bytes: number;
}

export interface MigrationUnit {
  id: string;
  legacyPath: string;
  type: "heading" | "paragraph" | "list-item" | "table-row" | "code-block";
  heading: string;
  headingPath: string[];
  content: string;
  summary: string;
  classification: MigrationUnitClassification;
}

export interface MigrationUnitClassification {
  area: string;
  label: string;
  storage: MigrationStorage;
  target: string;
  confidence: MigrationConfidence;
  reason: string;
}

export interface MigrationState {
  legacyPath: string;
  note: FileStatus;
}

export interface MigrationRunResult {
  results: ResultRow[];
  total: number;
  legacyPath: string;
}

export interface MigrationVerificationRow {
  legacyPath: string;
  kind: string;
  target: string;
  coverage: string;
}

export interface MigrationReviewRow extends MigrationVerificationRow {
  inboxStatus: MigrationInboxStatus;
  semanticStatus: SemanticStatus;
  note: string;
}

export interface MigrationBulkReviewRow {
  unitId: string;
  legacySource: string;
  unitType: string;
  heading: string;
  summary: string;
  target: string;
  area: string;
  confidence: MigrationConfidence;
  inboxStatus: MigrationInboxStatus;
  semanticStatus: SemanticStatus;
  reason: string;
}

export interface MigrationBulkReviewGroup {
  key: string;
  rows: number;
  high: number;
  medium: number;
  low: number;
  sources: string[];
  targets: string[];
  areas: string[];
  sampleUnitIds: string[];
  sampleSummaries: string[];
}

export interface MigrationBulkReviewPlan {
  totalRows: number;
  openRows: number;
  completedRows: number;
  highConfidenceRows: number;
  mediumConfidenceRows: number;
  humanReviewRows: number;
  humanReviewStructuralRows: number;
  humanReviewContentRows: number;
  highTargetGroups: MigrationBulkReviewGroup[];
  mediumTargetGroups: MigrationBulkReviewGroup[];
  singleTargetSourceGroups: MigrationBulkReviewGroup[];
  humanReviewSourceGroups: MigrationBulkReviewGroup[];
  humanReviewStructuralSourceGroups: MigrationBulkReviewGroup[];
  humanReviewContentSourceGroups: MigrationBulkReviewGroup[];
  generatedSourceGroups: MigrationBulkReviewGroup[];
}

export interface MetadataSummary {
  status: string;
  scope: string;
  budget: string;
}

export interface MarkdownTableItem {
  path: string;
  title: string;
  summary: string;
}

export interface MigrationInboxEntry {
  status: MigrationInboxStatus;
  inbox: string;
}

export type StatusCounts = Partial<Record<MigrationInboxStatus, number>>;

export interface QueryResult extends MetadataSummary {
  blockKind: string;
  blockLine: number;
  blockSnippet: string;
  file: string;
  graphEvidence: string;
  title: string;
  score: number;
  tldr: string;
}

export type WikiMarkdownBlockKind = "code_fence" | "heading" | "list_item" | "paragraph" | "table_row";

export interface WikiMarkdownBlock {
  headingPath: string[];
  id: string;
  kind: WikiMarkdownBlockKind;
  line: number;
  text: string;
}

export interface PruneCandidate {
  file: string;
  status: string;
  updated: string;
  reasons: string[];
}

export type WikiLinkKind = "wikilink" | "markdown";

export interface WikiLinkReference {
  file: string;
  target: string;
  normalizedTarget: string;
  kind: WikiLinkKind;
}

export interface WikiDiagnostic {
  code: string;
  severity: "error" | "warn";
  file: string;
  message: string;
}
