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
exports.projectSkillTarget = projectSkillTarget;
exports.sharedProjectSkillTarget = sharedProjectSkillTarget;
exports.installedProjectSkillSurfaces = installedProjectSkillSurfaces;
exports.hasSharedProjectSkillInstall = hasSharedProjectSkillInstall;
exports.syncProjectSkillInstall = syncProjectSkillInstall;
exports.syncSharedProjectSkillInstall = syncSharedProjectSkillInstall;
exports.runInstallSkillMode = runInstallSkillMode;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const agent_surfaces_1 = require("./agent-surfaces");
const args_1 = require("./args");
const skillName = "project-librarian";
const sharedProjectSkillRelativeRoot = path.join(".agents", "skills", skillName);
const packageFiles = [
    "SKILL.md",
    "dist",
    "README.md",
    "README.ko.md",
    "LICENSE",
    "package.json",
    "agents",
];
const runtimeDependencyPackages = ["typescript"];
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
function runtimeDependencySource(packageName) {
    try {
        return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [packageRoot()] }));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`missing runtime dependency ${packageName}: run npm install before installing the Project Librarian skill. Error: ${message}`);
    }
}
function runtimeDependencyTarget(packageName) {
    return path.join("node_modules", ...packageName.split("/"));
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
function projectSkillRelativeRoot(agent) {
    return path.join(projectAgentRoot(agent), "skills", skillName);
}
function projectSkillTarget(agent) {
    return path.join(process.cwd(), projectSkillRelativeRoot(agent));
}
function sharedProjectSkillTarget() {
    return path.join(process.cwd(), sharedProjectSkillRelativeRoot);
}
function installTarget(agent, scope) {
    const base = scope === "user" ? userAgentRoot(agent) : path.join(process.cwd(), projectAgentRoot(agent));
    return path.join(base, "skills", skillName);
}
function assertNoTargetSymlink(targetRoot, target, includeLeaf) {
    const rootResolved = path.resolve(targetRoot);
    const targetResolved = path.resolve(target);
    if (targetResolved !== rootResolved && !targetResolved.startsWith(`${rootResolved}${path.sep}`)) {
        fail(`skill install target escaped target root: ${target}`);
    }
    if (fs.existsSync(rootResolved) && fs.lstatSync(rootResolved).isSymbolicLink()) {
        fail("skill install refuses to follow destination symlink: .");
    }
    const relative = path.relative(rootResolved, targetResolved);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    const checkedParts = includeLeaf ? parts : parts.slice(0, -1);
    let current = rootResolved;
    for (const part of checkedParts) {
        current = path.join(current, part);
        if (!fs.existsSync(current))
            continue;
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            fail(`skill install refuses to follow destination symlink: ${path.relative(rootResolved, current) || "."}`);
        }
        if (current !== targetResolved && !stat.isDirectory()) {
            fail(`skill install target has a non-directory path component: ${path.relative(rootResolved, current)}`);
        }
    }
}
function isInsidePath(base, target) {
    const baseResolved = path.resolve(base);
    const targetResolved = path.resolve(target);
    return targetResolved === baseResolved || targetResolved.startsWith(`${baseResolved}${path.sep}`);
}
function mkdirFromBaseNoSymlink(base, target) {
    const baseResolved = path.resolve(base);
    const targetResolved = path.resolve(target);
    if (!isInsidePath(baseResolved, targetResolved)) {
        fail(`skill install target escaped checked base: ${target}`);
    }
    let current = baseResolved;
    const parts = path.relative(baseResolved, targetResolved).split(path.sep).filter(Boolean);
    for (const part of parts) {
        current = path.join(current, part);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) {
                fail(`skill install refuses to follow destination symlink: ${path.relative(baseResolved, current)}`);
            }
            if (!stat.isDirectory()) {
                fail(`skill install target has a non-directory path component: ${path.relative(baseResolved, current)}`);
            }
            continue;
        }
        fs.mkdirSync(current);
    }
}
function mkdirpNoTargetSymlink(targetRoot, target) {
    const rootResolved = path.resolve(targetRoot);
    const targetResolved = path.resolve(target);
    const cwdResolved = path.resolve(process.cwd());
    if (isInsidePath(cwdResolved, rootResolved)) {
        mkdirFromBaseNoSymlink(cwdResolved, rootResolved);
    }
    else {
        fs.mkdirSync(rootResolved, { recursive: true });
    }
    const relative = path.relative(rootResolved, targetResolved);
    let current = rootResolved;
    if (!relative) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
            fail("skill install refuses to follow destination symlink: .");
        }
        if (!fs.existsSync(current))
            fs.mkdirSync(current);
        return;
    }
    for (const part of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) {
                fail(`skill install refuses to follow destination symlink: ${path.relative(rootResolved, current)}`);
            }
            if (!stat.isDirectory()) {
                fail(`skill install target has a non-directory path component: ${path.relative(rootResolved, current)}`);
            }
            continue;
        }
        fs.mkdirSync(current);
    }
}
function sameFile(source, target) {
    if (!fs.existsSync(target))
        return false;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile())
        return false;
    return fs.readFileSync(source).equals(fs.readFileSync(target));
}
function copyPath(source, target, targetRoot, dryRun) {
    if (!fs.existsSync(source))
        fail(`missing package file: ${source}`);
    const existed = fs.existsSync(target);
    if (dryRun)
        return "dry-run";
    const sourceStat = fs.statSync(source);
    assertNoTargetSymlink(targetRoot, target, true);
    if (sourceStat.isDirectory()) {
        mkdirpNoTargetSymlink(targetRoot, target);
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            copyPath(path.join(source, entry.name), path.join(target, entry.name), targetRoot, false);
        }
        return existed ? "updated" : "created";
    }
    mkdirpNoTargetSymlink(targetRoot, path.dirname(target));
    if (sameFile(source, target))
        return "exists";
    fs.copyFileSync(source, target);
    fs.chmodSync(target, sourceStat.mode);
    return existed ? "updated" : "created";
}
function installedProjectSkillSurfaces() {
    return agent_surfaces_1.allAgentSurfaces.filter((agent) => fs.existsSync(path.join(projectSkillTarget(agent), "SKILL.md")));
}
function hasSharedProjectSkillInstall() {
    return fs.existsSync(path.join(sharedProjectSkillTarget(), "SKILL.md"));
}
function copyPackageFiles(targetRoot, dryRun, labelRoot = targetRoot) {
    const root = packageRoot();
    const packageRows = packageFiles.map((relativePath) => {
        const source = path.join(root, relativePath);
        const target = path.join(targetRoot, relativePath);
        return [path.join(labelRoot, relativePath), copyPath(source, target, targetRoot, dryRun)];
    });
    const dependencyRows = runtimeDependencyPackages.map((packageName) => {
        const relativePath = runtimeDependencyTarget(packageName);
        const source = runtimeDependencySource(packageName);
        const target = path.join(targetRoot, relativePath);
        return [path.join(labelRoot, relativePath), copyPath(source, target, targetRoot, dryRun)];
    });
    return [...packageRows, ...dependencyRows];
}
function syncProjectSkillInstall(agent) {
    return copyPackageFiles(projectSkillTarget(agent), false, projectSkillRelativeRoot(agent)).map(([label, status]) => {
        if (status === "dry-run")
            throw new Error("project skill sync does not support dry-run status");
        return [label, status];
    });
}
function syncSharedProjectSkillInstall() {
    return copyPackageFiles(sharedProjectSkillTarget(), false, sharedProjectSkillRelativeRoot).map(([label, status]) => {
        if (status === "dry-run")
            throw new Error("shared project skill sync does not support dry-run status");
        return [label, status];
    });
}
function runInstallSkillMode() {
    const scope = installScope();
    const agents = installAgents();
    const dryRun = args_1.args.has("--dry-run");
    const rows = [];
    for (const agent of agents) {
        const targetRoot = installTarget(agent, scope);
        rows.push(...copyPackageFiles(targetRoot, dryRun).map(([label, status]) => [`${agent}:${scope}:${label}`, status]));
    }
    console.log(`Project Librarian skill ${dryRun ? "install dry-run" : "install"} complete.`);
    console.log(`scope: ${scope}`);
    console.log(`agents: ${agents.join(", ")}`);
    console.log("note: install only installs the reusable skill files and required local-runner runtime dependencies; it does not create or update AGENTS.md, CLAUDE.md, GEMINI.md, wiki/, .cursor/rules/, .cursor/hooks.json, .gemini/settings.json, .codex/hooks.json, or .claude/settings.json.");
    console.log("compatibility: install-skill remains supported as an alias for install.");
    console.log("next: ask your agent to use Project Librarian from the target project root; the installed skill resolves the local runner.");
    for (const [label, status] of rows) {
        console.log(`${status.padEnd(7)} ${label}`);
    }
}
