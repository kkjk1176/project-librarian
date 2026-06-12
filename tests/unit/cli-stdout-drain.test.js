"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

// Regression for the 64KB stdout truncation: console.log queues asynchronously on
// pipes, and an immediate process.exit() used to discard everything past the first
// pipe chunk, so any output mode crossing ~64KB returned broken JSON (first seen on
// an 11k-file repo's --code-report). The fixture below forces a --code-query result
// past 64KB and asserts the JSON arrives complete.
test("code-query output beyond 64KB arrives unbroken", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stdout-drain-"));
  try {
    const dirName = "very-long-package-segment-padding-the-path-toward-the-pipe-chunk-boundary";
    for (let index = 0; index < 700; index += 1) {
      const file = path.join(root, "packages", dirName, `module-${String(index).padStart(4, "0")}`, "entry.ts");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `export const value${index} = ${index};\n`);
    }
    childProcess.execFileSync(process.execPath, [cliPath, "--code-index", "--code-scope", "packages"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = childProcess.execFileSync(process.execPath, [cliPath, "--code-query", "SELECT path FROM files"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.ok(Buffer.byteLength(output, "utf8") > 65536, `output must cross the 64KB pipe chunk boundary (got ${Buffer.byteLength(output, "utf8")} bytes)`);
    const rows = JSON.parse(output);
    assert.ok(Array.isArray(rows) && rows.length === 700, `expected 700 complete rows, got ${Array.isArray(rows) ? rows.length : typeof rows}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
