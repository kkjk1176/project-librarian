---
status: active
updated: 2026-06-10
scope: project-decisions
read_budget: short
decision_ref: wiki/meta/decision-policy.md
review_trigger: recent important project decisions change
---

# Recent Decisions

## TL;DR

- Keep only recent important project decisions that may matter at session start.
- Use [[decisions/log]] for full timestamp tracking.

## Decisions

- 2026-06-10: Cursor and Gemini CLI are added as supported agent targets through generated instruction files, startup hooks, and `install-skill --agents all`. Details: [[canonical/cli-behavior]].
- 2026-06-09: public product/package/CLI name changed to Project Librarian / `project-librarian`; the rename release source version is `0.2.0`. Details: [[decisions/npm-release-policy]].
- 2026-06-09: GitHub repository remote is renamed to `kkjk1176/project-librarian`, and npm package-name availability for `project-librarian` was confirmed by an `E404` registry lookup before publication. Details: [[decisions/npm-release-policy]].
- 2026-06-08: npm registry publication is the official distribution channel; `project-wiki-bootstrap@0.1.0` was published as the initial preview release under the original package name after strict pre-publish verification. Details: [[decisions/npm-release-policy]].
- 2026-06-08: installed agent skills should execute the local `dist/init-project-wiki.js` runner before falling back to network npm package execution. Details: [[decisions/npm-release-policy]].
- 2026-06-08: `project-wiki-bootstrap@0.1.2` is the previous npm `latest` patch release for local runner policy documentation before the rename. Details: [[decisions/npm-release-policy]].
- 2026-06-09: large-project roadmap improvements are adopted, and objective metrics are maintainer release evidence rather than a public metrics CLI workflow. Details: [[decisions/large-project-roadmap-and-metrics]].
- 2026-06-09: product scope is explicitly small-to-large: large projects and monorepos are first-class targets, not a later add-on to a small-project-only wiki. Details: [[canonical/project-brief]].
- 2026-06-09: `--issue-draft` remains a required fast path for useful issue reports when problems are found by other agents or users. Details: [[canonical/cli-behavior]].
- 2026-06-09: actual issue creation is implemented as a separate opt-in GitHub CLI integration after user approval; `--issue-draft` stays read-only. Details: [[canonical/cli-behavior]].
- 2026-06-09: migration review must rewrite legacy meaning instead of copying old markdown files into new project truth, and diagnostics now flag copied `wiki_legacy*` content. Details: [[canonical/cli-behavior]].
- 2026-06-09: package minimum Node version is now `>=22.13` for the whole CLI so bootstrap, diagnostics, skill runners, and code evidence share stable `node:sqlite` runtime support. Details: [[canonical/distribution-and-verification]].
