# Project Librarian

[![npm](https://img.shields.io/npm/v/project-librarian.svg)](https://www.npmjs.com/package/project-librarian)
[![라이선스](https://img.shields.io/npm/l/project-librarian.svg)](https://github.com/kkjk1176/project-librarian/blob/main/LICENSE)

**프로젝트 문맥을 찾기 쉽게 정리하세요.** Project Librarian은 저장소 안에 기획 위키를 만들고 관리합니다. Codex, Claude Code, Cursor, Gemini CLI가 현재 사실, 결정사항, 다음 작업을 필요한 만큼만 찾도록 돕습니다.

위키는 `서비스 → PRD/이니셔티브 → 문서 영역 → 집중 문서` 순서로 구성되어 각 내용을 담당 영역 가까이에 둡니다.

## 바로 시작하기

재사용 스킬을 설치한 뒤 현재 저장소를 초기화합니다.

```bash
npx project-librarian@latest install
npx project-librarian@latest init
```

터미널에서 `install`을 실행하면 설치 범위와 연결할 에이전트를 선택할 수 있습니다. 자동화 환경에서는 `--scope`와 `--agents`를 명시하세요.

그다음 에이전트에게 요청합니다.

> 이 저장소에 Project Librarian을 초기화하고 프로젝트 위키를 정리해 줘.

이미 설정되어 있다면 다음 명령으로 갱신합니다.

```bash
npx project-librarian@latest update
```

`init`은 기존 `wiki/`를 보존합니다. `update`는 선택한 스킬과 에이전트 설정·훅을 갱신하며 프로젝트 위키를 만들거나 다시 쓰지 않습니다. 정확한 범위와 대상 규칙은 [사용법](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/usage.md)에서 확인하세요.

## 제공하는 것

| 경로 | 용도 |
| --- | --- |
| `wiki/startup.md` | 세션 시작에 읽는 짧은 요약. |
| `wiki/index.md` | 전체 위키로 들어가는 기본 경로. |
| `wiki/00-index/` | 서비스 지도와 PRD 등록부. |
| `wiki/10-services/` | 서비스 사실과 PRD 문서. |
| `wiki/20-shared/` | 공유 계약과 용어. |
| `wiki/30-portfolio/` | PRD 간 우선순위와 순서. |
| `wiki/90-archive/` | 참고를 위해 보존한 폐기 자료. |
| 선택한 에이전트 설정과 훅 | 선택한 에이전트의 시작 라우팅. |

기존 생명주기형 디렉터리는 읽기 전용 호환 자료로 그대로 둡니다. Project Librarian이 이를 자동으로 재구성하지는 않습니다.

## 자주 쓰는 명령

```bash
project-librarian --query "인증 정책"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "결제"
project-librarian --doctor
```

후보함 기록, 인덱스 갱신, 용어집, 세션 인계와 전체 옵션은 [CLI 참고](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/cli-reference.md)에서 확인하세요.

## 다음 문서

| 안내서 | 필요할 때 |
| --- | --- |
| [사용법](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/usage.md) | 설치·초기화·갱신과 위키 정리 방법이 필요할 때 |
| [PRD 시각 자료](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/prd-visual-artifacts.md) | 접근 가능한 HTML 시각 자료를 만들 때 |
| [CLI 참고](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/cli-reference.md) | 명령과 옵션을 찾을 때 |
| [관리자 안내서](https://github.com/kkjk1176/project-librarian/blob/main/docs/ko/maintainer.md) | 개발·검증·패키징·배포를 할 때 |
| [영문 README](https://github.com/kkjk1176/project-librarian/blob/main/README.md) | 같은 내용을 영어로 읽을 때 |

## 요구 사항

- Node.js 22.13 이상
- Git은 선택 사항입니다. 훅 파일은 필요하지만 `core.hooksPath`를 바꾸면 안 될 때 `--no-git-config`를 사용하세요.

## 라이선스

[MIT](https://github.com/kkjk1176/project-librarian/blob/main/LICENSE)
