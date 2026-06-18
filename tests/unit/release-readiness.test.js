const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  benchmarkClaimStatus,
  inspectPackFiles,
  normalizePackPath,
  packFilePaths,
  parsePackJson,
  temporaryNpmCacheEnv,
} = require("../../benchmarks/tools/release-readiness.js");

test("release readiness parses npm pack JSON and normalizes package paths", () => {
  const entries = parsePackJson(JSON.stringify([{
    files: [
      { path: "package/README.md" },
      { path: "package/dist/init-project-wiki.js" },
    ],
  }]));
  assert.deepEqual(packFilePaths(entries), ["README.md", "dist/init-project-wiki.js"]);
  assert.equal(normalizePackPath("package/wiki/startup.md"), "wiki/startup.md");
});

test("release readiness package inspection requires shipped surface and rejects runtime state", () => {
  const ok = inspectPackFiles([
    "LICENSE",
    "README.md",
    "README.ko.md",
    "SKILL.md",
    "dist/init-project-wiki.js",
    "package.json",
  ]);
  assert.equal(ok.ok, true);

  const bad = inspectPackFiles([
    "LICENSE",
    "README.md",
    "README.ko.md",
    "SKILL.md",
    "dist/init-project-wiki.js",
    "package.json",
    "wiki/startup.md",
    ".omx/state/session.json",
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing_required, []);
  assert.deepEqual(bad.forbidden, [".omx/state/session.json", "wiki/startup.md"]);
});

test("release readiness uses an isolated npm cache for pack inspection", () => {
  const env = temporaryNpmCacheEnv();
  assert(env.npm_config_cache);
  assert.notEqual(env.npm_config_cache, process.env.npm_config_cache);
  assert(fs.existsSync(env.npm_config_cache));
});

test("release readiness recognizes the current README benchmark boundary as diagnostic", () => {
  const readme = fs.readFileSync(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
  const status = benchmarkClaimStatus(readme);
  assert.equal(status.ok, true);
  assert.equal(status.status, "diagnostic_only");
});
