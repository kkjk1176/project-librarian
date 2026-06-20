# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![코드 근거 인덱스](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

**모든 AI 코딩 에이전트에게 프로젝트에 대한 같은 지속 기억을 주세요.** Project Librarian은 저장소 안에 두는 간결한 계획 위키와 선택적 코드 근거 인덱스를 유지합니다. Codex, Claude Code, Cursor, Gemini CLI가 세션을 시작할 때 이걸 읽으므로, 매번 코드베이스를 처음부터 다시 파악하지 않아도 됩니다.

언어: [English](README.md) | [한국어](README.ko.md)

## 빠른 시작

대부분의 사용자는 생명주기 명령을 직접 실행하기보다 코딩 에이전트에게 Project Librarian 실행을 요청하면 됩니다.

재사용 가능한 스킬 파일을 한 번 설치하거나, 셸을 사용할 수 있는 에이전트에게 설치를 요청합니다.

```bash
npx project-librarian install-skill --scope user --agents all
```

그다음 대상 저장소에서 Codex, Claude Code, Cursor, Gemini CLI에 자연어로 요청합니다.

- "Project Librarian으로 이 저장소의 계획 위키를 설정하고 진단까지 실행해줘."
- "Project Librarian으로 기존 docs/wiki 내용을 마이그레이션해줘."
- "Project Librarian 위키에서 authentication decisions를 찾아줘."

설치된 스킬은 에이전트가 로컬 실행 경로를 찾고 프로젝트 루트에서 맞는 명령을 실행하도록 안내합니다. 실행 경로를 대상 저장소의 에이전트 설정 안에 두고 싶을 때만 프로젝트 범위 설치를 선택합니다.

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill`은 재사용 가능한 실행 파일과 스킬 파일만 복사합니다. `AGENTS.md`, 에이전트 훅, `wiki/`, git 훅 파일, 진단, 선택적 코드 근거 지원을 만들거나 갱신하는 것은 에이전트가 실행하는 생명주기 명령입니다.

## 핵심 강점

- **첫 읽기를 작게.** 세션 시작 훅은 `wiki/startup.md`와 `wiki/index.md`만 주입하고, 에이전트는 저장소 전체를 처음부터 훑는 대신 필요할 때 더 깊은 페이지로 이동합니다.
- **한 번 설정, 네 에이전트.** Codex, Claude Code, Cursor, Gemini CLI가 같은 위키 우선 계약과 훅, 규칙을 공유합니다.
- **구조적인 위키 작성.** 새 프로젝트 내용은 작성하거나 취합하기 전에 `wiki/meta/document-taxonomy.md`로 분류하므로 PRD, 정책, UX, 데이터, API, QA, 릴리즈, 운영 메모가 하나의 잡다한 페이지로 합쳐지지 않습니다.
- **검토 가능한 위키 그래프.** `--wiki-visualize`는 `.project-wiki/` 아래에 독립 실행형 HTML 그래프를 작성해, 시작 컨텍스트를 늘리지 않고 페이지 유형·라우터 깊이·역링크·결정 참조를 보여줍니다.
- **막연한 표현이 아니라 측정값.** 모든 성능 주장은 격리된 Codex 벤치마크에서 나오며, 손해를 본 경우도 이긴 경우 바로 옆에 보여 줍니다.
- **선택적 코드 근거.** 재생성 가능한 SQLite 인덱스와 답변 형태 MCP 도구가 영향·소유권·워크스페이스 그래프 질문에 답하며, 추가 런타임 의존성이 전혀 없습니다.
- **다시 실행해도 안전.** 부트스트랩은 멱등하고 기존 내용 보존을 우선하며, 진단은 깨진 경로·도달 불가 페이지·오래된 사실을 에이전트가 오해하기 전에 잡아냅니다.

## 존재 이유

LLM 코딩 에이전트는 매 세션마다 프로젝트를 처음부터 다시 파악하느라 컨텍스트와 도구 호출을 낭비합니다. 오래된 대화를 읽고, 문서를 훑고, 소스를 검색하고, 어떤 파일이 중요한지 추측하는 일이 반복됩니다.

Project Librarian은 에이전트에게 두 가지 로컬 정본을 제공합니다.

| 표면 | 에이전트가 얻는 것 |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 짧은 세션 시작 요약과 라우터. 관련 계획 페이지만 읽습니다. |
| `wiki/canonical/` 및 `wiki/decisions/` | 현재 프로젝트 사실, 제약, 리스크, 패키지 계약, CLI 동작, 지속되는 결정. |
| `wiki/meta/document-taxonomy.md` | PRD, 정책, UX, 데이터, 개발, QA, 릴리즈, 운영 정본을 어디에 둘지 안내하는 서비스 생애주기 분류 지도. |
| `.codex/`, `.claude/`, `.cursor/`, `.gemini/` 훅 | 전체 위키를 불러오지 않는 Codex/Claude Code/Cursor/Gemini CLI 시작 컨텍스트. |
| `GEMINI.md` 및 `.cursor/rules/` | Gemini CLI와 Cursor를 같은 간결한 위키 우선 계약으로 안내하는 지침 파일. |
| `.project-wiki/code-evidence.sqlite` | 파일, 심볼, import, route, 소유권, 워크스페이스 그래프, 보고서, 영향 확인을 위한 재생성 가능한 코드 근거. |
| `.project-wiki/wiki-graph.html` | 파생 concept type, 라우터 도달성, 링크, 역링크, 결정 참조를 보여주는 선택적 정적 위키 그래프 시각화. |
| 진단 및 마이그레이션 모드 | 링크 확인, 품질 확인, 마이그레이션 수신함, 오래된 신호 보고, 작업 흐름에서 문제가 드러날 때의 이슈 초안. |

핵심은 “문서를 더 많이 쓰자”가 아닙니다. 첫 에이전트 읽기량을 작게 유지하고, 더 깊은 프로젝트 정본과 코드 근거로 가는 신뢰 가능한 경로를 제공하는 것입니다.

이 분류 체계는 가능한 모든 문서를 만들라는 지시가 아니라 라우팅 보조 장치입니다. 서비스/제품 개발 문서 체계에 맞춘 분류라, 라이브러리/인프라/연구성 프로젝트에는 일부 항목이 덜 맞을 수 있습니다. 그런 경우 관련 있는 영역만 쓰고 나머지는 억지로 문서화하지 않는 것이 맞습니다.

## 벤치마크 결과

여기 수치는 모든 상황에 대한 약속이 아니라 관리자 릴리스 근거입니다. 모든 값은 실제 Codex JSONL 사용량과 로컬 실행 시간(ChatGPT/Codex 인증, `gpt-5.5`)이며, 격리된 환경 — 독립 Codex home, 허용 목록 전용 환경 변수, 정결한 작업 트리, 실행 후 픽스처 검증 — 에서 시나리오당 측정 3회와 예열 1회로, Project Librarian이 없는 `organic` 대조군과 비교했습니다.

아래 표에서 **“적음” / “많음”** 은 대조군 대비 비용 가중 토큰을, **“빠름” / “느림”** 은 실행 시간을 비교한 것입니다. (비용 가중 = uncached input + 0.1 × cached input + output + reasoning output. 캐시된 재전송은 정가가 아니므로 할인하며, 단순 합산 총량은 턴을 추가하는 도구를 부당하게 불리하게 만들기 때문입니다.) 위키 라우팅 트랙과 코드 그래프 트랙은 분리해 측정·보고하며, 한 트랙의 우위가 다른 트랙의 주장을 뒷받침하지 않습니다. `benchmarks/reports/llm/` 아래 생성 보고서는 기본적으로 무시됩니다. 공개 주장 근거로 쓸 릴리스 기준선만 의도적으로 커밋해야 합니다. 릴리스 후보는 다음 명령으로 재현할 수 있습니다.

```bash
npm run benchmark:release:preview
npm run benchmark:release -- --allow-codex-run
```

실측 릴리스 실행은 stderr에 `[benchmark:progress]` 줄을 스트리밍하여 시나리오 수, 예상 Codex 실행 총량, 현재 실행 순번, 단계, 프롬프트 ID, 종료 상태, 경과 시간, 원시 JSONL 경로를 보여줍니다. stdout은 최종 JSON 결과 전용으로 유지됩니다.

### 위키 트랙 (계획 문서 라우팅)

비용 가중 토큰, Project Librarian 대 대조군:

| 규모 | decision_lookup | aggregation | multi_session (2번째 세션) |
| --- | --- | --- | --- |
| 소형 | 14.4% 적음 | 81.0% 많음 | 22.0% 적음 |
| 중형 | 52.0% 적음 | 19.0% 적음 | 54.1% 적음 |
| 대형 | 71.1% 적음 | 29.0% 적음 | 71.8% 적음 |

최신 합성 위키 트랙 릴리스 후보는 2026-06-19에 `gpt-5.5`로 측정했으며, 42개 시나리오를 각 3회 측정하고 1회 예열했습니다. 전체 주장 게이트는 **통과**했습니다. 42/42개 시나리오가 정확성 검사를 통과했고, 42개 시나리오가 모두 claimable이었으며, 모든 corpus 게이트가 3회 실행 최소 조건을 충족했습니다. 이 릴리스 주장은 여전히 합성 위키 라우팅 트랙과 표기된 작업 유형에 한정됩니다. 코드 그래프 동작, 실제 저장소, 모든 에이전트 표면, 모든 질문 형태에 대한 주장이 아닙니다. 숨기지 않는 한계도 그대로 남습니다. 소형 `aggregation`은 위키를 켰을 때 여전히 81.0% 비싸고, 전체 보고서의 소형 `release_policy`도 9.4% 비싸며, `aggregation`은 토큰 비용이 줄어드는 규모에서도 실행 시간은 매번 더 느립니다.

### 코드 그래프 트랙 (코드 근거 인덱스, 실제 저장소)

SHA로 고정한 오픈소스 저장소 2곳에서, 손으로 작성한 정답 키와 격리된 Codex home에 주입한 답변 형태 MCP 도구로 측정했습니다. 평가기 거짓 양성 2건을 고치고 원시 JSONL에서 재채점한 뒤 30/30 정확으로 주장 게이트를 통과했으며, 원시 데이터에서 다시 계산하는 것이 상시 감사 정책입니다. 비용 가중 토큰, Project Librarian 대 대조군:

| 질문 | excalidraw (~1.2k 파일) | backstage (~11.8k 파일) |
| --- | --- | --- |
| impact_trace | 117% 많음 | **27.7% 적음** |
| workspace_graph | 106% 많음 | 2.6% 적음 |
| ownership_lookup | — | 99% 많음 |

주장은 규모 교차점이며, 손실도 승리 옆에 함께 공개합니다. 11.8k 파일 저장소에서는 비싼 순회 질문에서 도구가 이기고(impact_trace 비용 가중 토큰 27.7% 적음, 스캔 바이트 24.5% 적음) 워크스페이스 그래프는 손익분기인 반면, 소형 저장소에서는 전부 지고 저렴한 조회(CODEOWNERS 소유권)는 모든 측정 규모에서 집니다. 한마디로, 코드 근거 인덱스는 비싼 순회 질문이 있는 진짜 대형 저장소에서만 이득이며 — 이것이 곧 CLI의 규모 인지 게이트가 구현한 내용입니다: 인덱싱 대상 파일 약 5k개 미만에서는 `--code-index`가 명시적 동의를 요구하고 부트스트랩은 MCP 자동 등록을 건너뜁니다.

### 벤치마크 용어 설명

테스트 대상 저장소:

- **excalidraw** — 실제 오픈소스 화이트보드/다이어그램 앱(~1.2k 파일). 소형 저장소 표본.
- **backstage** — Spotify의 오픈소스 개발자 포털 플랫폼(~11.8k 파일). 대형 저장소 표본.

질문 유형(task family):

- **decision_lookup** — 위키에서 가장 최근 프로젝트 결정과 그 날짜를 찾기.
- **aggregation** — 여러 페이지에 흩어진 사실을 종합해야 답할 수 있는 질문.
- **multi_session** — 같은 프로젝트의 두 번째 세션. 지속되는 위키가 첫 세션뿐 아니라 다음 세션에도 도움이 되는지 측정.
- **impact_trace** — "이 모듈이 바뀌면 무엇이 영향받나?": 직접·간접으로 import하는 전체 집합을 추적.
- **ownership_lookup** — "이 파일의 소유자는 누구인가?": CODEOWNERS 마지막 일치 우선순위로 소유자 판정.
- **workspace_graph** — "이 패키지는 모노레포에서 무엇에 의존하나?": 워크스페이스/패키지 의존성 그래프.

## 설치 상세

설치 범위나 대상 에이전트를 고를 때 이 섹션을 참고합니다. 초기 스킬 설치에만 `npx`를 사용합니다.

```bash
npx project-librarian install-skill --scope user --agents all
```

현재 저장소에 설치:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill`은 재사용 가능한 스킬 파일만 복사합니다. `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, `.claude/settings.json`은 만들거나 갱신하지 않습니다.

| 상황 | 명령 |
| --- | --- |
| 지원하는 모든 에이전트에 전역 설치 | `npx project-librarian install-skill --scope user --agents all` |
| 현재 저장소에 설치 | `npx project-librarian install-skill --scope project --agents all` |
| Codex만 설치 | `npx project-librarian install-skill --agents codex` |
| Claude Code만 설치 | `npx project-librarian install-skill --agents claude` |
| Cursor만 설치 | `npx project-librarian install-skill --agents cursor` |
| Gemini CLI만 설치 | `npx project-librarian install-skill --agents gemini` |
| 설치 결과 미리 보기 | `npx project-librarian install-skill --scope project --agents all --dry-run` |

`--agents`는 `codex,claude,cursor,gemini`처럼 쉼표로 구분한 값도 받습니다. `all`은 지원하는 모든 에이전트를 대상으로 합니다. `--scope`는 `user` 또는 `project`를 받습니다.

프로젝트 설정/갱신 실행기도 `--agents`를 받습니다. 새로 설정할 때는 프로젝트 범위 Project Librarian 스킬 설치가 없을 때만 지원하는 모든 에이전트 표면을 기본으로 만듭니다. 저장소에 이미 `.codex/skills/project-librarian/`, `.claude/skills/project-librarian/` 같은 프로젝트 범위 스킬이 있으면 첫 설정도 그 설치된 에이전트 집합을 기본값으로 사용합니다. 마이그레이션 없는 기존 설정 갱신은 저장소에 이미 있는 에이전트 표면만 보존해서 갱신합니다. 따라서 Codex와 Claude 파일만 있던 저장소는 일반 갱신만으로 Cursor나 Gemini 파일이 새로 생기지 않습니다. 새 표면을 의도적으로 추가하려면 `project-librarian update --agents cursor` 또는 `project-librarian update --agents all`처럼 명시합니다. 목록에 없는 표면을 삭제하지는 않습니다.

## 실행 경로

이 경로들은 주로 에이전트와 자동화를 위한 참조입니다. 설치 후 에이전트는 `npx`가 아니라 설치된 로컬 복사본을 `node`로 실행해야 합니다. 이렇게 하면 제한된 에이전트 환경에서 네트워크 접근과 버전이 고정되지 않은 패키지 실행을 피할 수 있습니다.

| 설치 위치 | 실행 경로 |
| --- | --- |
| 프로젝트 범위 Codex 스킬 | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Claude 스킬 | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Cursor 스킬 | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Gemini 스킬 | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Codex 스킬 | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Claude 스킬 | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Cursor 스킬 | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Gemini 스킬 | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

## 일반 에이전트 요청

원하는 결과를 자연어로 요청하면 됩니다. 스킬은 내부적으로 요청을 로컬 실행 경로에 맞는 명령으로 연결합니다.

위키 설정과 유지보수:

| 목적 | 에이전트에게 요청할 말 | 내부 액션 |
| --- | --- | --- |
| 위키 생성 또는 갱신 | "Project Librarian으로 이 저장소의 계획 위키를 설정하거나 갱신해줘." | `[init]` |
| 마이그레이션 없이 기존 설정 갱신 | "위키를 마이그레이션하지 말고 이 저장소의 Project Librarian 설정을 갱신해줘." | `update` |
| 기존 설정에 특정 에이전트 표면 추가 | "위키 마이그레이션 없이 Cursor Project Librarian 표면을 추가해줘." | `update --agents cursor` |
| 기존 문서/위키 마이그레이션 | "Project Librarian으로 기존 docs/wiki 내용을 마이그레이션해줘." | `--migrate` |
| 생성된 설정 검증 | "Project Librarian 검증을 실행해줘." | `--lint` |
| 링크와 문서 품질 점검 | "Project Librarian 진단을 실행해줘." | `--doctor` |
| 진단 전에 생성된 라우팅 갱신 | "Project Librarian 라우팅을 갱신한 뒤 진단을 실행해줘." | `--doctor --fix` |
| 위키 내용 검색 | "Project Librarian 위키에서 authentication decisions를 찾아줘." | `--query "authentication decisions"` |
| 페이지의 역링크/결정 인용 확인 | "decisions/release-policy의 Project Librarian 위키 영향도를 보여줘." | `--wiki-impact "decisions/release-policy"` |
| 위키 그래프 시각화 생성 | "Project Librarian 위키 그래프 시각화를 생성해줘." | `--wiki-visualize` |
| 후보 메모 저장 | "이 내용을 Project Librarian 후보 메모로 저장해줘: <내용>." | `--capture-inbox --title "Candidate" --content "Details"` |
| 오래되었거나 미해결인 위키 페이지 보고 | "Project Librarian에서 오래되었거나 미해결인 페이지를 확인해줘." | `--prune-check` |
| git 설정 변경 없이 훅 파일 설치 | "git 설정은 바꾸지 말고 Project Librarian 훅 파일만 설정해줘." | `--no-git-config` |

코드 근거:

| 목적 | 에이전트에게 요청할 말 | 내부 액션 |
| --- | --- | --- |
| 기본 근거 캐시 생성 | "`src`에 대해 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-scope src` |
| 여러 범위 빌드 | "`src`와 `packages/api`에 대해 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-scope src --code-scope packages/api` |
| 증분 갱신 요구 | "Project Librarian 코드 근거 인덱스를 증분 갱신해줘." | `--code-index --incremental` |
| 전체 재생성 강제 | "Project Librarian 코드 근거 인덱스를 전체 재생성해줘." | `--code-index --code-index-full` |
| 선택적 Tree-sitter 백엔드 사용 | "Tree-sitter 파서로 Project Librarian 코드 근거를 만들어줘." | `--code-index --code-parser tree-sitter` |
| 캐시 호환성 진단 | "Project Librarian 코드 근거 캐시 상태와 호환성을 진단해줘." | `--code-index-health` |
| 캐시 상태 보기 | "Project Librarian 코드 근거 상태를 보여줘." | `--code-status` |
| 인덱싱된 파일 목록 | "Project Librarian 코드 근거에 인덱싱된 파일을 보여줘." | `--code-files` |
| 아키텍처/소유권 보고서 출력 | "Project Librarian 코드 보고서를 보여줘." | `--code-report` |
| 보고서 섹션 하나만 출력 | "Project Librarian 코드 보고서의 routes 섹션을 보여줘." | `--code-report --code-report-section routes` |
| 영향 근거 확인 | "`healthHandler`에 대한 Project Librarian 영향 근거를 보여줘." | `--code-impact healthHandler` |
| 컨텍스트 팩 생성 | "`healthHandler`에 대한 Project Librarian 컨텍스트 팩을 만들어줘." | `--code-context-pack healthHandler` |
| 인덱싱된 심볼 검색 | "Project Librarian 코드 근거에서 `Auth` 심볼을 찾아줘." | `--code-search-symbol Auth` |
| 보수적인 읽기 전용 SQL 실행 | "파일 경로를 확인하는 읽기 전용 Project Librarian 코드 근거 쿼리를 실행해줘." | `--code-query "select path from files order by path"` |

코드 근거 모드는 한 번에 하나만 실행할 수 있습니다. `--incremental`, `--code-index-full`, `--code-parser`는 `--code-index`와 함께 쓸 때만 유효합니다.

## 설치되는 파일

새로 설정할 때는 `--agents`로 좁히지 않았고 프로젝트 범위 Project Librarian 스킬 설치도 없을 때 아래 지원 에이전트 표면을 설치합니다. 마이그레이션 없는 기존 설정 갱신은 기본적으로 감지된 표면만 보존해서 갱신하고, 공통 위키/git 훅 파일은 계속 갱신합니다.

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

Git 훅 파일:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

위키 디렉터리:

- `wiki/canonical/`
- `wiki/decisions/`
- `wiki/inbox/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/migration/`

초기 위키 페이지와 라우터:

- `wiki/startup.md`
- `wiki/index.md`
- `wiki/meta/document-taxonomy.md`

`canonical/project-brief.md`, `canonical/open-questions.md`, `canonical/assumptions.md`, `canonical/risks.md`, ADR 템플릿처럼 실제 내용이 없는 빈 프로젝트 문서는 기본 생성하지 않습니다. 나중에 실제 내용이 생기면 문서를 만들고 `--refresh-index`로 라우팅할 수 있습니다. 마이그레이션 중 발견한 양식 전용 기존 템플릿은 새 위키 페이지나 검토 행으로 만들지 않고 `wiki/migration/inventory.md`에 스킵 사유만 남깁니다.

MCP 서버 등록 (`mcpServers`에 기존 항목 보존하며 병합):

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.gemini/settings.json`의 `mcpServers` (Gemini CLI)

폐기 가능한 코드 근거 캐시:

- `.project-wiki/code-evidence.sqlite`

## 코드 근거 MCP 서버

`project-librarian mcp`는 직접 구현한 stdio MCP 서버(줄바꿈 구분 JSON 위의 JSON-RPC 2.0, 추가 런타임 의존성 없음)를 실행해 기존 `.project-wiki` 코드 근거 인덱스를 읽기 전용으로 제공합니다. 답변 형태 도구 — `code_context_pack`, `code_impact`, `code_ownership`(CODEOWNERS 마지막 일치 우선순위), `code_workspace_graph`, `code_search`, `code_status` — 를 노출하며, 각 응답은 한 줄 답변으로 시작해 간결한 경로/심볼/시그니처 근거가 뒤따르고, 응답마다 길이를 제한하며, `code_status`가 인덱스가 오래되었다고 보고하면 경고를 앞에 붙입니다.

서버는 고정 리소스 — `project-librarian://wiki/startup`, `project-librarian://wiki/index`, `project-librarian://code/status` — 와 위키 분류 갱신, 코드 영향 추적, 검색 품질 검토용 프롬프트 템플릿도 제공합니다. 리소스 읽기는 임의 파일 경로가 아니라 고정 URI 레지스트리에서만 처리합니다.

부트스트랩은 Claude Code(`.mcp.json`), Cursor(`.cursor/mcp.json`), Gemini CLI(`.gemini/settings.json`의 `mcpServers`)에 서버를 등록하며, 기존 서버와 키를 보존하고 다시 실행하면 `exists`를 보고합니다. 저장소에 로컬 실행 경로가 있으면 `node <runner> mcp`로, 없으면 설치된 `project-librarian mcp` 바이너리로 등록합니다.

Codex는 MCP 서버를 사용자 레벨에서만 등록(`codex mcp add`)하므로 부트스트랩은 프로젝트 레벨 Codex MCP 설정을 작성하지 않습니다. Codex에서 서버를 쓰려면 머신당 한 번 실행하세요.

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## 작동 방식

1. 부트스트랩은 기존 내용 보존을 우선하는 위키 구조와 마커로 경계를 둔 에이전트 지침 섹션을 만듭니다.
2. 세션 시작 훅은 문자 예산이 적용된 `wiki/startup.md`와 `wiki/index.md`만 주입합니다.
3. 부트스트랩은 내용 없는 양식 전용 프로젝트 페이지를 만들지 않으며, 초점이 분명한 정본·결정·출처·운영 문서는 실제 내용이 있을 때 생성됩니다.
4. 상세 계획 정본은 정본·결정·출처·운영 문서에 있고 에이전트가 필요할 때 읽습니다.
5. 새 프로젝트 계획 내용은 작성하거나 취합하기 전에 `wiki/meta/document-taxonomy.md`로 분류해 상위/하위 문서 관계가 보이도록 유지합니다.
6. `--refresh-index`는 새로 발견한 위키 페이지를 라우팅하며, route가 많으면 `wiki/indexes/auto-*.md` 범위별 라우터로 분리합니다.
7. `--code-index`는 `.project-wiki/` 아래 폐기 가능한 SQLite 근거 캐시를 만듭니다.
8. `--code-report`, `--code-impact`, `--code-context-pack`, `--code-search-symbol`, `--code-query`가 계획 갱신용 코드 근거를 제공합니다.
9. 읽기 전용 위키 소비자는 공통 개념 읽기 모델을 사용해 정본 위키 스키마를 다시 쓰지 않고 경로와 frontmatter에서 사용자용 페이지 유형을 파생합니다.
10. 위키 생산자는 기존 Markdown/YAML 정본 스키마를 계속 작성하고, 진단·MCP·시각화 같은 읽기 전용 소비자는 원본 문서를 바꾸지 않는 파생 보기를 사용합니다.
11. `--wiki-visualize`는 데이터베이스나 서버를 추가하지 않고 기존 위키 그래프와 개념 읽기 모델을 재사용해 `.project-wiki/` 아래 정적 그래프 산출물을 작성합니다.
12. 진단은 깨진 링크, 중복 route, 고아 페이지, 오래된 페이지, 누락된 TL;DR, 근거 누락, 마이그레이션 정책 위반을 보고합니다.

마이그레이션은 검토를 우선합니다. `--migrate`는 기존 `wiki/`를 `wiki_legacy*`로 보존하고, 양식 전용 기존 파일은 제외한 뒤, 여러 성격의 내용이 섞인 기존 페이지를 의미 단위로 나눕니다. 이후 각 단위를 문서 분류 체계에 따라 분류해 `wiki/migration/` 아래 검토 파일을 작성합니다.

- `inventory.md`는 기존 마크다운 파일 목록과 파일 단위 분류를 기록합니다.
- `unit-map.md`는 각 제목, 문단, 목록 항목, 표 행, 코드 블록의 권장 분류 영역과 대상 페이지를 기록합니다.
- `split-plan.md`는 권장 새 위키 대상별로 의미 단위를 묶습니다. 그래서 API 명세, 기능, UX, QA, 정책, 운영 내용이 한 기존 페이지에 섞여 있어도 서로 다른 파일로 재작성할 수 있습니다.
- `coverage.md`는 각 단위의 편집 가능한 상태 장부입니다. 상태는 pending, adopted, merged, superseded, rejected, resolved, needs-human-review입니다.
- `verification.md`와 `review.md`는 `--review-migration` 후 커버리지와 의미적 완료 상태를 요약합니다.

`--migration-lint`는 `coverage.md`, `unit-map.md`, `split-plan.md`가 현재 마이그레이션 배치의 단위를 계속 빠짐없이 다루는지 검증합니다. 중복/오래된 단위 ID, 잘못된 storage/confidence/status 값, split count 불일치, target drift, 오래된 coverage 표 형식을 잡습니다. 기존 페이지 하나가 여러 대상 파일로 나뉘는 경우 `--review-migration`은 파일 단위 수신함 상태만으로 모든 단위를 완료 처리하지 않으며, 단위별 coverage가 해결되어야 합니다.

보존하거나 복사한 legacy 내용은 새 위키 정책과 구조에 맞으면 허용되며, 새 위키가 `wiki_legacy*` 참조에 의존해서는 안 됩니다.

## 언어 지원 표

이 표는 심볼/import 추출이 구현된 언어를 나열합니다. 그 외 인식되는 확장자는 목록 전용입니다. 기본 모드는 `typescript-ast`, `python-light`, `go-light`, 설정 추출, 목록 항목을 사용합니다. `--code-parser tree-sitter`는 지원되는 소스 파일을 `tree-sitter-*` 프로파일로 전환합니다.

| 언어 | 확장자 | 기본 추출 | Tree-sitter 추출 | 인덱싱되는 근거 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 함수, 클래스, 메서드, 변수, 인터페이스, 타입, enum, import, export, 호출, 일반 HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 함수, 클래스, 메서드, 변수, import, export, `require()` 호출, 일반 HTTP route |
| Python | `.py` | `python-light` | `tree-sitter-python` | 함수, 클래스, `import`, `from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | 함수, 메서드, 타입, const, var, 단일 import, import 블록 |
| Rust | `.rs` | 목록 전용 | `tree-sitter-rust` | 함수, struct, enum, trait, impl, `use` import |
| Java | `.java` | 목록 전용 | `tree-sitter-java` | 클래스, interface, enum, 메서드, import |
| PHP | `.php` | 목록 전용 | `tree-sitter-php` | 함수, 클래스, interface, trait, 메서드, namespace use |
| Kotlin | `.kt`, `.kts` | 목록 전용 | `tree-sitter-kotlin` | 함수, 클래스, object, import |
| Swift | `.swift` | 목록 전용 | `tree-sitter-swift` | 함수, 클래스, struct, protocol, enum, import |
| C | `.c`, `.h` | 목록 전용 | `tree-sitter-c` | 함수, struct, enum, include |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | 목록 전용 | `tree-sitter-cpp` | 함수, class/struct, namespace, enum, include/using |
| C# | `.cs` | 목록 전용 | `tree-sitter-csharp` | class, interface, struct, enum, 메서드, using |

인식되지만 목록 전용인 확장자에는 `.rb`, `.vue`, `.css`가 있습니다. 설정 파일(`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`, `Dockerfile`, `Makefile`)은 설정 근거 또는 목록 근거로 인덱싱됩니다.

## CLI 참조

자동화나 직접 CLI 실행에는 확인된 로컬 실행 경로를 사용합니다.

```bash
node .codex/skills/project-librarian/dist/init-project-wiki.js [init|update] [options]
node .codex/skills/project-librarian/dist/init-project-wiki.js install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all]
```

`update`는 기존 프로젝트 설정을 명시적으로 갱신하는 명령입니다. `--migrate`와 `--adopt-existing`는 함께 쓸 수 없습니다. 기존 문서나 위키를 `wiki_legacy*`로 보존하고 검토해야 할 때는 최상위 `--migrate`를 사용합니다.

중요 옵션:

| 옵션 | 용도 |
| --- | --- |
| `--migrate`, `--adopt-existing` | 기존 위키를 `wiki_legacy*`로 보존하고 마이그레이션 수신함, unit-map, split-plan, coverage 검토 파일을 만듭니다. |
| `--lint` | 파일을 수정하지 않고 생성된 설정을 검증합니다. |
| `--link-check` | 깨진 위키 링크, 중복 route, 고아 페이지, 그리고 시작 라우터가 깊이 예산 안에서 닿지 못하는 페이지를 보고합니다. |
| `--quality-check` | 오래되거나 충돌하거나 품질이 낮은 위키 문서 신호를 보고합니다. |
| `--doctor` | lint, link-check, quality-check를 함께 실행합니다. |
| `--doctor --fix` | 진단 전에 생성된 index 라우팅을 안전하게 갱신합니다. |
| `--migration-lint` | 마이그레이션 coverage, unit-map, split-plan, 검토 골격을 일반 lint와 분리해 검증합니다. |
| `--migration-quality-check` | 마이그레이션 정책/구조 신호를 일반 quality-check와 분리해 보고합니다. |
| `--migration-doctor` | migration-lint와 migration-quality-check를 함께 실행합니다. |
| `--query <terms>` | 위키 경로, 메타데이터, 제목, 본문을 검색합니다. 답변 우선 출력에 페이지별 TL;DR 줄을 붙이고 고정 크기 상한을 적용합니다. |
| `--wiki-impact <page-or-term>` | 일치하는 페이지의 위키 역링크, `decision_ref` 인용, 나가는 링크, 라우터 깊이를 보여줍니다. |
| `--wiki-visualize` | `.project-wiki/wiki-graph.html`에 독립 실행형 정적 위키 그래프 시각화를 작성합니다. |
| `--wiki-visualize-out <path>` | `--wiki-visualize`와 함께 사용해 `.project-wiki/` 아래의 사용자 지정 저장소 상대 경로에 작성합니다. |
| `--refresh-index` | 생성된 자동 발견 위키 라우팅을 갱신합니다. |
| `--capture-inbox --title <title> --content <content>` | 위키 수신함에 후보 메모를 추가합니다. |
| `--issue-draft --issue-title <title>` | 문제 또는 부작용에 대한 읽기 전용 GitHub 이슈 본문 초안을 출력합니다. |
| `--issue-create --issue-title <title>` | 명시적 사용자 승인 후 `gh`로 GitHub 이슈를 생성합니다. |
| `--glossary-init` | 선택적 용어집 페이지를 만들고 라우팅합니다. |
| `--prune-check` | 오래되거나 미해결인 수명 주기 신호가 있는 active 페이지를 보고합니다. |
| `--review-migration`, `--semantic-migrate` | 마이그레이션 coverage와 수신함 상태를 마이그레이션 검토 파일에 동기화합니다. |
| `--no-git-config` | `git core.hooksPath`를 바꾸지 않고 훅 파일을 설치합니다. |
| `--code-index` | 폐기 가능한 코드 근거 인덱스를 빌드합니다. |
| `--code-index-health` | 코드 근거 캐시 호환성을 검사하고 쓰기 없이 재빌드 안내를 출력합니다. |
| `--code-report` | 근거 인덱스에서 아키텍처/소유권 요약을 출력합니다. |
| `--code-report-section <section>` | 한 섹션만 출력: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, `edges`. |
| `--code-impact <term>` | 파일, 심볼, route, import, edge, 소유자 영향 근거를 보여줍니다. |
| `--code-context-pack <term>` | 구조적 파일, 심볼, route, import, edge, 소유권 근거를 담은 예산 제한 1차 컨텍스트 팩을 출력합니다. |
| `--code-search-symbol <term>` | 인덱싱된 심볼을 검색합니다. |
| `--code-query <sql>` | 근거 인덱스에 대해 보수적인 읽기 전용 SQL을 실행합니다. |

## 개발

소스는 TypeScript입니다. 커밋된 `dist/` 디렉터리는 npm 바이너리와 설치된 스킬 복사본이 사용하는 컴파일된 JavaScript입니다.

```bash
npm install
npm run typecheck
npm run build
npm test
npm run test:coverage
npm run benchmark:llm:raw-audit
npm run benchmark:llm:delta-analysis
npm run benchmark:claim-ledger
npm run release:check
npm pack --dry-run
```

`src/` 아래 TypeScript를 수정할 때는 커밋 전에 빌드해 `dist/`를 최신 상태로 유지하세요.

`npm run test:coverage`는 Node 내장 test coverage에 보수적인 line, branch, function threshold를 적용하므로 coverage를 단순 보고서가 아니라 회귀 게이트로 사용합니다.

`npm run release:check`는 로컬 전용 관리자 게이트입니다. 테스트, Node 내장 coverage, 벤치마크 파서 smoke, real-corpus 오프라인 데모, 벤치마크 release preview, 벤치마크 claim ledger 분류, raw 보관 상태 감사, package dry-run 검사, dist 실행 가능 여부, README 벤치마크 claim 경계 문구를 확인합니다. publish하지 않고 raw 벤치마크 산출물을 삭제하지 않으며 measured Codex 벤치마크도 실행하지 않습니다.

`release:check` 통과는 런타임 보증이 아니라 재현 가능한 릴리스 준비 근거로 봐야 합니다. 현재 checkout에서 위 로컬 게이트를 통과했음을 증명하며, package dry run이 예상 publish 경계(`agents/`, `dist/`, `LICENSE`, `README.md`, `README.ko.md`, `SKILL.md`) 안에 머물고 소스 파일, 테스트, 저장소 로컬 위키/워크플로 상태, raw 벤치마크 출력, 로컬 캐시를 제외하는지도 확인합니다.

배포는 GitHub Release가 published 상태가 된 뒤 `.github/workflows/publish.yml`에서 처리합니다. 이 워크플로는 GitHub OIDC 기반 npm trusted publishing(`id-token: write`)과 `npm publish --access public`을 사용하므로 npm provenance가 자동 생성됩니다. `NODE_AUTH_TOKEN`이나 npm token secret을 쓰면 안 되며, 릴리스 핵심 GitHub 공식 Actions는 전체 commit SHA로 고정합니다. `release:check`는 이 워크플로 계약도 로컬에서 검사합니다.

trusted publishing과 npm provenance는 패키지가 이 GitHub OIDC 워크플로를 통해 게시되었음을 증명합니다. 벤치마크 정확성, 최종 사용자 저장소의 코드 근거 freshness, 보안 감사를 증명하지는 않으며, 그런 항목은 별도의 근거 트랙으로 다룹니다.

관리자 벤치마크 명령은 [benchmarks/README.md](benchmarks/README.md)에 있습니다. 이 명령은 릴리스 근거와 공개 주장 검증을 위한 것이며, 일반 사용자 설정 절차가 아닙니다.

코드 근거 런타임/스토리지 점검에는 `npm run perf:code-efficiency`를 사용합니다. 이 명령은 3k/10k/50k 픽스처를 생성하고 `benchmarks/reports/code-performance-efficiency/current.json`과 `.md`를 작성합니다. 명령 시간에는 CLI 시작과 freshness 확인이 포함되며, `query_groups` 섹션은 대표 file/symbol/route/import/edge 쿼리의 직접 DB 시간을 따로 보고합니다. 보고서는 `mixed-monorepo`, `web-service`, `python-cli`, `docs-heavy` 체크인 corpus도 합성 scale fixture와 분리해 측정합니다.

측정형 LLM 벤치마크 실행은 1일보다 오래된 이전 raw run 디렉터리와 격리 Codex home을 자동 삭제하고, claimable 실행 실패 시에도 현재 실행의 home을 삭제한 뒤 종료합니다. raw JSONL, stderr, 보고서, manifest는 보존 기간 안의 실행에 대해서만 감사용으로 유지됩니다. 무시된 오래된 raw 출력은 격리 Codex home을 삭제하기 전에 dry-run-first 헬퍼로 여전히 먼저 감사할 수 있습니다.

```bash
npm run benchmark:llm:raw-audit -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14 --execute
```

`npm run benchmark:llm:delta-analysis`는 체크인된 measured LLM 보고서를 읽고 Codex를 실행하지 않은 채 cost-weighted regression을 순위화합니다. 대표 raw JSONL command trace와 broad-search/router-read driver 분류까지 보려면 `-- --include-traces`를 붙입니다. 작은 scale aggregation처럼 약한 셀을 새 공개 claim보다 먼저 진단하는 첫 경로입니다.

측정형 LLM 실행은 기본적으로 `--scenario-order run-major-balanced`를 사용합니다. 각 measured run index마다 선택된 모든 scenario를 실행하고 반복마다 순서를 뒤집어, 반복 실행에서 with/without 조건이 한쪽으로 몰리지 않게 합니다. 이전의 scenario별 묶음 실행 진단을 재현할 때만 `--scenario-order scenario-major`를 사용하세요.

`npm run typecheck:ts7`은 opt-in TypeScript 7 RC 호환성 probe입니다. `npx`를 사용하며, compiler API와 이 프로젝트 TypeScript extractor의 parity 기록이 생기기 전까지 `test`, `release:check`, CI 게이트 밖에 둡니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다. 긴 대화 기록에서 프로젝트 상태를 재구성하는 대신, 지속되는 markdown 컨텍스트를 작업 가까이에 둡니다.

Project Librarian은 그 아이디어를 저장소 로컬 지침, 간결한 시작 훅, 마이그레이션 도구, 진단, 선택적 코드 근거를 갖춘 Codex, Claude Code, Cursor, Gemini CLI용 설치형 CLI 및 스킬로 구현합니다.

## 라이선스

MIT
