<!-- PROJECT-WIKI-CLAUDE:START -->
# Claude Code Project Instructions

@AGENTS.md

## Claude Code Notes

Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so this file imports `AGENTS.md` to share the same wiki-first planning contract with Codex and other agents. Bootstrap also installs a Claude Code `SessionStart` hook in `.claude/settings.json` for compact wiki startup context.

At session start, follow the imported instructions: review `wiki/startup.md` and `wiki/index.md` first, then read detailed wiki pages on demand only when the current task needs them.
<!-- PROJECT-WIKI-CLAUDE:END -->
