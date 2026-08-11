# 사용법

## 재사용 스킬 설치

```bash
npx project-librarian@latest install
```

설치 과정에서 설치 범위와 사용할 에이전트를 선택합니다. 방향키로 범위를 고르고, `Space`로 에이전트를 체크하거나 해제한 뒤 `Enter`를 누르면 설치합니다. 자동화 환경에서는 `--scope user|project`와 `--agents codex,claude,cursor,gemini|all`을 명시할 수 있습니다.

## 저장소 초기화

```bash
npx project-librarian@latest init
```

초기화는 중립적인 서비스/PRD 허브, 운영 규칙, 짧은 시작 라우팅, 에이전트 훅, Git 훅 파일을 만듭니다. 서비스나 PRD를 임의로 만들지 않으며 기존 위키를 덮어쓰지 않습니다.

선택한 에이전트만 설정할 수 있습니다.

```bash
npx project-librarian@latest init --agents codex,cursor
```

훅 파일은 필요하지만 저장소의 `core.hooksPath`를 바꾸면 안 될 때는 `--no-git-config`를 사용합니다.

## 기존 설정 갱신

```bash
npx project-librarian@latest update
```

TTY에서 업데이트를 실행하면 먼저 범위를 고릅니다. 프로젝트 범위에서만 업데이트 대상을 체크하며, 사용자 범위는 두 번째 선택 없이 설치된 사용자 스킬을 바로 갱신합니다.

- `user`: 사용자 범위에 설치된 스킬 복사본만 갱신합니다. 현재 프로젝트의 위키, 에이전트 지침, 훅은 쓰지 않습니다.
- `project`: 재사용 스킬과 프로젝트 에이전트 설정/훅 중 원하는 대상을 조합해 갱신합니다. `update`는 프로젝트 위키를 쓰지 않습니다.

자동화에서는 대상을 명시합니다.

```bash
npx project-librarian@latest update --scope user --targets skill --agents codex
npx project-librarian@latest update --scope project --targets skill,agents --agents codex,cursor --no-git-config
```

`--targets`에는 `skill`, `agents`, `all`을 사용할 수 있습니다. 프로젝트 범위 스킬 복사본은 스킬 대상을 선택했을 때만 갱신하며, 없는 프로젝트 범위 스킬 복사본을 update가 새로 만들지는 않습니다. 에이전트 대상은 기존 에이전트 루트가 필요하고, 없을 때는 `--agents`로 대상을 명시해야 합니다. 빠진 위키 설정은 `init`으로 만들고, `--refresh-index` 같은 위키 변경은 명시적인 위키 유지관리 옵션으로 실행합니다.

기존 생명주기형 디렉터리는 읽기 전용 호환 자료로 그대로 둡니다. Project Librarian은 이를 자동으로 재정리하지 않습니다.

## PRD 시각 자료

PRD는 아래 시각 자료를 모두 지원합니다. 시각 자료가 필요하면 소유한 Markdown 문서나 영역 인덱스에서 연결하고, 표준 시각 자료 자체는 HTML 파일로 작성합니다.

| 영역 | 시각 자료 |
| --- | --- |
| 탐색 | 사용자 여정 지도, 생태계·이해관계자 지도 |
| 요구사항 | 사용자 플로우, 서비스 블루프린트/스윔레인, 권한 매트릭스 |
| 설계 | 시스템 컨텍스트/아키텍처, 시퀀스 다이어그램, 상태 머신, 화면 플로우/와이어프레임, 도메인·데이터 모델 |
| 출시·로드맵 | 의존성·롤아웃 맵 |
| 검증·지표 | 실험 흐름, 퍼널, KPI 트리, 코호트 뷰 |
| 결정·출처 | 결정 영향도 맵, 근거 맵 |

PRD 안에서는 다음과 같이 둡니다.

```text
wiki/10-services/<service>/prds/<PRD-ID-slug>/03-design/
  index.md
  visuals/
    system-architecture.html
    state-machine.html
```

Markdown는 메타데이터, 근거, 요구사항, 결정사항, 텍스트 요약의 원본으로 유지하고, HTML은 시각적 표현의 원본으로 사용합니다. 모든 시각 자료는 자체 완결형·반응형·인쇄 가능하고 키보드로 탐색할 수 있어야 하며, 색상에만 의존하지 않고 제목, 목적, 범례, 텍스트 요약, 갱신일, 출처 또는 결정 참조를 포함해야 합니다. 작은 설명에는 Mermaid나 ASCII를 사용할 수 있지만, PRD의 표준 시각 자료는 HTML로 작성합니다. 전체 계약은 [PRD 시각 자료 안내](prd-visual-artifacts.md)를 따릅니다.

## 위키 정리

기본 작성 경로는 다음과 같습니다.

```text
서비스 -> PRD/이니셔티브 -> 문서 영역 -> 집중된 문서
```

- `wiki/00-index/`에서 서비스와 안정적인 PRD ID를 등록합니다.
- 서비스와 PRD의 현재 사실은 `wiki/10-services/`에 둡니다.
- 여러 소유자가 공유하는 계약만 `wiki/20-shared/`에 둡니다.
- PRD 간 순서는 `wiki/30-portfolio/`에 둡니다.
- 미해결 후보는 `wiki/inbox/`에 둡니다.
- 보존할 폐기 자료는 `wiki/90-archive/`에 둡니다.

영구 문서에는 상태, 갱신일, 범위, 유형, 소유자, 읽기 예산, 결정 참조, 검토 조건을 기록합니다.

## 검색과 라우팅

```bash
project-librarian --query "요청 제한 정책"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "결제"
```

`--query`는 가장 강한 일치 문서와 제한된 보조 결과를 반환합니다. `--wiki-impact`는 대상 주변의 링크와 인용을 설명합니다. `--wiki-neighborhood`는 대상 주변의 짧은 읽기 순서를 제안합니다.

## 위키 품질 검사

```bash
project-librarian --lint
project-librarian --link-check
project-librarian --quality-check
project-librarian --doctor
```

진단 전에 관리 인덱스 블록을 갱신하려면 `--doctor --fix`를 사용합니다. 검토하거나 폐기할 문서는 `--prune-check` 또는 `--prune-check-strict`로 찾습니다.

## 후보함과 용어집

```bash
project-librarian --capture-inbox \
  --title "재시도 소유권" \
  --content "재시도 정책을 어느 서비스가 소유하는지 확인한다." \
  --category open-question

project-librarian --glossary-init
project-librarian --refresh-index
```

후보함 내용은 서비스, PRD, 공유, 포트폴리오, 보관 경로로 분류되기 전까지 현재 사실이 아닙니다.

## 세션 인계

```bash
project-librarian --handoff-save \
  --goal "결제 요구사항 완료" \
  --state "초안 완료" \
  --next "결제 소유자 검토" \
  --verification "project-librarian --doctor"

project-librarian --handoff-show
project-librarian --handoff-status
project-librarian --handoff-promote-inbox
project-librarian --handoff-clear
```

인계 파일은 로컬 생성 참고 자료이며 영구 기획 사실이 아닙니다. 필요한 사실만 후보함으로 옮긴 뒤 일반 분류 절차를 따릅니다.
