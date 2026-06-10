---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: product direction, audience, scope, success criteria, or language choice changes
---

# Project Brief

## TL;DR

- Project Librarian은 작은 저장소뿐 아니라 큰 프로젝트와 모노레포에서도 쓸 수 있는 token-efficient project planning wiki와 재생성 가능한 code evidence index를 생성/유지하는 TypeScript CLI 패키지다.
- 핵심 사용자는 Codex, Claude Code, Cursor, Gemini CLI 같은 LLM coding agent를 쓰는 개발자와, agent가 반복해서 읽을 durable project context 및 코드 근거가 필요한 팀, 특히 큰 저장소에서 context routing과 code-backed planning update가 필요한 팀이다.
- 성공 기준은 idempotent bootstrap, 기존 수동 내용 보존, compact startup hook, lint 가능한 생성물, migration/search/inbox, scoped routing, code-evidence index/report/impact 모드다.
- README는 설치만 `npx`로 안내하고, agent/LLM이 실행하는 bootstrap, diagnostics, migration, code evidence 등 lifecycle 명령은 설치된 local `node .../dist/init-project-wiki.js` runner로 안내해야 한다.
- Benchmark는 사용자 실행 기능이 아니라 maintainer release evidence다. Public README는 benchmark 사용법보다 결과값, 측정 조건, claim boundary를 먼저 안내해야 한다.
- 이 코드 기반 wiki의 canonical 내용 언어는 현재 요청에 맞춰 한국어로 둔다.

## Current State

코드 기준 현재 제품은 `project-librarian` CLI다. 기본 실행은 repo-local `wiki/`와 agent instruction files, Codex/Claude session-start hooks, Cursor/Gemini compatibility files, optional git hook 파일을 생성하거나 업데이트한다.

Code-proven facts:

- npm binary는 `project-librarian`이고 `dist/init-project-wiki.js`를 실행한다. Evidence: `package.json`.
- source of truth는 TypeScript 파일이 있는 `src/`이며, 배포 실행물은 `dist/`에 커밋된다. Evidence: `README.md`, `package.json`.
- default bootstrap은 wiki directories, root instructions, Codex/Claude hook config, session hook scripts, Cursor/Gemini compatibility files, git hook scripts, starter wiki pages를 만든다. Evidence: `src/init-project-wiki.ts`.
- 생성된 session-start hook은 `wiki/startup.md`와 `wiki/index.md`만 compact context로 주입한다. Evidence: `src/hooks.ts`.
- CLI는 bootstrap, migration, lint, link-check, quality-check, doctor, query, issue-draft, refresh-index, capture-inbox, prune-check, migration review, glossary-init, skill install, code evidence index/query/report/status/files/symbol search 모드를 제공한다. Evidence: `src/args.ts`, `src/init-project-wiki.ts`.

Product framing:

- 이 프로젝트는 “작은 프로젝트 전용 wiki bootstrap”이 아니다. 작은 저장소에서도 startup context를 작게 유지하지만, 큰 프로젝트와 모노레포에서 scoped routing, diagnostics, migration, code evidence를 통해 agent가 필요한 문서와 코드 근거를 좁혀 읽도록 설계되어야 한다.
- Public-facing README는 CLI 옵션 목록을 먼저 나열하기보다 문제, 정량 결과, agent execution model, 주요 기능, 작동 방식 순서로 제품 가치를 설명해야 한다. Detailed CLI reference는 뒤쪽에 두되, agent 실행 예시는 local runner를 기준으로 해야 한다.

## Audience

- Primary: Codex/Claude Code/Cursor/Gemini CLI를 쓰며 프로젝트별 planning memory와 agent startup context를 표준화하려는 개발자와 팀.
- Secondary: 큰 저장소, 모노레포, 기존 docs/wiki를 새 `wiki/` 구조로 검토 가능한 inbox와 scoped routing으로 관리하려는 팀.
- Agent audience: repository state를 긴 대화 기록 대신 `wiki/startup.md`, `wiki/index.md`, on-demand canonical/decision/meta pages로 재구성해야 하는 coding agents.

## Core Scenarios

1. 새 프로젝트 또는 기존 프로젝트 루트에서 CLI를 실행해 wiki와 hooks를 생성한다.
2. 같은 CLI를 다시 실행해 managed sections/files만 idempotently 업데이트한다.
3. 기존 wiki/docs를 `--migrate`로 보존하고 migration inbox로 분류한다.
4. `--lint`, `--link-check`, `--quality-check`, `--doctor`, `--query`, `--issue-draft`, `--refresh-index`, `--capture-inbox`, `--prune-check`로 wiki lifecycle과 스킬 문제/부작용 보고 초안을 관리한다.
5. 큰 저장소와 모노레포에서는 `--refresh-index`가 대량 auto-discovered pages를 scoped generated routers로 나눠 startup index budget을 지킨다.
6. 큰 저장소에서는 `--code-index`, read-only `--code-query`, `--code-report`로 코드 증거 캐시와 architecture/ownership/parser-backend 요약을 만든 뒤 canonical wiki 업데이트 근거로 쓴다.

## Success Criteria

- Bootstrap rerun이 안전해야 한다: unmanaged instruction content와 metadata-bearing wiki pages를 보존한다.
- Startup context는 작아야 한다: hooks는 startup/index만 읽고 상세 문서는 router에 따라 on demand로 읽는다.
- 큰 프로젝트에서도 routing이 유지되어야 한다: 대량 wiki pages는 scoped routers로 분리하고, code evidence는 canonical truth가 아니라 검증 가능한 근거 캐시로 사용한다.
- Generated setup은 검증 가능해야 한다: `--lint`와 hook 실행이 통과해야 한다.
- Migration은 직접 정본화하지 않아야 한다: legacy markdown은 inbox에 후보로 남기고 사람이 검토 가능한 상태를 유지한다.
- Code evidence index는 canonical truth가 아니라 재생성 가능한 evidence cache로 남아야 한다.
- 문제 보고는 빠르게 남길 수 있어야 한다: 사용자가 직접 발견하지 못한 버그, 혼란, 부작용을 다른 agent나 사용자가 발견했을 때 `--issue-draft`로 재현/환경/영향 정보를 즉시 이슈화 가능한 형태로 남긴다.
- 이슈 생성은 승인 기반이어야 한다: GitHub CLI가 있고 사용자가 명시적으로 허가한 경우, 별도 opt-in 명령인 `--issue-create`가 draft를 실제 GitHub issue로 등록할 수 있어야 한다.

## Constraints

- Generated operating templates are English by default, while project canonical pages may follow user/project language.
- `.project-wiki/` is disposable evidence storage and must not be treated as canonical wiki content.
- The whole package requires Node `>=22.13` so bootstrap, diagnostics, installed skill runners, and code evidence indexing all run on a single runtime with stable `node:sqlite` support.
