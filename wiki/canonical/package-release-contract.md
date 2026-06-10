---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/npm-release-policy.md
review_trigger: package metadata, runtime policy, npm version, release gate, TypeScript settings, published verification, or dist policy changes
---

# Package Release Contract

## TL;DR

- npm registry publication is the official public distribution path.
- The package is preview SemVer below `1.0.0`; public CLI and generated-file behavior remains compatibility-sensitive.
- `project-librarian@0.2.0` is published as the rename release; the old public package name was `project-wiki-bootstrap`.
- Current source version is `project-librarian@0.2.1` for a benchmark-evidence documentation correction after `0.2.0` publication.
- Node `>=22.13` is the package-wide runtime minimum.
- Release gates include `npm test`, benchmark evidence when making claims, package inspection, executable `dist`, README command review, and unique npm versioning.

## Package Contract

Code-proven behavior:

- `package.json` declares package name `project-librarian`, CommonJS package type, MIT license, and Node engine `>=22.13`.
- Node `>=22.13` is the minimum for the whole package because code evidence indexing uses `node:sqlite` without experimental flags, and keeping one runtime avoids feature-specific Node support splits; evidence: `package.json`, `README.md`, `src/code-index-db.ts`.
- The CLI binary maps `project-librarian` to `dist/init-project-wiki.js`; evidence: `package.json`.
- The published package has no runtime dependencies; TypeScript and Node types are development-only dependencies; evidence: `package.json`.
- npm package metadata includes repository, bugs, homepage, and keyword fields; evidence: `package.json`.
- npm package contents are restricted through the `files` allowlist to `agents/`, `dist/`, localized READMEs, `LICENSE`, and `SKILL.md`; `package.json` is included by npm automatically.

## Npm Version And Release Policy

Accepted project policy:

- The package uses the npm registry as the official public distribution channel for the `npx project-librarian ...` command.
- The first public package name was `project-wiki-bootstrap`; the project is renamed to `project-librarian` for the `0.2.0` release because the package identity, CLI binary, and installed skill layout changed.
- On 2026-06-09, `npm view project-librarian version` returned npm `E404`, confirming no package by that name existed in the registry at check time; later registry lookup showed `project-librarian@0.2.0` published with `latest` pointing to `0.2.0`.
- While below `1.0.0`, treat public CLI commands, flags, generated file contracts, hook behavior, and installed skill layout as compatibility-sensitive.
- Use patch releases such as `0.1.1` for compatible fixes, documentation corrections that affect installation/use, packaging fixes, and regenerated `dist/` output that does not change public behavior.
- Use minor releases such as `0.2.0` for new CLI modes, new generated files, changed defaults, changed install contents, changed hook behavior, changed minimum Node version, or any intentional compatibility break before `1.0.0`.
- Move to `1.0.0` only when the CLI surface, generated wiki layout, install-skill behavior, hook contracts, and diagnostics are considered stable enough for normal SemVer expectations.
- After `1.0.0`, follow SemVer normally: patch for compatible fixes, minor for backward-compatible features, major for breaking public behavior.
- Do not reuse a published version. Every npm publish must be from a unique package version.

Release gate:

1. Rebuild and verify with `npm test`.
2. Run `npm run benchmark` and compare against the previous baseline before making token-savings, read-speed, or improvement claims.
3. Run `npm run benchmark:baseline` for releases where benchmark evidence should be archived.
4. Inspect package contents with `npm pack --dry-run`.
5. Confirm `dist/init-project-wiki.js` is executable and matches current `src/`.
6. Confirm README quick-start commands match the intended npm distribution status.
7. Confirm the pack output excludes runtime state, logs, tests, source-only files, and other non-release artifacts.
8. Publish with `npm publish` from the repository root after npm login/auth is ready.
9. If the npm account requires write-time 2FA, publish with a fresh OTP or a granular access token that is allowed to bypass 2FA for package publishing.

## TypeScript Settings

Code-proven behavior:

- `tsconfig.json` targets ES2022, uses `Node16` module/moduleResolution, emits from `src` to `dist`, and enables strict options including `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

## Published Verification

Verified on 2026-06-08 under the previous package name: npm showed `project-wiki-bootstrap@0.1.2` as the current package version, published `npx --yes project-wiki-bootstrap --help` executed successfully, and the project-scope `install-skill --agents both --dry-run` path executed after the install/bootstrap-order fix.

`project-librarian@0.2.0` is published on npm and `latest` points to `0.2.0` in registry metadata. The local 2026-06-10 publish retry for `0.2.0` failed with npm `E404` because the version already existed and the local npm auth check returned `E401`; do not retry the same version. Use a unique patch version such as `0.2.1` for compatible documentation/package corrections, then verify `npx --yes project-librarian --help` after publication.

## Maintenance Constraint

Inference from README and package wiring:

- When changing `src/`, rebuild `dist/` before release or commit review because the published binary path points at `dist/init-project-wiki.js` and README development notes say committed `dist/` is used by the npm binary.
