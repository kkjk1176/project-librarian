---
status: active
updated: 2026-06-08
scope: project-decisions
read_budget: medium
decision_ref: wiki/meta/decision-policy.md
review_trigger: npm release process, package versioning, public CLI compatibility, or distribution channel changes
---

# Npm Release Policy Decision Pack

## TL;DR

- Publish `project-wiki-bootstrap` to npm so `npx project-wiki-bootstrap ...` is the official install and direct shell execution path.
- After skill installation, use the installed local runner as the preferred agent execution path.
- Treat `project-wiki-bootstrap@0.1.2` as the current published `latest` patch release.
- Use strict release gates: `npm test`, `npm pack --dry-run`, `dist/` sync, README command check, then `npm publish`.
- Before `1.0.0`, use patch releases for compatible fixes and minor releases for new public behavior or compatibility breaks.

## Decision Pack

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| 2026-06-08 | Use npm registry publication as the official public distribution channel. | The documented `npx project-wiki-bootstrap ...` workflow depends on the package existing in npm registry. | GitHub/folder/tarball fallback as the primary path. | npm registry ownership, package naming, or publication access changes. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Prefer installed local runners for Codex and Claude Code skill execution after `install-skill`. | Restricted agent environments can block network registry access and unpinned public package execution, while the installed skill already contains the executable `dist/init-project-wiki.js`. | Keep asking agents to run unpinned `npx project-wiki-bootstrap ...` for lifecycle operations after skill installation. | Skill packaging stops including executable `dist/`, or agent sandbox policies around npm package execution change. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Release the local runner policy documentation as patch `0.1.2`. | The package contents and public generated output do not change, but installed skill behavior guidance and localized README usage guidance do. | Reuse `0.1.1`, which npm will reject and which would hide the published documentation correction. | A code or generated-file behavior change is added after publish. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Publish the initial package as preview `0.1.0` if package metadata and contents remain current. | The package already declares `0.1.0`, and preview status matches an early CLI whose public contracts may still evolve. | Jump directly to `1.0.0` before the generated wiki layout, hooks, diagnostics, and install-skill contracts are proven stable. | Stable CLI and generated-file contracts are ready for normal SemVer expectations. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Use patch versions for compatible fixes below `1.0.0`. | Users need install and packaging fixes without treating every small correction as a new compatibility window. | Keep reusing `0.1.0`, which npm rejects after publication. | A published fix changes public behavior or generated output in a compatibility-sensitive way. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Use minor versions for new public behavior or compatibility breaks while below `1.0.0`. | Pre-1.0 packages can evolve, but users still need visible version boundaries for CLI flags, generated file contracts, hooks, install contents, and Node requirements. | Hide compatibility breaks in patch versions. | The project reaches `1.0.0`; then normal SemVer major/minor/patch rules apply. | [[canonical/distribution-and-verification]] |
| 2026-06-08 | Require `npm test`, `npm pack --dry-run`, `dist/` sync, README command review, and `npm publish` as the release gate. | The package binary points at committed `dist/`, and the user-facing install path is only valid once npm publication succeeds. | Publish from TypeScript source without checking package contents. | Build system, package output, or release automation changes. | [[canonical/distribution-and-verification]] |

## Notes

- `npm publish` is external and irreversible for a given version, so it should be run only after the local release gate passes.
- The package name is currently unscoped, so normal public package publication should not require `--access public`.
