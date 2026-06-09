"use strict";

function benchmarkValidation(fail) {
  return {
    expectBenchmark(condition, message) {
      if (!condition) fail(`benchmark validation failed: ${message}`);
    },
    passedValidation(name) {
      return { name, status: "passed" };
    },
  };
}

module.exports = { benchmarkValidation };
