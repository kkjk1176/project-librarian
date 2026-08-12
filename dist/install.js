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
exports.applyChoiceKey = applyChoiceKey;
exports.promptChoices = promptChoices;
exports.projectSkillTarget = projectSkillTarget;
exports.sharedProjectSkillTarget = sharedProjectSkillTarget;
exports.installedProjectSkillSurfaces = installedProjectSkillSurfaces;
exports.installedUserSkillSurfaces = installedUserSkillSurfaces;
exports.hasSharedProjectSkillInstall = hasSharedProjectSkillInstall;
exports.syncProjectSkillInstall = syncProjectSkillInstall;
exports.syncUserSkillInstall = syncUserSkillInstall;
exports.syncSharedProjectSkillInstall = syncSharedProjectSkillInstall;
exports.runInstallMode = runInstallMode;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const readline = __importStar(require("node:readline"));
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
function applyChoiceKey(state, key, multi, optionCount) {
    if (key === "ctrl-c" || key === "escape" || key === "q")
        return "cancel";
    if (key === "return" || key === "enter")
        return "submit";
    if (optionCount === 0)
        return state;
    if (key === "up") {
        return { ...state, cursor: (state.cursor - 1 + optionCount) % optionCount };
    }
    if (key === "down") {
        return { ...state, cursor: (state.cursor + 1) % optionCount };
    }
    if (multi && key === "space") {
        const selected = [...state.selected];
        selected[state.cursor] = !selected[state.cursor];
        return { ...state, selected };
    }
    if (multi && key === "a") {
        const selectAll = state.selected.some((value) => !value);
        return { ...state, selected: state.selected.map(() => selectAll) };
    }
    return state;
}
function promptChoices(title, options, multi, defaultIndexes, nonInteractiveMessage = "interactive selection requires a TTY; pass explicit options for non-interactive use") {
    if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error(nonInteractiveMessage);
    }
    const stdin = process.stdin;
    const stdout = process.stdout;
    const initialSelected = options.map((_, index) => defaultIndexes.includes(index));
    let state = {
        cursor: defaultIndexes[0] ?? 0,
        selected: initialSelected,
    };
    let renderedLines = 0;
    const clearFrame = () => {
        if (renderedLines === 0)
            return;
        stdout.write(`\u001b[${renderedLines}A`);
        for (let index = 0; index < renderedLines; index += 1) {
            stdout.write("\u001b[2K");
            if (index < renderedLines - 1)
                stdout.write("\u001b[1B");
        }
        stdout.write(`\u001b[${renderedLines - 1}A\r`);
        renderedLines = 0;
    };
    const render = () => {
        if (renderedLines > 0)
            stdout.write(`\u001b[${renderedLines}A`);
        const lines = [
            `\u001b[1m${title}\u001b[0m`,
            multi ? "↑/↓ Move · Space toggle · a select all · Enter submit · q cancel" : "↑/↓ Move · Enter submit · q cancel",
            ...options.map((option, index) => {
                const pointer = index === state.cursor ? "\u001b[36m❯\u001b[0m" : " ";
                const marker = multi
                    ? state.selected[index] ? "\u001b[32m☑\u001b[0m" : "☐"
                    : index === state.cursor ? "\u001b[32m●\u001b[0m" : "○";
                return `${pointer} ${marker} ${option.label}`;
            }),
        ];
        stdout.write(lines.map((line) => `\u001b[2K${line}`).join("\n") + "\n");
        renderedLines = lines.length;
    };
    return new Promise((resolve, reject) => {
        const previousRawMode = Boolean(stdin.isRaw);
        const onKeypress = (_input, key) => {
            const keyName = key.ctrl && key.name === "c" ? "ctrl-c" : key.name ?? "";
            const next = applyChoiceKey(state, keyName, multi, options.length);
            if (next === "cancel") {
                clearFrame();
                stdin.setRawMode(previousRawMode);
                stdin.removeListener("keypress", onKeypress);
                stdout.write("\n");
                reject(new Error("Installation cancelled."));
                return;
            }
            if (next === "submit") {
                const values = options.filter((_option, index) => multi ? state.selected[index] : index === state.cursor).map((option) => option.value);
                if (values.length === 0)
                    return;
                clearFrame();
                stdin.setRawMode(previousRawMode);
                stdin.removeListener("keypress", onKeypress);
                resolve(values);
                return;
            }
            state = next;
            render();
        };
        readline.emitKeypressEvents(stdin);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("keypress", onKeypress);
        render();
    });
}
async function interactiveInstallSelection() {
    const nonInteractiveMessage = "interactive install requires a TTY; pass --scope and/or --agents for non-interactive use";
    const selectedScope = (await promptChoices("Select Project Librarian installation scope", [
        { value: "user", label: "User — install to agent skills in the home directory" },
        { value: "project", label: "Project — install to agents in this repository" },
    ], false, [0], nonInteractiveMessage))[0];
    if (!selectedScope)
        throw new Error("interactive install did not return an install scope");
    const agents = await promptChoices("Select agents to install", [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude Code" },
        { value: "cursor", label: "Cursor" },
        { value: "gemini", label: "Gemini CLI" },
    ], true, agent_surfaces_1.allAgentSurfaces.map((_agent, index) => index), nonInteractiveMessage);
    return { scope: selectedScope, agents };
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
function userSkillTarget(agent) {
    return installTarget(agent, "user");
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
function installedUserSkillSurfaces() {
    return agent_surfaces_1.allAgentSurfaces.filter((agent) => fs.existsSync(path.join(userSkillTarget(agent), "SKILL.md")));
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
function syncUserSkillInstall(agent) {
    const targetRoot = userSkillTarget(agent);
    return copyPackageFiles(targetRoot, false, `${agent}:user`).map(([label, status]) => {
        if (status === "dry-run")
            throw new Error("user skill sync does not support dry-run status");
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
async function runInstallMode() {
    const hasExplicitSelection = Boolean((0, args_1.argValue)("--scope") || (0, args_1.argValue)("--agents"));
    const { scope, agents } = hasExplicitSelection
        ? { scope: installScope(), agents: installAgents() }
        : await interactiveInstallSelection();
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
    console.log("next: ask your agent to use Project Librarian from the target project root; the installed skill resolves the local runner.");
    for (const [label, status] of rows) {
        console.log(`${status.padEnd(7)} ${label}`);
    }
}
