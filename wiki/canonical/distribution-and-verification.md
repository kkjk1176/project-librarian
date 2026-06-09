---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/npm-release-policy.md
review_trigger: package entrypoints, build/test commands, committed dist policy, skill package contents, or supported runtime changes
---

# Distribution And Verification

## TL;DR

- The npm binary is `project-wiki-bootstrap` and points to `dist/init-project-wiki.js`.
- Source is TypeScript under `src/`; committed `dist/` is the executable package output.
- `project-wiki-bootstrap@0.1.2` is currently published on npm as the `latest` dist-tag.
- The package requires Node `>=22.13` for stable `node:sqlite` and one runtime policy across CLI and installed skill runners.
- The broad verification command is `npm test`.
- Maintainer release evidence uses benchmark commands; public claims should cite benchmark values and deltas.
- Detailed package/release and verification/skill-installation contracts live in the child pages below.

## Read On Demand

- [[canonical/package-release-contract]]: package metadata, npm versioning, release gates, TypeScript settings, published verification, maintenance constraints.
- [[canonical/verification-and-skill-installation]]: build/test commands, smoke coverage, skill installation contents, local runner precedence.
- [[canonical/benchmark-and-release-evidence]]: benchmark metrics, release claims, baselines, and trend evidence.

## Current Contract

Code-proven behavior:

- `package.json` declares package name `project-wiki-bootstrap`, CommonJS package type, MIT license, and Node engine `>=22.13`; evidence: `package.json`.
- The CLI binary maps `project-wiki-bootstrap` to `dist/init-project-wiki.js`; evidence: `package.json`.
- `npm test` runs build, typecheck, unit tests, and smoke tests; evidence: `package.json`.
- `install-skill` copies reusable skill files into Codex and/or Claude skill directories without bootstrapping a target wiki; evidence: `src/install-skill.ts`.
- When changing `src/`, rebuild `dist/` before release or commit review because the published binary path points at `dist/init-project-wiki.js`.
