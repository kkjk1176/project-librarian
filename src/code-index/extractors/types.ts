import type { IndexStatements } from "../schema";

export interface CodeFileFingerprint {
  mtimeMs: number;
  path: string;
  size: number;
}

export interface CodeFile extends CodeFileFingerprint {
  bytes: number;
  hash: string;
  language: string;
  lines: number;
  profile: string;
  text: string;
}

export type ExtractionStrength = "structural" | "light" | "config" | "inventory";

export interface ExtractionBackend {
  id: string;
  index(file: CodeFile, statements: IndexStatements): void;
  label: string;
  profile: string;
  strength: ExtractionStrength;
}
