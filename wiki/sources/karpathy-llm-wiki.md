---
status: active
updated: 2026-06-08
scope: source-summary
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: source interpretation or reference link changes
---

# Karpathy LLM Wiki

## TL;DR

- This pattern favors continuously maintained markdown wiki context over repeatedly reconstructing context from scratch.
- This project applies the pattern to project-planning source-of-truth management.

Source: [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
Checked: 2026-06-08

## Applied Here

- `wiki/startup.md` stores compact session context.
- `wiki/index.md` routes reads and updates.
- `wiki/canonical/` stores current project truth.
- `wiki/decisions/` stores project decision history.
- `wiki/meta/` stores wiki operating rules and operating decisions.
