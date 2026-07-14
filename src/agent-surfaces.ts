export type AgentSurface = "codex" | "claude" | "cursor" | "gemini";
export type AgentSurfaceLifecycle = "init" | "update";

export type AgentSurfaceResolutionSource =
  | "explicit"
  | "managed-install"
  | "existing-agent-root"
  | "common-install"
  | "fresh-init"
  | "missing-update-target";

export interface AgentSurfaceResolution {
  source: AgentSurfaceResolutionSource;
  surfaces: AgentSurface[];
}

export const allAgentSurfaces: readonly AgentSurface[] = ["codex", "claude", "cursor", "gemini"] as const;

export const agentSurfaceRequiredFiles: Record<AgentSurface, readonly string[]> = {
  codex: [".codex/hooks/wiki-session-start.js", ".codex/hooks.json"],
  claude: ["CLAUDE.md", ".claude/hooks/wiki-session-start.js", ".claude/settings.json"],
  cursor: [".cursor/rules/project-librarian.mdc", ".cursor/hooks/wiki-session-start.js", ".cursor/hooks.json"],
  gemini: ["GEMINI.md", ".gemini/hooks/wiki-session-start.js", ".gemini/settings.json"],
};

const agentSurfaceProjectSkillFiles: Record<AgentSurface, readonly string[]> = {
  codex: [".codex/skills/project-librarian/SKILL.md"],
  claude: [".claude/skills/project-librarian/SKILL.md"],
  cursor: [".cursor/skills/project-librarian/SKILL.md"],
  gemini: [".gemini/skills/project-librarian/SKILL.md"],
};

const agentSurfaceRoots: Record<AgentSurface, string> = {
  codex: ".codex",
  claude: ".claude",
  cursor: ".cursor",
  gemini: ".gemini",
};

const projectLibrarianCommonInstallFiles = [
  ".agents/skills/project-librarian/SKILL.md",
  "wiki/startup.md",
  "wiki/index.md",
  "wiki/AGENTS.md",
] as const;

export interface ParsedAgentSurfaces {
  surfaces: AgentSurface[];
  invalid: string[];
}

export function parseAgentSurfaceValues(values: string[]): ParsedAgentSurfaces {
  const surfaces = new Set<AgentSurface>();
  const invalid: string[] = [];
  for (const value of values) {
    if (value === "all") {
      for (const surface of allAgentSurfaces) surfaces.add(surface);
    } else if ((allAgentSurfaces as readonly string[]).includes(value)) {
      surfaces.add(value as AgentSurface);
    } else {
      invalid.push(value);
    }
  }
  return { surfaces: Array.from(surfaces), invalid };
}

export function hasProjectLibrarianInstall(fileExists: (relativePath: string) => boolean, readFile?: (relativePath: string) => string): boolean {
  if (projectLibrarianCommonInstallFiles.some((file) => fileExists(file))) return true;
  if (allAgentSurfaces.some((surface) => agentSurfaceProjectSkillFiles[surface].some((file) => fileExists(file)))) return true;
  if (fileExists("AGENTS.md") && readFile) {
    return readFile("AGENTS.md").includes("PROJECT-WIKI-FIRST:START");
  }
  return false;
}

export function activeAgentSurfaces(fileExists: (relativePath: string) => boolean): AgentSurface[] {
  return allAgentSurfaces.filter((surface) => (
    agentSurfaceRequiredFiles[surface].some((file) => fileExists(file))
    || agentSurfaceProjectSkillFiles[surface].some((file) => fileExists(file))
  ));
}

export function existingAgentSurfaceRoots(fileExists: (relativePath: string) => boolean): AgentSurface[] {
  return allAgentSurfaces.filter((surface) => fileExists(agentSurfaceRoots[surface]));
}

export function resolveBootstrapAgentSurfaces(
  lifecycle: AgentSurfaceLifecycle,
  explicitSurfaces: readonly AgentSurface[],
  fileExists: (relativePath: string) => boolean,
  readFile: (relativePath: string) => string,
): AgentSurfaceResolution {
  if (explicitSurfaces.length > 0) {
    return { source: "explicit", surfaces: Array.from(explicitSurfaces) };
  }

  const managedSurfaces = activeAgentSurfaces(fileExists);
  if (managedSurfaces.length > 0) {
    return { source: "managed-install", surfaces: managedSurfaces };
  }

  const hasCommonInstall = hasProjectLibrarianInstall(fileExists, readFile);
  if (lifecycle === "update") {
    const existingRoots = existingAgentSurfaceRoots(fileExists);
    if (existingRoots.length > 0) {
      return { source: "existing-agent-root", surfaces: existingRoots };
    }
    if (hasCommonInstall) {
      return { source: "common-install", surfaces: [] };
    }
    return { source: "missing-update-target", surfaces: [] };
  }

  if (hasCommonInstall) {
    return { source: "common-install", surfaces: [] };
  }
  return { source: "fresh-init", surfaces: Array.from(allAgentSurfaces) };
}

export function includesAgentSurface(surfaces: readonly AgentSurface[], surface: AgentSurface): boolean {
  return surfaces.includes(surface);
}
