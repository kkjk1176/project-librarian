# 사용법

## 재사용 스킬 설치

```bash
npx project-librarian@latest install --scope user --agents all
```

현재 저장소에 설치하려면 `--scope project`를 사용합니다. 에이전트 대상은 `codex`, `claude`, `cursor`, `gemini`, `all` 중에서 선택합니다. `install-skill`은 기존 자동화를 위한 별칭으로 유지됩니다.

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

업데이트는 관리 지침, 훅, 운영 템플릿, 프로젝트 범위 스킬 복사본을 갱신합니다. 기존 위키 문서를 보존하며, `--agents`를 명시하지 않으면 관리 중이거나 이미 존재하는 에이전트 표면만 대상으로 삼습니다. 설치 흔적이나 에이전트 루트를 찾지 못하면 파일을 쓰기 전에 실패하고 `init` 또는 명시적 에이전트 선택을 안내합니다.

기존 생명주기형 디렉터리는 읽기 전용 호환 자료로 그대로 둡니다. Project Librarian은 이를 자동으로 재정리하지 않습니다.

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
