"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS = 1;
const DEFAULT_AUTO_PRUNE_RAW_RUN_AGE_DAYS = 1;

function toSlash(value) {
  return value.split(path.sep).join("/");
}

function assertUnderRawRoot(rawRoot, target) {
  const relative = path.relative(rawRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`codex home retention path must be inside raw root: ${target}`);
  }
  return relative;
}

function codexHomeDirectoryName(name) {
  return /^codex-home(?:-|$)/.test(name);
}

function assertPruneOptions({ rawRoot, olderThanDays }) {
  const absoluteRawRoot = path.resolve(rawRoot);
  if (!fs.existsSync(absoluteRawRoot) || !fs.statSync(absoluteRawRoot).isDirectory()) {
    throw new Error(`raw root does not exist: ${absoluteRawRoot}`);
  }
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
    throw new Error(`olderThanDays must be a positive integer: ${olderThanDays}`);
  }
  return absoluteRawRoot;
}

function parseRawRunDirectoryName(name) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function candidateContainers(rawRoot) {
  const containers = [rawRoot];
  for (const entry of fs.readdirSync(rawRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    containers.push(path.join(rawRoot, entry.name));
  }
  return containers;
}

function discoverPrunableCodexHomes({ rawRoot, olderThanDays, now = new Date() }) {
  const absoluteRawRoot = assertPruneOptions({ rawRoot, olderThanDays });
  const cutoffMs = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cutoffMs)) {
    throw new Error(`invalid prune cutoff for olderThanDays: ${olderThanDays}`);
  }
  const candidates = [];
  const seen = new Set();
  for (const container of candidateContainers(absoluteRawRoot)) {
    for (const entry of fs.readdirSync(container, { withFileTypes: true })) {
      if (!entry.isDirectory() || !codexHomeDirectoryName(entry.name)) continue;
      const homePath = path.join(container, entry.name);
      const relative = toSlash(assertUnderRawRoot(absoluteRawRoot, homePath));
      if (seen.has(relative)) continue;
      seen.add(relative);
      const stat = fs.statSync(homePath);
      if (stat.mtimeMs > cutoffMs) continue;
      const summary = summarizeDirectory(homePath);
      candidates.push({
        absolute_path: homePath,
        relative_path: relative,
        modified_at: stat.mtime.toISOString(),
        file_count: summary.file_count,
        directory_count: summary.directory_count,
        byte_count: summary.byte_count,
        largest_files: summary.largest_files,
      });
    }
  }
  candidates.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return {
    raw_root: absoluteRawRoot,
    older_than_days: olderThanDays,
    cutoff: new Date(cutoffMs).toISOString(),
    candidates,
  };
}

function pruneOldCodexHomes({ rawRoot, olderThanDays, dryRun = true, now = new Date() }) {
  const discovery = discoverPrunableCodexHomes({ rawRoot, olderThanDays, now });
  const action = dryRun ? "would-prune" : "pruned";
  if (!dryRun) {
    for (const candidate of discovery.candidates) {
      fs.rmSync(candidate.absolute_path, { recursive: true });
    }
  }
  const candidates = discovery.candidates.map(({ absolute_path, ...candidate }) => ({
    ...candidate,
    action,
  }));
  const candidateBytes = candidates.reduce((sum, candidate) => sum + candidate.byte_count, 0);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    raw_root: discovery.raw_root,
    older_than_days: discovery.older_than_days,
    cutoff: discovery.cutoff,
    dry_run: Boolean(dryRun),
    candidate_count: candidates.length,
    candidate_bytes: candidateBytes,
    pruned_count: dryRun ? 0 : candidates.length,
    pruned_bytes: dryRun ? 0 : candidateBytes,
    candidates,
  };
}

function discoverPrunableRawRuns({ rawRoot, olderThanDays, now = new Date() }) {
  const absoluteRawRoot = assertPruneOptions({ rawRoot, olderThanDays });
  const cutoffMs = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cutoffMs)) {
    throw new Error(`invalid prune cutoff for olderThanDays: ${olderThanDays}`);
  }
  const candidates = [];
  for (const entry of fs.readdirSync(absoluteRawRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const startedAt = parseRawRunDirectoryName(entry.name);
    if (!startedAt || startedAt.getTime() > cutoffMs) continue;
    const runPath = path.join(absoluteRawRoot, entry.name);
    const summary = summarizeDirectory(runPath);
    candidates.push({
      absolute_path: runPath,
      relative_path: entry.name,
      started_at: startedAt.toISOString(),
      file_count: summary.file_count,
      directory_count: summary.directory_count,
      byte_count: summary.byte_count,
      largest_files: summary.largest_files,
    });
  }
  candidates.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return {
    raw_root: absoluteRawRoot,
    older_than_days: olderThanDays,
    cutoff: new Date(cutoffMs).toISOString(),
    candidates,
  };
}

function pruneOldRawRuns({ rawRoot, olderThanDays, dryRun = true, now = new Date() }) {
  const discovery = discoverPrunableRawRuns({ rawRoot, olderThanDays, now });
  const action = dryRun ? "would-prune" : "pruned";
  if (!dryRun) {
    for (const candidate of discovery.candidates) {
      fs.rmSync(candidate.absolute_path, { recursive: true });
    }
  }
  const candidates = discovery.candidates.map(({ absolute_path, ...candidate }) => ({
    ...candidate,
    action,
  }));
  const candidateBytes = candidates.reduce((sum, candidate) => sum + candidate.byte_count, 0);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    raw_root: discovery.raw_root,
    older_than_days: discovery.older_than_days,
    cutoff: discovery.cutoff,
    dry_run: Boolean(dryRun),
    candidate_count: candidates.length,
    candidate_bytes: candidateBytes,
    pruned_count: dryRun ? 0 : candidates.length,
    pruned_bytes: dryRun ? 0 : candidateBytes,
    candidates,
  };
}

function summarizeDirectory(root) {
  const stats = {
    file_count: 0,
    directory_count: 0,
    byte_count: 0,
    largest_files: [],
  };

  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = toSlash(path.relative(root, absolute));
      if (entry.isDirectory()) {
        stats.directory_count += 1;
        visit(absolute);
      } else if (entry.isFile()) {
        const fileStats = fs.statSync(absolute);
        stats.file_count += 1;
        stats.byte_count += fileStats.size;
        stats.largest_files.push({ path: relative, bytes: fileStats.size });
      }
    }
  }

  visit(root);
  stats.largest_files.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  stats.largest_files = stats.largest_files.slice(0, 10);
  return stats;
}

function uniqueExistingHomePaths(rawRoot, homePaths) {
  const seen = new Set();
  const homes = [];
  for (const homePath of homePaths) {
    const absolute = path.resolve(homePath);
    assertUnderRawRoot(rawRoot, absolute);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    if (!fs.existsSync(absolute)) {
      throw new Error(`codex home retention path does not exist: ${absolute}`);
    }
    if (!fs.statSync(absolute).isDirectory()) {
      throw new Error(`codex home retention path is not a directory: ${absolute}`);
    }
    homes.push(absolute);
  }
  return homes;
}

function applyCodexHomeRetention({ rawRoot, homePaths, keepCodexHomes }) {
  const absoluteRawRoot = path.resolve(rawRoot);
  if (!fs.existsSync(absoluteRawRoot) || !fs.statSync(absoluteRawRoot).isDirectory()) {
    throw new Error(`raw root does not exist: ${absoluteRawRoot}`);
  }

  const homes = uniqueExistingHomePaths(absoluteRawRoot, homePaths);
  const entries = homes.map((homePath) => {
    const summary = summarizeDirectory(homePath);
    return {
      relative_path: toSlash(path.relative(absoluteRawRoot, homePath)),
      retained: Boolean(keepCodexHomes),
      action: keepCodexHomes ? "kept" : "pruned",
      file_count: summary.file_count,
      directory_count: summary.directory_count,
      byte_count: summary.byte_count,
      largest_files: summary.largest_files,
    };
  });

  if (!keepCodexHomes) {
    for (const homePath of homes) {
      fs.rmSync(homePath, { recursive: true });
    }
  }

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    keep_codex_homes: Boolean(keepCodexHomes),
    raw_root: absoluteRawRoot,
    home_count: entries.length,
    retained_home_count: keepCodexHomes ? entries.length : 0,
    pruned_home_count: keepCodexHomes ? 0 : entries.length,
    retained_bytes: keepCodexHomes ? entries.reduce((sum, entry) => sum + entry.byte_count, 0) : 0,
    pruned_bytes: keepCodexHomes ? 0 : entries.reduce((sum, entry) => sum + entry.byte_count, 0),
    homes: entries,
  };

  const manifestPath = path.join(absoluteRawRoot, "codex-home-retention.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, manifest_path: manifestPath };
}

module.exports = {
  DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS,
  DEFAULT_AUTO_PRUNE_RAW_RUN_AGE_DAYS,
  applyCodexHomeRetention,
  discoverPrunableRawRuns,
  discoverPrunableCodexHomes,
  pruneOldCodexHomes,
  pruneOldRawRuns,
  summarizeDirectory,
};
