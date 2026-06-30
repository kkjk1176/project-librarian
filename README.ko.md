# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![코드 근거 인덱스](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

**모든 AI 코딩 에이전트에게 프로젝트에 대한 같은 지속 기억을 주세요.** Project Librarian은 저장소 안에 두는 간결한 계획 위키와 선택적 코드 근거 인덱스를 유지해 Codex, Claude Code, Cursor, Gemini CLI가 세션 시작 때 같은 맥락을 읽게 합니다.

언어: [English](README.md) | [한국어](README.ko.md)

## 빠른 시작

대부분의 사용자는 생명주기 명령을 직접 실행하기보다 코딩 에이전트에게 Project Librarian 실행을 요청하면 됩니다.

재사용 가능한 스킬 파일을 한 번 설치합니다.

```bash
npx project-librarian@latest install --scope user --agents all
```

그다음 대상 저장소에서 Codex, Claude Code, Cursor, Gemini CLI에 자연어로 요청합니다.

- "Project Librarian으로 이 저장소의 계획 위키를 설정하고 진단까지 실행해줘."
- "Project Librarian으로 기존 docs/wiki 내용을 마이그레이션해줘."
- "Project Librarian 위키에서 authentication decisions를 찾아줘."

설치된 스킬은 에이전트가 로컬 실행 경로를 찾고 프로젝트 루트에서 맞는 명령을 실행하도록 안내합니다. 실행 경로를 대상 저장소의 에이전트 설정 안에 두고 싶을 때만 프로젝트 범위 설치를 선택합니다.

```bash
npx project-librarian@latest install --scope project --agents all
```

`install`은 재사용 가능한 실행 파일, 스킬 파일, 로컬 실행기에 필요한 필수 런타임 의존성을 복사합니다. `AGENTS.md`, 에이전트 훅, `wiki/`, git 훅 파일, 진단, 선택적 코드 근거 지원을 만들거나 갱신하는 것은 에이전트가 실행하는 생명주기 명령입니다. `install-skill`은 호환성 별칭으로 계속 지원됩니다.

## 업데이트

기존 설정을 위키 마이그레이션 없이 갱신하려면 다음 명령을 실행합니다.

```bash
npx project-librarian@latest update
```

이 명령은 관리 설정 파일, 에이전트 훅, 위키 운영/메타 파일, 기존 프로젝트 범위 스킬 복사본을 갱신합니다. 현재 `wiki/`는 보존하고 migration flag는 거부하므로 위키를 `wiki_legacy*`로 바꾸지 않습니다.

특정 프로젝트 표면을 의도적으로 추가하거나 갱신할 때는 `--agents`를 명시합니다.

```bash
npx project-librarian@latest update --agents cursor
npx project-librarian@latest update --agents all
```

사용자 범위 스킬 설치는 전역 에이전트 도구이므로 프로젝트 업데이트가 바꾸지 않습니다. 전역 스킬은 명시적으로 갱신합니다.

```bash
npx project-librarian@latest install --scope user --agents all
```

## 존재 이유

LLM 코딩 에이전트는 매 세션마다 프로젝트를 처음부터 다시 파악하느라 컨텍스트와 도구 호출을 낭비합니다. 오래된 대화를 읽고, 문서를 훑고, 소스를 검색하고, 어떤 파일이 중요한지 추측하는 일이 반복됩니다.

Project Librarian은 작은 첫 읽기와 더 깊은 정본으로 가는 경로를 제공합니다.

| 표면 | 에이전트가 얻는 것 |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 짧은 세션 시작 요약과 라우터. 관련 계획 페이지만 읽습니다. |
| `wiki/canonical/`, `wiki/roadmaps/`, `wiki/plans/`, `wiki/decisions/` | 현재 정본, 미래 범위, 실행 계획, 지속되는 근거를 분리합니다. |
| 에이전트 훅과 규칙 | Codex, Claude Code, Cursor, Gemini CLI가 같은 위키 우선 계약에서 시작합니다. |
| `.project-wiki/code-evidence.sqlite` | 영향, 소유권, route, symbol, import, workspace graph 질문을 위한 선택적 재생성 코드 근거. |
| 진단 및 마이그레이션 모드 | 링크 확인, 품질 확인, 마이그레이션 검토 파일, 오래된 신호 보고, 이슈 초안. |

핵심은 "문서를 더 많이 쓰자"가 아닙니다. 첫 에이전트 읽기량을 작게 유지하고, 더 깊은 프로젝트 정본과 코드 근거로 가는 신뢰 가능한 경로를 제공하는 것입니다.

## 핵심 강점

- **첫 읽기를 작게.** 시작 훅은 `wiki/startup.md`와 `wiki/index.md`만 주입하고, 에이전트는 필요할 때 더 깊은 페이지로 이동합니다.
- **한 번 설정, 네 에이전트.** Codex, Claude Code, Cursor, Gemini CLI가 같은 저장소 로컬 기억 계약을 공유합니다.
- **구조적인 위키 작성.** 새 프로젝트 내용은 작성하거나 취합하기 전에 분류하므로 PRD, 정책, UX, 데이터, API, QA, 릴리즈, 운영 메모가 하나의 잡다한 페이지로 합쳐지지 않습니다.
- **검토 가능한 위키 그래프.** `--wiki-visualize`는 시작 컨텍스트를 늘리지 않고 `.project-wiki/` 아래에 정적 HTML 그래프를 작성합니다.
- **측정된 주장.** 벤치마크에서 이긴 경우와 손해를 본 경우를 주장 경계와 함께 공개합니다.
- **로컬 세션 핸드오프.** `--handoff-save`는 `.project-wiki/session/` 아래에 생성형 재개 메모를 저장하되 실행 기억을 프로젝트 정본으로 바꾸지 않습니다.
- **선택적 코드 근거.** SQLite 인덱스와 답변 형태 MCP 도구가 큰 저장소의 비싼 탐색 질문에 답하며, MCP SDK 의존성은 추가하지 않습니다.
- **다시 실행해도 안전.** 부트스트랩은 멱등하고 기존 내용 보존을 우선합니다.

## 일반 요청

원하는 결과를 에이전트에게 말하면, 설치된 스킬이 요청을 로컬 실행 명령으로 연결합니다.

| 목표 | 에이전트에게 요청 |
| --- | --- |
| 위키 생성 또는 갱신 | "Project Librarian으로 이 저장소의 계획 위키를 설정하거나 갱신해줘." |
| 마이그레이션 없는 갱신 | "이 저장소의 Project Librarian 설정을 위키 마이그레이션 없이 갱신해줘." |
| 기존 문서/위키 마이그레이션 | "Project Librarian으로 기존 docs/wiki 내용을 마이그레이션해줘." |
| 진단 실행 | "Project Librarian 진단을 실행해줘." |
| 프로젝트 기억 검색 | "Project Librarian 위키에서 authentication decisions를 찾아줘." |
| 코드 근거 구축 | "Project Librarian 코드 근거를 `src`에 대해 구축해줘." |
| 코드 영향 확인 | "`healthHandler`에 대한 Project Librarian 영향 근거를 보여줘." |
| 세션 핸드오프 저장 | "현재 작업에 대한 Project Librarian 세션 핸드오프를 저장해줘." |

설치 범위, 실행 경로, 생성 파일, 마이그레이션 동작, 전체 요청 표는 [사용 가이드](docs/ko/usage.md)에 있습니다.

## 벤치마크

여기 수치는 모든 상황에 대한 약속이 아니라 관리자 릴리스 근거입니다. 모든 값은 실제 Codex JSONL 사용량과 로컬 실행 시간이며, Project Librarian이 없는 `organic` 대조군과 격리된 환경에서 비교했습니다. 위키 라우팅 트랙과 코드 그래프 트랙은 분리해 측정하며, 한 트랙의 우위가 다른 트랙의 주장을 뒷받침하지 않습니다.

최신 clean 합성 위키 라우팅 트랙 릴리스 근거는 2026-06-29에 `gpt-5.5`, `perf/small-repo-code-evidence-safeguards` 브랜치의 `ae79390` 커밋에서 측정했습니다. 42개 시나리오, 21개 with/without 쌍을 각 3회 측정하고 1회 예열했으며, 전체 주장 게이트는 통과했고 주장 ledger는 이 보고서를 release-claimable로 분류했습니다. repair 실행은 보존된 raw JSONL에서 claimable 측정 실행 125개를 재사용하고 남은 실패 슬롯 1개를 다시 측정했습니다. 이 주장은 합성 위키 라우팅 트랙과 표기된 작업 유형에 한정되며, 코드 그래프 동작, 실제 저장소, 모든 에이전트 표면, 모든 질문 형태에 대한 주장이 아닙니다.

위키 트랙 집계, 대조군 대비 변화:

| 규모 | 비용 가중 토큰 | 전체 토큰 | 실행 시간 | 명령 수 | 도구 출력 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 전체 | 51.39% 적음 | 48.67% 적음 | 19.83% 빠름 | 18.40% 적음 | 85.88% 적음 |
| 소형 | 21.59% 적음 | 9.31% 적음 | 13.91% 빠름 | 12.64% 적음 | 43.89% 적음 |
| 중형 | 45.95% 적음 | 37.42% 적음 | 11.88% 빠름 | 4.30% 적음 | 69.12% 적음 |
| 대형 | 66.97% 적음 | 69.87% 적음 | 31.90% 빠름 | 35.19% 적음 | 95.58% 적음 |

위키 트랙 작업 유형별 비용 가중 토큰 변화, 전체 규모 합산:

| 작업 유형 | 변화 |
| --- | ---: |
| onboarding | 65.95% 적음 |
| decision_lookup | 48.46% 적음 |
| code_impact | 55.61% 적음 |
| release_policy | 58.22% 적음 |
| change_location | 29.59% 적음 |
| multi_session | 52.58% 적음 |
| aggregation | 42.53% 적음 |

규모별 값은 서로 다릅니다. 소형/중형/대형 작업 유형별 실제 행렬과 아직 역전이 남은 셀은 [벤치마크 근거](docs/ko/benchmarks.md#위키-트랙)에 있습니다.

실행 시간과 명령 수의 한계도 있습니다. 이번 보고서에서 `code_impact`, `change_location`, `aggregation`은 토큰과 출력 바이트가 모두 개선됐지만, 실행 시간이나 명령 수에서는 일부 역전이 남아 있습니다.

코드 그래프 트랙, 대조군 대비 비용 가중 토큰:

| 질문 | excalidraw (약 1.2k 파일) | backstage (약 11.8k 파일) |
| --- | --- | --- |
| impact_trace | 117% 많음 | **27.7% 적음** |
| workspace_graph | 106% 많음 | 2.6% 적음 |
| ownership_lookup | - | 99% 많음 |

코드 근거 인덱스는 큰 저장소의 비싼 탐색 질문에서만 효과가 납니다. 약 5k개 미만의 인덱싱 가능 파일에서는 `--code-index`가 `--acknowledge-small-repo` 없이는 중단되며, 기존 `.project-wiki` SQLite 인덱스로 사용자가 이미 선택했음을 알 수 있는 경우가 아니면 부트스트랩은 MCP 자동 등록을 건너뜁니다.

`--code-report`, `--code-impact`, `--code-context-pack`, MCP 도구 출력을 현재 코드 구조 근거로 인용하기 전에는 `project-librarian --code-status` 또는 MCP `code_status`를 실행해 `stale_files: 0`인지 확인해야 합니다. 오래된 보고서는 재빌드가 필요하다는 신호이지 권위 있는 프로젝트 진실이 아닙니다.

방법론, 작업 유형 설명, 재현 명령, 공개된 손실은 [한국어 벤치마크 근거](docs/ko/benchmarks.md)에 있습니다.

## 문서

| 문서 | 용도 |
| --- | --- |
| [사용 가이드](docs/ko/usage.md) | 설치 범위, 실행 경로, 생성 파일, 마이그레이션, 일반 에이전트 요청. |
| [코드 근거](docs/ko/code-evidence.md) | MCP 서버 동작, 최신성 계약, 규모 게이트, 언어 지원, 네이티브 헬퍼 정책. |
| [CLI 참조](docs/ko/cli-reference.md) | 전체 명령과 옵션 참조. |
| [벤치마크 근거](docs/ko/benchmarks.md) | 공개 벤치마크 주장, 한계, 관리자 벤치마크 명령. |
| [관리자 가이드](docs/ko/maintainer.md) | 개발, 릴리스 준비, 신뢰 배포, 벤치마크 운영. |
| [기여 안내](CONTRIBUTING.md) | 로컬 기여 흐름과 검증 기대치. |
| [보안 정책](SECURITY.md) | 지원 버전, 비공개 제보, 공급망 경계. |

## 설치 상세

| 상황 | 명령 |
| --- | --- |
| 지원하는 모든 에이전트에 전역 설치 | `npx project-librarian@latest install --scope user --agents all` |
| 현재 저장소에 설치 | `npx project-librarian@latest install --scope project --agents all` |
| Codex만 설치 | `npx project-librarian@latest install --agents codex` |
| Claude Code만 설치 | `npx project-librarian@latest install --agents claude` |
| Cursor만 설치 | `npx project-librarian@latest install --agents cursor` |
| Gemini CLI만 설치 | `npx project-librarian@latest install --agents gemini` |
| 설치 결과 미리 보기 | `npx project-librarian@latest install --scope project --agents all --dry-run` |

`--agents`는 `codex,claude,cursor,gemini` 같은 쉼표 구분 값도 받습니다. `all`은 지원하는 모든 에이전트를 대상으로 합니다. `--scope`는 `user` 또는 `project`를 받습니다. 직접 CLI와 자동화 세부사항은 [CLI 참조](docs/ko/cli-reference.md)에 있습니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다. 긴 대화 기록에서 프로젝트 상태를 다시 구성하는 대신, 작업 가까이에 지속 가능한 마크다운 맥락을 둔다는 생각입니다.

Project Librarian은 이 아이디어를 Codex, Claude Code, Cursor, Gemini CLI용 설치형 CLI와 스킬로 확장합니다. 저장소 로컬 지침, 간결한 시작 훅, 마이그레이션 도구, 진단, 선택적 코드 근거를 함께 제공합니다.

## 라이선스

MIT
