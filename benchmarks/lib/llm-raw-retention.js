"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
  applyCodexHomeRetention,
  summarizeDirectory,
};
