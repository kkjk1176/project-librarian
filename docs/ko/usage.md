# 사용 가이드

README 빠른 시작 이후에 보는 문서입니다. 설치 범위, 실행 경로, 생성 파일, 마이그레이션 동작, 에이전트 요청 예시를 다룹니다.

## 설치 범위

초기 스킬 설치나 특정 레지스트리 버전으로 프로젝트를 갱신할 때는 `npx`를 사용합니다.

```bash
npx project-librarian@latest install --scope user --agents all
```

현재 저장소 안에 설치하려면 다음을 사용합니다.

```bash
npx project-librarian@latest install --scope project --agents all
```

`install`은 재사용 가능한 스킬 파일과 로컬 실행기에 필요한 필수 런타임 의존성을 복사합니다. `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, `.claude/settings.json`은 만들거나 갱신하지 않습니다. `install-skill`은 호환성 별칭으로 계속 지원됩니다.

| 상황 | 명령 |
| --- | --- |
| 지원하는 모든 에이전트에 전역 설치 | `npx project-librarian@latest install --scope user --agents all` |
| 현재 저장소에 설치 | `npx project-librarian@latest install --scope project --agents all` |
| Codex만 설치 | `npx project-librarian@latest install --agents codex` |
| Claude Code만 설치 | `npx project-librarian@latest install --agents claude` |
| Cursor만 설치 | `npx project-librarian@latest install --agents cursor` |
| Gemini CLI만 설치 | `npx project-librarian@latest install --agents gemini` |
| 설치 결과 미리 보기 | `npx project-librarian@latest install --scope project --agents all --dry-run` |

`--agents`는 `codex,claude,cursor,gemini` 같은 쉼표 구분 값도 받습니다. `all`은 지원하는 모든 에이전트를 대상으로 합니다. `--scope`는 `user` 또는 `project`를 받습니다.

프로젝트 설정/갱신 실행기도 `--agents`를 받습니다. 새 설정은 프로젝트 범위 Project Librarian 스킬 설치가 없을 때만 지원하는 모든 에이전트 표면을 기본으로 만듭니다. 저장소에 이미 `.codex/skills/project-librarian/`, `.claude/skills/project-librarian/` 같은 프로젝트 범위 스킬이 있으면 첫 설정도 그 설치된 에이전트 집합을 기본값으로 사용합니다.

마이그레이션 없는 기존 설정 갱신은 저장소에 이미 있는 에이전트 표면만 보존해서 갱신합니다. 따라서 Codex와 Claude 파일만 있던 저장소는 일반 갱신만으로 Cursor나 Gemini 파일이 새로 생기지 않습니다. 새 표면을 의도적으로 추가하려면 `project-librarian update --agents cursor` 또는 `project-librarian update --agents all`처럼 명시합니다. 목록에 없는 표면을 삭제하지는 않습니다.

`project-librarian update`는 선택된 표면에 이미 프로젝트 범위 Project Librarian 스킬 설치가 있으면 현재 실행 중인 패키지의 재사용 가능한 스킬 파일과 프로젝트 로컬 실행기에 필요한 런타임 의존성을 그 프로젝트 스킬 디렉터리로 동기화합니다. 기존 공유 `.agents/skills/project-librarian/` 설치는 별도로 동기화하며 Codex, Claude, Cursor, Gemini 설정 표면을 암묵적으로 추가하지 않습니다. 기본적으로 새 프로젝트 범위 스킬 설치를 만들지는 않고, 사용자 범위 스킬 설치도 갱신하지 않습니다. 사용자 범위 스킬은 `install --scope user`로 명시적으로 갱신합니다.

## 실행 경로

이 경로들은 주로 에이전트와 자동화를 위한 참조입니다. 설치 후 에이전트는 `npx`가 아니라 설치된 로컬 복사본을 `node`로 실행해야 합니다. 제한된 에이전트 환경에서 네트워크 접근과 버전이 고정되지 않은 패키지 실행을 피하기 위해서입니다.

| 설치 위치 | 실행 경로 |
| --- | --- |
| 공유 프로젝트 범위 스킬 | `node .agents/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Codex 스킬 | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Claude 스킬 | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Cursor 스킬 | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Gemini 스킬 | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Codex 스킬 | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Claude 스킬 | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Cursor 스킬 | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Gemini 스킬 | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

## 일반 에이전트 요청

원하는 결과를 에이전트에게 말하면, 스킬이 요청을 로컬 실행 명령으로 연결합니다.

위키 설정과 유지보수:

| 목표 | 에이전트에게 요청 | 내부 동작 |
| --- | --- | --- |
| 위키 생성 또는 갱신 | "Project Librarian으로 이 저장소의 계획 위키를 설정하거나 갱신해줘." | `[init]` |
| 마이그레이션 없는 기존 설정 갱신 | "이 저장소의 Project Librarian 설정을 위키 마이그레이션 없이 갱신해줘." | `update` |
| npm 최신 패키지로 마이그레이션 없이 갱신 | "이 저장소를 최신 Project Librarian으로 위키 마이그레이션 없이 갱신해줘." | `npx project-librarian@latest update` |
| 특정 에이전트 표면 추가 | "위키 마이그레이션 없이 Cursor Project Librarian 표면을 추가해줘." | `update --agents cursor` |
| 기존 문서/위키 마이그레이션 | "Project Librarian으로 기존 docs/wiki 내용을 마이그레이션해줘." | `--migrate` |
| 생성된 설정 검증 | "Project Librarian 검증을 실행해줘." | `--lint` |
| 링크와 문서 품질 점검 | "Project Librarian 진단을 실행해줘." | `--doctor` |
| 진단 전 라우팅 갱신 | "Project Librarian 라우팅을 갱신한 뒤 진단을 실행해줘." | `--doctor --fix` |
| 위키 내용 검색 | "Project Librarian 위키에서 authentication decisions를 찾아줘." | `--query "authentication decisions"` |
| 페이지 영향도 확인 | "decisions/release-policy의 Project Librarian 위키 영향도를 보여줘." | `--wiki-impact "decisions/release-policy"` |
| 가까운 위키 맥락 찾기 | "canonical/project-brief의 Project Librarian wiki neighborhood를 보여줘." | `--wiki-neighborhood "canonical/project-brief"` |
| 후보 메모 저장 | "이 내용을 Project Librarian 후보 메모로 저장해줘: <내용>." | `--capture-inbox --title "Candidate" --content "Details"` |
| 세션 핸드오프 저장 | "현재 작업을 Project Librarian 세션 핸드오프로 저장해줘." | `--handoff-save --goal "..." --state "..." --next "..."` |
| 핸드오프 보기 | "마지막 Project Librarian 세션 핸드오프를 보여줘." | `--handoff-show` |
| 핸드오프 후보 승격 | "마지막 Project Librarian 핸드오프를 위키 수신함 후보로 승격해줘." | `--handoff-promote-inbox` |
| 전체 핸드오프 주입 실험 켜기 | "Project Librarian 전체 핸드오프 주입 실험을 켜줘." | `--handoff-injection-enable` |
| 오래되었거나 미해결인 페이지 보고 | "Project Librarian에서 오래되었거나 미해결인 페이지를 확인해줘." | `--prune-check` |
| 엄격한 기준으로 stale/unresolved 보고 | "Project Librarian에서 엄격한 기준으로 오래되었거나 미해결인 페이지를 확인해줘." | `--prune-check --prune-check-strict` |
| git 설정 변경 없이 훅 파일 설치 | "git 설정은 바꾸지 말고 Project Librarian 훅 파일만 설정해줘." | `--no-git-config` |

코드 근거:

| 목표 | 에이전트에게 요청 | 내부 동작 |
| --- | --- | --- |
| 기본 근거 캐시 생성 | "`src`에 대해 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-scope src` |
| 여러 범위 빌드 | "`src`와 `packages/api`에 대해 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-scope src --code-scope packages/api` |
| 증분 갱신 요구 | "Project Librarian 코드 근거 인덱스를 증분 갱신해줘." | `--code-index --incremental` |
| 전체 재생성 강제 | "Project Librarian 코드 근거 인덱스를 전체 재생성해줘." | `--code-index --code-index-full` |
| 스키마 마이그레이션 승인 | "Project Librarian 코드 근거 인덱스 스키마를 마이그레이션해줘." | `--code-index --code-index-migrate` |
| 선택적 Tree-sitter 백엔드 사용 | "Tree-sitter 파서로 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-parser tree-sitter` |
| 캐시 호환성 진단 | "Project Librarian 코드 근거 캐시 상태와 호환성을 진단해줘." | `--code-index-health` |
| 캐시 상태 확인 | "Project Librarian 코드 근거 상태를 보여줘." | `--code-status` |
| 인덱싱된 파일 목록 | "Project Librarian 코드 근거 인덱스의 파일 목록을 보여줘." | `--code-files` |
| 구조/소유권 보고서 | "Project Librarian 코드 보고서를 보여줘." | `--code-report` |
| 특정 보고서 섹션 | "Project Librarian 코드 보고서의 routes 섹션을 보여줘." | `--code-report --code-report-section routes` |
| 영향 근거 확인 | "`healthHandler`의 Project Librarian 영향 근거를 보여줘." | `--code-impact healthHandler` |
| 컨텍스트 팩 생성 | "`healthHandler`의 Project Librarian 컨텍스트 팩을 만들어줘." | `--code-context-pack healthHandler` |
| 심볼 검색 | "`Auth` 심볼을 Project Librarian 코드 근거에서 찾아줘." | `--code-search-symbol Auth` |
| 보수적 읽기 전용 SQL | "파일 경로를 위한 읽기 전용 Project Librarian 코드 근거 쿼리를 실행해줘." | `--code-query "select path from files order by path"` |

한 번에 하나의 코드 근거 모드만 실행할 수 있습니다. `--incremental`, `--code-index-full`, `--code-index-migrate`, `--code-parser`는 `--code-index`와 함께 사용할 때만 유효합니다. `--code-index-migrate`는 기존 폐기형 인덱스의 스키마 버전이 현재 패키지와 다를 때 교체를 승인한다는 명시적 표시입니다.

## 설치되는 파일

새 설정은 `--agents`를 지정하지 않았고 저장소에 더 좁은 에이전트 집합의 프로젝트 범위 Project Librarian 스킬이 없으면 지원하는 에이전트 표면을 설치합니다. 기존 마이그레이션 없는 업데이트는 감지된 표면만 보존해서 갱신합니다.

프로젝트 지침 파일:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `wiki/AGENTS.md`
- `.cursor/rules/project-librarian.mdc`

시작 훅:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`
- `.cursor/hooks.json`
- `.cursor/hooks/wiki-session-start.js`
- `.gemini/settings.json`
- `.gemini/hooks/wiki-session-start.js`

git 훅 파일:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

위키 디렉터리:

- `wiki/canonical/`
- `wiki/roadmaps/`
- `wiki/plans/`
- `wiki/decisions/`
- `wiki/inbox/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/migration/`

시드 위키 페이지와 라우터:

- `wiki/startup.md`
- `wiki/index.md`
- `wiki/meta/document-taxonomy.md`

실제 내용이 없는 빈 프로젝트 문서나 ADR 템플릿은 기본 생성하지 않습니다. 나중에 실제 내용이 생기면 문서를 만들고 `--refresh-index`로 라우팅할 수 있습니다.

MCP 서버 등록은 Claude Code(`.mcp.json`), Cursor(`.cursor/mcp.json`), Gemini CLI(`.gemini/settings.json`)의 `mcpServers`에 기존 값을 보존하며 병합합니다. 폐기 가능한 코드 근거 캐시는 `.project-wiki/code-evidence.sqlite`입니다.

## 작동 방식

1. 부트스트랩은 기존 내용을 보존하는 위키 구조와 marker-bounded 에이전트 지침 섹션을 만듭니다.
2. 세션 시작 훅은 문자 예산이 적용된 `wiki/startup.md`와 `wiki/index.md`만 주입합니다.
3. 실제 내용이 없는 양식 전용 페이지는 만들지 않습니다.
4. 자세한 계획 정본은 에이전트가 필요할 때 읽는 canonical, decision, source, meta 페이지에 둡니다.
5. 새 프로젝트 계획 내용은 작성하거나 취합하기 전에 분류해 상위/하위 문서 관계가 보이도록 유지합니다.
6. `--refresh-index`는 새로 발견한 위키 페이지를 라우팅합니다. route가 많으면 `wiki/indexes/auto-*.md` 범위별 라우터로 나눕니다.
7. `--code-index`는 `.project-wiki/` 아래 폐기 가능한 SQLite 근거 캐시를 만듭니다.
8. `--code-report`, `--code-impact`, `--code-context-pack`, `--code-search-symbol`, `--code-query`는 계획 업데이트에 쓸 코드 기반 근거를 노출합니다.
9. 위키 생산자는 canonical markdown/YAML 스키마를 계속 쓰고, 진단/MCP 같은 읽기 전용 소비자는 원본 문서를 변경하지 않고 검사합니다.
10. 진단은 깨진 링크, 중복 route, orphan page, topology warning, stale page, TL;DR 누락, 근거 공백, 마이그레이션 정책 위반을 보고합니다.

마이그레이션은 검토 우선입니다. `--migrate`는 기존 `wiki/`를 `wiki_legacy*`로 보존하고, 양식 전용 파일은 건너뛰며, 여러 성격이 섞인 기존 페이지를 의미 단위로 나눕니다. 이후 각 단위를 분류해 `wiki/migration/` 아래 검토 파일을 작성합니다.
