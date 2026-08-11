# Project Librarian

[![npm](https://img.shields.io/npm/v/project-librarian.svg)](https://www.npmjs.com/package/project-librarian)
[![라이선스](https://img.shields.io/npm/l/project-librarian.svg)](LICENSE)

**코딩 에이전트가 프로젝트를 오래 유지되는 정돈된 구조로 이해하게 합니다.** Project Librarian은 Codex, Claude Code, Cursor, Gemini CLI가 함께 읽는 저장소 로컬 기획 위키를 만들고 관리합니다.

위키는 `서비스 -> PRD/이니셔티브 -> 문서 영역` 순서로 소유권을 드러냅니다. 짧은 시작 문서가 현재 사실, 결정, 출처, 계획, 공유 계약, 보관 자료로 필요한 만큼만 안내합니다.

## 설치

```bash
npx project-librarian@latest install
```

설치 과정에서 사용자 전체 또는 현재 프로젝트를 고르고, 사용할 에이전트 표면을 체크합니다. 자동화 환경에서는 `--scope`와 `--agents`를 명시할 수 있습니다.

그다음 에이전트에게 요청합니다.

> 이 저장소에 Project Librarian을 초기화하고 프로젝트 위키를 정리해 줘.

CLI를 직접 실행할 수도 있습니다.

```bash
npx project-librarian@latest init
```

`init`은 기존 `wiki/`를 교체하지 않고 빠진 위키 및 에이전트 설정 파일을 만듭니다. `update`는 기존 위키 내용과 에이전트 표면을 보존하면서 관리 설정을 갱신합니다.

```bash
npx project-librarian@latest update
```

TTY에서 `update`를 실행하면 먼저 범위를 고릅니다. 사용자 범위는 대상 체크 없이 설치된 사용자 스킬을 바로 갱신하고, 프로젝트 범위에서만 재사용 스킬과 프로젝트 에이전트 설정/훅 중 대상을 체크합니다. `update`는 프로젝트 위키를 만들거나 다시 쓰지 않습니다. 자동화에서는 `--scope user|project`와 `--targets skill|agents|all`을 명시합니다. 빠진 위키 설정은 `init`으로 만들고, `--refresh-index` 같은 위키 유지관리 옵션은 명시적으로 실행합니다.

## 생성 구조

| 경로 | 용도 |
| --- | --- |
| `wiki/startup.md` | 세션 시작용 요약 문맥. |
| `wiki/index.md` | 나머지 위키로 연결하는 수정 가능한 라우터. |
| `wiki/00-index/` | 서비스 지도와 PRD 등록부. |
| `wiki/10-services/` | 서비스 사실과 PRD 소유 문서. |
| `wiki/20-shared/` | 서비스 간 공유 계약과 용어집. |
| `wiki/30-portfolio/` | PRD 간 순서와 로드맵. |
| `wiki/90-archive/` | 참고를 위해 보존하는 폐기 자료. |
| `wiki/meta/` | 위키 분류법과 운영 규칙. |
| 에이전트 훅과 지침 | 선택한 코딩 에이전트의 시작 라우팅. |

기존 생명주기형 위키 디렉터리는 읽기 전용 호환 자료로 그대로 둡니다. Project Librarian은 이를 자동으로 재구성하지 않습니다.

## 위키 작업

```bash
project-librarian --lint
project-librarian --link-check
project-librarian --quality-check
project-librarian --doctor
project-librarian --query "인증 정책"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "결제"
project-librarian --refresh-index
project-librarian --glossary-init
project-librarian --capture-inbox --title "열린 질문" --content "결제 재시도의 소유자는 누구인가?"
```

세션 인계 명령은 짧게 유지할 재개 문맥을 `.project-wiki/session/`에 저장하며, 이를 영구 위키 사실로 취급하지 않습니다.

## 설계 원칙

- 정리 품질을 우선합니다. 모든 영구 문서는 명확한 소유자, 범위, 상태, 경로를 가집니다.
- 시작 문맥은 짧게 유지하고 상세 내용은 명시적 링크를 따라 필요할 때 읽습니다.
- 기존 위키 내용은 기본적으로 보존합니다.
- 검토 전 메모는 `wiki/inbox/`에 둡니다.
- 진단은 깨진 링크, 약한 라우팅, 오래된 문서, 과도하게 비대한 허브를 알려 줍니다.

## 문서

| 안내서 | 내용 |
| --- | --- |
| [사용법](docs/ko/usage.md) | 설정, 생성 파일, 위키 작업 흐름, 에이전트 요청. |
| [PRD 시각 자료](docs/ko/prd-visual-artifacts.md) | 지원하는 PRD 시각 자료와 HTML 작성 규칙. |
| [CLI 참고](docs/ko/cli-reference.md) | 명령과 옵션. |
| [관리자 안내서](docs/ko/maintainer.md) | 개발, 검증, 패키징, 배포. |
| [영문 README](README.md) | 영문 소개와 사용법. |

## 요구 사항

- Node.js 22.13 이상
- Git은 선택 사항이며 기존 `core.hooksPath` 설정을 보존합니다

## 라이선스

[MIT](LICENSE)
