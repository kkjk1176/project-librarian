---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/log.md
review_trigger: issue draft, issue create, GitHub CLI, approval, or problem-reporting contract changes
---

# CLI Issue Reporting

## TL;DR

- `--issue-draft` is read-only, network-free, and meant for useful problem reports.
- `--issue-create` is a separate opt-in GitHub CLI path after explicit user approval.
- Drafting a report does not replace local fixes or wiki corrections.

## Code-Proven Behavior

- The CLI provides `--issue-draft` as a read-only problem report generator; evidence: `src/args.ts`, `src/init-project-wiki.ts`, `src/modes.ts`.
- The CLI provides `--issue-create` as a separate opt-in GitHub issue creation path backed by `gh auth status` and `gh issue create --body-file`; evidence: `src/args.ts`, `src/init-project-wiki.ts`, `src/modes.ts`.
- `--issue-draft` prints a Markdown GitHub issue body for skill failures, side effects, confusing behavior, or generated-file surprises, including reproduction prompts, expected vs actual behavior, affected generated files, environment context, and diagnostics to attach; evidence: `src/modes.ts`.
- `--issue-create` requires a git repository, GitHub remote, authenticated `gh`, and network access, and reports real `gh` errors instead of falling back to a draft; evidence: `src/modes.ts`.
- The skill execution contract requires agents to resolve a local runner first and run `$PROJECT_WIKI_BOOTSTRAP --issue-draft --issue-title "..."` before the final response when they discover a project-wiki-bootstrap bug, regression, workflow mismatch, confusing generated behavior, or unintended side effect while using the skill, unless the user explicitly asked not to generate a draft; evidence: `SKILL.md`.
- The skill execution contract allows actual issue creation only after explicit user approval and only through GitHub CLI when authenticated; evidence: `SKILL.md`.
- Issue draft generation does not replace local fixes. It preserves a reportable problem record while implementation and wiki corrections continue; evidence: `SKILL.md`, `README.md`.

## Product Direction

- `--issue-draft` is intentionally retained so problems discovered by someone other than the maintainer can be turned quickly into a useful issue with reproduction context, environment, affected generated files, side effects, and diagnostics.
- Git itself is not an issue tracker, so direct issue creation must target a hosting provider integration instead of plain `git`.
- The draft contract should remain read-only and network-free. Actual issue creation should stay in a distinct command so agents can draft safely by default and create only after explicit approval.
