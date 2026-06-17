import type { IndexStatements } from "../schema";

export interface CodeFile {
  bytes: number;
  hash: string;
  language: string;
  lines: number;
  path: string;
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
