"use strict";

const allNativeStrategies = ["sqlite-bridge", "sqlite-direct", "row-stream"];
const defaultNativeStrategy = "sqlite-direct";

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

function assertIncrementalNativeStrategies(strategies, rustMode, optionName = "--native-strategies") {
  if (rustMode !== "incremental") return;
  const unsupported = strategies.filter((strategy) => strategy !== defaultNativeStrategy);
  if (unsupported.length > 0) {
    throw new Error(`${optionName} for incremental rust mode must be ${defaultNativeStrategy}; ${unsupported.join(", ")} are full-rebuild strategies because native incremental writer is ${defaultNativeStrategy}-only`);
  }
}

module.exports = {
  allNativeStrategies,
  assertIncrementalNativeStrategies,
  defaultNativeStrategy,
  parseNativeStrategies,
};
