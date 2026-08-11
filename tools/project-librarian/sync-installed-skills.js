"use strict";

// The checked-in agent skills are distributable runtime snapshots. Keep their
// executable payload tied to root dist rather than hand-copied between releases.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const rootDist = path.join(root, "dist");
const rootPackagePath = path.join(root, "package.json");
const rootReadmeNames = ["README.md", "README.ko.md"];
const rootSkillPath = path.join(root, "SKILL.md");
const skillRoots = [
  ".agents/skills/project-librarian",
  ".claude/skills/project-librarian",
];

function managedPath(relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`skill target escaped repository: ${relativePath}`);
  return target;
}

function assertNoSymlink(target) {
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`refusing to replace symlinked skill runtime: ${target}`);
}

function copyRuntime(source, target) {
  assertNoSymlink(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyRuntimeEntry(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`unsupported root runtime entry: ${from}`);
  }
}

function copyRuntimeEntry(source, target) {
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`refusing to copy symlinked root runtime entry: ${source}`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyRuntimeEntry(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`unsupported root runtime entry: ${from}`);
  }
}

function syncPackageMetadata(skillRoot) {
  const target = path.join(skillRoot, "package.json");
  fs.copyFileSync(rootPackagePath, target);
}

function syncReadmes(skillRoot) {
  for (const readmeName of rootReadmeNames) {
    fs.copyFileSync(path.join(root, readmeName), path.join(skillRoot, readmeName));
  }
}

function syncSkillContract(skillRoot) {
  const target = path.join(skillRoot, "SKILL.md");
  if (path.resolve(rootSkillPath) !== path.resolve(target)) fs.copyFileSync(rootSkillPath, target);
}

function main() {
  if (!fs.statSync(rootDist).isDirectory()) throw new Error(`missing built root runtime: ${rootDist}`);
  for (const skillPath of skillRoots) {
    const skillRoot = managedPath(skillPath);
    // Claude's checked-in copy is optional because .claude is normally a
    // developer-local agent surface. When it is present, it must receive the
    // exact same runtime snapshot as the shared checked-in skills.
    if (!fs.existsSync(skillRoot)) continue;
    assertNoSymlink(skillRoot);
    if (!fs.statSync(skillRoot).isDirectory()) throw new Error(`missing checked-in skill root: ${skillPath}`);
    copyRuntime(rootDist, path.join(skillRoot, "dist"));
    syncPackageMetadata(skillRoot);
    syncReadmes(skillRoot);
    syncSkillContract(skillRoot);
  }
}

main();
