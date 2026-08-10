"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const rootDist = path.join(root, "dist");
const configuredSkillRoots = [
  ".agents/skills/project-librarian",
  ".agents/skills/project-wiki-bootstrap",
  ".claude/skills/project-librarian",
  ".claude/skills/project-wiki-bootstrap",
];
const installedSkills = configuredSkillRoots.filter((relativeSkillRoot) => fs.existsSync(path.join(root, relativeSkillRoot)));

assert.deepEqual(
  installedSkills.slice(0, 2),
  [".agents/skills/project-librarian", ".agents/skills/project-wiki-bootstrap"],
  "the checked-in shared skill snapshots must remain available for parity checks",
);

function runtimeDigest(directory) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        files.push([
          path.relative(directory, target),
          crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
        ]);
      }
    }
  }
  visit(directory);
  return files.sort(([left], [right]) => left.localeCompare(right));
}

function run(runner, cwd, args) {
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 0, `${runner} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
}

test("installed primary and compatibility skills keep the complete v2 runtime in sync", () => {
  const expectedRuntime = runtimeDigest(rootDist);
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  for (const relativeSkillRoot of installedSkills) {
    const skillRoot = path.join(root, relativeSkillRoot);
    assert.deepEqual(runtimeDigest(path.join(skillRoot, "dist")), expectedRuntime, `${relativeSkillRoot} runtime differs from root dist`);

    const metadata = JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8"));
    if (relativeSkillRoot.endsWith("project-librarian")) {
      assert.deepEqual(metadata, rootPackage, `${relativeSkillRoot} package metadata differs from root package`);
    } else {
      assert.equal(metadata.name, "project-wiki-bootstrap");
      assert.equal(metadata.version, "0.1.2", "the compatibility package keeps its independent package version");
      assert.equal(metadata.projectLibrarianRuntimeVersion, rootPackage.version);
      assert.deepEqual(metadata.engines, rootPackage.engines);
      assert.deepEqual(metadata.dependencies, rootPackage.dependencies);
      assert.deepEqual(metadata.optionalDependencies, rootPackage.optionalDependencies);
      assert.equal(metadata.scripts, undefined, "the compatibility package must not advertise removed development workflows");
    }
  }
});

test("checked-in skill documentation exposes only the wiki product surface", () => {
  const rootReadmes = {
    "README.md": fs.readFileSync(path.join(root, "README.md"), "utf8"),
    "README.ko.md": fs.readFileSync(path.join(root, "README.ko.md"), "utf8"),
  };
  for (const relativeSkillRoot of installedSkills) {
    const skillRoot = path.join(root, relativeSkillRoot);
    for (const [readme, expected] of Object.entries(rootReadmes)) {
      assert.equal(fs.readFileSync(path.join(skillRoot, readme), "utf8"), expected, `${relativeSkillRoot}/${readme} differs from the root documentation`);
    }
    const canonicalSkill = fs.readFileSync(path.join(
      root,
      relativeSkillRoot.endsWith("project-librarian")
        ? "SKILL.md"
        : ".agents/skills/project-wiki-bootstrap/SKILL.md",
    ), "utf8");
    assert.equal(fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8"), canonicalSkill, `${relativeSkillRoot}/SKILL.md differs from its canonical contract`);
  }
});

test("every installed primary and compatibility runner fresh-initializes a lintable v2-only wiki", () => {
  for (const relativeSkillRoot of installedSkills) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-installed-v2-"));
    try {
      const runner = path.join(root, relativeSkillRoot, "dist", "init-project-wiki.js");
      run(runner, workspace, ["init", "--no-git-config"]);
      for (const expected of [
        "wiki/00-index/README.md",
        "wiki/01-governance/README.md",
        "wiki/10-services/README.md",
        "wiki/20-shared/README.md",
        "wiki/30-portfolio/README.md",
        "wiki/90-archive/README.md",
      ]) {
        assert.equal(fs.existsSync(path.join(workspace, expected)), true, `${relativeSkillRoot} did not create ${expected}`);
      }
      for (const absent of [
        "wiki/canonical",
        "wiki/decisions",
        "wiki/sources",
        "wiki/meta/wiki-ops-v1-decisions.md",
        "wiki/10-services/project-librarian",
      ]) {
        assert.equal(fs.existsSync(path.join(workspace, absent)), false, `${relativeSkillRoot} unexpectedly created ${absent}`);
      }
      run(runner, workspace, ["--lint"]);
      run(runner, workspace, ["--link-check"]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});
