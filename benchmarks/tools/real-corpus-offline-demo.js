#!/usr/bin/env node
"use strict";

// Scripted OFFLINE demo of the real-repository benchmark track. Proves the full
// dev pipeline end-to-end WITHOUT any network, real codex, or measured run:
//
//   1. Build a committed git STUB repo in tmp (a monorepo with CODEOWNERS
//      precedence + cross-workspace imports), standing in for a fetched OSS repo.
//   2. Stage it under a corpus dir and author a minimal answer key.
//   3. Build the real-corpus MANIFEST: materializes the with-arm copy (bootstrap +
//      code-index + installed runner + MCP handshake) and the pristine control copy,
//      emits corpus "real" scenarios with mcp:true on the with arm.
//   4. Show the config.toml MCP injection content the runner would write into the
//      isolated CODEX_HOME (the exact `codex mcp add` table), and confirm the
//      control-arm home has no such entry.
//   5. Demonstrate the pinned-sha + git-clean fingerprint: a clean check passes,
//      then a tracked-file mutation makes the post-run validation HARD-FAIL.
//   6. Demonstrate the fetch REFUSAL (exit-2) without --allow-corpus-fetch.
//
// Exit code 0 means every offline stage behaved as designed. Any unexpected error
// exits non-zero (no fallback).

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const cliPath = path.join(root, "dist", "init-project-wiki.js");

const {
  assertSelectionGate,
  checkRealRepoPreRun,
  copyPristineClone,
  fetchCorpus,
  loadCorpusManifest,
  snapshotRealRepoUntracked,
  validateRealRepoAfterRun,
} = require("../lib/real-corpus");
const { buildRealCorpusManifest } = require("../lib/real-corpus-manifest");
const { injectMcpServerConfig } = require("../lib/hermetic");

function log(step, message) {
  process.stdout.write(`[${step}] ${message}\n`);
}

function git(repoDir, args) {
  return childProcess.execFileSync("git", args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildStubRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rc-demo-stub-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "stub@example.com"]);
  git(repo, ["config", "user.name", "Stub"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFile(path.join(repo, "CODEOWNERS"), [
    "* @stub-org-default",
    "*.go @stub-go-team",
    "*.ts @stub-ts-team",
    "/packages/workspace-a/ @stub-team-a",
    "/packages/workspace-a/src/ @stub-src-team",
    "/packages/workspace-a/src/service/ @stub-service-team",
    "",
  ].join("\n"));
  writeFile(path.join(repo, "package.json"), `${JSON.stringify({ name: "stub-monorepo", private: true, workspaces: ["packages/*"] }, null, 2)}\n`);
  writeFile(path.join(repo, "README.md"), "# Stub monorepo\n");
  writeFile(path.join(repo, "packages", "workspace-a", "package.json"), `${JSON.stringify({ name: "@stub/workspace-a", private: true }, null, 2)}\n`);
  writeFile(path.join(repo, "packages", "workspace-a", "src", "core.ts"), "export function core() { return \"core\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "mid.ts"), "import { core } from \"./core\";\nexport function mid() { return core() + \"-mid\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "leaf.ts"), "import { mid } from \"./mid\";\nexport function leaf() { return mid() + \"-leaf\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "service", "handler.go"), "package service\n\nfunc Handle() string { return \"handler\" }\n");
  writeFile(path.join(repo, "packages", "workspace-b", "package.json"), `${JSON.stringify({ name: "@stub/workspace-b", private: true, dependencies: { "@stub/workspace-a": "workspace:*" } }, null, 2)}\n`);
  writeFile(path.join(repo, "packages", "workspace-b", "src", "bridge.ts"), "import { core } from \"@stub/workspace-a/src/core\";\nexport function bridge() { return core(); }\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "stub monorepo"]);
  return { repo, sha: git(repo, ["rev-parse", "HEAD"]).trim() };
}

function main() {
  if (!fs.existsSync(cliPath)) {
    process.stderr.write(`built CLI missing at ${cliPath}; run npm run build first\n`);
    process.exit(1);
  }

  // 0. Candidate manifest selection gate (the shipped corpus).
  const candidateManifest = loadCorpusManifest(path.join(root, "benchmarks", "real-corpus.json"));
  const gate = assertSelectionGate(candidateManifest.candidates);
  log("gate", `selection gate PASSED: ${gate.distinct_languages.length} languages, ${gate.large_repo_count} large repo(s), ${gate.codeowners_count} CODEOWNERS, ${gate.monorepo_count} monorepos`);

  // 6 (early). Fetch refusal without the flag (exit-2 semantics), shown before any
  // materialization so the offline guarantee is explicit.
  try {
    fetchCorpus({ allowFetch: false, corpusDir: "/tmp/never", candidates: candidateManifest.candidates });
    throw new Error("fetchCorpus should have refused without --allow-corpus-fetch");
  } catch (error) {
    if (error.exitCode !== 2 || !error.refused) throw error;
    log("fetch", `fetch correctly REFUSED without --allow-corpus-fetch (exit-2); it listed ${candidateManifest.candidates.length} repos it WOULD fetch`);
  }

  const { repo, sha } = buildStubRepo();
  const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-demo-corpus-"));
  const keysDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-demo-keys-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rc-demo-work-"));
  const isolatedWithHome = fs.mkdtempSync(path.join(os.tmpdir(), "rc-demo-withhome-"));
  const cleanup = [repo, corpusDir, keysDir, work, isolatedWithHome];
  try {
    log("stub", `built committed stub monorepo at HEAD ${sha.slice(0, 12)}`);

    // 2. Stage the pristine clone + author a minimal answer key.
    copyPristineClone(repo, path.join(corpusDir, "stub"));
    const key = {
      repo: "stub",
      sha,
      code_scopes: ["packages", "package.json", "CODEOWNERS"],
      questions: [
        {
          question_id: "impact-1",
          task_family: "impact_trace",
          prompt: "Transitive importers of packages/workspace-a/src/core.ts? Answer from code evidence.",
          expectation: {
            required_terms: ["packages/workspace-a/src/mid.ts", "packages/workspace-a/src/leaf.ts"],
            any_terms: [["import", "transitive"]],
            forbidden_terms: ["I cannot access"],
            evidence_by_condition: {
              with_project_librarian: ["packages/", "@stub/workspace-"],
              without_project_librarian: ["packages/", "@stub/workspace-"],
            },
            answer_key_terms: ["packages/workspace-a/src/mid.ts"],
          },
        },
      ],
    };
    writeFile(path.join(keysDir, "stub.json"), `${JSON.stringify(key, null, 2)}\n`);
    log("key", "authored a minimal answer key (1 impact_trace question) and validated its shape on load");

    // 3. Build the real-corpus manifest (materializes with-arm incl. MCP handshake).
    const manifest = buildRealCorpusManifest({ corpusDir, keysDir, workDir: work, cliPath, repos: ["stub"] });
    if (manifest.corpus !== "real" || manifest.schema_version !== 5) {
      throw new Error(`unexpected manifest: corpus=${manifest.corpus} schema=${manifest.schema_version}`);
    }
    const withScenario = manifest.scenarios.find((s) => s.condition === "with_project_librarian");
    const controlScenario = manifest.scenarios.find((s) => s.condition === "without_project_librarian");
    const handshake = manifest.repos[0].mcp_handshake;
    log("manifest", `built corpus 'real' manifest (schema 5): ${manifest.scenarios.length} scenarios, repo_sha ${withScenario.repo_sha.slice(0, 12)}`);
    log("mcp", `with-arm MCP handshake OK: ${handshake.tool_count} tools [${handshake.tool_names.join(", ")}]`);
    if (withScenario.mcp !== true || controlScenario.mcp !== false) {
      throw new Error("MCP must be marked on the with arm only");
    }
    log("mcp", `with-arm scenario mcp=true (runner ${path.basename(withScenario.mcp_runner_path)}), control-arm scenario mcp=false`);

    // 4. Show the exact config.toml MCP table the runner injects into the isolated
    //    CODEX_HOME for the with arm, and confirm the control home has none.
    const injection = injectMcpServerConfig({ codexHome: isolatedWithHome, runnerPath: withScenario.mcp_runner_path });
    const injectedToml = fs.readFileSync(injection.config_path, "utf8");
    log("config", `injected config.toml into the with-arm isolated CODEX_HOME (created=${injection.created}):`);
    for (const line of injectedToml.trimEnd().split("\n")) log("config", `  ${line}`);
    log("config", "control-arm isolated home receives NO [mcp_servers] entry (the with/without contrast)");

    // 5. Fingerprint demo: pinned-sha + git-clean. The with-arm copy carries
    //    untracked bootstrap output; capture that baseline, show a clean post-run
    //    validation, then mutate a TRACKED file and show the HARD-FAIL.
    const withDir = withScenario.cwd;
    checkRealRepoPreRun({ cwd: withDir, expectedSha: withScenario.repo_sha });
    const baseline = snapshotRealRepoUntracked(withDir);
    const cleanResult = validateRealRepoAfterRun({ cwd: withDir, expectedSha: withScenario.repo_sha, preRunUntracked: baseline });
    log("fingerprint", `clean post-run validation PASSED (pinned_sha_matched=${cleanResult.pinned_sha_matched}, git_clean=${cleanResult.git_clean})`);

    // Mutate a tracked file to simulate a run that dirtied the working copy.
    writeFile(path.join(withDir, "README.md"), "# mutated by a misbehaving run\n");
    let drifted = false;
    try {
      validateRealRepoAfterRun({ cwd: withDir, expectedSha: withScenario.repo_sha, preRunUntracked: baseline });
    } catch (error) {
      drifted = true;
      log("fingerprint", `drift correctly HARD-FAILED: ${error.message.split("\n")[0]}`);
    }
    if (!drifted) throw new Error("expected the tracked-file mutation to fail post-run validation");

    log("done", "ALL OFFLINE STAGES PASSED");
  } finally {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
