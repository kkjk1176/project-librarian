"use strict";

const childProcess = require("node:child_process");

const allNativeStrategies = ["sqlite-bridge", "sqlite-direct", "row-stream"];
const defaultNativeStrategy = "sqlite-direct";

const strategyProvenance = {
  "row-stream": "native/indexer-rs/src/main.rs row-stream output, consumed by src/code-index/native-helper.ts",
  "sqlite-bridge": "native/indexer-rs/src/main.rs write_database_with_sqlite_bridge starts sqlite3 CLI",
  "sqlite-direct": "native/indexer-rs/src/main.rs sqlite3-direct-ffi output mode",
};

function parseNativeStrategies(value, optionName = "--native-strategies") {
  const requested = String(value || defaultNativeStrategy).trim();
  const strategies = requested === "all"
    ? allNativeStrategies
    : requested.split(",").map((strategy) => strategy.trim()).filter(Boolean);

  if (strategies.length === 0) {
    throw new Error(`${optionName} must include at least one strategy`);
  }
  for (const strategy of strategies) {
    if (!allNativeStrategies.includes(strategy)) {
      throw new Error(`invalid ${optionName} ${strategy}; expected all, ${allNativeStrategies.join(", ")}, or a comma-separated subset`);
    }
  }

  const uniqueStrategies = Array.from(new Set(strategies));
  if (!uniqueStrategies.includes(defaultNativeStrategy)) {
    throw new Error(`${optionName} must include ${defaultNativeStrategy} because top-level rust_* fields are the default release-path comparison`);
  }
  return uniqueStrategies;
}

function commandAvailable(command) {
  const result = childProcess.spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function nativeStrategyRequiredCommands(strategies) {
  const commands = [];
  for (const strategy of strategies) {
    if (strategy === "sqlite-bridge") commands.push("sqlite3");
  }
  return Array.from(new Set(commands));
}

function nativeStrategyRequirements(strategies, options = {}) {
  const isCommandAvailable = options.commandAvailable ?? commandAvailable;
  return strategies.map((strategy) => {
    const requirements = nativeStrategyRequiredCommands([strategy]).map((command) => ({
      type: "command",
      name: command,
      status: isCommandAvailable(command) ? "available" : "missing",
    }));
    return {
      strategy,
      status: requirements.every((requirement) => requirement.status === "available") ? "available" : "missing",
      requirements,
      provenance: strategyProvenance[strategy],
    };
  });
}

function assertNativeStrategyRequirements(strategies, options = {}) {
  const requirements = nativeStrategyRequirements(strategies, options);
  const missing = requirements.flatMap((entry) =>
    entry.requirements
      .filter((requirement) => requirement.status !== "available")
      .map((requirement) => `${entry.strategy} requires ${requirement.type} ${requirement.name} (${entry.provenance})`)
  );
  if (missing.length > 0) {
    throw new Error(`unavailable native strategy requirement(s): ${missing.join("; ")}`);
  }
  return requirements;
}

function assertIncrementalNativeStrategies(strategies, rustMode, optionName = "--native-strategies") {
  if (rustMode !== "incremental") return;
  const unsupported = strategies.filter((strategy) => strategy !== defaultNativeStrategy);
  if (unsupported.length > 0) {
    throw new Error(`${optionName} for incremental rust mode must be ${defaultNativeStrategy}; ${unsupported.join(", ")} are full-rebuild strategies because native incremental writer is ${defaultNativeStrategy}-only`);
  }
}

module.exports = {
  allNativeStrategies,
  assertNativeStrategyRequirements,
  assertIncrementalNativeStrategies,
  defaultNativeStrategy,
  nativeStrategyRequiredCommands,
  nativeStrategyRequirements,
  parseNativeStrategies,
};
