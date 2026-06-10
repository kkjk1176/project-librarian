---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: short
decision_ref: none
review_trigger: project risks are added, mitigated, or resolved
---

# Risks

## TL;DR

- 이 페이지는 현재 코드 구조에서 보이는 maintenance and behavior risks를 추적한다.
- 위험이 완화되면 evidence와 함께 resolved로 이동한다.

## Active

| Risk | Impact | Mitigation | Revisit Trigger |
| --- | --- | --- | --- |
| `src/` and committed `dist/` can drift. | npm binary and skill installation may execute stale compiled code. | Run `npm run build` and `npm test` before release/commit review. | Any change under `src/`. |
| Hook config and compatibility instruction updates must preserve unmanaged user content. | Existing project hooks or agent instructions could be removed if merge logic regresses. | Preserve smoke coverage for custom Codex/Claude/Cursor hook entries and marker-bounded Claude/Gemini instruction files. | Any change to `src/hooks.ts`, `src/templates.ts`, or generated instruction files. |
| Migration classification is heuristic. | Legacy docs can be routed to imperfect inbox categories. | Keep migration output as review inboxes, not canonical truth. | Changes to `classifyMarkdown` or migration workflow. |

## Resolved

- Initial “project topic unknown” risk from starter wiki is resolved by code inspection.
- The split runtime risk where `package.json` allowed Node `>=18` while code evidence indexing needed `node:sqlite` is resolved by raising the package minimum to Node `>=22.13` and documenting the `node:sqlite` reason in README.
