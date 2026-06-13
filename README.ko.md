# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![코드 근거 인덱스](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

Codex, Claude Code, Cursor, Gemini CLI를 위한 간결한 프로젝트 메모리와 코드 근거.

Project Librarian은 저장소 로컬 계획 위키, 간결한 시작 훅, 선택적 SQLite 코드 근거 인덱스를 생성합니다. 에이전트는 프로젝트 계획에서 시작하고, 필요한 문서로 라우팅하며, 전체 저장소를 반복 스캔하지 않고 코드로 뒷받침되는 근거를 확인할 수 있습니다.

언어: [English](README.md) | [한국어](README.ko.md)

## 존재 이유

LLM 코딩 에이전트는 매 세션마다 프로젝트를 다시 발견하느라 컨텍스트와 도구 호출을 낭비합니다. 오래된 대화 읽기, Markdown 스캔, 소스 검색, 관련 파일 추측이 반복됩니다.

Project Librarian은 에이전트에게 두 가지 로컬 정본을 제공합니다.

| 표면 | 에이전트가 얻는 것 |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 짧은 세션 시작 요약과 라우터. 필요한 계획 페이지만 읽습니다. |
| `wiki/canonical/` 및 `wiki/decisions/` | 현재 프로젝트 사실, 제약, 리스크, 패키지 계약, CLI 동작, 지속되는 결정. |
| `.codex/`, `.claude/`, `.cursor/`, `.gemini/` 훅 | 전체 위키를 로드하지 않는 Codex/Claude Code/Cursor/Gemini CLI 시작 컨텍스트. |
| `GEMINI.md` 및 `.cursor/rules/` | Gemini CLI와 Cursor가 같은 compact wiki-first 계약으로 진입하게 하는 instruction 파일. |
| `.project-wiki/code-evidence.sqlite` | 파일, 심볼, import, route, 소유권, 작업공간 그래프, 보고서, 영향 확인을 위한 재생성 가능한 코드 근거. |
| 진단 및 마이그레이션 모드 | 링크 확인, 품질 확인, 마이그레이션 수신함, 오래된 신호 보고서, 작업 흐름 문제 발견 시 이슈 초안. |

핵심은 “문서를 더 많이 쓰자”가 아닙니다. 첫 에이전트 읽기량을 작게 유지하고, 더 깊은 프로젝트 정본과 코드 근거로 가는 신뢰 가능한 경로를 제공하는 것입니다.

## 벤치마크 결과

벤치마크는 관리자 릴리스 근거이며 공개 사용자 작업 흐름이 아닙니다. README와 릴리스 노트가 모호한 성능 표현 대신 경계가 있는 숫자로 가치를 설명할 수 있게 하기 위해 존재합니다. 모든 값은 실제 Codex JSONL usage와 로컬 wall-clock 측정값(ChatGPT/Codex 인증, `gpt-5.5`)이며, hermetic 환경(격리된 Codex home, allowlist 전용 env, clean tree, post-run fixture 검증)에서 시나리오당 측정 3회 + 예열 1회로, `organic` no-Project-Librarian control과 비교해 측정했습니다. 음수 delta는 Project Librarian 조건이 control보다 적게 들었다는 뜻입니다.

헤드라인 지표는 cost-weighted tokens(uncached input + 0.1 × cached input + output + reasoning output)입니다. 캐시된 재전송은 정가가 아니므로 할인되며, 단순 합산 total은 턴을 추가하는 도구를 구조적으로 불리하게 만들기 때문입니다. wiki 라우팅 트랙과 code-graph(코드 근거) 트랙은 분리해서 측정·보고하며, 한 트랙의 승리가 다른 트랙의 주장을 뒷받침하지 않습니다. 이전 2026-06-10 1회 실행 보고서(`current-local.*`)는 이 hermetic 측정으로 대체되었습니다.

### Wiki 트랙 (계획 문서 라우팅)

보고서: `benchmarks/reports/llm/stage1-organic.*`, `benchmarks/reports/llm/stage1-large-retry.*` (2026-06-11). Project Librarian 사용 vs 미사용 cost-weighted delta:

| 규모 | decision_lookup | aggregation | multi_session (2번째 세션) |
| --- | ---: | ---: | ---: |
| 소형 | -7.9% | +7.0% | -30.4% |
| 중형 | -69.5% | +8.8% | -56.6% |
| 대형 (gate 통과 retry) | -62.6% | -45.0%* | -70.7% |

Claim-grade 셀(claim gate 통과, 모든 실행 correctness 통과): 대형 `decision_lookup`(-62.6% cost-weighted, wall time -41.5%)과 대형 `multi_session`(-70.7% cost-weighted, wall time -33.9%). 주장과 함께 공개하는 경계: `aggregation` 소형/중형은 공개된 손실(+7~9%)이고, aggregation wall time은 토큰이 줄어드는 규모에서도 위키 사용 시 매 규모 더 길며, *대형 aggregation(-45.0%)은 트랙 gate가 control 측 correctness flake로 실패한 Stage 1 실행에서 나온 값이라 주장이 아니라 조사 근거로 남습니다.

### Code-graph 트랙 (코드 근거 인덱스)

보고서: `benchmarks/reports/llm/stage2d-codegraph.*` (2026-06-11, claim gate 18/18 통과) — 대표성을 심화한 fixture(규모 비례 CODEOWNERS 20/80/250 규칙 + 우선순위 케이스, 다중 홉 의존 체인, 순회가 필요한 질문)에서, 제품의 task-shaped 명령(`--code-impact`, `--code-report` 섹션)을 광고하는 fixture로 측정. cost-weighted delta:

| 규모 | impact_trace | ownership_lookup | workspace_graph |
| --- | ---: | ---: | ---: |
| 소형 | +101% | +47% | +79% |
| 중형 | +29% | +64% | -5% |
| 대형 | +217% | +87% | +49% |

이 오버헤드는 gate를 통과한 세 가지 변형(구조 심화, evaluator 수정, task-shaped 인터페이스)에서 재현되었으므로 code-graph 성능 주장은 하지 않으며, losing-scenarios 정책에 따라 측정된 경계로 공개합니다. control은 다중 홉 구조 질문을 3~9개의 표적 grep으로 답하는 반면, 도구 상호작용(탐색, 호출, 출력 검증)은 이 fixture 규모에서 절감보다 비용이 큽니다.

#### 실제 저장소 코퍼스 (claim gate 통과)

보고서: `benchmarks/reports/llm/stageR1-real.*`, `stageR1-real-rescored.*` (2026-06-12, evaluator false positive 2건 수정 후 raw JSONL에서 재채점하여 30/30 correctness로 claim gate 통과 — 원본은 보존, raw 재계산은 상시 감사 정책). SHA 고정 excalidraw(~1.2k 파일)와 backstage(~11.8k 파일), 손으로 작성한 정답 키, hermetic Codex home에 주입한 answer-shaped MCP 도구. cost-weighted delta:

| 질문 | excalidraw (~1.2k 파일) | backstage (~11.8k 파일) |
| --- | ---: | ---: |
| impact_trace | +117% | **-27.7%** |
| workspace_graph | +106% | -2.6% |
| ownership_lookup | — | +99% |

주장은 scale crossover입니다. 11.8k 파일 저장소에서는 비싼 순회 질문에서 도구가 이기고(impact_trace -27.7% cost-weighted, scan bytes -24.5%) workspace graph는 손익분기인 반면, 소형 저장소에서는 전부 지고 저렴한 lookup(CODEOWNERS ownership)은 모든 측정 규모에서 집니다 — 지는 셀을 이기는 셀과 함께 공개합니다. 이 경계가 곧 CLI의 scale-aware gate가 인코딩한 내용입니다: 인덱싱 대상 파일 약 5k개 미만에서는 `--code-index`가 명시적 승인을 요구하고 bootstrap은 MCP 자동 등록을 건너뛰며, 이 측정값을 근거로 제시합니다.

## 설치

초기 skill 설치에만 `npx`를 사용합니다.

```bash
npx project-librarian install-skill --scope user --agents all
```

현재 저장소에 설치:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill`은 재사용 가능한 skill 파일만 복사합니다. `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, `.claude/settings.json`은 만들거나 갱신하지 않습니다.

| 상황 | 명령 |
| --- | --- |
| 지원하는 모든 agent에 전역 설치 | `npx project-librarian install-skill --scope user --agents all` |
| 현재 저장소에 설치 | `npx project-librarian install-skill --scope project --agents all` |
| Codex만 설치 | `npx project-librarian install-skill --agents codex` |
| Claude Code만 설치 | `npx project-librarian install-skill --agents claude` |
| Cursor만 설치 | `npx project-librarian install-skill --agents cursor` |
| Gemini CLI만 설치 | `npx project-librarian install-skill --agents gemini` |
| 설치 결과 미리 보기 | `npx project-librarian install-skill --scope project --agents all --dry-run` |

`--agents`는 `codex,claude,cursor,gemini` 같은 comma-separated 값도 받습니다. `all`은 지원하는 모든 agent를 대상으로 하며, `both`는 Codex/Claude 호환 alias입니다. `--scope`는 `user` 또는 `project`를 받습니다.

## 에이전트 실행 경로

설치 후 에이전트는 `npx`가 아니라 설치된 로컬 복사본을 `node`로 실행해야 합니다. 이렇게 하면 제한된 에이전트 환경에서 네트워크 접근과 고정되지 않은 패키지 실행을 피할 수 있습니다.

| 설치 위치 | 실행 경로 |
| --- | --- |
| 프로젝트 범위 Codex skill | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Claude skill | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Cursor skill | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 프로젝트 범위 Gemini skill | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Codex skill | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Claude skill | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Cursor skill | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 사용자 범위 Gemini skill | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

아래 예시는 다음 runner를 사용합니다.

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
| wiki 생성 또는 갱신 | `$PROJECT_LIBRARIAN` |
| 기존 docs/wiki 마이그레이션 | `$PROJECT_LIBRARIAN --migrate` |
| 생성된 설정 검증 | `$PROJECT_LIBRARIAN --lint` |
| 링크와 문서 품질 점검 | `$PROJECT_LIBRARIAN --doctor` |
| 진단 전에 생성된 라우팅 갱신 | `$PROJECT_LIBRARIAN --doctor --fix` |
| project wiki 검색 | `$PROJECT_LIBRARIAN --query "authentication decisions"` |
| 페이지의 wiki 역링크/decision_ref 인용 확인 | `$PROJECT_LIBRARIAN --wiki-impact "decisions/release-policy"` |
| 후보 메모 저장 | `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate" --content "Details"` |
| 오래되었거나 미해결인 위키 페이지 보고 | `$PROJECT_LIBRARIAN --prune-check` |
| git config 변경 없이 훅 파일 설치 | `$PROJECT_LIBRARIAN --no-git-config` |

코드 근거 빌드 및 확인:

| 목적 | 에이전트 명령 |
| --- | --- |
| 기본 근거 캐시 생성 | `$PROJECT_LIBRARIAN --code-index --code-scope src` |
| 여러 범위 빌드 | `$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api` |
| 증분 갱신 요구 | `$PROJECT_LIBRARIAN --code-index --incremental` |
| 전체 재생성 강제 | `$PROJECT_LIBRARIAN --code-index --code-index-full` |
| 선택적 Tree-sitter backend 사용 | `$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter` |
| 캐시 상태 보기 | `$PROJECT_LIBRARIAN --code-status` |
| 인덱싱된 파일 목록 | `$PROJECT_LIBRARIAN --code-files` |
| 아키텍처/소유권 보고서 출력 | `$PROJECT_LIBRARIAN --code-report` |
| 보고서 섹션 하나만 출력 | `$PROJECT_LIBRARIAN --code-report --code-report-section routes` |
| 영향 근거 확인 | `$PROJECT_LIBRARIAN --code-impact healthHandler` |
| 인덱싱된 심볼 검색 | `$PROJECT_LIBRARIAN --code-search-symbol Auth` |
| 보수적인 읽기 전용 SQL 실행 | `$PROJECT_LIBRARIAN --code-query "select path from files order by path"` |

코드 근거 모드는 한 번에 하나만 실행할 수 있습니다. `--incremental`, `--code-index-full`, `--code-parser`는 `--code-index`와 함께 쓸 때만 유효합니다.

## 설치되는 파일

프로젝트 instruction 파일:

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

MCP 서버 등록 (`mcpServers`에 보존 우선 병합):

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.gemini/settings.json`의 `mcpServers` (Gemini CLI)

폐기 가능한 코드 근거 캐시:

- `.project-wiki/code-evidence.sqlite`

## 코드 근거 MCP 서버

`project-librarian mcp`는 직접 구현한 stdio MCP 서버(newline-delimited JSON 위 JSON-RPC 2.0, 추가 런타임 의존성 없음)를 실행하여 기존 `.project-wiki` 코드 근거 인덱스를 읽기 전용으로 제공합니다. answer-shaped 도구 — `code_impact`, `code_ownership`(CODEOWNERS last-match 우선순위), `code_workspace_graph`, `code_search`, `code_status` — 를 노출하며, 각 응답은 한 줄 답변으로 시작하고 간결한 경로/심볼/시그니처 근거가 뒤따르며, 응답마다 길이를 제한하고, `code_status`가 인덱스 staleness를 보고하면 경고를 앞에 붙입니다.

Bootstrap은 Claude Code(`.mcp.json`), Cursor(`.cursor/mcp.json`), Gemini CLI(`.gemini/settings.json`의 `mcpServers`)에 서버를 등록하며, 기존 서버와 키를 보존하고 재실행 시 `exists`를 보고합니다. 저장소에 로컬 runner가 있으면 `node <runner> mcp`로, 없으면 설치된 `project-librarian mcp` 바이너리로 등록합니다.

Codex는 MCP 서버를 사용자 레벨에서만 등록(`codex mcp add`)하므로 bootstrap은 프로젝트 레벨 Codex MCP 설정을 작성하지 않습니다. Codex에서 서버를 쓰려면 머신당 한 번 실행하세요.

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## 작동 방식

1. Bootstrap은 보존 우선 위키 구조와 marker로 경계가 정해진 에이전트 지시 섹션을 만듭니다.
2. 세션 시작 훅은 문자 예산이 적용된 `wiki/startup.md`와 `wiki/index.md`만 주입합니다.
3. 상세 계획 정본은 canonical, decision, source, meta page에 있고 에이전트가 필요할 때 읽습니다.
4. `--refresh-index`는 새로 발견한 위키 페이지를 라우팅하며, route가 많으면 `wiki/indexes/auto-*.md` 범위별 라우터로 분리합니다.
5. `--code-index`는 `.project-wiki/` 아래 폐기 가능한 SQLite 근거 캐시를 만듭니다.
6. `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`가 계획 갱신용 코드 근거를 제공합니다.
7. 진단은 깨진 링크, 중복 route, orphan page, 오래된 페이지, 누락된 TL;DR, 근거 gap, 마이그레이션 정책 위반을 보고합니다.

마이그레이션은 검토 우선입니다. `--migrate`는 기존 `wiki/`를 `wiki_legacy*`로 보존하고 마이그레이션 inbox와 unit-level coverage ledger를 작성하며, legacy 의미를 현재 wiki 규칙에 맞게 재구성합니다. 보존하거나 복사한 legacy 내용은 새 wiki 정책과 구조에 맞으면 허용되며, 새 wiki가 `wiki_legacy*` 참조에 의존하면 안 됩니다.

## 언어 지원 표

이 표는 심볼/import 추출이 구현된 언어를 나열합니다. 그 외 인식되는 확장자는 목록 전용입니다. 기본 모드는 `typescript-ast`, `python-light`, `go-light`, 설정 추출, 목록 row를 사용합니다. `--code-parser tree-sitter`는 지원되는 소스 파일을 `tree-sitter-*` 프로파일로 전환합니다.

| 언어 | 확장자 | 기본 추출 | Tree-sitter 추출 | 인덱싱되는 근거 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 함수, 클래스, 메서드, 변수, 인터페이스, 타입, enum, import, export, 호출, 일반 HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 함수, 클래스, 메서드, 변수, import, export, `require()` 호출, 호출, 일반 HTTP route |
| Python | `.py` | `python-light` | `tree-sitter-python` | 함수, 클래스, `import`, `from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | 함수, 메서드, 타입, const, var, 단일 import, import block |
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
| `--migrate`, `--adopt-existing` | 기존 wiki를 `wiki_legacy*`로 보존하고 마이그레이션 inbox를 만듭니다. |
| `--lint` | 파일을 수정하지 않고 생성된 설정을 검증합니다. |
| `--link-check` | 깨진 wiki 링크, 중복 route, orphan page, 그리고 시작 라우터가 깊이 예산 안에서 닿지 못하는 페이지를 보고합니다. |
| `--quality-check` | 오래되거나 충돌하거나 품질이 낮은 wiki 문서 신호를 보고합니다. |
| `--doctor` | lint, link-check, quality-check를 함께 실행합니다. |
| `--doctor --fix` | 진단 전에 생성된 index 라우팅을 안전하게 갱신합니다. |
| `--migration-lint` | 마이그레이션 검토 스캐폴딩을 일반 lint와 분리해 검증합니다. |
| `--migration-quality-check` | 마이그레이션 정책/구조 신호를 일반 quality-check와 분리해 보고합니다. |
| `--migration-doctor` | migration-lint와 migration-quality-check를 함께 실행합니다. |
| `--query <terms>` | wiki 경로, 메타데이터, 제목, 본문을 검색합니다. answer-first 출력에 페이지별 TL;DR 줄을 붙이고 하드 사이즈 캡을 적용합니다. |
| `--wiki-impact <page-or-term>` | 일치하는 페이지의 wiki 역링크, `decision_ref` 인용, 나가는 링크, 라우터 깊이를 보여줍니다. |
| `--refresh-index` | 생성된 자동 발견 wiki 라우팅을 갱신합니다. |
| `--capture-inbox --title <title> --content <content>` | wiki inbox에 후보 메모를 추가합니다. |
| `--issue-draft --issue-title <title>` | 문제 또는 부작용에 대한 읽기 전용 GitHub 이슈 본문 초안을 출력합니다. |
| `--issue-create --issue-title <title>` | 명시적 사용자 승인 후 `gh`로 GitHub 이슈를 생성합니다. |
| `--glossary-init` | 선택적 glossary 페이지를 만들고 라우팅합니다. |
| `--prune-check` | 오래되거나 미해결인 lifecycle 신호가 있는 active 페이지를 보고합니다. |
| `--review-migration`, `--semantic-migrate` | 마이그레이션 inbox 상태를 마이그레이션 검토 파일에 동기화합니다. |
| `--no-git-config` | `git core.hooksPath`를 바꾸지 않고 훅 파일을 설치합니다. |
| `--code-index` | 폐기 가능한 코드 근거 인덱스를 빌드합니다. |
| `--code-report` | 근거 인덱스에서 아키텍처/소유권 요약을 출력합니다. |
| `--code-report-section <section>` | 한 섹션만 출력: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, `edges`. |
| `--code-impact <term>` | 파일, 심볼, route, import, edge, 소유자 영향 근거를 보여줍니다. |
| `--code-search-symbol <term>` | 인덱싱된 심볼을 검색합니다. |
| `--code-query <sql>` | 근거 인덱스에 대해 보수적인 읽기 전용 SQL을 실행합니다. |

## 개발

소스는 TypeScript입니다. 커밋된 `dist/` 디렉터리는 npm 바이너리와 설치된 skill 복사본이 사용하는 컴파일된 JavaScript입니다.

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 아래 TypeScript를 수정할 때는 커밋 전에 빌드하여 `dist/`를 최신 상태로 유지하세요.

관리자 벤치마크 명령은 [benchmarks/README.md](benchmarks/README.md)에 있습니다. 이 명령은 릴리스 근거와 공개 주장 검증을 위한 것이며, 일반 최종 사용자 설정 절차가 아닙니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다. 긴 대화 기록에서 프로젝트 상태를 재구성하는 대신, 지속되는 markdown 컨텍스트를 작업 가까이에 둡니다.

Project Librarian은 그 아이디어를, 저장소 로컬 instruction, 간결한 시작 훅, 마이그레이션 헬퍼, 진단, 선택적 코드 근거를 갖춘 Codex, Claude Code, Cursor, Gemini CLI용 설치형 CLI 및 skill로 구현합니다.

## 라이선스

MIT
