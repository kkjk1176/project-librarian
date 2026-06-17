const assert = require("node:assert/strict");
const test = require("node:test");

process.argv = [process.execPath, "code-index-report-mode.test.js", "--code-report", "--code-report-section", "routes"];

const { runCodeReportMode } = require("../../dist/code-index/modes.js");

function unused(name) {
  return () => {
    throw new Error(`${name} not used`);
  };
}

test("code report mode reuses one staleness calculation for warning and metadata", () => {
  const staleness = { stale: false, changed: 0, added: 0, deleted: 0 };
  const database = { closeCalls: 0, close() { this.closeCalls += 1; } };
  let stalenessCalls = 0;
  let warningCalls = 0;
  let reportCalls = 0;
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (value) => logs.push(String(value));
    runCodeReportMode({
      codeContextPack: unused("codeContextPack"),
      codeEvidenceDatabasePath() {
        return { absolutePath: "/tmp/code.sqlite", relativePath: ".project-wiki/code-evidence.sqlite" };
      },
      codeImpact: unused("codeImpact"),
      codeIndexStaleness(actualDatabase) {
        stalenessCalls += 1;
        assert.equal(actualDatabase, database);
        return staleness;
      },
      codeReportForRequestedSection(actualDatabase, requestedSection, options) {
        reportCalls += 1;
        assert.equal(actualDatabase, database);
        assert.equal(requestedSection, "routes");
        assert.equal(options.staleness, staleness);
        return { section: "routes" };
      },
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
  assert.equal(reportCalls, 1);
  assert.deepEqual(logs, [JSON.stringify({ section: "routes" }, null, 2)]);
  assert.equal(database.closeCalls, 1);
});
