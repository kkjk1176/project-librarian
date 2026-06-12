export interface ParsedArgs {
  acknowledgeSmallRepoMode: boolean;
  args: Set<string>;
  captureCategory: string;
  captureContent: string;
  captureInboxMode: boolean;
  captureTitle: string;
  codeFilesMode: boolean;
  codeImpactMode: boolean;
  codeImpactTarget: string;
  codeIndexFullMode: boolean;
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
  command: "init" | "install-skill" | "mcp";
  commandArgs: string[];
  doctorMode: boolean;
  fixMode: boolean;
  glossaryMode: boolean;
  helpMode: boolean;
  issueBodyFile: string;
  issueCreateMode: boolean;
  issueDraftMode: boolean;
  issueDraftTitle: string;
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
}

export const rawArgs: string[] = process.argv.slice(2);
const knownCommands: Set<string> = new Set(["init", "install-skill", "mcp"]);

const flagsWithoutValues: Set<string> = new Set([
  "--acknowledge-small-repo",
  "--adopt-existing",
  "--capture-inbox",
  "--code-evidence-files",
  "--code-evidence-index",
  "--code-evidence-status",
  "--code-files",
  "--code-incremental",
  "--code-index",
  "--code-index-full",
  "--code-index-incremental",
  "--code-evidence-index-full",
  "--code-evidence-index-incremental",
  "--code-report",
  "--code-status",
  "--code-evidence-report",
  "--dry-run",
  "--glossary-init",
  "--doctor",
  "--fix",
  "--issue-create",
  "--issue-draft",
  "--incremental",
  "--link-check",
  "--lint",
  "--migrate",
  "--migration-doctor",
  "--migration-lint",
  "--migration-quality-check",
  "--no-git-config",
  "--prune-check",
  "--quality-check",
  "--refresh-index",
  "--review-migration",
  "--semantic-migrate",
]);
const flagsWithValues: Set<string> = new Set([
  "--agents",
  "--category",
  "--code-evidence-impact",
  "--code-evidence-out",
  "--code-evidence-parser",
  "--code-evidence-query",
  "--code-evidence-report-section",
  "--code-evidence-scope",
  "--code-evidence-symbol",
  "--code-impact",
  "--code-index-out",
  "--code-parser",
  "--code-query",
  "--code-report-section",
  "--code-scope",
  "--code-search-symbol",
  "--content",
  "--issue-body-file",
  "--issue-title",
  "--query",
  "--scope",
  "--title",
  "--wiki-impact",
]);
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

export function parseArgs(argv: string[]): ParsedArgs {
  const command: "init" | "install-skill" | "mcp" = knownCommands.has(argv[0] ?? "") ? argv[0] as "init" | "install-skill" | "mcp" : "init";
  const commandArgs = command === argv[0] ? argv.slice(1) : argv;
  const args = new Set(commandArgs);
  const hasFlag = (name: string): boolean => hasFlagIn(commandArgs, name);
  const argValue = (name: string): string => argValueFrom(commandArgs, name);
  const argValues = (name: string): string[] => argValuesFrom(commandArgs, name);
  const codeImpactTarget = argValue("--code-impact") || argValue("--code-evidence-impact");
  const codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
  const codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
  return {
    acknowledgeSmallRepoMode: args.has("--acknowledge-small-repo"),
    args,
    captureCategory: argValue("--category") || "project-candidate",
    captureContent: argValue("--content"),
    captureInboxMode: args.has("--capture-inbox"),
    captureTitle: argValue("--title"),
    codeFilesMode: args.has("--code-files") || args.has("--code-evidence-files"),
    codeImpactMode: hasFlag("--code-impact") || hasFlag("--code-evidence-impact"),
    codeImpactTarget,
    codeIndexFullMode: args.has("--code-index-full") || args.has("--code-evidence-index-full"),
    codeIndexIncrementalMode: args.has("--incremental") || args.has("--code-incremental") || args.has("--code-index-incremental") || args.has("--code-evidence-index-incremental"),
    codeIndexMode: args.has("--code-index") || args.has("--code-evidence-index"),
    codeIndexOutput: argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite",
    codeIndexScopes: [...argValues("--code-scope"), ...argValues("--code-evidence-scope")],
    codeParser: argValue("--code-parser") || argValue("--code-evidence-parser") || "default",
    codeParserMode: hasFlag("--code-parser") || hasFlag("--code-evidence-parser"),
    codeQueryMode: hasFlag("--code-query") || hasFlag("--code-evidence-query"),
    codeQuerySql,
    codeReportMode: args.has("--code-report") || args.has("--code-evidence-report"),
    codeReportSection: argValue("--code-report-section") || argValue("--code-evidence-report-section"),
    codeSearchSymbol,
    codeSearchSymbolMode: hasFlag("--code-search-symbol") || hasFlag("--code-evidence-symbol"),
    codeStatusMode: args.has("--code-status") || args.has("--code-evidence-status"),
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
    reviewMigrationMode: args.has("--review-migration") || args.has("--semantic-migrate"),
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
  };
}

export const parsedArgs: ParsedArgs = parseArgs(rawArgs);
export const helpMode = parsedArgs.helpMode;
export const unknownCommand = parsedArgs.unknownCommand;
export const command = parsedArgs.command;
export const commandArgs = parsedArgs.commandArgs;
export const args = parsedArgs.args;
export const unknownOptions = parsedArgs.unknownOptions;
export const unexpectedValueOptions = parsedArgs.unexpectedValueOptions;
export const missingValueOptions = parsedArgs.missingValueOptions;
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
export const codeReportMode = parsedArgs.codeReportMode;
export const codeStatusMode = parsedArgs.codeStatusMode;
export const codeFilesMode = parsedArgs.codeFilesMode;
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
