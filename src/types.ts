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
  | "updated"
  | `updated from ${string}`;
export type ResultRow = [label: string, status: FileStatus];
export type WikiBudget = "short" | "medium" | "on-demand";
export type WikiStatus = "active" | "template";

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
