import { argValue, argValues } from "./args";
import type { ChoiceOption, InstallScope } from "./install";
import { promptChoices } from "./install";

export type UpdateScope = InstallScope;
export type UpdateTarget = "skill" | "agents";

export interface UpdateSelection {
  scope: UpdateScope;
  targets: UpdateTarget[];
}

const allUpdateTargets: readonly UpdateTarget[] = ["skill", "agents"];

function parseScope(): UpdateScope {
  const scope = argValue("--scope") || "project";
  if (scope === "user" || scope === "project") return scope;
  throw new Error(`invalid --scope: ${scope}; expected user or project`);
}

function parseTargets(scope: UpdateScope): UpdateTarget[] {
  const values = argValues("--targets");
  if (values.length === 0) return scope === "user" ? ["skill"] : Array.from(allUpdateTargets);
  const targets = new Set<UpdateTarget>();
  for (const value of values) {
    if (value === "all") {
      for (const target of allUpdateTargets) targets.add(target);
    } else if ((allUpdateTargets as readonly string[]).includes(value)) {
      targets.add(value as UpdateTarget);
    } else {
      throw new Error(`invalid --targets entry: ${value}; expected skill, agents, or all`);
    }
  }
  if (scope === "user" && Array.from(targets).some((target) => target !== "skill")) {
    throw new Error("user scope only supports --targets skill; agents belong to project scope");
  }
  return Array.from(targets);
}

function hasExplicitSelection(): boolean {
  return Boolean(argValue("--scope") || argValues("--targets").length > 0 || argValues("--agents").length > 0);
}

async function chooseScope(): Promise<UpdateScope> {
  const options: readonly ChoiceOption<UpdateScope>[] = [
    { value: "user", label: "User — update only the skill installed in the home directory" },
    { value: "project", label: "Project — update project agents and skill" },
  ];
  const selected = await promptChoices<UpdateScope>(
    "Select Project Librarian update scope",
    options,
    false,
    [0],
    "interactive update requires a TTY; pass --scope and/or --targets for non-interactive use",
  );
  const scope = selected[0];
  if (!scope) throw new Error("interactive update did not return an update scope");
  return scope;
}

async function chooseTargets(): Promise<UpdateTarget[]> {
  const options: readonly ChoiceOption<UpdateTarget>[] = [
    { value: "skill", label: "Reusable skill — update the skill installed in this project" },
    { value: "agents", label: "Project agents — update AGENTS.md, settings, and hooks" },
  ];
  const defaults = options.map((_option, index) => index);
  return promptChoices<UpdateTarget>(
    "Select update targets",
    options,
    true,
    defaults,
    "interactive update requires a TTY; pass --scope and/or --targets for non-interactive use",
  );
}

export async function resolveUpdateSelection(): Promise<UpdateSelection> {
  if (hasExplicitSelection()) {
    const scope = parseScope();
    return { scope, targets: parseTargets(scope) };
  }
  const scope = await chooseScope();
  if (scope === "user") return { scope, targets: ["skill"] };
  return { scope, targets: await chooseTargets() };
}
