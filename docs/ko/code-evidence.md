# 코드 근거

Project Librarian은 `.project-wiki/` 아래 폐기 가능한 SQLite 인덱스를 만들고, 읽기 전용 CLI와 MCP 표면으로 제공할 수 있습니다. 이 기능은 선택 사항이며 계획 위키는 코드 근거 없이도 동작합니다.

## 최신성 계약

`--code-report`, `--code-impact`, `--code-context-pack`, MCP 도구 출력을 현재 코드 구조 근거로 인용하기 전에는 다음을 실행합니다.

```bash
project-librarian --code-status
```

또는 MCP `code_status`를 실행하고 `stale_files: 0`인지 확인해야 합니다. 오래된 보고서는 재빌드가 필요하다는 신호이지 권위 있는 프로젝트 진실이 아닙니다.

## 규모 게이트

코드 근거 인덱스는 모든 상황에서 이기는 도구가 아니라 규모 교차점이 있는 도구로 측정됐습니다. 인덱싱 가능 파일이 약 5k개 미만이면 `--acknowledge-small-repo`를 주지 않는 한 `--code-index`는 중단됩니다. 기존 `.project-wiki` SQLite 인덱스로 사용자가 이미 선택했음을 알 수 있는 경우가 아니면 부트스트랩은 MCP 자동 등록도 건너뜁니다.

측정된 릴리스 근거:

| 질문 | excalidraw (약 1.2k 파일) | backstage (약 11.8k 파일) |
| --- | --- | --- |
| impact_trace | 117% 많음 | **27.7% 적음** |
| workspace_graph | 106% 많음 | 2.6% 적음 |
| ownership_lookup | - | 99% 많음 |

인덱스는 큰 저장소의 비싼 순회 질문에서만 효과가 납니다. 저렴한 조회는 큰 규모에서도 손해일 수 있습니다.

## MCP 서버

`project-librarian mcp`는 기존 `.project-wiki` 코드 근거 인덱스를 읽기 전용으로 제공하는 직접 구현 stdio MCP 서버입니다. 줄바꿈 구분 JSON 위의 JSON-RPC 2.0을 사용하며 MCP SDK 의존성은 없습니다. 패키지의 필수 런타임 의존성은 `typescript`이고, 코드 근거 기능은 Node의 `node:sqlite`도 사용합니다. Tree-sitter 문법 패키지는 선택 사항입니다.

서버가 제공하는 답변 형태 도구:

- `code_context_pack`
- `code_impact`
- `code_ownership`
- `code_workspace_graph`
- `code_search`
- `code_status`

응답은 한 줄 답변으로 시작하고, 간결한 경로/심볼/시그니처 근거가 뒤따르며, 응답 길이를 제한합니다. `code_status`가 인덱스가 오래되었다고 보고하면 경고를 앞에 붙입니다.

고정 리소스도 제공합니다.

- `project-librarian://wiki/startup`
- `project-librarian://wiki/index`
- `project-librarian://code/status`

위키 분류 갱신, 코드 영향 추적, 유지보수 개선 검토, 검색 품질 검토용 프롬프트 템플릿도 포함합니다. 리소스 읽기는 임의 파일 경로가 아니라 고정 URI 레지스트리에서만 처리합니다.

부트스트랩은 Claude Code(`.mcp.json`), Cursor(`.cursor/mcp.json`), Gemini CLI(`.gemini/settings.json`의 `mcpServers`)에 서버를 등록하며 기존 서버와 키를 보존합니다. 저장소에 로컬 실행 경로가 있으면 `node <runner> mcp`를 사용하고, 없으면 설치된 `project-librarian mcp` 바이너리를 사용합니다.

Codex는 MCP 서버를 사용자 수준에서만 등록하므로 부트스트랩은 프로젝트 수준 Codex MCP 설정을 쓰지 않습니다. Codex에서 쓰려면 한 번만 실행합니다.

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## 언어 지원 표

이 표는 심볼/import 추출이 구현된 언어를 보여줍니다. 그 밖의 인식된 확장자는 inventory-only입니다. 기본 모드는 JS/TS에 `typescript-ast`, 나머지 언어에 `*-light`, 설정 추출, inventory row를 사용합니다. `--code-parser tree-sitter`는 지원 소스 파일을 `tree-sitter-*` 프로파일로 전환합니다.

| 언어 | 확장자 | 기본 추출 | Tree-sitter 추출 | 인덱싱되는 근거 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 함수, 클래스, 메서드, 변수, 인터페이스, 타입, enum, import/export, 호출, 일반 HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 함수, 클래스, 메서드, 변수, import/export, `require()` 호출, 호출, 일반 HTTP route |
| Python | `.py` | `python-light` | `tree-sitter-python` | 함수, 클래스, `import`, `from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | 함수, 메서드, 타입, const, var, 단일 import, import block |
| Rust | `.rs` | `rust-light` | `tree-sitter-rust` | 함수, struct, enum, trait, impl, `use` import |
| Java | `.java` | `java-light` | `tree-sitter-java` | 클래스, 인터페이스, enum, 메서드, import |
| PHP | `.php` | `php-light` | `tree-sitter-php` | 함수, 클래스, 인터페이스, trait, 메서드, namespace use |
| Kotlin | `.kt`, `.kts` | `kotlin-light` | `tree-sitter-kotlin` | 함수, 클래스, object, import |
| Swift | `.swift` | `swift-light` | `tree-sitter-swift` | 함수, 클래스, struct, protocol, enum, import |
| C | `.c`, `.h` | `c-light` | `tree-sitter-c` | 함수, struct, enum, include |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | `cpp-light` | `tree-sitter-cpp` | 함수, 클래스/struct, namespace, enum, include/using |
| C# | `.cs` | `csharp-light` | `tree-sitter-csharp` | 클래스, 인터페이스, struct, enum, 메서드, using |

`.rb`, `.vue`, `.css`는 인식하지만 inventory-only입니다. `.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`, `Dockerfile`, `Makefile`은 설정 또는 inventory 근거로 인덱싱됩니다.

## 스키마 마이그레이션

코드 근거 인덱스는 폐기 가능한 캐시지만, Project Librarian은 스키마 버전 변경을 명시적 마이그레이션 경계로 취급합니다. 기존 `.project-wiki/code-evidence.sqlite`의 스키마 버전이 현재 패키지와 다르면 `--code-index`는 데이터베이스를 교체하기 전에 멈추고 마이그레이션 필요 메시지와 승인 명령을 출력합니다.

현재 인덱스 상태는 `project-librarian --code-index-health`로 확인합니다. 호환되지 않는 스키마의 인덱스 교체를 승인하려면 새 인덱스에 적용할 scope/parser 옵션과 함께 `--code-index --code-index-migrate`를 다시 실행합니다. `--incremental`은 스키마 버전을 마이그레이션할 수 없습니다.

## 네이티브 헬퍼 정책

실험적 `--code-index-engine native-rust`는 `typescript-ast`, `config`, 표의 `*-light` 프로파일, inventory-only 소스 파일을 네이티브 헬퍼로 처리합니다. `--code-index-engine`을 생략하면 `auto`입니다. full-index auto는 헬퍼를 사용할 수 있고 구조적으로 추출되는 네이티브 프로파일이 하나 이상 있을 때 네이티브 헬퍼를 사용하며, config-only 또는 inventory-only 저장소는 TypeScript 경로에 남깁니다. 호환되는 incremental auto는 헬퍼를 사용할 수 있고 변경 파일이 native-eligible이면 Rust direct-writer를 사용합니다.

헬퍼 탐색은 `PROJECT_LIBRARIAN_NATIVE_INDEXER`를 먼저 보고, 없으면 `dist/native/<platform>-<arch>/project-librarian-indexer` 또는 `.exe`를 확인합니다. Linux musl 설치는 `dist/native/linux-<arch>-musl/`을 확인합니다.

공개 릴리스는 staged helper 하나만 배포하면 안 됩니다. `release:check`는 packaged native helper가 없거나 지원 플랫폼 전체 matrix(`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`, `linux-x64-musl`, `win32-arm64`, `win32-x64`)가 있을 때만 통과하며, helper 실행 비트, Mach-O/ELF/PE 플랫폼 헤더, packaged-helper SHA-256 manifest도 확인합니다.
