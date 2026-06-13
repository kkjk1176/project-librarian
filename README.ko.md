# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![코드 근거 인덱스](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

**모든 AI 코딩 에이전트에게 프로젝트에 대한 같은 지속 기억을 주세요.** Project Librarian은 저장소 안에 두는 간결한 계획 위키와 선택적 코드 근거 인덱스를 유지합니다. Codex, Claude Code, Cursor, Gemini CLI가 세션을 시작할 때 이걸 읽으므로, 매번 코드베이스를 처음부터 다시 파악하지 않아도 됩니다.

언어: [English](README.md) | [한국어](README.ko.md)

## 핵심 강점

- **첫 읽기를 작게.** 세션 시작 훅은 `wiki/startup.md`와 `wiki/index.md`만 주입하고, 에이전트는 저장소 전체를 처음부터 훑는 대신 필요할 때 더 깊은 페이지로 이동합니다.
- **한 번 설정, 네 에이전트.** Codex, Claude Code, Cursor, Gemini CLI가 같은 위키 우선 계약과 훅, 규칙을 공유합니다.
- **막연한 표현이 아니라 측정값.** 모든 성능 주장은 격리된 Codex 벤치마크에서 나오며, 손해를 본 경우도 이긴 경우 바로 옆에 공개합니다.
- **선택적 코드 근거.** 재생성 가능한 SQLite 인덱스와 답변 형태 MCP 도구가 영향·소유권·워크스페이스 그래프 질문에 답하며, 추가 런타임 의존성이 전혀 없습니다.
- **다시 실행해도 안전.** 부트스트랩은 멱등하고 기존 내용 보존을 우선하며, 진단은 깨진 경로·도달 불가 페이지·오래된 사실을 에이전트가 오해하기 전에 잡아냅니다.

## 존재 이유

LLM 코딩 에이전트는 매 세션마다 프로젝트를 처음부터 다시 파악하느라 컨텍스트와 도구 호출을 낭비합니다. 오래된 대화를 읽고, 문서를 훑고, 소스를 검색하고, 어떤 파일이 중요한지 추측하는 일이 반복됩니다.

Project Librarian은 에이전트에게 두 가지 로컬 정본을 제공합니다.

| 표면 | 에이전트가 얻는 것 |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 짧은 세션 시작 요약과 라우터. 관련 계획 페이지만 읽습니다. |
| `wiki/canonical/` 및 `wiki/decisions/` | 현재 프로젝트 사실, 제약, 리스크, 패키지 계약, CLI 동작, 지속되는 결정. |
| `.codex/`, `.claude/`, `.cursor/`, `.gemini/` 훅 | 전체 위키를 불러오지 않는 Codex/Claude Code/Cursor/Gemini CLI 시작 컨텍스트. |
| `GEMINI.md` 및 `.cursor/rules/` | Gemini CLI와 Cursor를 같은 간결한 위키 우선 계약으로 안내하는 지침 파일. |
| `.project-wiki/code-evidence.sqlite` | 파일, 심볼, import, route, 소유권, 워크스페이스 그래프, 보고서, 영향 확인을 위한 재생성 가능한 코드 근거. |
| 진단 및 마이그레이션 모드 | 링크 확인, 품질 확인, 마이그레이션 수신함, 오래된 신호 보고, 작업 흐름에서 문제가 드러날 때의 이슈 초안. |

핵심은 “문서를 더 많이 쓰자”가 아닙니다. 첫 에이전트 읽기량을 작게 유지하고, 더 깊은 프로젝트 정본과 코드 근거로 가는 신뢰 가능한 경로를 제공하는 것입니다.

## 벤치마크 결과

여기 수치는 마케팅이 아니라 관리자 릴리스 근거입니다. 모든 값은 실제 Codex JSONL 사용량과 로컬 실행 시간(ChatGPT/Codex 인증, `gpt-5.5`)이며, 격리된(hermetic) 환경 — 독립 Codex home, 허용 목록 전용 환경 변수, 정결한 작업 트리, 실행 후 픽스처 검증 — 에서 시나리오당 측정 3회와 예열 1회로, Project Librarian이 없는 `organic` 대조군과 비교했습니다.

아래 표에서 **“적음” / “많음”** 은 대조군 대비 비용 가중 토큰을, **“빠름” / “느림”** 은 실행 시간을 비교한 것입니다. (비용 가중 = uncached input + 0.1 × cached input + output + reasoning output. 캐시된 재전송은 정가가 아니므로 할인하며, 단순 합산 총량은 턴을 추가하는 도구를 부당하게 불리하게 만들기 때문입니다.) wiki 라우팅 트랙과 code-graph 트랙은 분리해 측정·보고하며, 한 트랙의 우위가 다른 트랙의 주장을 뒷받침하지 않습니다. 이전 2026-06-10 1회 실행 보고서는 이 격리 측정으로 대체되었습니다.

### Wiki 트랙 (계획 문서 라우팅)

보고서: `benchmarks/reports/llm/stage1-organic.*`, `stage1-large-retry.*` (2026-06-11). 비용 가중 토큰, Project Librarian 대 대조군:

| 규모 | decision_lookup | aggregation | multi_session (2번째 세션) |
| --- | --- | --- | --- |
| 소형 | 7.9% 적음 | 7.0% 많음 | 30.4% 적음 |
| 중형 | 69.5% 적음 | 8.8% 많음 | 56.6% 적음 |
| 대형 (게이트 통과 재시도) | 62.6% 적음 | 45.0% 적음* | 70.7% 적음 |

주장 등급 셀(주장 게이트 통과, 전 실행 정확)은 대형의 두 승리입니다: `decision_lookup`(비용 가중 토큰 62.6% 적음, 41.5% 빠름)과 `multi_session`(토큰 70.7% 적음, 33.9% 빠름). 숨기지 않고 함께 공개하는 한계: `aggregation`은 소형/중형에서 토큰을 7~9% *더* 쓰고, 위키를 켜면 토큰이 줄어드는 규모에서도 매 규모 *더 느리며*, *대형 aggregation 수치(45.0% 적음)는 대조군 측 정확성 불안정으로 게이트가 실패한 Stage 1 실행에서 나온 값이라 주장이 아니라 조사 근거로 남습니다.

### Code-graph 트랙 (코드 근거 인덱스)

보고서: `benchmarks/reports/llm/stage2d-codegraph.*` (2026-06-11, 주장 게이트 18/18 통과). 대표성을 심화한 픽스처(규모 비례 CODEOWNERS 20/80/250 규칙과 우선순위 사례, 다중 홉 의존 체인, 순회가 필요한 질문)에서, 제품의 작업 형태 명령(`--code-impact`, `--code-report` 섹션)을 노출한 채 측정했습니다.

| 규모 | impact_trace | ownership_lookup | workspace_graph |
| --- | --- | --- | --- |
| 소형 | 101% 많음 | 47% 많음 | 79% 많음 |
| 중형 | 29% 많음 | 64% 많음 | 5% 적음 |
| 대형 | 217% 많음 | 87% 많음 | 49% 많음 |

이것은 오버헤드이고, 그대로 밝힙니다. 게이트를 통과한 세 변형(구조 심화, 평가기 수정, 작업 형태 인터페이스)에서 재현되었으므로 **code-graph 성능 주장은 하지 않습니다.** 이 픽스처 규모에서는 대조군이 다중 홉 구조 질문을 3~9개의 표적 grep으로 답하고, 도구 상호작용(탐색, 호출, 출력 검증)은 절감보다 비용이 큽니다.

#### 실제 저장소 코퍼스 (주장 게이트 통과)

보고서: `benchmarks/reports/llm/stageR1-real.*`, `stageR1-real-rescored.*` (2026-06-12, 평가기 거짓 양성 2건을 고치고 원시 JSONL에서 재채점해 30/30 정확으로 게이트 통과 — 원본 보존, 원시 재계산은 상시 감사 정책). SHA 고정 excalidraw(~1.2k 파일)와 backstage(~11.8k 파일), 손으로 작성한 정답 키, 격리된 Codex home에 주입한 답변 형태 MCP 도구.

| 질문 | excalidraw (~1.2k 파일) | backstage (~11.8k 파일) |
| --- | --- | --- |
| impact_trace | 117% 많음 | **27.7% 적음** |
| workspace_graph | 106% 많음 | 2.6% 적음 |
| ownership_lookup | — | 99% 많음 |

주장은 규모 교차점입니다. 11.8k 파일 저장소에서는 비싼 순회 질문에서 도구가 이기고(impact_trace 비용 가중 토큰 27.7% 적음, 스캔 바이트 24.5% 적음) 워크스페이스 그래프는 손익분기인 반면, 소형 저장소에서는 전부 지고 저렴한 조회(CODEOWNERS 소유권)는 모든 측정 규모에서 집니다. 지는 셀도 이기는 셀과 함께 공개합니다. 이 경계가 곧 CLI의 규모 인지 게이트가 구현한 내용입니다: 인덱싱 대상 파일 약 5k개 미만에서는 `--code-index`가 명시적 동의를 요구하고 부트스트랩은 MCP 자동 등록을 건너뛰며, 이 측정값을 근거로 제시합니다.

## 설치

초기 스킬 설치에만 `npx`를 사용합니다.

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

`--agents`는 `codex,claude,cursor,gemini`처럼 쉼표로 구분한 값도 받습니다. `all`은 지원하는 모든 에이전트를 대상으로 하며, `both`는 Codex/Claude 호환용 별칭입니다. `--scope`는 `user` 또는 `project`를 받습니다.

## 에이전트 실행 경로

설치 후 에이전트는 `npx`가 아니라 설치된 로컬 복사본을 `node`로 실행해야 합니다. 이렇게 하면 제한된 에이전트 환경에서 네트워크 접근과 버전이 고정되지 않은 패키지 실행을 피할 수 있습니다.

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

아래 예시는 다음 실행 경로를 사용합니다.

```bash
PROJECT_LIBRARIAN="node .codex/skills/project-librarian/dist/init-project-wiki.js"
```

설치 위치에 맞는 로컬 실행 경로를 사용하세요.

## 일반 에이전트 작업 흐름

프로젝트 루트에서 위키를 만들거나 갱신합니다.

```bash
$PROJECT_LIBRARIAN
```

위키 검증과 유지보수:

| 목적 | 에이전트 명령 |
| --- | --- |
| 위키 생성 또는 갱신 | `$PROJECT_LIBRARIAN` |
| 기존 문서/위키 마이그레이션 | `$PROJECT_LIBRARIAN --migrate` |
| 생성된 설정 검증 | `$PROJECT_LIBRARIAN --lint` |
| 링크와 문서 품질 점검 | `$PROJECT_LIBRARIAN --doctor` |
| 진단 전에 생성된 라우팅 갱신 | `$PROJECT_LIBRARIAN --doctor --fix` |
| 위키 내용 검색 | `$PROJECT_LIBRARIAN --query "authentication decisions"` |
| 페이지의 위키 역링크/decision_ref 인용 확인 | `$PROJECT_LIBRARIAN --wiki-impact "decisions/release-policy"` |
| 후보 메모 저장 | `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate" --content "Details"` |
| 오래되었거나 미해결인 위키 페이지 보고 | `$PROJECT_LIBRARIAN --prune-check` |
| git 설정 변경 없이 훅 파일 설치 | `$PROJECT_LIBRARIAN --no-git-config` |

코드 근거 빌드 및 확인:

| 목적 | 에이전트 명령 |
| --- | --- |
| 기본 근거 캐시 생성 | `$PROJECT_LIBRARIAN --code-index --code-scope src` |
| 여러 범위 빌드 | `$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api` |
| 증분 갱신 요구 | `$PROJECT_LIBRARIAN --code-index --incremental` |
| 전체 재생성 강제 | `$PROJECT_LIBRARIAN --code-index --code-index-full` |
| 선택적 Tree-sitter 백엔드 사용 | `$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter` |
| 캐시 상태 보기 | `$PROJECT_LIBRARIAN --code-status` |
| 인덱싱된 파일 목록 | `$PROJECT_LIBRARIAN --code-files` |
| 아키텍처/소유권 보고서 출력 | `$PROJECT_LIBRARIAN --code-report` |
| 보고서 섹션 하나만 출력 | `$PROJECT_LIBRARIAN --code-report --code-report-section routes` |
| 영향 근거 확인 | `$PROJECT_LIBRARIAN --code-impact healthHandler` |
| 인덱싱된 심볼 검색 | `$PROJECT_LIBRARIAN --code-search-symbol Auth` |
| 보수적인 읽기 전용 SQL 실행 | `$PROJECT_LIBRARIAN --code-query "select path from files order by path"` |

코드 근거 모드는 한 번에 하나만 실행할 수 있습니다. `--incremental`, `--code-index-full`, `--code-parser`는 `--code-index`와 함께 쓸 때만 유효합니다.

## 설치되는 파일

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

MCP 서버 등록 (`mcpServers`에 기존 항목 보존하며 병합):

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.gemini/settings.json`의 `mcpServers` (Gemini CLI)

폐기 가능한 코드 근거 캐시:

- `.project-wiki/code-evidence.sqlite`

## 코드 근거 MCP 서버

`project-librarian mcp`는 직접 구현한 stdio MCP 서버(줄바꿈 구분 JSON 위의 JSON-RPC 2.0, 추가 런타임 의존성 없음)를 실행해 기존 `.project-wiki` 코드 근거 인덱스를 읽기 전용으로 제공합니다. 답변 형태 도구 — `code_impact`, `code_ownership`(CODEOWNERS 마지막 일치 우선순위), `code_workspace_graph`, `code_search`, `code_status` — 를 노출하며, 각 응답은 한 줄 답변으로 시작해 간결한 경로/심볼/시그니처 근거가 뒤따르고, 응답마다 길이를 제한하며, `code_status`가 인덱스가 오래되었다고 보고하면 경고를 앞에 붙입니다.

부트스트랩은 Claude Code(`.mcp.json`), Cursor(`.cursor/mcp.json`), Gemini CLI(`.gemini/settings.json`의 `mcpServers`)에 서버를 등록하며, 기존 서버와 키를 보존하고 다시 실행하면 `exists`를 보고합니다. 저장소에 로컬 실행 경로가 있으면 `node <runner> mcp`로, 없으면 설치된 `project-librarian mcp` 바이너리로 등록합니다.

Codex는 MCP 서버를 사용자 레벨에서만 등록(`codex mcp add`)하므로 부트스트랩은 프로젝트 레벨 Codex MCP 설정을 작성하지 않습니다. Codex에서 서버를 쓰려면 머신당 한 번 실행하세요.

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## 작동 방식

1. 부트스트랩은 기존 내용 보존을 우선하는 위키 구조와 마커로 경계를 둔 에이전트 지침 섹션을 만듭니다.
2. 세션 시작 훅은 문자 예산이 적용된 `wiki/startup.md`와 `wiki/index.md`만 주입합니다.
3. 상세 계획 정본은 canonical, decision, source, meta 페이지에 있고 에이전트가 필요할 때 읽습니다.
4. `--refresh-index`는 새로 발견한 위키 페이지를 라우팅하며, route가 많으면 `wiki/indexes/auto-*.md` 범위별 라우터로 분리합니다.
5. `--code-index`는 `.project-wiki/` 아래 폐기 가능한 SQLite 근거 캐시를 만듭니다.
6. `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`가 계획 갱신용 코드 근거를 제공합니다.
7. 진단은 깨진 링크, 중복 route, 고아 페이지, 오래된 페이지, 누락된 TL;DR, 근거 누락, 마이그레이션 정책 위반을 보고합니다.

마이그레이션은 검토를 우선합니다. `--migrate`는 기존 `wiki/`를 `wiki_legacy*`로 보존하고 마이그레이션 수신함과 단위별 커버리지 장부를 작성하며, legacy 의미를 현재 위키 규칙에 맞게 재구성합니다. 보존하거나 복사한 legacy 내용은 새 위키 정책과 구조에 맞으면 허용되며, 새 위키가 `wiki_legacy*` 참조에 의존해서는 안 됩니다.

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

에이전트 실행에는 로컬 실행 경로를 사용합니다.

```bash
$PROJECT_LIBRARIAN [init] [options]
$PROJECT_LIBRARIAN install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]
```

중요 옵션:

| 옵션 | 용도 |
| --- | --- |
| `--migrate`, `--adopt-existing` | 기존 위키를 `wiki_legacy*`로 보존하고 마이그레이션 수신함을 만듭니다. |
| `--lint` | 파일을 수정하지 않고 생성된 설정을 검증합니다. |
| `--link-check` | 깨진 위키 링크, 중복 route, 고아 페이지, 그리고 시작 라우터가 깊이 예산 안에서 닿지 못하는 페이지를 보고합니다. |
| `--quality-check` | 오래되거나 충돌하거나 품질이 낮은 위키 문서 신호를 보고합니다. |
| `--doctor` | lint, link-check, quality-check를 함께 실행합니다. |
| `--doctor --fix` | 진단 전에 생성된 index 라우팅을 안전하게 갱신합니다. |
| `--migration-lint` | 마이그레이션 검토 골격을 일반 lint와 분리해 검증합니다. |
| `--migration-quality-check` | 마이그레이션 정책/구조 신호를 일반 quality-check와 분리해 보고합니다. |
| `--migration-doctor` | migration-lint와 migration-quality-check를 함께 실행합니다. |
| `--query <terms>` | 위키 경로, 메타데이터, 제목, 본문을 검색합니다. 답변 우선 출력에 페이지별 TL;DR 줄을 붙이고 고정 크기 상한을 적용합니다. |
| `--wiki-impact <page-or-term>` | 일치하는 페이지의 위키 역링크, `decision_ref` 인용, 나가는 링크, 라우터 깊이를 보여줍니다. |
| `--refresh-index` | 생성된 자동 발견 위키 라우팅을 갱신합니다. |
| `--capture-inbox --title <title> --content <content>` | 위키 수신함에 후보 메모를 추가합니다. |
| `--issue-draft --issue-title <title>` | 문제 또는 부작용에 대한 읽기 전용 GitHub 이슈 본문 초안을 출력합니다. |
| `--issue-create --issue-title <title>` | 명시적 사용자 승인 후 `gh`로 GitHub 이슈를 생성합니다. |
| `--glossary-init` | 선택적 용어집 페이지를 만들고 라우팅합니다. |
| `--prune-check` | 오래되거나 미해결인 수명 주기 신호가 있는 active 페이지를 보고합니다. |
| `--review-migration`, `--semantic-migrate` | 마이그레이션 수신함 상태를 마이그레이션 검토 파일에 동기화합니다. |
| `--no-git-config` | `git core.hooksPath`를 바꾸지 않고 훅 파일을 설치합니다. |
| `--code-index` | 폐기 가능한 코드 근거 인덱스를 빌드합니다. |
| `--code-report` | 근거 인덱스에서 아키텍처/소유권 요약을 출력합니다. |
| `--code-report-section <section>` | 한 섹션만 출력: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, `edges`. |
| `--code-impact <term>` | 파일, 심볼, route, import, edge, 소유자 영향 근거를 보여줍니다. |
| `--code-search-symbol <term>` | 인덱싱된 심볼을 검색합니다. |
| `--code-query <sql>` | 근거 인덱스에 대해 보수적인 읽기 전용 SQL을 실행합니다. |

## 개발

소스는 TypeScript입니다. 커밋된 `dist/` 디렉터리는 npm 바이너리와 설치된 스킬 복사본이 사용하는 컴파일된 JavaScript입니다.

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 아래 TypeScript를 수정할 때는 커밋 전에 빌드해 `dist/`를 최신 상태로 유지하세요.

관리자 벤치마크 명령은 [benchmarks/README.md](benchmarks/README.md)에 있습니다. 이 명령은 릴리스 근거와 공개 주장 검증을 위한 것이며, 일반 사용자 설정 절차가 아닙니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다. 긴 대화 기록에서 프로젝트 상태를 재구성하는 대신, 지속되는 markdown 컨텍스트를 작업 가까이에 둡니다.

Project Librarian은 그 아이디어를 저장소 로컬 지침, 간결한 시작 훅, 마이그레이션 도구, 진단, 선택적 코드 근거를 갖춘 Codex, Claude Code, Cursor, Gemini CLI용 설치형 CLI 및 스킬로 구현합니다.

## 라이선스

MIT
