const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  benchmarkClaimStatus,
  inspectPackFiles,
  normalizePackPath,
  packFilePaths,
  parsePackJson,
  temporaryNpmCacheEnv,
  trustedPublishingWorkflowStatus,
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

test("release readiness recognizes the current README benchmark boundary as release claimable", () => {
  const readme = fs.readFileSync(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
  const status = benchmarkClaimStatus(readme);
  assert.equal(status.ok, true);
  assert.equal(status.status, "release_claimable");
});

test("release readiness validates the trusted publishing workflow", () => {
  const workflow = path.resolve(__dirname, "..", "..", ".github", "workflows", "publish.yml");
  const status = trustedPublishingWorkflowStatus(workflow);
  assert.equal(status.ok, true);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.forbidden, []);
});

test("release readiness rejects token-based npm publish workflows", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-")), "publish.yml");
  fs.writeFileSync(fixture, [
    "name: Publish Package",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          registry-url: https://registry.npmjs.org",
    "          package-manager-cache: false",
    "      - run: npm run release:check",
    "      - run: npm publish --access public",
    "        env:",
    "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    "",
  ].join("\n"));
  const status = trustedPublishingWorkflowStatus(fixture);
  assert.equal(status.ok, false);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.forbidden, ["NODE_AUTH_TOKEN", "NPM_TOKEN", "npm token secret"]);
});
