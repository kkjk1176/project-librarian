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
exports.runInstallSkillMode = runInstallSkillMode;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const agent_surfaces_1 = require("./agent-surfaces");
const args_1 = require("./args");
const skillName = "project-librarian";
const packageFiles = [
    "SKILL.md",
    "dist",
    "README.md",
    "README.ko.md",
    "LICENSE",
    "package.json",
    "agents",
];
function fail(message) {
    console.error(message);
    process.exit(1);
}
function installScope() {
    const scope = (0, args_1.argValue)("--scope") || "user";
    if (scope === "user" || scope === "project")
        return scope;
    return fail(`invalid --scope: ${scope}; expected user or project`);
}
function installAgents() {
    const value = (0, args_1.argValue)("--agents") || "all";
    const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
    const agents = new Set();
    for (const part of parts) {
        if (part === "all") {
            for (const agent of agent_surfaces_1.allAgentSurfaces)
                agents.add(agent);
        }
        else if (agent_surfaces_1.allAgentSurfaces.includes(part)) {
            agents.add(part);
        }
        else {
            return fail(`invalid --agents entry: ${part}; expected codex, claude, cursor, gemini, or all`);
        }
    }
    return Array.from(agents);
}
function packageRoot() {
    return path.resolve(__dirname, "..");
}
function userAgentRoot(agent) {
    const home = os.homedir();
    if (agent === "codex")
        return process.env.CODEX_HOME || path.join(home, ".codex");
    if (agent === "claude")
        return process.env.CLAUDE_HOME || path.join(home, ".claude");
    if (agent === "cursor")
        return process.env.CURSOR_HOME || path.join(home, ".cursor");
    return process.env.GEMINI_HOME || path.join(home, ".gemini");
}
function projectAgentRoot(agent) {
    if (agent === "codex")
        return ".codex";
    if (agent === "claude")
        return ".claude";
    if (agent === "cursor")
        return ".cursor";
    return ".gemini";
}
function installTarget(agent, scope) {
    const base = scope === "user" ? userAgentRoot(agent) : path.join(process.cwd(), projectAgentRoot(agent));
    return path.join(base, "skills", skillName);
}
function sameFile(source, target) {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile())
        return false;
    return fs.readFileSync(source).equals(fs.readFileSync(target));
}
function copyPath(source, target, dryRun) {
    if (!fs.existsSync(source))
        fail(`missing package file: ${source}`);
    const existed = fs.existsSync(target);
    if (dryRun)
        return "dry-run";
    const sourceStat = fs.statSync(source);
    if (sourceStat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            copyPath(path.join(source, entry.name), path.join(target, entry.name), false);
        }
        return existed ? "updated" : "created";
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (sameFile(source, target))
        return "exists";
    fs.copyFileSync(source, target);
    fs.chmodSync(target, sourceStat.mode);
    return existed ? "updated" : "created";
}
function runInstallSkillMode() {
    const scope = installScope();
    const agents = installAgents();
    const dryRun = args_1.args.has("--dry-run");
    const root = packageRoot();
    const rows = [];
    for (const agent of agents) {
        const targetRoot = installTarget(agent, scope);
        for (const relativePath of packageFiles) {
            const source = path.join(root, relativePath);
            const target = path.join(targetRoot, relativePath);
            rows.push([`${agent}:${scope}:${path.join(targetRoot, relativePath)}`, copyPath(source, target, dryRun)]);
        }
    }
    console.log(`Project Librarian skill ${dryRun ? "install dry-run" : "install"} complete.`);
    console.log(`scope: ${scope}`);
    console.log(`agents: ${agents.join(", ")}`);
    console.log("note: install-skill only installs the reusable skill files; it does not create or update AGENTS.md, CLAUDE.md, GEMINI.md, wiki/, .cursor/rules/, .cursor/hooks.json, .gemini/settings.json, .codex/hooks.json, or .claude/settings.json.");
    console.log("next: ask your agent to use Project Librarian from the target project root; the installed skill resolves the local runner.");
    for (const [label, status] of rows) {
        console.log(`${status.padEnd(7)} ${label}`);
    }
}
