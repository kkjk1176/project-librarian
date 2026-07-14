# CLI 참조

자동화나 직접 CLI 실행에는 확인된 로컬 실행 경로를 사용합니다.

```bash
node .codex/skills/project-librarian/dist/init-project-wiki.js [init|update] [options]
node .codex/skills/project-librarian/dist/init-project-wiki.js install [--scope user|project] [--agents codex|claude|cursor|gemini|all]
```

`install-skill`은 `install`의 호환성 별칭으로 계속 지원됩니다.

`update`는 기존 프로젝트 갱신을 명시하는 명령입니다. `--migrate`와 `--adopt-existing`를 거부합니다. 기존 문서나 위키 내용을 `wiki_legacy*`로 보존하고 검토해야 한다면 top-level `--migrate`를 사용합니다. `--agents`가 없으면 Project Librarian이 관리 중인 표면을 먼저 보존하고, 관리 표면이 없을 때만 저장소에 이미 존재하는 에이전트 루트를 사용합니다. 업데이트에서는 전체 에이전트로 폴백하지 않습니다. 설치나 에이전트 루트를 하나도 감지하지 못하면 파일을 쓰기 전에 종료하고 `init` 또는 `--agents`를 요구합니다. 선택된 에이전트 표면에 프로젝트 범위 Project Librarian 스킬 설치가 이미 있으면 `update`는 현재 패키지의 재사용 가능한 스킬 파일과 로컬 실행기에 필요한 필수 런타임 의존성을 해당 프로젝트 스킬 디렉터리에 복사한 뒤 관리 설정을 갱신합니다. 기존 공유 `.agents/skills/project-librarian/` 설치는 에이전트별 설정 표면을 선택하지 않고 별도로 동기화합니다.

### 주요 옵션

| 옵션 | 목적 |
| --- | --- |
| `install --scope user|project --agents <list> --dry-run` | 재사용 가능한 스킬 파일과 로컬 실행기에 필요한 필수 런타임 의존성을 전역 또는 현재 저장소에 설치합니다. `--dry-run`은 install에서 복사될 파일을 미리 보여줍니다. |
| `update --agents <list>` | 기존 설정과 기존 프로젝트 범위 스킬 복사본을 갱신합니다. 표면은 `codex`, `claude`, `cursor`, `gemini`, `all` 중 하나입니다. |
| `--migrate`, `--adopt-existing` | 기존 위키를 `wiki_legacy*`로 보존하고 migration inbox, unit-map, split-plan, coverage 검토 파일을 만듭니다. |
| `--lint` | 파일을 수정하지 않고 생성된 설정을 검증합니다. |
| `--link-check` | 깨진 위키 링크, 중복 route, orphan page, router reachability, warning-only topology 신호를 보고합니다. |
| `--quality-check` | 오래되었거나 충돌하거나 품질이 낮은 위키 문서 신호를 보고합니다. |
| `--doctor` | lint, link-check, quality-check를 함께 실행합니다. |
| `--doctor --fix` | 진단 전에 생성된 index routing을 안전하게 갱신합니다. `--fix`는 `--doctor`의 modifier입니다. |
| `--migration-lint` | migration coverage, unit-map, split-plan, review scaffolding을 일반 lint와 분리해 검증합니다. |
| `--migration-quality-check` | migration 정책/구조 신호를 일반 quality-check와 분리해 보고합니다. |
| `--migration-doctor` | migration-lint와 migration-quality-check를 함께 실행합니다. |
| `--query <terms>` | 위키 경로, 메타데이터, 제목, 본문을 검색하고 크기 제한이 있는 answer-first 출력을 제공합니다. |
| `--wiki-impact <page-or-term>` | 일치하는 페이지의 backlinks, `decision_ref` 인용, outgoing link, router depth를 보여줍니다. |
| `--wiki-neighborhood <page-or-term>` | link, `decision_ref`, metadata, page class, router depth를 사용해 가까운 위키 페이지의 제한된 읽기 순서를 보여줍니다. |
| `--refresh-index` | 자동 발견된 위키 routing을 갱신합니다. |
| `--capture-inbox --title <title> --content <content> --category <category>` | 후보 메모를 위키 inbox에 추가합니다. category 기본값은 `project-candidate`입니다. |
| `--handoff-save --goal <goal> --state <state> --next <action>` | `.project-wiki/session/` 아래에 생성형 로컬 세션 핸드오프를 저장합니다. 필요하면 `--next`, `--decision`, `--blocked`, `--open-question`, `--verification`, `--last-success-command`, `--last-failure-command`를 반복합니다. |
| `--handoff-show`, `--handoff-status`, `--handoff-clear` | 생성된 세션 핸드오프를 출력, 점검, 제거합니다. 시작 훅은 핸드오프가 있을 때 존재만 알리고 기본적으로 전체 파일을 주입하지 않습니다. |
| `--handoff-promote-inbox` | 생성된 핸드오프의 선별된 사실을 `wiki/inbox/project-candidates.md`에 pending 후보로 추가합니다. canonical, plan, decision 페이지는 쓰지 않습니다. |
| `--handoff-injection-enable`, `--handoff-injection-disable`, `--handoff-injection-status` | 제한된 전체 핸드오프 주입 실험을 켜고, 끄고, 상태를 확인합니다. 기본 시작 동작은 pointer-only입니다. |
| `--issue-draft --issue-title <title>` | 문제나 부작용에 대한 읽기 전용 GitHub issue 본문 초안을 출력합니다. |
| `--issue-create --issue-title <title> --issue-body-file <path>` | 명시적 사용자 승인 후 `gh`로 GitHub issue를 생성합니다. `--issue-body-file`은 기존 Markdown 본문을 재사용합니다. |
| `--glossary-init` | 선택적 glossary 페이지를 만들고 route에 추가합니다. |
| `--prune-check` | stale 또는 unresolved lifecycle 신호가 있는 active page를 보고합니다. |
| `--prune-check --prune-check-strict` | `updated` 날짜가 오늘보다 오래됐다는 이유만으로 선택된 페이지는 제외합니다. |
| `--review-migration`, `--semantic-migrate` | migration coverage와 inbox status를 migration review 파일에 동기화합니다. |
| `--no-git-config` | `git core.hooksPath`를 바꾸지 않고 훅 파일을 설치합니다. |
| `--code-index` | 폐기 가능한 코드 근거 인덱스를 만듭니다. |
| `--code-scope <path>` | `--code-index`와 함께 사용해 인덱싱 범위를 하나 이상의 프로젝트 상대 파일/디렉터리로 제한합니다. |
| `--code-index-out <path>` | `.project-wiki/` 아래 사용자 지정 SQLite 출력 경로를 사용합니다. index와 read mode에 모두 적용됩니다. |
| `--acknowledge-small-repo` | `--code-index`와 함께 사용해 약 5k 파일 미만 규모 경고 후에도 진행합니다. |
| `--incremental`, `--code-index-incremental`, `--code-index-full` | `--code-index`와 함께 사용해 증분 갱신을 요구하거나 전체 재생성을 강제합니다. |
| `--code-index-migrate` | `--code-index`와 함께 사용해 기존 인덱스의 스키마 버전이 현재 패키지와 다를 때 교체를 명시적으로 승인합니다. |
| `--code-parser <mode>` | `--code-index`와 함께 사용해 `default` 또는 선택적 `tree-sitter` 추출을 선택합니다. |
| `--code-index-health` | 파일을 쓰지 않고 코드 근거 캐시 호환성과 재빌드 안내를 출력합니다. |
| `--code-index-engine <engine>` | 기본 `auto` 인덱스 엔진을 `typescript` 또는 `native-rust`로 override합니다. |
| `--code-status`, `--code-files` | 캐시 최신성을 확인하거나 인덱싱된 파일을 나열합니다. |
| `--code-report` | 근거 인덱스에서 구조와 소유권 요약을 출력합니다. |
| `--code-report-section <section>` | `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, `edges` 중 한 섹션을 출력합니다. |
| `--code-impact <term>` | 파일, 심볼, route, import, edge, owner 영향 근거를 보여줍니다. |
| `--code-context-pack <term>` | 구조 파일, 심볼, route, import, edge, 소유권 근거를 담은 예산 제한 first-pass context pack을 출력합니다. |
| `--code-search-symbol <term>` | 인덱싱된 심볼을 검색합니다. |
| `--code-query <sql>` | 근거 인덱스에서 보수적 읽기 전용 SQL을 실행합니다. |

### Topology Warnings

`--link-check`의 topology finding은 warning-only입니다. 그래서 bootstrap, update, release 흐름을 막지 않으면서 정리 방향을 알려줍니다.

| 코드 | 의미 |
| --- | --- |
| `hub-overload` | 사람이 관리하는 router 또는 meta 페이지가 너무 많은 위키 페이지를 링크하므로 분리하거나 범위를 좁혀야 합니다. |
| `weak-authority-route` | decision 또는 evidence 권위 신호가 있는 active canonical page가 generated auto-index routing으로만 도달 가능합니다. |
| `missing-evidence-link` | active canonical page가 source-backed claim을 하지만 source link 또는 `decision_ref`가 없습니다. |
| `stale-fanout` | 많이 링크된 active page가 topology-sensitive edit에 비해 너무 넓은 review trigger를 갖고 있습니다. |
