"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUpdateSelection = resolveUpdateSelection;
const args_1 = require("./args");
const install_1 = require("./install");
const allUpdateTargets = ["skill", "agents"];
function parseScope() {
    const scope = (0, args_1.argValue)("--scope") || "project";
    if (scope === "user" || scope === "project")
        return scope;
    throw new Error(`invalid --scope: ${scope}; expected user or project`);
}
function parseTargets(scope) {
    const values = (0, args_1.argValues)("--targets");
    if (values.length === 0)
        return scope === "user" ? ["skill"] : Array.from(allUpdateTargets);
    const targets = new Set();
    for (const value of values) {
        if (value === "all") {
            for (const target of allUpdateTargets)
                targets.add(target);
        }
        else if (allUpdateTargets.includes(value)) {
            targets.add(value);
        }
        else {
            throw new Error(`invalid --targets entry: ${value}; expected skill, agents, or all`);
        }
    }
    if (scope === "user" && Array.from(targets).some((target) => target !== "skill")) {
        throw new Error("user scope only supports --targets skill; agents belong to project scope");
    }
    return Array.from(targets);
}
function hasExplicitSelection() {
    return Boolean((0, args_1.argValue)("--scope") || (0, args_1.argValues)("--targets").length > 0 || (0, args_1.argValues)("--agents").length > 0);
}
async function chooseScope() {
    const options = [
        { value: "user", label: "사용자 전체 — 홈 디렉터리에 설치된 스킬만 업데이트" },
        { value: "project", label: "현재 프로젝트 — 프로젝트 에이전트와 스킬을 업데이트" },
    ];
    const selected = await (0, install_1.promptChoices)("Project Librarian 업데이트 범위를 선택하세요", options, false, [0], "interactive update requires a TTY; pass --scope and/or --targets for non-interactive use");
    const scope = selected[0];
    if (!scope)
        throw new Error("interactive update did not return an update scope");
    return scope;
}
async function chooseTargets() {
    const options = [
        { value: "skill", label: "재사용 스킬 — 프로젝트에 설치된 스킬 갱신" },
        { value: "agents", label: "프로젝트 에이전트 — AGENTS.md, 설정, hook 갱신" },
    ];
    const defaults = options.map((_option, index) => index);
    return (0, install_1.promptChoices)("업데이트할 대상을 선택하세요", options, true, defaults, "interactive update requires a TTY; pass --scope and/or --targets for non-interactive use");
}
async function resolveUpdateSelection() {
    if (hasExplicitSelection()) {
        const scope = parseScope();
        return { scope, targets: parseTargets(scope) };
    }
    const scope = await chooseScope();
    if (scope === "user")
        return { scope, targets: ["skill"] };
    return { scope, targets: await chooseTargets() };
}
