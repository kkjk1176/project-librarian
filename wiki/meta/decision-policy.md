---
status: active
updated: 2026-06-09
scope: wiki-meta
read_budget: medium
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: project decision recording levels or ADR criteria change
---

# Decision Policy

## TL;DR

- Canonical docs hold current agreement; project decision docs hold rationale and history.
- Simple project changes update canonical docs only.
- Trivial decisions that need timing go into `decisions/log.md`.
- Related decisions can be grouped into a Decision Pack.
- Heavy decisions use a Full ADR.
- Wiki operating decisions belong in `wiki/meta/`, not project decision history.

## 1. Canonical Only

Use only `wiki/canonical/` for simple spec confirmation, current behavior descriptions, reversible wording edits, and low-context changes.

## 2. One-Line Log

Use `wiki/decisions/log.md` when the main value is timestamp tracking.

```md
- YYYY-MM-DD | area | decision | canonical: [[canonical/example]]
```

## 3. Decision Pack

Use a Decision Pack when several related choices share one topic.

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |

## 4. Full ADR

Use a Full ADR when the decision affects product direction, architecture, public API, data model, security/permissions, SEO contracts, high migration cost, or a likely future challenge.

## Token Rules

- Put a TL;DR near the top of canonical docs.
- Do not inject full canonical or decision bodies into startup context.
- Read long decision files only when `wiki/index.md` routing says they are relevant.
