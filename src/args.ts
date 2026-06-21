import type { AgentSurface } from "./agent-surfaces";
import { parseAgentSurfaceValues } from "./agent-surfaces";

export interface ParsedArgs {
  acknowledgeSmallRepoMode: boolean;
  agentTargets: AgentSurface[];
  args: Set<string>;
  captureCategory: string;
  captureContent: string;
  captureInboxMode: boolean;
  captureTitle: string;
  codeFilesMode: boolean;
  codeContextPackMode: boolean;
  codeContextPackTarget: string;
  codeImpactMode: boolean;
  codeImpactTarget: string;
  codeIndexFullMode: boolean;
  codeIndexHealthMode: boolean;
  codeIndexIncrementalMode: boolean;
  codeIndexMode: boolean;
  codeIndexOutput: string;
  codeIndexScopes: string[];
  codeParser: string;
  codeParserMode: boolean;
  codeQueryMode: boolean;
  codeQuerySql: string;
  codeReportMode: boolean;
  codeReportSection: string;
  codeSearchSymbol: string;
  codeSearchSymbolMode: boolean;
  codeStatusMode: boolean;
  command: "init" | "update" | "install" | "install-skill" | "mcp";
  commandArgs: string[];
  doctorMode: boolean;
  fixMode: boolean;
  glossaryMode: boolean;
  helpMode: boolean;
  issueBodyFile: string;
  issueCreateMode: boolean;
  issueDraftMode: boolean;
  issueDraftTitle: string;
  invalidAgentTargets: string[];
  linkCheckMode: boolean;
  lintMode: boolean;
  migrationDoctorMode: boolean;
  migrationLintMode: boolean;
  migrationQualityCheckMode: boolean;
  migrateMode: boolean;
  missingValueOptions: string[];
  noGitConfigMode: boolean;
  pruneCheckMode: boolean;
  qualityCheckMode: boolean;
  queryTerm: string;
  rawArgs: string[];
  refreshIndexMode: boolean;
  reviewMigrationMode: boolean;
  unexpectedValueOptions: string[];
  unknownCommand: string;
  unknownOptions: string[];
  wikiImpactMode: boolean;
  wikiImpactTarget: string;
  wikiVisualizeMode: boolean;
  wikiVisualizeOutput: string;
}

export const rawArgs: string[] = process.argv.slice(2);
const knownCommands: Set<string> = new Set(["init", "update", "install", "install-skill", "mcp"]);

type FlagValuePolicy = "none" | "value";

interface FlagDefinition {
  aliases?: readonly string[];
  name: string;
  value: FlagValuePolicy;
}

const flagDefinitions: readonly FlagDefinition[] = [
  { name: "--acknowledge-small-repo", value: "none" },
  { name: "--adopt-existing", value: "none" },
  { name: "--agents", value: "value" },
  { name: "--capture-inbox", value: "none" },
  { name: "--category", value: "value" },
  { name: "--code-context-pack", value: "value", aliases: ["--code-evidence-context-pack"] },
  { name: "--code-files", value: "none", aliases: ["--code-evidence-files"] },
  { name: "--code-impact", value: "value", aliases: ["--code-evidence-impact"] },
  { name: "--code-index", value: "none", aliases: ["--code-evidence-index"] },
  { name: "--code-index-full", value: "none", aliases: ["--code-evidence-index-full"] },
  { name: "--code-index-health", value: "none" },
  { name: "--code-index-incremental", value: "none", aliases: ["--incremental", "--code-incremental", "--code-evidence-index-incremental"] },
  { name: "--code-index-out", value: "value", aliases: ["--code-evidence-out"] },
  { name: "--code-parser", value: "value", aliases: ["--code-evidence-parser"] },
  { name: "--code-query", value: "value", aliases: ["--code-evidence-query"] },
  { name: "--code-report", value: "none", aliases: ["--code-evidence-report"] },
  { name: "--code-report-section", value: "value", aliases: ["--code-evidence-report-section"] },
  { name: "--code-scope", value: "value", aliases: ["--code-evidence-scope"] },
  { name: "--code-search-symbol", value: "value", aliases: ["--code-evidence-symbol"] },
  { name: "--code-status", value: "none", aliases: ["--code-evidence-status"] },
  { name: "--content", value: "value" },
  { name: "--doctor", value: "none" },
  { name: "--dry-run", value: "none" },
  { name: "--fix", value: "none" },
  { name: "--glossary-init", value: "none" },
  { name: "--issue-body-file", value: "value" },
  { name: "--issue-create", value: "none" },
  { name: "--issue-draft", value: "none" },
  { name: "--issue-title", value: "value" },
  { name: "--link-check", value: "none" },
  { name: "--lint", value: "none" },
  { name: "--migrate", value: "none" },
  { name: "--migration-doctor", value: "none" },
  { name: "--migration-lint", value: "none" },
  { name: "--migration-quality-check", value: "none" },
  { name: "--no-git-config", value: "none" },
  { name: "--prune-check", value: "none" },
  { name: "--quality-check", value: "none" },
  { name: "--query", value: "value" },
  { name: "--refresh-index", value: "none" },
  { name: "--review-migration", value: "none", aliases: ["--semantic-migrate"] },
  { name: "--scope", value: "value" },
  { name: "--title", value: "value" },
  { name: "--wiki-graph-html", value: "none" },
  { name: "--wiki-impact", value: "value" },
  { name: "--wiki-visualize", value: "none" },
  { name: "--wiki-visualize-out", value: "value" },
];

function definitionNames(definition: FlagDefinition): string[] {
  return [definition.name, ...(definition.aliases ?? [])];
}

function flagNamesByPolicy(value: FlagValuePolicy): string[] {
  return flagDefinitions.filter((definition) => definition.value === value).flatMap(definitionNames);
}

function namesForFlag(name: string): string[] {
  const definition = flagDefinitions.find((candidate) => definitionNames(candidate).includes(name));
  return definition ? definitionNames(definition) : [name];
}

const flagsWithoutValues: Set<string> = new Set(flagNamesByPolicy("none"));
const flagsWithValues: Set<string> = new Set(flagNamesByPolicy("value"));
const knownFlags: Set<string> = new Set([...flagsWithoutValues, ...flagsWithValues, "--help", "-h"]);

function flagName(arg: string): string {
  return arg.startsWith("--") ? arg.split("=", 1)[0] ?? arg : arg;
}

function hasFlagIn(commandArgs: string[], name: string): boolean {
  const prefix = `${name}=`;
  return commandArgs.some((arg) => arg === name || arg.startsWith(prefix));
}

function flagHasValue(commandArgs: string[], name: string): boolean {
  const prefix = `${name}=`;
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!arg) continue;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim().length > 0;
    if (arg === name) {
      const next = commandArgs[index + 1];
      return Boolean(next && !next.startsWith("-"));
    }
  }
  return true;
}

function argValueFrom(commandArgs: string[], name: string): string {
  const prefix = `${name}=`;
  const inline = commandArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = commandArgs.indexOf(name);
  const next = index >= 0 ? commandArgs[index + 1] : undefined;
  if (next && !next.startsWith("--")) {
    return next;
  }
  return "";
}

function argValuesFrom(commandArgs: string[], name: string): string[] {
  const prefix = `${name}=`;
  const values: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!arg) continue;
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === name) {
      const next = commandArgs[index + 1];
      if (next && !next.startsWith("--")) values.push(next);
    }
  }
  return values.flatMap((value) => value.split(",").map((part) => part.trim()).filter(Boolean));
}

type Command = ParsedArgs["command"];

export function parseArgs(argv: string[]): ParsedArgs {
  const command: Command = knownCommands.has(argv[0] ?? "") ? argv[0] as Command : "init";
  const commandArgs = command === argv[0] ? argv.slice(1) : argv;
  const args = new Set(commandArgs);
  const hasFlag = (name: string): boolean => hasFlagIn(commandArgs, name);
  const argValue = (name: string): string => argValueFrom(commandArgs, name);
  const argValues = (name: string): string[] => argValuesFrom(commandArgs, name);
  const hasAnyFlag = (name: string): boolean => namesForFlag(name).some(hasFlag);
  const argValueFromAny = (name: string): string => namesForFlag(name).map(argValue).find(Boolean) ?? "";
  const argValuesFromAny = (name: string): string[] => namesForFlag(name).flatMap(argValues);
  const codeImpactTarget = argValueFromAny("--code-impact");
  const codeContextPackTarget = argValueFromAny("--code-context-pack");
  const codeQuerySql = argValueFromAny("--code-query");
  const codeSearchSymbol = argValueFromAny("--code-search-symbol");
  const parsedAgentTargets = parseAgentSurfaceValues(argValues("--agents"));
  return {
    acknowledgeSmallRepoMode: args.has("--acknowledge-small-repo"),
    agentTargets: parsedAgentTargets.surfaces,
    args,
    captureCategory: argValue("--category") || "project-candidate",
    captureContent: argValue("--content"),
    captureInboxMode: args.has("--capture-inbox"),
    captureTitle: argValue("--title"),
    codeContextPackMode: hasAnyFlag("--code-context-pack"),
    codeContextPackTarget,
    codeFilesMode: hasAnyFlag("--code-files"),
    codeImpactMode: hasAnyFlag("--code-impact"),
    codeImpactTarget,
    codeIndexFullMode: hasAnyFlag("--code-index-full"),
    codeIndexHealthMode: args.has("--code-index-health"),
    codeIndexIncrementalMode: hasAnyFlag("--code-index-incremental"),
    codeIndexMode: hasAnyFlag("--code-index"),
    codeIndexOutput: argValueFromAny("--code-index-out") || ".project-wiki/code-evidence.sqlite",
    codeIndexScopes: argValuesFromAny("--code-scope"),
    codeParser: argValueFromAny("--code-parser") || "default",
    codeParserMode: hasAnyFlag("--code-parser"),
    codeQueryMode: hasAnyFlag("--code-query"),
    codeQuerySql,
    codeReportMode: hasAnyFlag("--code-report"),
    codeReportSection: argValueFromAny("--code-report-section"),
    codeSearchSymbol,
    codeSearchSymbolMode: hasAnyFlag("--code-search-symbol"),
    codeStatusMode: hasAnyFlag("--code-status"),
    command,
    commandArgs,
    doctorMode: args.has("--doctor"),
    fixMode: args.has("--fix"),
    glossaryMode: args.has("--glossary-init"),
    helpMode: argv.includes("--help") || argv.includes("-h"),
    issueBodyFile: argValue("--issue-body-file"),
    issueCreateMode: args.has("--issue-create"),
    issueDraftMode: args.has("--issue-draft"),
    issueDraftTitle: argValue("--issue-title"),
    invalidAgentTargets: parsedAgentTargets.invalid,
    linkCheckMode: args.has("--link-check"),
    lintMode: args.has("--lint"),
    migrationDoctorMode: args.has("--migration-doctor"),
    migrationLintMode: args.has("--migration-lint"),
    migrationQualityCheckMode: args.has("--migration-quality-check"),
    migrateMode: args.has("--migrate") || args.has("--adopt-existing"),
    missingValueOptions: Array.from(flagsWithValues).filter((flag) => hasFlag(flag) && !flagHasValue(commandArgs, flag)),
    noGitConfigMode: args.has("--no-git-config"),
    pruneCheckMode: args.has("--prune-check"),
    qualityCheckMode: args.has("--quality-check"),
    queryTerm: argValue("--query"),
    rawArgs: argv,
    refreshIndexMode: args.has("--refresh-index"),
    reviewMigrationMode: hasAnyFlag("--review-migration"),
    unexpectedValueOptions: Array.from(new Set(commandArgs
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map(flagName)
      .filter((arg) => flagsWithoutValues.has(arg)))),
    unknownCommand: argv[0] && !argv[0].startsWith("-") && !knownCommands.has(argv[0]) ? argv[0] : "",
    unknownOptions: Array.from(new Set(commandArgs
      .filter((arg) => arg.startsWith("-"))
      .map(flagName)
      .filter((arg) => !knownFlags.has(arg)))),
    wikiImpactMode: hasFlag("--wiki-impact"),
    wikiImpactTarget: argValue("--wiki-impact"),
    wikiVisualizeMode: hasFlag("--wiki-visualize") || hasFlag("--wiki-graph-html"),
    wikiVisualizeOutput: argValue("--wiki-visualize-out"),
  };
}

export const parsedArgs: ParsedArgs = parseArgs(rawArgs);
export const agentTargets = parsedArgs.agentTargets;
export const helpMode = parsedArgs.helpMode;
export const unknownCommand = parsedArgs.unknownCommand;
export const command = parsedArgs.command;
export const commandArgs = parsedArgs.commandArgs;
export const args = parsedArgs.args;
export const unknownOptions = parsedArgs.unknownOptions;
export const unexpectedValueOptions = parsedArgs.unexpectedValueOptions;
export const missingValueOptions = parsedArgs.missingValueOptions;
export const invalidAgentTargets = parsedArgs.invalidAgentTargets;
export const migrateMode = parsedArgs.migrateMode;
export const lintMode = parsedArgs.lintMode;
export const migrationDoctorMode = parsedArgs.migrationDoctorMode;
export const migrationLintMode = parsedArgs.migrationLintMode;
export const migrationQualityCheckMode = parsedArgs.migrationQualityCheckMode;
export const linkCheckMode = parsedArgs.linkCheckMode;
export const qualityCheckMode = parsedArgs.qualityCheckMode;
export const doctorMode = parsedArgs.doctorMode;
export const fixMode = parsedArgs.fixMode;
export const glossaryMode = parsedArgs.glossaryMode;
export const issueCreateMode = parsedArgs.issueCreateMode;
export const issueDraftMode = parsedArgs.issueDraftMode;
export const refreshIndexMode = parsedArgs.refreshIndexMode;
export const captureInboxMode = parsedArgs.captureInboxMode;
export const pruneCheckMode = parsedArgs.pruneCheckMode;
export const reviewMigrationMode = parsedArgs.reviewMigrationMode;
export const noGitConfigMode = parsedArgs.noGitConfigMode;
export const acknowledgeSmallRepoMode = parsedArgs.acknowledgeSmallRepoMode;
export const codeIndexMode = parsedArgs.codeIndexMode;
export const codeIndexIncrementalMode = parsedArgs.codeIndexIncrementalMode;
export const codeIndexFullMode = parsedArgs.codeIndexFullMode;
export const codeIndexHealthMode = parsedArgs.codeIndexHealthMode;
export const codeReportMode = parsedArgs.codeReportMode;
export const codeStatusMode = parsedArgs.codeStatusMode;
export const codeFilesMode = parsedArgs.codeFilesMode;
export const codeContextPackMode = parsedArgs.codeContextPackMode;
export const codeParserMode = parsedArgs.codeParserMode;
export const codeImpactMode = parsedArgs.codeImpactMode;
export const codeQueryMode = parsedArgs.codeQueryMode;
export const codeSearchSymbolMode = parsedArgs.codeSearchSymbolMode;

export function argValue(name: string): string {
  return argValueFrom(commandArgs, name);
}

export function argValues(name: string): string[] {
  return argValuesFrom(commandArgs, name);
}

export const queryTerm = parsedArgs.queryTerm;
export const wikiImpactMode = parsedArgs.wikiImpactMode;
export const wikiImpactTarget = parsedArgs.wikiImpactTarget;
export const wikiVisualizeMode = parsedArgs.wikiVisualizeMode;
export const wikiVisualizeOutput = parsedArgs.wikiVisualizeOutput;
export const codeContextPackTarget = parsedArgs.codeContextPackTarget;
export const codeImpactTarget = parsedArgs.codeImpactTarget;
export const codeQuerySql = parsedArgs.codeQuerySql;
export const codeReportSection = parsedArgs.codeReportSection;
export const codeSearchSymbol = parsedArgs.codeSearchSymbol;
export const codeIndexOutput = parsedArgs.codeIndexOutput;
export const codeParser = parsedArgs.codeParser;
export const codeIndexScopes = parsedArgs.codeIndexScopes;
export const captureTitle = parsedArgs.captureTitle;
export const captureContent = parsedArgs.captureContent;
export const captureCategory = parsedArgs.captureCategory;
export const issueBodyFile = parsedArgs.issueBodyFile;
export const issueDraftTitle = parsedArgs.issueDraftTitle;
