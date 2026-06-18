"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentSurfaceRequiredFiles = exports.allAgentSurfaces = void 0;
exports.parseAgentSurfaceValues = parseAgentSurfaceValues;
exports.hasProjectLibrarianInstall = hasProjectLibrarianInstall;
exports.activeAgentSurfaces = activeAgentSurfaces;
exports.resolveBootstrapAgentSurfaces = resolveBootstrapAgentSurfaces;
exports.includesAgentSurface = includesAgentSurface;
exports.allAgentSurfaces = ["codex", "claude", "cursor", "gemini"];
exports.agentSurfaceRequiredFiles = {
    codex: [".codex/hooks/wiki-session-start.js", ".codex/hooks.json"],
    claude: ["CLAUDE.md", ".claude/hooks/wiki-session-start.js", ".claude/settings.json"],
    cursor: [".cursor/rules/project-librarian.mdc", ".cursor/hooks/wiki-session-start.js", ".cursor/hooks.json"],
    gemini: ["GEMINI.md", ".gemini/hooks/wiki-session-start.js", ".gemini/settings.json"],
};
const projectLibrarianCommonInstallFiles = [
    "wiki/startup.md",
    "wiki/index.md",
    "wiki/AGENTS.md",
];
function parseAgentSurfaceValues(values) {
    const surfaces = new Set();
    const invalid = [];
    for (const value of values) {
        if (value === "all") {
            for (const surface of exports.allAgentSurfaces)
                surfaces.add(surface);
        }
        else if (exports.allAgentSurfaces.includes(value)) {
            surfaces.add(value);
        }
        else {
            invalid.push(value);
        }
    }
    return { surfaces: Array.from(surfaces), invalid };
}
function hasProjectLibrarianInstall(fileExists, readFile) {
    if (projectLibrarianCommonInstallFiles.some((file) => fileExists(file)))
        return true;
    if (fileExists("AGENTS.md") && readFile) {
        return readFile("AGENTS.md").includes("PROJECT-WIKI-FIRST:START");
    }
    return false;
}
function activeAgentSurfaces(fileExists) {
    return exports.allAgentSurfaces.filter((surface) => exports.agentSurfaceRequiredFiles[surface].some((file) => fileExists(file)));
}
function resolveBootstrapAgentSurfaces(explicitSurfaces, fileExists, readFile) {
    if (explicitSurfaces.length > 0)
        return Array.from(explicitSurfaces);
    if (hasProjectLibrarianInstall(fileExists, readFile))
        return activeAgentSurfaces(fileExists);
    return Array.from(exports.allAgentSurfaces);
}
function includesAgentSurface(surfaces, surface) {
    return surfaces.includes(surface);
}
