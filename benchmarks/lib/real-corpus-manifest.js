"use strict";

// Real-repository manifest assembly (DEV-ONLY, offline). Turns a corpus directory
// of PRISTINE repo clones plus per-repo answer-key files into a manifest with the
// SAME shape the synthetic buildManifest produces, so the runner and report code
// consume it uniformly — except every scenario carries corpus "real" with the
// repo/repo_sha/question_id it was built from, and the with-arm scenarios are
// marked `mcp: true` so the runner injects the project-librarian MCP server into
// the isolated CODEX_HOME for the measured run.
//
// No network here: the pristine clones must already exist under corpusDir (fetched
// behind --allow-corpus-fetch, or staged in tests via a tmp git stub repo). This
// module materializes a fresh per-condition COPY of each pristine clone (never
// mutating the pristine), bootstraps + indexes + installs the runner + verifies
// the MCP handshake on the with-arm copy, and leaves the control copy untouched.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { conditions } = require("./llm-fixtures");
const {
  checkRealRepoPreRun,
  gitRevParseHead,
  loadAnswerKey,
  materializeControlArm,
  materializeWithArm,
} = require("./real-corpus");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Frame a real-repo question prompt with the standard benchmark-scenario preamble,
// mirroring framePrompt in llm-fixtures.js so the measured prompt shape matches the
// synthetic track. The repo name and question id make the scenario self-describing.
function frameRealPrompt(promptBody, repo, condition, taskFamily) {
  return [
    `Benchmark scenario: real-corpus / ${repo} / ${condition} / ${taskFamily}.`,
    "Work as a coding agent in this repository.",
    "Use only local repository evidence.",
    "Do not modify files unless explicitly asked.",
    promptBody,
  ].join("\n");
}

function codexCommand(prompt, requestedModel = "") {
  const command = ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (requestedModel) command.push("--model", requestedModel);
  command.push(prompt);
  return command;
}

// Resolve the answer-key file for a repo. Convention: benchmarks/real-keys/<repo>.json.
function answerKeyPathForRepo(keysDir, repo) {
  return path.join(keysDir, `${repo}.json`);
}

// Build the real-corpus manifest. Inputs:
//   corpusDir:     directory holding pristine repo clones (one subdir per repo).
//   keysDir:       directory holding per-repo answer-key files (<repo>.json).
//   workDir:       scratch dir for the fresh per-condition copies (never the repo root).
//   cliPath:       the repo's built CLI used to bootstrap/index with-arm copies.
//   repos:         repo names to include (each must have a clone + key).
//   requestedModel: optional --model passthrough.
// For each repo and each question in its key, emits a with/without scenario pair.
// The with-arm copy is materialized once per repo (bootstrap+index+runner+MCP
// handshake) and shared by every question's with scenario for that repo; likewise
// one control copy per repo. Each scenario records the repo_sha (the materialized
// copy's HEAD) and a pinned-sha + git-clean fixture_fingerprint instead of a
// full-file content hash.
function buildRealCorpusManifest({ corpusDir, keysDir, workDir, cliPath, repos, requestedModel = "" }) {
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new Error("buildRealCorpusManifest requires a non-empty repos list");
  }
  if (!corpusDir || !fs.existsSync(corpusDir)) {
    throw new Error(`buildRealCorpusManifest: corpus directory missing: ${corpusDir}`);
  }
  fs.mkdirSync(workDir, { recursive: true });

  const scenarios = [];
  const repoProvenance = [];
  for (const repo of repos) {
    const pristineDir = path.join(corpusDir, repo);
    if (!fs.existsSync(pristineDir)) {
      throw new Error(`buildRealCorpusManifest: pristine clone for repo "${repo}" missing at ${pristineDir}`);
    }
    const key = loadAnswerKey(answerKeyPathForRepo(keysDir, repo));
    if (key.repo !== repo) {
      throw new Error(`buildRealCorpusManifest: answer key repo "${key.repo}" does not match requested repo "${repo}"`);
    }
    // Materialize the two condition copies ONCE per repo. The with-arm copy gets
    // bootstrap + code-index + runner install + MCP handshake verification; the
    // control copy is pristine. Each condition+run-set gets its own COPY so the
    // pristine clone is never mutated.
    const withArm = materializeWithArm({
      pristineDir,
      destDir: path.join(workDir, repo, "with_project_librarian"),
      cliPath,
      codeScopes: key.code_scopes,
    });
    const controlArm = materializeControlArm({
      pristineDir,
      destDir: path.join(workDir, repo, "without_project_librarian"),
    });
    const armByCondition = {
      with_project_librarian: withArm,
      without_project_librarian: controlArm,
    };
    const repoShaByCondition = {
      with_project_librarian: gitRevParseHead(withArm.dir),
      without_project_librarian: gitRevParseHead(controlArm.dir),
    };
    repoProvenance.push({
      repo,
      sha: key.sha,
      with_dir: withArm.dir,
      control_dir: controlArm.dir,
      mcp_handshake: withArm.mcp_handshake,
      code_scopes: withArm.code_scopes,
    });

    for (const question of key.questions) {
      for (const condition of conditions) {
        const arm = armByCondition[condition];
        const cwd = arm.dir;
        const repoSha = repoShaByCondition[condition];
        const prompt = frameRealPrompt(question.prompt, repo, condition, question.task_family);
        // Real-corpus fingerprint: pinned sha + git-clean (a content hash of a
        // multi-thousand-file repo is impractical and unnecessary). The verified
        // pre-run check is the live integrity gate; this record carries the sha
        // and a fixed algorithm tag so reports/validators can tell it apart from
        // the synthetic content-hash fingerprint.
        const fixtureFingerprint = {
          algorithm: "pinned-sha-git-clean",
          repo_sha: repoSha,
          value: sha256(`${repo}\0${repoSha}\0${condition}`),
        };
        const isWith = condition === "with_project_librarian";
        scenarios.push({
          scale: "real",
          condition,
          benchmark_track: "code_graph",
          corpus: "real",
          repo,
          repo_sha: repoSha,
          question_id: question.question_id,
          control_profile: "organic",
          task_family: question.task_family,
          prompt_id: `${repo}-${question.question_id}-${condition}`,
          cwd,
          expectation: question.expectation,
          requested_model: requestedModel || null,
          fixture_fingerprint: fixtureFingerprint,
          prompt,
          command: codexCommand(prompt, requestedModel),
          // with-arm real scenarios get the MCP server injected into the isolated
          // CODEX_HOME for the measured run; the runner reads mcp + mcp_runner_path.
          // Control-arm scenarios are NOT marked (no MCP entry in their home).
          mcp: isWith,
          mcp_runner_path: isWith ? arm.installed_cli_absolute : null,
          // Pre-run integrity uses the pinned-sha + git-clean check, not the
          // synthetic content-hash; the runner branches on fixture_fingerprint.algorithm.
          real_repo_check: true,
        });
      }
    }
  }

  const presentTracks = ["code_graph"];
  return {
    // schema_version 5 mirrors the synthetic manifest: corpus dimension on every
    // scenario. This manifest is the "real" corpus (corpus "real" scenarios with
    // repo/repo_sha/question_id populated and with-arm scenarios marked mcp:true).
    schema_version: 5,
    benchmark_kind: "codex-actual-llm-manifest",
    generated_at: new Date().toISOString(),
    fixture_root: workDir,
    corpus_dir: corpusDir,
    scales: ["real"],
    conditions,
    benchmark_tracks: presentTracks,
    corpus: "real",
    control_profile: "organic",
    task_families: [...new Set(scenarios.map((scenario) => scenario.task_family))],
    task_tracks: Object.fromEntries([...new Set(scenarios.map((scenario) => scenario.task_family))].map((family) => [family, "code_graph"])),
    requested_model: requestedModel || null,
    repos: repoProvenance,
    manifest_fingerprint: sha256(JSON.stringify(scenarios.map((scenario) => ({
      scale: scenario.scale,
      condition: scenario.condition,
      benchmark_track: scenario.benchmark_track,
      corpus: scenario.corpus,
      repo: scenario.repo,
      repo_sha: scenario.repo_sha,
      question_id: scenario.question_id,
      control_profile: scenario.control_profile,
      task_family: scenario.task_family,
      prompt: scenario.prompt,
      sessions: scenario.sessions || null,
      expectation: scenario.expectation,
      fixture_fingerprint: scenario.fixture_fingerprint,
      requested_model: scenario.requested_model,
    })))),
    scenarios,
  };
}

module.exports = {
  answerKeyPathForRepo,
  buildRealCorpusManifest,
  checkRealRepoPreRun,
};
