import * as path from "node:path";
import type { CodeParserMode, IndexStatements } from "../schema";
import { indexConfigs } from "./config";
import { genericLightProfileByLanguage, indexGenericLight, indexGoLight, indexPythonLight, type GenericLightLanguage } from "./light-languages";
import { treeSitterBackends } from "./tree-sitter";
import { indexJavaScriptLike } from "./typescript";
import type { CodeFile, ExtractionBackend } from "./types";

type Fail = (message: string) => never;

function treeSitterProfile(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  if ([".ts", ".mts", ".cts"].includes(extension)) return "tree-sitter-typescript";
  if (extension === ".tsx") return "tree-sitter-tsx";
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension)) return "tree-sitter-javascript";
  if (extension === ".py") return "tree-sitter-python";
  if (extension === ".go") return "tree-sitter-go";
  if ([".c", ".h"].includes(extension)) return "tree-sitter-c";
  if ([".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"].includes(extension)) return "tree-sitter-cpp";
  if (extension === ".cs") return "tree-sitter-csharp";
  if (extension === ".java") return "tree-sitter-java";
  if ([".kt", ".kts"].includes(extension)) return "tree-sitter-kotlin";
  if (extension === ".php") return "tree-sitter-php";
  if (extension === ".rs") return "tree-sitter-rust";
  if (extension === ".swift") return "tree-sitter-swift";
  return "inventory-only";
}

export function extractionProfile(relativePath: string, language: string, parserMode: CodeParserMode): string {
  if (language === "config") return "config";
  if (parserMode === "tree-sitter") return treeSitterProfile(relativePath);
  if (isJavaScriptLikeProfileInput(language)) return "typescript-ast";
  if (language === "python") return "python-light";
  if (language === "go") return "go-light";
  if (isGenericLightLanguage(language)) return genericLightProfileByLanguage[language];
  return "inventory-only";
}

function isJavaScriptLikeProfileInput(language: string): boolean {
  return language === "javascript" || language === "typescript";
}

function isGenericLightLanguage(language: string): language is GenericLightLanguage {
  return ["c", "cpp", "csharp", "java", "kotlin", "php", "rust", "swift"].includes(language);
}

export interface ExtractionBackendRegistry {
  backendForProfile(profile: string): ExtractionBackend;
}

export function createExtractionBackendRegistry(fail: Fail): ExtractionBackendRegistry {
  const extractionBackends: ExtractionBackend[] = [
    {
      id: "typescript-compiler",
      index: indexJavaScriptLike,
      label: "TypeScript compiler API",
      profile: "typescript-ast",
      strength: "structural",
    },
    {
      id: "regex-light",
      index: indexPythonLight,
      label: "Python lightweight regex",
      profile: "python-light",
      strength: "light",
    },
    {
      id: "regex-light",
      index: indexGoLight,
      label: "Go lightweight regex",
      profile: "go-light",
      strength: "light",
    },
    ...Object.entries(genericLightProfileByLanguage).map(([language, profile]) => ({
      id: "regex-light",
      index: (file: CodeFile, statements: IndexStatements) => indexGenericLight(file, statements, language as GenericLightLanguage),
      label: `${language} lightweight regex`,
      profile,
      strength: "light" as const,
    })),
    ...treeSitterBackends(fail),
    {
      id: "config-key-value",
      index: (file: CodeFile, statements: IndexStatements) => indexConfigs(file, statements.insertConfig),
      label: "Configuration key/value extractor",
      profile: "config",
      strength: "config",
    },
    {
      id: "inventory-only",
      index: () => undefined,
      label: "Inventory-only file listing",
      profile: "inventory-only",
      strength: "inventory",
    },
  ];
  const extractionBackendsByProfile = new Map(extractionBackends.map((backend) => [backend.profile, backend] as const));
  return {
    backendForProfile(profile: string): ExtractionBackend {
      const backend = extractionBackendsByProfile.get(profile);
      if (!backend) fail(`missing extraction backend for profile: ${profile}`);
      return backend;
    },
  };
}
