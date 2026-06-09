export const rawArgs: string[] = process.argv.slice(2);
const knownCommands: Set<string> = new Set(["init", "install-skill"]);
export const helpMode = rawArgs.includes("--help") || rawArgs.includes("-h");
export const unknownCommand = rawArgs[0] && !rawArgs[0].startsWith("-") && !knownCommands.has(rawArgs[0]) ? rawArgs[0] : "";
export const command: "init" | "install-skill" = knownCommands.has(rawArgs[0] ?? "") ? rawArgs[0] as "init" | "install-skill" : "init";
export const commandArgs: string[] = command === rawArgs[0] ? rawArgs.slice(1) : rawArgs;
export const args: Set<string> = new Set(commandArgs);

const flagsWithoutValues: Set<string> = new Set([
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
]);
const knownFlags: Set<string> = new Set([...flagsWithoutValues, ...flagsWithValues, "--help", "-h"]);

function flagName(arg: string): string {
  return arg.startsWith("--") ? arg.split("=", 1)[0] ?? arg : arg;
}

function hasFlag(name: string): boolean {
  const prefix = `${name}=`;
  return commandArgs.some((arg) => arg === name || arg.startsWith(prefix));
}

function flagHasValue(name: string): boolean {
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

export const unknownOptions: string[] = Array.from(new Set(commandArgs
  .filter((arg) => arg.startsWith("-"))
  .map(flagName)
  .filter((arg) => !knownFlags.has(arg))));
export const missingValueOptions: string[] = Array.from(flagsWithValues).filter((flag) => hasFlag(flag) && !flagHasValue(flag));

export const migrateMode = args.has("--migrate") || args.has("--adopt-existing");
export const lintMode = args.has("--lint");
export const linkCheckMode = args.has("--link-check");
export const qualityCheckMode = args.has("--quality-check");
export const doctorMode = args.has("--doctor");
export const fixMode = args.has("--fix");
export const glossaryMode = args.has("--glossary-init");
export const issueCreateMode = args.has("--issue-create");
export const issueDraftMode = args.has("--issue-draft");
export const refreshIndexMode = args.has("--refresh-index");
export const captureInboxMode = args.has("--capture-inbox");
export const pruneCheckMode = args.has("--prune-check");
export const reviewMigrationMode = args.has("--review-migration") || args.has("--semantic-migrate");
export const noGitConfigMode = args.has("--no-git-config");
export const codeIndexMode = args.has("--code-index") || args.has("--code-evidence-index");
export const codeIndexIncrementalMode = args.has("--incremental") || args.has("--code-incremental") || args.has("--code-index-incremental") || args.has("--code-evidence-index-incremental");
export const codeIndexFullMode = args.has("--code-index-full") || args.has("--code-evidence-index-full");
export const codeReportMode = args.has("--code-report") || args.has("--code-evidence-report");
export const codeStatusMode = args.has("--code-status") || args.has("--code-evidence-status");
export const codeFilesMode = args.has("--code-files") || args.has("--code-evidence-files");
export const codeParserMode = hasFlag("--code-parser") || hasFlag("--code-evidence-parser");
export const codeImpactMode = hasFlag("--code-impact") || hasFlag("--code-evidence-impact");
export const codeQueryMode = hasFlag("--code-query") || hasFlag("--code-evidence-query");
export const codeSearchSymbolMode = hasFlag("--code-search-symbol") || hasFlag("--code-evidence-symbol");

export function argValue(name: string): string {
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

export function argValues(name: string): string[] {
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

export const queryTerm = argValue("--query");
export const codeImpactTarget = argValue("--code-impact") || argValue("--code-evidence-impact");
export const codeQuerySql = argValue("--code-query") || argValue("--code-evidence-query");
export const codeReportSection = argValue("--code-report-section") || argValue("--code-evidence-report-section");
export const codeSearchSymbol = argValue("--code-search-symbol") || argValue("--code-evidence-symbol");
export const codeIndexOutput = argValue("--code-index-out") || argValue("--code-evidence-out") || ".project-wiki/code-evidence.sqlite";
export const codeParser = argValue("--code-parser") || argValue("--code-evidence-parser") || "default";
export const codeIndexScopes = [...argValues("--code-scope"), ...argValues("--code-evidence-scope")];
export const captureTitle = argValue("--title");
export const captureContent = argValue("--content");
export const captureCategory = argValue("--category") || "project-candidate";
export const issueBodyFile = argValue("--issue-body-file");
export const issueDraftTitle = argValue("--issue-title");
