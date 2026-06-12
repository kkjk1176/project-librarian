# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![코드 근거 인덱스](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

Codex, Claude Code, Cursor, Gemini CLI를 위한 간결한 프로젝트 메모리와 코드 근거.

Project Librarian은 저장소 로컬 계획 위키, 간결한 시작 훅, 선택적 SQLite 코드 근거 인덱스를 생성합니다. 에이전트는 프로젝트 계획에서 시작하고, 필요한 문서로 라우팅하며, 전체 저장소를 반복 스캔하지 않고 코드로 뒷받침되는 근거를 확인할 수 있습니다.

언어: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

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

벤치마크는 관리자 릴리스 근거이며 공개 사용자 작업 흐름이 아닙니다. README와 릴리스 노트가 모호한 성능 표현 대신 경계가 있는 숫자로 설명할 수 있게 하기 위한 근거입니다.

현재 로컬 측정 보고서: `benchmarks/reports/llm/current-local.json`, `benchmarks/reports/llm/current-local.md`, 2026-06-10 생성, ChatGPT/Codex 인증, `gpt-5.5`, `decision_lookup`, 조건별 측정 1회, 예열 없음. 아래 값은 실제 Codex JSONL usage와 로컬 wall-clock 측정값입니다. 양수 delta는 Project Librarian 조건이 미사용 control보다 더 많이 사용했다는 뜻입니다.

| 규모 | Project Librarian 미사용 | Project Librarian 사용 | 실제 delta |
| --- | ---: | ---: | ---: |
| 소형 | total 102,655 tokens; input 101,226; 37.15s; command 9회 | total 176,104 tokens; input 173,733; 61.04s; command 15회 | tokens +71.55%; time +64.33%; commands +66.67% |
| 중형 | total 79,340 tokens; input 78,348; 44.28s; command 5회 | total 165,840 tokens; input 163,856; 48.48s; command 10회 | tokens +109.02%; time +9.5%; commands +100% |
| 대형 | total 197,097 tokens; input 195,278; 45.87s; command 10회 | total 183,959 tokens; input 181,897; 49.42s; command 13회 | tokens -6.67%; time +7.72%; commands +30% |

주장 범위: 이 승인된 로컬 실행은 benchmark claim gate를 통과했지만 clean release baseline은 아닙니다. dirty worktree, 조건별 1회 실행이며, 런타임 상태 파일이 생성 fixture 디렉터리를 건드렸기 때문에 post-run fixture fingerprint validator는 clean isolated rerun이 필요합니다. 반복 clean actual-LLM 실행에서 안정적인 delta가 나오기 전까지 Project Librarian의 토큰/시간 개선을 주장하지 않습니다.

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

코드 근거:

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

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `wiki/AGENTS.md`
- `.cursor/rules/project-librarian.mdc`
- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`
- `.cursor/hooks.json`
- `.cursor/hooks/wiki-session-start.js`
- `.gemini/settings.json`
- `.gemini/hooks/wiki-session-start.js`
- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`
- `wiki/canonical/`, `wiki/decisions/`, `wiki/inbox/`, `wiki/meta/`, `wiki/sources/`, `wiki/migration/`
- 폐기 가능한 코드 근거 캐시인 `.project-wiki/code-evidence.sqlite`

## 작동 방식

1. Bootstrap은 보존 우선 위키 구조와 marker로 경계가 정해진 에이전트 지시 섹션을 만듭니다.
2. 세션 시작 훅은 문자 예산이 적용된 `wiki/startup.md`와 `wiki/index.md`만 주입합니다.
3. 상세 계획 정본은 canonical, decision, source, meta page에 있고 에이전트가 필요할 때 읽습니다.
4. `--refresh-index`는 새 위키 페이지를 라우팅하며, route가 많으면 `wiki/indexes/auto-*.md` 범위별 라우터로 분리합니다.
5. `--code-index`는 `.project-wiki/` 아래 폐기 가능한 SQLite 근거 캐시를 만듭니다.
6. `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`가 계획 갱신용 코드 근거를 제공합니다.
7. 진단은 깨진 링크, 중복 route, orphan page, 오래된 페이지, 누락된 TL;DR, 근거 gap, 마이그레이션 정책 위반을 보고합니다.

마이그레이션은 검토 우선입니다. `--migrate`는 기존 `wiki/`를 `wiki_legacy*`로 보존하고 마이그레이션 inbox와 unit-level coverage ledger를 작성하며, legacy 의미를 현재 wiki 규칙에 맞게 재구성합니다. 보존하거나 복사한 legacy 내용은 새 wiki 정책과 구조에 맞으면 허용되며, 새 wiki가 `wiki_legacy*` 참조에 의존하면 안 됩니다.

## 언어 지원 표

| 언어 | 확장자 | 기본 추출 | Tree-sitter 추출 | 인덱싱되는 근거 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 함수, 클래스, 메서드, 변수, 인터페이스, 타입, enum, import, export, 호출, 일반 HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 함수, 클래스, 메서드, 변수, import, export, `require()` 호출, 일반 HTTP route |
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

`.rb`, `.vue`, `.css`는 인식되지만 목록 전용입니다. 설정 파일은 설정 근거 또는 목록 근거로 인덱싱됩니다.

## CLI 참조

에이전트 실행에는 로컬 실행 경로를 사용합니다.

```bash
$PROJECT_LIBRARIAN [init] [options]
$PROJECT_LIBRARIAN install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]
```

중요 옵션: `--migrate`, `--lint`, `--link-check`, `--quality-check`, `--doctor`, `--doctor --fix`, `--migration-lint`, `--migration-quality-check`, `--migration-doctor`, `--query`, `--wiki-impact`, `--refresh-index`, `--capture-inbox`, `--issue-draft`, `--issue-create`, `--glossary-init`, `--prune-check`, `--review-migration`, `--no-git-config`, `--code-index`, `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`.

## 개발

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

관리자 벤치마크 명령은 [benchmarks/README.md](benchmarks/README.md)에 있습니다. 이 명령은 릴리스 근거와 공개 주장 검증을 위한 것이며, 일반 최종 사용자 설정 절차가 아닙니다.

## 영감

이 프로젝트는 Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴에서 영감을 받았습니다.

## 라이선스

MIT
