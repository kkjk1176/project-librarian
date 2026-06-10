---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/npm-release-policy.md
review_trigger: package entrypoints, build/test commands, committed dist policy, skill package contents, or supported runtime changes
---

# Distribution And Verification

## TL;DR

- The source npm binary is `project-librarian` and points to `dist/init-project-wiki.js`.
- Source is TypeScript under `src/`; committed `dist/` is the executable package output.
- `project-librarian@0.2.0` is the published rename-release version; the current source version is `0.2.1` for benchmark-evidence documentation correction.
- The GitHub repository remote is now `https://github.com/kkjk1176/project-librarian.git`; npm registry metadata now shows `project-librarian@0.2.0` with `latest` pointing to `0.2.0`.
- The package requires Node `>=22.13` for stable `node:sqlite` and one runtime policy across CLI and installed skill runners.
- Public install documentation targets `npx project-librarian install-skill ...` for the rename release; agent/LLM lifecycle documentation should use installed local `node .../dist/init-project-wiki.js` runners for bootstrap, diagnostics, migration, and code evidence commands.
- The broad verification command is `npm test`.
- Maintainer release evidence uses benchmark commands; public claims should cite benchmark values and deltas.
- Detailed package/release and verification/skill-installation contracts live in the child pages below.

## Read On Demand

- [[canonical/package-release-contract]]: package metadata, npm versioning, release gates, TypeScript settings, published verification, maintenance constraints.
- [[canonical/verification-and-skill-installation]]: build/test commands, smoke coverage, skill installation contents, local runner precedence.
- [[canonical/benchmark-and-release-evidence]]: benchmark metrics, release claims, baselines, and trend evidence.

## Current Contract

Code-proven behavior:

- `package.json` declares package name `project-librarian`, CommonJS package type, MIT license, and Node engine `>=22.13`; evidence: `package.json`.
- The CLI binary maps `project-librarian` to `dist/init-project-wiki.js`; evidence: `package.json`.
- `package.json` repository, bugs, and homepage URLs point at `kkjk1176/project-librarian`; evidence: `package.json`.
- `npm test` runs build, typecheck, unit tests, and smoke tests; evidence: `package.json`.
- `install-skill` copies reusable skill files into Codex, Claude, Cursor, and/or Gemini skill directories without bootstrapping a target wiki; evidence: `src/install-skill.ts`.
- When changing `src/`, rebuild `dist/` before release or commit review because the published binary path points at `dist/init-project-wiki.js`.

## README Command Policy

Accepted project documentation policy:

- Use `npx project-librarian install-skill ...` for initial skill installation because that is the npm distribution path.
- After installation, examples intended for Codex, Claude Code, Cursor, Gemini CLI, or any LLM agent should use the matching local installed runner, such as `node .codex/skills/project-librarian/dist/init-project-wiki.js`.
- Avoid documenting `npx project-librarian --lint`, `npx project-librarian --doctor`, `npx project-librarian --code-index`, or other lifecycle modes as the normal agent execution path.
- Direct shell users may still use the npm binary when registry access is available, but that path should not be the default in agent-facing lifecycle tables.
