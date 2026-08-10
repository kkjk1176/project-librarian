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
const compatibilitySkillPath = path.join(root, ".agents", "skills", "project-wiki-bootstrap", "SKILL.md");
const skillRoots = [
  { path: ".agents/skills/project-librarian", compatibility: false },
  { path: ".claude/skills/project-librarian", compatibility: false },
  { path: ".agents/skills/project-wiki-bootstrap", compatibility: true },
  { path: ".claude/skills/project-wiki-bootstrap", compatibility: true },
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

function syncPackageMetadata(skillRoot, compatibility, rootPackage) {
  const target = path.join(skillRoot, "package.json");
  if (!compatibility) {
    fs.copyFileSync(rootPackagePath, target);
    return;
  }

  const existing = JSON.parse(fs.readFileSync(target, "utf8"));
  const {
    scripts: _removedScripts,
    devDependencies: _removedDevDependencies,
    optionalDependencies: _removedOptionalDependencies,
    ...packageIdentity
  } = existing;
  const compatible = {
    ...packageIdentity,
    type: rootPackage.type,
    engines: rootPackage.engines,
    dependencies: rootPackage.dependencies,
    optionalDependencies: rootPackage.optionalDependencies,
    projectLibrarianRuntimeVersion: rootPackage.version,
  };
  fs.writeFileSync(target, `${JSON.stringify(compatible, null, 2)}\n`);
}

function syncReadmes(skillRoot) {
  for (const readmeName of rootReadmeNames) {
    fs.copyFileSync(path.join(root, readmeName), path.join(skillRoot, readmeName));
  }
}

function syncSkillContract(skillRoot, compatibility) {
  const source = compatibility ? compatibilitySkillPath : rootSkillPath;
  const target = path.join(skillRoot, "SKILL.md");
  if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
}

function main() {
  if (!fs.statSync(rootDist).isDirectory()) throw new Error(`missing built root runtime: ${rootDist}`);
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf8"));
  for (const skill of skillRoots) {
    const skillRoot = managedPath(skill.path);
    // Claude's checked-in copy is optional because .claude is normally a
    // developer-local agent surface. When it is present, it must receive the
    // exact same runtime snapshot as the shared checked-in skills.
    if (!fs.existsSync(skillRoot)) continue;
    assertNoSymlink(skillRoot);
    if (!fs.statSync(skillRoot).isDirectory()) throw new Error(`missing checked-in skill root: ${skill.path}`);
    copyRuntime(rootDist, path.join(skillRoot, "dist"));
    syncPackageMetadata(skillRoot, skill.compatibility, rootPackage);
    syncReadmes(skillRoot);
    syncSkillContract(skillRoot, skill.compatibility);
  }
}

main();
