"use strict";

const phaseTimingMarker = "code_index_phase_timings ";

function parseCodeIndexPhaseTimingsOrThrow(stderr) {
  const line = stderr.split(/\r?\n/).reverse().find((entry) => entry.startsWith(phaseTimingMarker));
  if (!line) {
    throw new Error("missing code_index_phase_timings stderr evidence; benchmark reports are not claimable without phase timing output");
  }
  try {
    const parsed = JSON.parse(line.slice(phaseTimingMarker.length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("phase timing payload must be an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`invalid code_index_phase_timings JSON: ${error.message}`);
  }
}

function medianRun(samples) {
  if (samples.length === 0) throw new Error("medianRun requires at least one sample");
  const selected = samples.slice().sort((left, right) => left.elapsed_ms - right.elapsed_ms)[Math.floor(samples.length / 2)];
  return {
    median_ms: selected.elapsed_ms,
    parsed: selected.parsed,
    samples_ms: samples.map((sample) => sample.elapsed_ms),
    timings: selected.timings,
  };
}

function diffCounts(left, right) {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const diff = {};
  for (const key of keys) {
    if (!(key in left) || !(key in right)) {
      throw new Error(`row count key mismatch: ${key}`);
    }
    diff[key] = left[key] - right[key];
  }
  return diff;
}

function pairedRowDeltas(leftSamples, rightSamples) {
  if (leftSamples.length !== rightSamples.length) {
    throw new Error(`paired row-delta evidence requires equal sample counts: ${leftSamples.length} vs ${rightSamples.length}`);
  }
  return leftSamples.map((left, index) => {
    const right = rightSamples[index];
    const leftRunIndex = left.run_index ?? index;
    const rightRunIndex = right.run_index ?? index;
    if (leftRunIndex !== rightRunIndex) {
      throw new Error(`paired row-delta evidence run index mismatch: ${leftRunIndex} vs ${rightRunIndex}`);
    }
    if (!left.counts || !right.counts) {
      throw new Error(`paired row-delta evidence missing counts for run ${leftRunIndex}`);
    }
    return {
      run_index: leftRunIndex,
      row_delta: diffCounts(left.counts, right.counts),
    };
  });
}

function maxAbsRowDeltas(rowDeltaRuns) {
  const maximums = {};
  for (const run of rowDeltaRuns) {
    for (const [key, value] of Object.entries(run.row_delta)) {
      maximums[key] = Math.max(maximums[key] ?? 0, Math.abs(value));
    }
  }
  return maximums;
}

module.exports = {
  diffCounts,
  maxAbsRowDeltas,
  medianRun,
  pairedRowDeltas,
  parseCodeIndexPhaseTimingsOrThrow,
};
