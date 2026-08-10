# CLI 참고

## 명령

```text
project-librarian init [옵션]
project-librarian update [옵션]
project-librarian install [--scope user|project] [--agents <목록>] [--dry-run]
project-librarian install-skill [--scope user|project] [--agents <목록>] [--dry-run]
```

- `init`은 빠진 위키 및 선택한 에이전트 설정 파일을 만들고 기존 `wiki/`는 보존합니다.
- `update`는 위키 내용과 이미 존재하는 에이전트 표면을 보존하면서 관리 설정을 갱신합니다.
- `install`은 선택한 에이전트용 재사용 스킬을 설치합니다.
- `install-skill`은 `install`의 호환 별칭입니다.

## 위키 진단

| 옵션 | 기능 |
| --- | --- |
| `--lint` | 필수 파일, 메타데이터, 에이전트 설정을 검사합니다. |
| `--link-check` | 깨진 링크, 중복 경로, 고립 문서, 라우팅 문제를 찾습니다. |
| `--quality-check` | 오래됨, 충돌, 미해결 표현, 과도한 문서 크기를 찾습니다. |
| `--doctor` | lint, 링크, 품질, 라우터 사실 검사를 함께 실행합니다. |
| `--fix` | `--doctor` 실행 전에 생성 인덱스 블록을 갱신합니다. |
| `--prune-check` | 오래됐거나 미해결 신호가 있는 활성 문서를 나열합니다. |
| `--prune-check-strict` | 날짜만 오래된 후보는 제외합니다. |

## 위키 검색과 유지관리

| 옵션 | 기능 |
| --- | --- |
| `--query <검색어>` | 위키 경로, 메타데이터, 제목, 본문을 검색합니다. |
| `--wiki-impact <대상>` | 백링크, 나가는 링크, 결정 인용, 라우터 깊이를 보여 줍니다. |
| `--wiki-neighborhood <대상>` | 문서나 검색어 주변의 제한된 읽기 순서를 제안합니다. |
| `--refresh-index` | 자동 발견 인덱스 블록을 갱신합니다. |
| `--glossary-init` | `wiki/20-shared/glossary.md`를 만들고 연결합니다. |
| `--capture-inbox` | `--title`, `--content`, 선택적 `--category`로 후보를 추가합니다. |

## 세션 인계

`--handoff-save`, `--handoff-show`, `--handoff-status`, `--handoff-clear`, `--handoff-promote-inbox`로 `.project-wiki/session/`의 로컬 재개 상태를 관리합니다. 전체 인계 주입은 `--handoff-injection-enable`, `--handoff-injection-disable`, `--handoff-injection-status`로 관리합니다.

## 설정과 지원

- `--agents codex|claude|cursor|gemini|all`은 설정 대상을 선택합니다.
- `--scope user|project`는 스킬 설치 범위를 선택합니다.
- `--dry-run`은 스킬 설치 결과를 미리 보여 줍니다.
- `--no-git-config`는 훅 파일만 쓰고 `core.hooksPath`는 바꾸지 않습니다.
- 이슈 작성에는 `--issue-draft`, `--issue-create`, `--issue-title`, `--issue-body-file`을 사용합니다.
- `--help`는 현재 공개 표면을 출력합니다.

폐기된 명령과 옵션은 알 수 없는 입력으로 처리되며 파일을 쓰기 전에 실패합니다.
