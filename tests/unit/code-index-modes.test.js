const assert = require("node:assert/strict");
const test = require("node:test");

process.argv = [process.execPath, "code-index-modes.test.js", "--code-context-pack", "healthHandler"];

const { resolveCodeIndexEngine, runCodeContextPackMode } = require("../../dist/code-index/modes.js");

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
            return [{ value: "4" }];
          }
          throw new Error(`unexpected fake database query: ${sql}`);
        },
      };
    },
  };
}

test("code context pack mode reuses one staleness calculation for warning and output", () => {
  const staleness = { stale: true, changed: 1, added: 2, deleted: 3 };
  const database = fakeCompatibleDatabase();
  let stalenessCalls = 0;
  let warningCalls = 0;
  let packCalls = 0;
  const logs = [];
  const originalLog = console.log;
  try {
    console.log = (value) => logs.push(String(value));
    runCodeContextPackMode({
      codeContextPack(actualDatabase, query, options) {
        packCalls += 1;
        assert.equal(actualDatabase, database);
        assert.equal(query, "healthHandler");
        assert.equal(options.staleness, staleness);
        return "context pack output";
      },
      codeEvidenceDatabasePath() {
        return { absolutePath: "/tmp/code.sqlite", relativePath: ".project-wiki/code-evidence.sqlite" };
      },
      codeImpact() {
        throw new Error("not used");
      },
      codeIndexHealth() {
        throw new Error("not used");
      },
      codeIndexStaleness(actualDatabase) {
        stalenessCalls += 1;
        assert.equal(actualDatabase, database);
        return staleness;
      },
      codeReportForRequestedSection() {
        throw new Error("not used");
      },
      codeScopes() {
        throw new Error("not used");
      },
      fail(message) {
        throw new Error(message);
      },
      indexCodeFile() {
        throw new Error("not used");
      },
      openDatabase(databasePath) {
        assert.equal(databasePath, "/tmp/code.sqlite");
        return database;
      },
      prepareOutputPath() {
        throw new Error("not used");
      },
      readCodeFile() {
        throw new Error("not used");
      },
      removeDatabaseFiles() {
        throw new Error("not used");
      },
      requireExistingIndex() {},
      selectedCodeParserMode() {
        throw new Error("not used");
      },
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
  assert.equal(packCalls, 1);
  assert.deepEqual(logs, ["context pack output"]);
  assert.equal(database.closeCalls, 1);
});

test("auto code index engine resolves to native only for eligible full runs", () => {
  assert.equal(resolveCodeIndexEngine("typescript", 10000, () => true, false), "typescript");
  assert.equal(resolveCodeIndexEngine("native-rust", 1, () => false, false), "native-rust");
  assert.equal(resolveCodeIndexEngine("auto", 10000, () => true, false), "native-rust");
  assert.equal(resolveCodeIndexEngine("auto", 10000, () => true, true), "typescript");
  assert.equal(resolveCodeIndexEngine("auto", 10000, () => false, false), "typescript");

  let observedFileCount = 0;
  assert.equal(resolveCodeIndexEngine("auto", 42, (fileCount) => {
    observedFileCount = fileCount;
    return false;
  }, false), "typescript");
  assert.equal(observedFileCount, 42);
});
