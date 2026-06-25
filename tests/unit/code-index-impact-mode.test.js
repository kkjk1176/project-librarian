const assert = require("node:assert/strict");
const test = require("node:test");

process.argv = [process.execPath, "code-index-impact-mode.test.js", "--code-impact", "healthHandler"];

const { runCodeImpactMode } = require("../../dist/code-index/modes.js");

function unused(name) {
  return () => {
    throw new Error(`${name} not used`);
  };
}

function fakeCompatibleDatabase() {
  return {
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
    },
    prepare(sql) {
      return {
        all(key) {
          if (/SELECT value FROM meta WHERE key = \?/.test(sql) && key === "schema_version") {
            return [{ value: "5" }];
          }
          throw new Error(`unexpected fake database query: ${sql}`);
        },
      };
    },
  };
}

test("code impact mode reuses one staleness calculation for warning and metadata", () => {
  const staleness = { stale: true, changed: 1, added: 0, deleted: 0 };
  const database = fakeCompatibleDatabase();
  let stalenessCalls = 0;
  let warningCalls = 0;
  let impactCalls = 0;
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (value) => logs.push(String(value));
    runCodeImpactMode({
      codeContextPack: unused("codeContextPack"),
      codeEvidenceDatabasePath() {
        return { absolutePath: "/tmp/code.sqlite", relativePath: ".project-wiki/code-evidence.sqlite" };
      },
      codeImpact(actualDatabase, target, options) {
        impactCalls += 1;
        assert.equal(actualDatabase, database);
        assert.equal(target, "healthHandler");
        assert.equal(options.staleness, staleness);
        return { ok: true };
      },
      codeIndexStaleness(actualDatabase) {
        stalenessCalls += 1;
        assert.equal(actualDatabase, database);
        return staleness;
      },
      codeReportForRequestedSection: unused("codeReportForRequestedSection"),
      codeScopes: unused("codeScopes"),
      fail(message) {
        throw new Error(message);
      },
      indexCodeFile: unused("indexCodeFile"),
      openDatabase(databasePath) {
        assert.equal(databasePath, "/tmp/code.sqlite");
        return database;
      },
      prepareOutputPath: unused("prepareOutputPath"),
      readCodeFile: unused("readCodeFile"),
      removeDatabaseFiles: unused("removeDatabaseFiles"),
      requireExistingIndex() {},
      selectedCodeParserMode: unused("selectedCodeParserMode"),
      warnIfCodeIndexStale(actualDatabase, actualStaleness) {
        warningCalls += 1;
        assert.equal(actualDatabase, database);
        assert.equal(actualStaleness, staleness);
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(stalenessCalls, 1);
  assert.equal(warningCalls, 1);
  assert.equal(impactCalls, 1);
  assert.deepEqual(logs, [JSON.stringify({ ok: true }, null, 2)]);
  assert.equal(database.closeCalls, 1);
});
