# 벤치마크 근거

여기 수치는 모든 상황에 대한 약속이 아니라 관리자 릴리스 근거입니다. 모든 값은 실제 Codex JSONL 사용량과 로컬 실행 시간(ChatGPT/Codex 인증, `gpt-5.5`)이며, 격리된 Codex home, 허용 목록 전용 환경, 깨끗한 작업 트리, 실행 후 fixture 검증 조건에서 측정했습니다. 각 시나리오는 측정 3회와 예열 1회로, Project Librarian이 없는 `organic` 대조군과 비교했습니다.

위키 라우팅 트랙과 코드 그래프 트랙은 분리해 측정하고 보고합니다. 한 트랙의 승리가 다른 트랙의 주장을 뒷받침하지 않습니다.

## 릴리스 후보 재현

```bash
npm run benchmark:release:preview
npm run benchmark:release -- --allow-codex-run
```

실측 릴리스 실행은 stderr에 `[benchmark:progress]` 줄을 스트리밍해 시나리오 수, 예상 Codex 실행 총량, 현재 실행 순번, 단계, 프롬프트 ID, 종료 상태, 경과 시간, 원시 JSONL 경로를 보여줍니다. stdout은 최종 JSON 결과 전용입니다.

`benchmarks/reports/llm/` 아래 생성 보고서는 기본적으로 무시됩니다. 공개 주장 근거로 쓰려는 릴리스 기준선만 의도적으로 커밋해야 합니다.

## 위키 트랙

최신 clean 합성 위키 트랙 릴리스 근거는 2026-06-29에 `gpt-5.5`, `perf/small-repo-code-evidence-safeguards` 브랜치의 `ae79390` 커밋에서 측정했습니다. 42개 시나리오, 21개 with/without 쌍을 각 3회 측정하고 1회 예열했으며, 전체 주장 게이트는 **통과**했고 주장 ledger는 이 보고서를 release-claimable로 분류했습니다. repair 실행은 보존된 raw JSONL에서 claimable 측정 실행 125개를 재사용하고 남은 실패 슬롯 1개를 다시 측정했습니다.

비용 가중 토큰, Project Librarian 대 대조군, 전체 규모 합산:

| 작업 유형 | 변화 |
| --- | ---: |
| onboarding | 65.95% 적음 |
| decision_lookup | 48.46% 적음 |
| code_impact | 55.61% 적음 |
| release_policy | 58.22% 적음 |
| change_location | 29.59% 적음 |
| multi_session | 52.58% 적음 |
| aggregation | 42.53% 적음 |

규모별 비용 가중 토큰 변화:

| 작업 유형 | 소형 | 중형 | 대형 |
| --- | ---: | ---: | ---: |
| onboarding | 60.88% 적음 | 65.53% 적음 | 69.17% 적음 |
| decision_lookup | 19.18% 적음 | 51.29% 적음 | 60.12% 적음 |
| code_impact | 26.61% 적음 | 54.81% 적음 | 68.43% 적음 |
| release_policy | 30.23% 적음 | 62.16% 적음 | 67.26% 적음 |
| change_location | 7.79% 적음 | 2.86% 많음 | 57.27% 적음 |
| multi_session | 54.29% 많음 | 35.32% 적음 | 82.77% 적음 |
| aggregation | 7.66% 적음 | 51.32% 적음 | 49.17% 적음 |

이 릴리스 주장은 합성 위키 라우팅 트랙과 표기된 작업 유형에 한정됩니다. 코드 그래프 동작, 실제 저장소, 모든 에이전트 표면, 모든 질문 형태에 대한 주장이 아닙니다. 숨기지 않는 한계도 남습니다. 비용 가중 토큰 기준으로 소형 `multi_session`과 중형 `change_location`은 위키를 켰을 때 더 비쌉니다. 또한 `code_impact`, `change_location`, `aggregation`은 작업 유형 집계에서 토큰과 출력 바이트가 개선됐더라도 이번 보고서의 실행 시간이나 명령 수에는 일부 역전이 남아 있습니다.

## 코드 그래프 트랙

SHA로 고정한 오픈소스 저장소 2곳에서, 손으로 작성한 정답 키와 격리된 Codex home에 주입한 답변 형태 MCP 도구로 측정했습니다. 평가기 거짓 양성 2건을 고치고 원시 JSONL에서 재채점한 뒤 30/30 정확으로 주장 게이트를 통과했으며, 원시 데이터에서 다시 계산하는 것이 상시 감사 정책입니다.

비용 가중 토큰, Project Librarian 대 대조군:

| 질문 | excalidraw (약 1.2k 파일) | backstage (약 11.8k 파일) |
| --- | --- | --- |
| impact_trace | 117% 많음 | **27.7% 적음** |
| workspace_graph | 106% 많음 | 2.6% 적음 |
| ownership_lookup | - | 99% 많음 |

주장은 규모 교차점이며 손실도 승리 옆에 공개합니다. 11.8k 파일 저장소에서는 비싼 순회 질문(`impact_trace` 비용 가중 토큰 27.7% 감소, 스캔 바이트 24.5% 감소)에서 이기고 workspace graph는 손익분기입니다. 반면 소형 저장소에서는 모두 지고, CODEOWNERS 소유권 같은 저렴한 조회는 모든 측정 규모에서 집니다.

## 벤치마크 이름

테스트 대상 저장소:

- **excalidraw** - 실제 오픈소스 화이트보드/다이어그램 앱(약 1.2k 파일). 소형 저장소 표본.
- **backstage** - Spotify의 오픈소스 개발자 포털 플랫폼(약 11.8k 파일). 대형 저장소 표본.

질문 유형:

- **onboarding** - 프로젝트가 무엇인지, 현재 리스크, 다음에 읽을 문서를 요약합니다.
- **decision_lookup** - 위키에서 가장 최근 프로젝트 결정과 그 날짜를 찾습니다.
- **code_impact** - 벤치마크 보고서 스키마 변경 시 영향받을 파일이나 영역을 찾습니다.
- **release_policy** - publish 또는 benchmark claim 전에 필요한 체크를 찾습니다.
- **change_location** - Codex LLM benchmark runner 구현 시 어디를 수정해야 하는지 찾습니다.
- **aggregation** - 여러 페이지에 흩어진 사실을 종합해야 답할 수 있는 질문입니다.
- **multi_session** - 같은 프로젝트의 두 번째 세션으로, 지속되는 위키가 다음 세션에도 도움이 되는지 측정합니다.
- **impact_trace** - 바뀌는 모듈의 직접/간접 importer 전체를 추적합니다.
- **ownership_lookup** - CODEOWNERS 마지막 일치 우선순위로 소유자를 판정합니다.
- **workspace_graph** - workspace/package 의존성 그래프를 판정합니다.

## 관리자 명령

관리자 벤치마크 명령은 [benchmarks/README.md](../../benchmarks/README.md)에도 있습니다. 이 명령은 릴리스 근거와 공개 주장 검증을 위한 것이며 일반 사용자 설정 절차가 아닙니다.
