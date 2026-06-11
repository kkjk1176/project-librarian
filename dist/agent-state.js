"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRequiredFiles = exports.commonRequiredFiles = exports.allAgentTargets = exports.installStatePath = void 0;
exports.parseAgentTargets = parseAgentTargets;
exports.explicitAgentSelection = explicitAgentSelection;
exports.readInstallState = readInstallState;
exports.registeredAgentsFromState = registeredAgentsFromState;
exports.inferInstalledAgentsFromProject = inferInstalledAgentsFromProject;
exports.resolveProjectAgents = resolveProjectAgents;
exports.registerProjectAgents = registerProjectAgents;
exports.removeEmptyInstallStateDir = removeEmptyInstallStateDir;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const args_1 = require("./args");
const workspace_1 = require("./workspace");
exports.installStatePath = ".project-librarian/install-state.json";
exports.allAgentTargets = ["codex", "claude", "cursor", "gemini"];
const legacyBothAgentTargets = ["codex", "claude"];
exports.commonRequiredFiles = [
    "AGENTS.md",
    "wiki/AGENTS.md",
    "wiki/startup.md",
    "wiki/index.md",
    "wiki/canonical/project-brief.md",
    "wiki/canonical/open-questions.md",
    "wiki/canonical/assumptions.md",
    "wiki/canonical/risks.md",
    "wiki/decisions/log.md",
    "wiki/decisions/recent.md",
    "wiki/meta/operating-model.md",
    "wiki/meta/decision-policy.md",
    "wiki/meta/wiki-ops-v1-decisions.md",
    ".githooks/prepare-commit-msg",
    ".githooks/wiki-commit-trailers.js",
];
exports.agentRequiredFiles = {
    codex: [
        ".codex/hooks/wiki-session-start.js",
        ".codex/hooks.json",
    ],
    claude: [
        "CLAUDE.md",
        ".claude/hooks/wiki-session-start.js",
        ".claude/settings.json",
    ],
    cursor: [
        ".cursor/rules/project-librarian.mdc",
        ".cursor/hooks/wiki-session-start.js",
        ".cursor/hooks.json",
    ],
    gemini: [
        "GEMINI.md",
        ".gemini/hooks/wiki-session-start.js",
        ".gemini/settings.json",
    ],
};
function nowIso() {
    return new Date().toISOString();
}
function emptyState() {
    return { version: 1, agents: {} };
}
function sortedAgents(agents) {
    const selected = new Set(agents);
    return exports.allAgentTargets.filter((agent) => selected.has(agent));
}
function parseAgentTargets(value) {
    const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
    const agents = new Set();
    const warnings = [];
    for (const part of parts.length > 0 ? parts : ["all"]) {
        if (part === "all") {
            for (const agent of exports.allAgentTargets)
                agents.add(agent);
        }
        else if (part === "both") {
            warnings.push("--agents both is deprecated; use --agents codex,claude");
            for (const agent of legacyBothAgentTargets)
                agents.add(agent);
        }
        else if (exports.allAgentTargets.includes(part)) {
            agents.add(part);
        }
        else {
            throw new Error(`invalid --agents entry: ${part}; expected codex, claude, cursor, gemini, all, or legacy both`);
        }
    }
    return { agents: sortedAgents(agents), warnings };
}
function explicitAgentSelection() {
    const value = (0, args_1.argValue)("--agents");
    return value ? parseAgentTargets(value) : null;
}
function readInstallState() {
    if (!(0, workspace_1.exists)(exports.installStatePath))
        return null;
    const parsed = JSON.parse((0, workspace_1.read)(exports.installStatePath));
    if (parsed.version !== 1 || !parsed.agents || typeof parsed.agents !== "object") {
        throw new Error(`${exports.installStatePath} has an unsupported install-state format`);
    }
    return { version: 1, agents: parsed.agents };
}
function registeredAgentsFromState(state) {
    return exports.allAgentTargets.filter((agent) => state.agents[agent]?.installed === true);
}
function inferInstalledAgentsFromProject() {
    return exports.allAgentTargets.filter((agent) => exports.agentRequiredFiles[agent].some((file) => (0, workspace_1.exists)(file)));
}
function resolveProjectAgents(defaultAgents = exports.allAgentTargets) {
    const explicit = explicitAgentSelection();
    if (explicit)
        return { ...explicit, source: "explicit" };
    const state = readInstallState();
    if (state)
        return { agents: registeredAgentsFromState(state), warnings: [], source: "state" };
    const inferred = inferInstalledAgentsFromProject();
    if (inferred.length > 0) {
        return {
            agents: inferred,
            warnings: [`${exports.installStatePath} is missing; inferred registered agents: ${inferred.join(", ")}`],
            source: "inferred",
        };
    }
    return { agents: defaultAgents, warnings: [], source: "default" };
}
function registerProjectAgents(agents) {
    const current = readInstallState() ?? emptyState();
    const before = new Set(registeredAgentsFromState(current));
    const timestamp = nowIso();
    for (const agent of agents) {
        const previous = current.agents[agent];
        current.agents[agent] = {
            installed: true,
            installedAt: previous?.installedAt ?? timestamp,
            updatedAt: timestamp,
        };
    }
    (0, workspace_1.write)(exports.installStatePath, `${JSON.stringify(current, null, 2)}\n`);
    const registered = registeredAgentsFromState(current);
    return { added: registered.filter((agent) => !before.has(agent)), registered };
}
function removeEmptyInstallStateDir() {
    const dir = path.dirname((0, workspace_1.abs)(exports.installStatePath));
    if (dir === workspace_1.root || !fs.existsSync(dir))
        return;
    if (fs.readdirSync(dir).length === 0)
        fs.rmdirSync(dir);
}
