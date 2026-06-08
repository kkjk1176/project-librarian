# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

사람과 LLM 코딩 에이전트가 함께 쓰는 작은 프로젝트 계획 wiki를 생성합니다.

언어: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

생성되는 wiki는 시작 컨텍스트를 작게 유지합니다.

- `wiki/startup.md`: 현재 프로젝트 요약
- `wiki/index.md`: 다음에 읽을 상세 문서 라우터
- `wiki/canonical/`, `wiki/decisions/`, `wiki/sources/`, `wiki/meta/`: 필요할 때만 읽는 상세 컨텍스트

## 얻는 것

Project Wiki Bootstrap은 코딩 에이전트가 예측 가능하게 읽을 수 있는 저장소 로컬 계획 메모리를 만듭니다.

핵심 기능:

- Codex와 Claude Code용 wiki-first 프로젝트 지시문
- compact 시작 컨텍스트만 로드하는 session-start hook
- 현재 프로젝트 사실, 가정, 리스크, 결정, source를 담는 canonical 문서
- 깨진 링크, 중복 route, orphan page, stale signal, 품질 gap을 찾는 wiki diagnostics
- 기존 markdown 문서를 옮기기 위한 migration 지원
- 큰 저장소에서 코드 근거 기반 wiki 갱신을 돕는 선택적 code evidence index

그 결과 같은 컨텍스트를 반복해서 다시 모으는 일이 줄어듭니다. 에이전트는 현재 프로젝트 의도에서 시작하고, 필요할 때만 상세 문서를 읽으며, 사람이 검토할 수 있는 파일에 프로젝트 결정을 남길 수 있습니다.

## Quick Start

### 1. Skill 설치

Codex와 Claude Code용 skill을 한 번 설치합니다.

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

현재 저장소 안에만 설치하려면 `--scope project`를 사용합니다.

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

`install-skill`은 `.codex/skills/` 및/또는 `.claude/skills/` 아래에 재사용 가능한 skill 파일만 설치합니다. `AGENTS.md`, `CLAUDE.md`, `wiki/`, `.codex/hooks.json`, `.claude/settings.json`은 생성하거나 갱신하지 않습니다.

설치 옵션:

| 상황 | 명령 |
| --- | --- |
| Codex와 Claude Code에 전역 설치 | `npx project-wiki-bootstrap install-skill --scope user --agents both` |
| 현재 저장소의 Codex와 Claude Code에 설치 | `npx project-wiki-bootstrap install-skill --scope project --agents both` |
| 한 에이전트에만 설치 | `npx project-wiki-bootstrap install-skill --agents codex` 또는 `--agents claude` |

### 에이전트 세션의 로컬 Runner

skill 설치 후 Codex와 Claude Code는 npm에서 패키지를 다시 가져오지 말고 설치된 로컬 사본을 실행해야 합니다. 이렇게 하면 제한된 에이전트 환경에서 network 실패와 미고정 공개 패키지 실행 차단을 피할 수 있습니다.

자주 쓰는 로컬 runner:

| 설치 위치 | Runner |
| --- | --- |
| 프로젝트 범위 Codex skill | `node .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 프로젝트 범위 Claude skill | `node .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 사용자 범위 Codex skill | `node ~/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 사용자 범위 Claude skill | `node ~/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |

직접 shell에서 실행하는 사용자는 registry 접근이 가능할 때 `npx project-wiki-bootstrap ...`를 계속 사용할 수 있습니다. 설치된 skill을 사용하는 에이전트는 로컬 runner를 우선해야 하며, 실패하면 생성 파일을 수동으로 재구성하는 fallback 대신 실제 오류를 보고해야 합니다.

### 2. Project Wiki 생성, 갱신, 유지보수

skill 설치 후 대상 프로젝트 루트에서 wiki 명령을 실행합니다.

```bash
npx project-wiki-bootstrap
```

Wiki 명령:

| 상황 | 명령 |
| --- | --- |
| wiki 생성 또는 갱신 | `npx project-wiki-bootstrap` |
| 기존 docs/wiki 마이그레이션 | `npx project-wiki-bootstrap --migrate` |
| 링크와 문서 품질 점검 | `npx project-wiki-bootstrap --doctor` |
| 안전한 routing 갱신 후 점검 | `npx project-wiki-bootstrap --doctor --fix` |
| git 설정 변경 없이 hook 파일만 설치 | `npx project-wiki-bootstrap --no-git-config` |

## Skill Actions

설치 후 Codex 또는 Claude Code에 다음 작업을 요청할 수 있습니다.

- 프로젝트 wiki 생성, 갱신, 검증
- wiki 링크, 중복 route, orphan page, 문서 품질 점검
- wiki 문서 검색
- `wiki/index.md` 갱신
- 후보 메모를 `wiki/inbox/project-candidates.md`에 저장
- stale 또는 undecided 상태의 wiki 문서 보고
- 스킬 사용 중 발견한 문제나 부작용을 GitHub issue 본문 초안으로 작성
- `wiki/canonical/glossary.md` 생성
- 기존 markdown 문서를 검토 가능한 inbox로 마이그레이션
- 코드를 분석해 근거가 있는 프로젝트 정보를 wiki에 반영

예시:

```text
Apply project-wiki-bootstrap to this project.
Validate the project wiki setup.
Search the project wiki for authentication decisions.
Analyze apps/web and packages/api, then update the wiki from the code.
Review the migrated wiki inbox.
```

Claude Code에서는 `/project-wiki-bootstrap`도 사용할 수 있습니다.

## Wiki Diagnostics

이미 생성된 wiki를 검토하거나 정리할 때 사용합니다.

| 목적 | 명령 |
| --- | --- |
| 생성된 setup 검증 | `npx project-wiki-bootstrap --lint` |
| 깨진 링크, 중복 index route, orphan page 점검 | `npx project-wiki-bootstrap --link-check` |
| stale page, unresolved signal, TL;DR 누락, budget drift, evidence gap 점검 | `npx project-wiki-bootstrap --quality-check` |
| setup, link, quality 점검 통합 실행 | `npx project-wiki-bootstrap --doctor` |
| 안전한 routing fix 후 진단 실행 | `npx project-wiki-bootstrap --doctor --fix` |

깨진 링크는 실패로 처리합니다. 중복 route, orphan page, 품질 항목은 사람이 병합, routing, 갱신, 재작성 여부를 판단할 수 있도록 warning으로 보고합니다.

## GitHub Issue Drafts

project-wiki-bootstrap 실행 중 부작용이 생기거나, 동작이 헷갈리거나, 특정 환경에서 실패하거나, 예상하지 못한 파일이 생성되었을 때 사용합니다.

```bash
npx project-wiki-bootstrap --issue-draft --issue-title "Report unexpected wiki hook behavior"
```

이 명령은 read-only입니다. 재현 단계, 기대 동작과 실제 동작, 부작용, 영향을 받은 생성 파일, 환경 정보, 첨부할 diagnostics를 포함한 Markdown 문제 보고 템플릿을 출력합니다. GitHub issue를 직접 생성하지 않으며 network access도 필요하지 않습니다.

이 스킬을 사용하는 LLM이 project-wiki-bootstrap의 버그, 회귀, 워크플로 불일치, 헷갈리는 생성 동작, 의도하지 않은 부작용을 발견하면, 사용자가 issue draft 생성을 원하지 않는다고 명시하지 않은 한 LLM은 작업을 마무리하기 전에 read-only issue draft를 실행합니다. 이 단계는 로컬 문제 수정을 대체하지 않습니다.

## 설치되는 파일

프로젝트 지시 파일:

- `AGENTS.md`
- `CLAUDE.md`
- `wiki/AGENTS.md`

시작 hook:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`

선택적 git hook 파일:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

wiki 디렉터리:

- `wiki/canonical/`
- `wiki/decisions/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/inbox/`
- `wiki/migration/`

## Code Evidence Index

큰 저장소에서는 폐기 가능한 SQLite evidence cache를 만들 수 있습니다.

```bash
npx project-wiki-bootstrap --code-index --code-scope src
```

cache는 `.project-wiki/` 아래에 생성되며 필요할 때 다시 만들 수 있습니다. wiki 갱신을 위한 근거이지 canonical wiki content가 아닙니다. `.env.example`을 제외한 `.env*` 파일과 secret, credential, token, private, key 용어가 들어간 명백한 민감 config 파일명은 기본적으로 제외됩니다.

유용한 명령:

| 목적 | 명령 |
| --- | --- |
| cache 생성 또는 갱신 | `npx project-wiki-bootstrap --code-index --code-scope src` |
| 집계 보기 | `npx project-wiki-bootstrap --code-status` |
| indexed file 목록 | `npx project-wiki-bootstrap --code-files` |
| symbol 검색 | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| read-only SQL 실행 | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

Code evidence indexing은 `node:sqlite`를 제공하는 Node runtime이 필요합니다. 기본 bootstrap 명령은 Node 18+를 지원하지만, evidence index는 현재 `node:sqlite`가 포함된 더 최신 Node 릴리스가 필요합니다.

## Language Support Matrix

아래 matrix는 symbol/import 추출이 구현된 언어만 포함합니다. 그 외 인식되는 확장자는 inventory-only이며 언어 지원으로 보지 않습니다.

| 언어 | 확장자 | Extraction profile | Indexed evidence |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | function, class, method, variable, interface, type, enum, import, export, call, common HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | function, class, method, variable, import, export, `require()` call, call, common HTTP route |
| Python | `.py` | `python-light` | function, class, `import`, `from ... import` |

Config 파일(`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`)은 별도의 configuration evidence로 indexed 됩니다.

## 정책과 side effect

- git 저장소에서는 `core.hooksPath`가 비어 있을 때 기본적으로 `git config core.hooksPath .githooks`를 설정합니다.
- 다른 `core.hooksPath`가 이미 있으면 bootstrap은 기존 값을 보존하고 git config 변경을 건너뛰었다고 보고합니다.
- `--no-git-config`를 사용하면 `core.hooksPath`를 바꾸지 않고 hook 파일만 설치합니다.
- 기존 `AGENTS.md`, `CLAUDE.md`, `wiki/AGENTS.md`는 project-wiki marker block 밖의 내용을 보존합니다.
- 생성되는 운영 문서는 기본적으로 영어입니다. 프로젝트 canonical wiki content는 사용자 지시나 기존 프로젝트 언어를 따릅니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다. 긴 채팅 기록에서 프로젝트 컨텍스트를 매번 재구성하는 대신, 작업 가까이에 지속적인 markdown wiki를 둔다는 아이디어입니다.

Project Wiki Bootstrap은 그 아이디어를 Codex와 Claude Code에서 설치해 쓸 수 있는 bootstrap으로 바꿨습니다. 저장소 로컬 지시문, 시작 hook, migration helper, 선택적 code evidence를 함께 제공합니다.

## Development

소스는 TypeScript입니다. 커밋된 `dist/` 디렉터리는 npm binary와 skill 설치에 사용되는 컴파일 결과입니다.

Repository layout:

- `src/init-project-wiki.ts`: CLI entrypoint
- `src/args.ts`: command-line argument parsing
- `src/hooks.ts`: Codex, Claude Code, git hook 생성
- `src/install-skill.ts`: user/project skill installer
- `src/templates.ts`: 생성되는 instruction 및 wiki template
- `src/code-index.ts`: 선택적 SQLite code evidence index
- `src/wiki-files.ts`: wiki file discovery 및 markdown helper
- `src/migration.ts`: 기존 wiki migration
- `src/modes.ts`: lint, search, refresh, capture, prune mode
- `dist/`: 컴파일 결과

Development commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 아래 TypeScript를 수정했다면 커밋 전에 rebuild해서 `dist/`를 맞춰야 합니다.

## License

MIT
