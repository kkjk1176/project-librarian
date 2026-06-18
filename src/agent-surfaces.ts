export type AgentSurface = "codex" | "claude" | "cursor" | "gemini";

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

const projectLibrarianCommonInstallFiles = [
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

export function resolveBootstrapAgentSurfaces(
  explicitSurfaces: readonly AgentSurface[],
  fileExists: (relativePath: string) => boolean,
  readFile: (relativePath: string) => string,
): AgentSurface[] {
  if (explicitSurfaces.length > 0) return Array.from(explicitSurfaces);
  if (hasProjectLibrarianInstall(fileExists, readFile)) return activeAgentSurfaces(fileExists);
  return Array.from(allAgentSurfaces);
}

export function includesAgentSurface(surfaces: readonly AgentSurface[], surface: AgentSurface): boolean {
  return surfaces.includes(surface);
}
