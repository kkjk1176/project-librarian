import type { AgentSurface } from "./agent-surfaces";
import { parseAgentSurfaceValues } from "./agent-surfaces";

export interface ParsedArgs {
  agentTargets: AgentSurface[];
  args: Set<string>;
  captureCategory: string;
  captureContent: string;
  captureInboxMode: boolean;
  captureTitle: string;
  command: "init" | "update" | "install" | "install-skill";
  commandArgs: string[];
  doctorMode: boolean;
  fixMode: boolean;
  glossaryMode: boolean;
  helpMode: boolean;
  handoffBlocked: string[];
  handoffClearMode: boolean;
  handoffDecisions: string[];
  handoffGoal: string;
  handoffInputMode: boolean;
  handoffInjectionDisableMode: boolean;
  handoffInjectionEnableMode: boolean;
  handoffInjectionStatusMode: boolean;
  handoffLastFailureCommand: string;
  handoffLastSuccessCommand: string;
  handoffNextActions: string[];
  handoffOpenQuestions: string[];
  handoffPromoteInboxMode: boolean;
  handoffSaveMode: boolean;
  handoffShowMode: boolean;
  handoffState: string;
  handoffStatusMode: boolean;
  handoffVerification: string[];
  invalidAgentTargets: string[];
  issueBodyFile: string;
  issueCreateMode: boolean;
  issueDraftMode: boolean;
  issueDraftTitle: string;
  linkCheckMode: boolean;
  lintMode: boolean;
  missingValueOptions: string[];
  noGitConfigMode: boolean;
  pruneCheckMode: boolean;
  pruneCheckStrictMode: boolean;
  qualityCheckMode: boolean;
  queryTerm: string;
  rawArgs: string[];
  refreshIndexMode: boolean;
  unexpectedValueOptions: string[];
  unknownCommand: string;
  unknownOptions: string[];
  wikiImpactMode: boolean;
  wikiImpactTarget: string;
  wikiNeighborhoodMode: boolean;
  wikiNeighborhoodTarget: string;
}

export const rawArgs: string[] = process.argv.slice(2);
const knownCommands = new Set(["init", "update", "install", "install-skill"]);

type FlagValuePolicy = "none" | "value";

interface FlagDefinition {
  name: string;
  value: FlagValuePolicy;
}

const flagDefinitions: readonly FlagDefinition[] = [
  { name: "--agents", value: "value" },
  { name: "--blocked", value: "value" },
  { name: "--capture-inbox", value: "none" },
  { name: "--category", value: "value" },
  { name: "--content", value: "value" },
  { name: "--decision", value: "value" },
  { name: "--doctor", value: "none" },
  { name: "--dry-run", value: "none" },
  { name: "--fix", value: "none" },
  { name: "--glossary-init", value: "none" },
  { name: "--goal", value: "value" },
  { name: "--handoff-clear", value: "none" },
  { name: "--handoff-injection-disable", value: "none" },
  { name: "--handoff-injection-enable", value: "none" },
  { name: "--handoff-injection-status", value: "none" },
  { name: "--handoff-promote-inbox", value: "none" },
  { name: "--handoff-save", value: "none" },
  { name: "--handoff-show", value: "none" },
  { name: "--handoff-status", value: "none" },
  { name: "--issue-body-file", value: "value" },
  { name: "--issue-create", value: "none" },
  { name: "--issue-draft", value: "none" },
  { name: "--issue-title", value: "value" },
  { name: "--last-failure-command", value: "value" },
  { name: "--last-success-command", value: "value" },
  { name: "--link-check", value: "none" },
  { name: "--lint", value: "none" },
  { name: "--next", value: "value" },
  { name: "--no-git-config", value: "none" },
  { name: "--open-question", value: "value" },
  { name: "--prune-check", value: "none" },
  { name: "--prune-check-strict", value: "none" },
  { name: "--quality-check", value: "none" },
  { name: "--query", value: "value" },
  { name: "--refresh-index", value: "none" },
  { name: "--scope", value: "value" },
  { name: "--state", value: "value" },
  { name: "--title", value: "value" },
  { name: "--verification", value: "value" },
  { name: "--wiki-impact", value: "value" },
  { name: "--wiki-neighborhood", value: "value" },
];

const flagsWithoutValues = new Set(flagDefinitions.filter((definition) => definition.value === "none").map((definition) => definition.name));
const flagsWithValues = new Set(flagDefinitions.filter((definition) => definition.value === "value").map((definition) => definition.name));
const knownFlags = new Set([...flagsWithoutValues, ...flagsWithValues, "--help", "-h"]);

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
  return next && !next.startsWith("--") ? next : "";
}

function argValuesFrom(commandArgs: string[], name: string): string[] {
  const prefix = `${name}=`;
  const values: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!arg) continue;
    if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
    else if (arg === name) {
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
  const parsedAgentTargets = parseAgentSurfaceValues(argValues("--agents"));
  const handoffInputMode = [
    "--blocked",
    "--decision",
    "--goal",
    "--last-failure-command",
    "--last-success-command",
    "--next",
    "--open-question",
    "--state",
    "--verification",
  ].some(hasFlag);
  return {
    agentTargets: parsedAgentTargets.surfaces,
    args,
    captureCategory: argValue("--category") || "project-candidate",
    captureContent: argValue("--content"),
    captureInboxMode: args.has("--capture-inbox"),
    captureTitle: argValue("--title"),
    command,
    commandArgs,
    doctorMode: args.has("--doctor"),
    fixMode: args.has("--fix"),
    glossaryMode: args.has("--glossary-init"),
    helpMode: argv.includes("--help") || argv.includes("-h"),
    handoffBlocked: argValues("--blocked"),
    handoffClearMode: args.has("--handoff-clear"),
    handoffDecisions: argValues("--decision"),
    handoffGoal: argValue("--goal"),
    handoffInputMode,
    handoffInjectionDisableMode: args.has("--handoff-injection-disable"),
    handoffInjectionEnableMode: args.has("--handoff-injection-enable"),
    handoffInjectionStatusMode: args.has("--handoff-injection-status"),
    handoffLastFailureCommand: argValue("--last-failure-command"),
    handoffLastSuccessCommand: argValue("--last-success-command"),
    handoffNextActions: argValues("--next"),
    handoffOpenQuestions: argValues("--open-question"),
    handoffPromoteInboxMode: args.has("--handoff-promote-inbox"),
    handoffSaveMode: args.has("--handoff-save"),
    handoffShowMode: args.has("--handoff-show"),
    handoffState: argValue("--state"),
    handoffStatusMode: args.has("--handoff-status"),
    handoffVerification: argValues("--verification"),
    invalidAgentTargets: parsedAgentTargets.invalid,
    issueBodyFile: argValue("--issue-body-file"),
    issueCreateMode: args.has("--issue-create"),
    issueDraftMode: args.has("--issue-draft"),
    issueDraftTitle: argValue("--issue-title"),
    linkCheckMode: args.has("--link-check"),
    lintMode: args.has("--lint"),
    missingValueOptions: [...flagsWithValues].filter((flag) => hasFlag(flag) && !flagHasValue(commandArgs, flag)),
    noGitConfigMode: args.has("--no-git-config"),
    pruneCheckMode: args.has("--prune-check"),
    pruneCheckStrictMode: args.has("--prune-check-strict"),
    qualityCheckMode: args.has("--quality-check"),
    queryTerm: argValue("--query"),
    rawArgs: argv,
    refreshIndexMode: args.has("--refresh-index"),
    unexpectedValueOptions: [...new Set(commandArgs
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map(flagName)
      .filter((arg) => flagsWithoutValues.has(arg)))],
    unknownCommand: argv[0] && !argv[0].startsWith("-") && !knownCommands.has(argv[0]) ? argv[0] : "",
    unknownOptions: [...new Set(commandArgs
      .filter((arg) => arg.startsWith("-"))
      .map(flagName)
      .filter((arg) => !knownFlags.has(arg)))],
    wikiImpactMode: hasFlag("--wiki-impact"),
    wikiImpactTarget: argValue("--wiki-impact"),
    wikiNeighborhoodMode: hasFlag("--wiki-neighborhood"),
    wikiNeighborhoodTarget: argValue("--wiki-neighborhood"),
  };
}

export const parsedArgs = parseArgs(rawArgs);
export const agentTargets = parsedArgs.agentTargets;
export const args = parsedArgs.args;
export const captureCategory = parsedArgs.captureCategory;
export const captureContent = parsedArgs.captureContent;
export const captureInboxMode = parsedArgs.captureInboxMode;
export const captureTitle = parsedArgs.captureTitle;
export const command = parsedArgs.command;
export const commandArgs = parsedArgs.commandArgs;
export const doctorMode = parsedArgs.doctorMode;
export const fixMode = parsedArgs.fixMode;
export const glossaryMode = parsedArgs.glossaryMode;
export const helpMode = parsedArgs.helpMode;
export const handoffBlocked = parsedArgs.handoffBlocked;
export const handoffClearMode = parsedArgs.handoffClearMode;
export const handoffDecisions = parsedArgs.handoffDecisions;
export const handoffGoal = parsedArgs.handoffGoal;
export const handoffInputMode = parsedArgs.handoffInputMode;
export const handoffInjectionDisableMode = parsedArgs.handoffInjectionDisableMode;
export const handoffInjectionEnableMode = parsedArgs.handoffInjectionEnableMode;
export const handoffInjectionStatusMode = parsedArgs.handoffInjectionStatusMode;
export const handoffLastFailureCommand = parsedArgs.handoffLastFailureCommand;
export const handoffLastSuccessCommand = parsedArgs.handoffLastSuccessCommand;
export const handoffNextActions = parsedArgs.handoffNextActions;
export const handoffOpenQuestions = parsedArgs.handoffOpenQuestions;
export const handoffPromoteInboxMode = parsedArgs.handoffPromoteInboxMode;
export const handoffSaveMode = parsedArgs.handoffSaveMode;
export const handoffShowMode = parsedArgs.handoffShowMode;
export const handoffState = parsedArgs.handoffState;
export const handoffStatusMode = parsedArgs.handoffStatusMode;
export const handoffVerification = parsedArgs.handoffVerification;
export const invalidAgentTargets = parsedArgs.invalidAgentTargets;
export const issueBodyFile = parsedArgs.issueBodyFile;
export const issueCreateMode = parsedArgs.issueCreateMode;
export const issueDraftMode = parsedArgs.issueDraftMode;
export const issueDraftTitle = parsedArgs.issueDraftTitle;
export const linkCheckMode = parsedArgs.linkCheckMode;
export const lintMode = parsedArgs.lintMode;
export const missingValueOptions = parsedArgs.missingValueOptions;
export const noGitConfigMode = parsedArgs.noGitConfigMode;
export const pruneCheckMode = parsedArgs.pruneCheckMode;
export const pruneCheckStrictMode = parsedArgs.pruneCheckStrictMode;
export const qualityCheckMode = parsedArgs.qualityCheckMode;
export const queryTerm = parsedArgs.queryTerm;
export const refreshIndexMode = parsedArgs.refreshIndexMode;
export const unexpectedValueOptions = parsedArgs.unexpectedValueOptions;
export const unknownCommand = parsedArgs.unknownCommand;
export const unknownOptions = parsedArgs.unknownOptions;
export const wikiImpactMode = parsedArgs.wikiImpactMode;
export const wikiImpactTarget = parsedArgs.wikiImpactTarget;
export const wikiNeighborhoodMode = parsedArgs.wikiNeighborhoodMode;
export const wikiNeighborhoodTarget = parsedArgs.wikiNeighborhoodTarget;

export function argValue(name: string): string {
  return argValueFrom(commandArgs, name);
}

export function argValues(name: string): string[] {
  return argValuesFrom(commandArgs, name);
}
