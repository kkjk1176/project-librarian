# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

小さなリポジトリから大規模プロジェクトやモノレポまで、人間と LLM コーディングエージェントが使う token-efficient なプロジェクト計画 wiki を作成します。

言語: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成される wiki は、起動コンテキストを小さく保ちます。

- `wiki/startup.md`: 現在のプロジェクト要約
- `wiki/index.md`: 次に読む詳細ページのルーター
- `wiki/canonical/`、`wiki/decisions/`、`wiki/sources/`、`wiki/meta/`: 必要なときだけ読む詳細コンテキスト

## 得られるもの

Project Wiki Bootstrap は、コーディングエージェントが予測可能に読める、リポジトリローカルの計画メモリを作ります。

主な機能:

- Codex と Claude Code 用の wiki-first プロジェクト指示
- compact な起動コンテキストだけを読み込む session-start hook
- 現在のプロジェクト事実、前提、リスク、意思決定、source を置く canonical 文書
- 壊れたリンク、重複 route、orphan page、stale signal、品質 gap を見つける wiki diagnostics
- 既存 markdown 文書を移行するための migration support
- 大きなリポジトリでコード根拠に基づく wiki 更新を助ける任意の code evidence index

これにより、同じコンテキストを繰り返し集め直す作業を減らせます。エージェントは現在のプロジェクト意図から開始し、必要なときだけ詳細文書を読み、人間がレビューできるファイルにプロジェクトの意思決定を残せます。

## Quick Start

### 1. Skill をインストール

Codex と Claude Code 用の skill を一度インストールします。

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

現在のリポジトリ内にインストールする場合は `--scope project` を使います。

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

`install-skill` は `.codex/skills/` および/または `.claude/skills/` の下に再利用可能な skill ファイルだけをインストールします。`AGENTS.md`、`CLAUDE.md`、`wiki/`、`.codex/hooks.json`、`.claude/settings.json` は作成または更新しません。

インストールオプション:

| 状況 | コマンド |
| --- | --- |
| Codex と Claude Code にグローバルインストール | `npx project-wiki-bootstrap install-skill --scope user --agents both` |
| 現在のリポジトリの Codex と Claude Code にインストール | `npx project-wiki-bootstrap install-skill --scope project --agents both` |
| 1 つのエージェントだけにインストール | `npx project-wiki-bootstrap install-skill --agents codex` または `--agents claude` |

### エージェントセッションのローカル Runner

skill のインストール後、Codex と Claude Code は npm からパッケージを再取得せず、インストール済みのローカルコピーを実行するべきです。これにより、制限されたエージェント環境での network failure や未固定の公開パッケージ実行のブロックを避けられます。

よく使うローカル runner:

| インストール先 | Runner |
| --- | --- |
| Project-scoped Codex skill | `node .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| Project-scoped Claude skill | `node .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| User-scoped Codex skill | `node ~/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| User-scoped Claude skill | `node ~/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |

直接 shell で実行するユーザーは、registry access が利用できる場合に `npx project-wiki-bootstrap ...` を引き続き使えます。インストール済み skill を使うエージェントはローカル runner を優先し、失敗した場合は生成ファイルを手作業で再構成する fallback ではなく、実際のエラーを報告してください。

### 2. Project Wiki を作成、更新、保守

skill のインストール後、対象プロジェクトのルートで wiki コマンドを実行します。

```bash
npx project-wiki-bootstrap
```

Wiki コマンド:

| 状況 | コマンド |
| --- | --- |
| wiki の作成または更新 | `npx project-wiki-bootstrap` |
| 既存 docs/wiki の移行 | `npx project-wiki-bootstrap --migrate` |
| リンクと文書品質をチェック | `npx project-wiki-bootstrap --doctor` |
| 安全な routing 更新後にチェック | `npx project-wiki-bootstrap --doctor --fix` |
| git 設定を変更せず hook ファイルだけをインストール | `npx project-wiki-bootstrap --no-git-config` |

## Skill Actions

インストール後、Codex または Claude Code に次の作業を依頼できます。

- プロジェクト wiki の作成、更新、検証
- wiki リンク、重複 route、orphan page、文書品質のチェック
- wiki ページの検索
- `wiki/index.md` の更新
- 候補メモを `wiki/inbox/project-candidates.md` に保存
- stale または undecided 状態の wiki ページの報告
- skill 使用中に見つかった問題や副作用の GitHub issue body ドラフトを作成
- `wiki/canonical/glossary.md` の作成
- 既存 markdown 文書の review 用 inbox への移行
- コードを分析し、根拠のあるプロジェクト情報を wiki に反映

例:

```text
Apply project-wiki-bootstrap to this project.
Validate the project wiki setup.
Search the project wiki for authentication decisions.
Analyze apps/web and packages/api, then update the wiki from the code.
Review the migrated wiki inbox.
```

Claude Code では `/project-wiki-bootstrap` も使えます。

## Wiki Diagnostics

既存 wiki のレビューや整理に使います。

| 目的 | コマンド |
| --- | --- |
| 生成された setup を検証 | `npx project-wiki-bootstrap --lint` |
| 壊れたリンク、重複 index route、orphan page をチェック | `npx project-wiki-bootstrap --link-check` |
| stale page、unresolved signal、TL;DR 欠落、budget drift、evidence gap をチェック | `npx project-wiki-bootstrap --quality-check` |
| setup、link、quality チェックをまとめて実行 | `npx project-wiki-bootstrap --doctor` |
| 安全な routing fix の後に診断を実行 | `npx project-wiki-bootstrap --doctor --fix` |

壊れたリンクは失敗として扱います。重複 route、orphan page、品質項目は、merge、routing、更新、rewrite の判断材料として warning で報告します。

問題や副作用の GitHub issue body ドラフトを作るには `npx project-wiki-bootstrap --issue-draft --issue-title "Report unexpected wiki hook behavior"` を使います。このコマンドは read-only で、再現手順、期待動作と実際の動作、影響を受けた生成ファイル、環境情報、添付すべき diagnostics のテンプレートを出力します。GitHub issue は作成せず network access も不要です。

GitHub repository でユーザーが明示的に許可した場合は、GitHub CLI で実際の issue を作成できます: `npx project-wiki-bootstrap --issue-create --issue-title "Report unexpected wiki hook behavior"`。このコマンドは `gh auth status` の後に `gh issue create --title ... --body-file ...` を呼び出します。認証済みの `gh`、GitHub remote、network access が必要です。失敗した場合は draft に silently fallback せず、実際の error を報告します。

この skill を使う LLM が project-wiki-bootstrap の bug、regression、workflow mismatch、紛らわしい生成挙動、意図しない side effect を見つけた場合、ユーザーが issue draft を不要だと明示していない限り、LLM は作業を終える前に read-only issue draft を実行します。これはローカル修正の代替ではありません。

## インストールされるファイル

プロジェクト指示ファイル:

- `AGENTS.md`
- `CLAUDE.md`
- `wiki/AGENTS.md`

起動 hook:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`

任意の git hook ファイル:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

wiki ディレクトリ:

- `wiki/canonical/`
- `wiki/decisions/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/inbox/`
- `wiki/migration/`

## Code Evidence Index

大きなリポジトリでは、破棄可能な SQLite evidence cache を作成できます。

```bash
npx project-wiki-bootstrap --code-index --code-scope src
```

cache は `.project-wiki/` 配下に作成され、必要に応じて再生成できます。これは wiki 更新のための根拠であり、canonical wiki content ではありません。`.env.example` 以外の `.env*` ファイルと、secret、credential、token、private、key 系の語を含む明らかに機密性の高い config ファイル名は既定で除外されます。

便利なコマンド:

| 目的 | コマンド |
| --- | --- |
| cache の作成または更新 | `npx project-wiki-bootstrap --code-index --code-scope src` |
| optional Tree-sitter parser backend で cache を作成 | `npx project-wiki-bootstrap --code-index --code-parser tree-sitter --code-scope src` |
| 増分 cache 更新を必須にする | `npx project-wiki-bootstrap --code-index --incremental --code-scope src` |
| cache の full rebuild を強制 | `npx project-wiki-bootstrap --code-index --code-index-full --code-scope src` |
| 集計の表示 | `npx project-wiki-bootstrap --code-status` |
| indexed file の一覧 | `npx project-wiki-bootstrap --code-files` |
| architecture/ownership/parser backend/routes/dependencies/evidence coverage の要約 | `npx project-wiki-bootstrap --code-report` |
| 必要な report section だけを出力 | `npx project-wiki-bootstrap --code-report --code-report-section routes` |
| workspace と CODEOWNERS signal の確認 | `npx project-wiki-bootstrap --code-report --code-report-section workspaces` |
| workspace package manager, lockfile, internal dependency graph signal の確認 | `npx project-wiki-bootstrap --code-report --code-report-section workspace-graph` |
| file/symbol/route/module の impact evidence を確認 | `npx project-wiki-bootstrap --code-impact healthHandler` |
| symbol 検索 | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| read-only SQL の実行 | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

Code evidence indexing には `node:sqlite` を提供する Node runtime が必要です。基本の bootstrap コマンドは Node 18+ をサポートしますが、evidence index は `node:sqlite` が Node 22.5.0 で追加され、Node 22.13.0 から `--experimental-sqlite` なしで使えるため、Node 22.13+ または Node 24+ を推奨します。`--code-parser tree-sitter` は optional `@sengac/tree-sitter*` packages を使い、それらが未インストールの場合は package error で失敗します。

## Language Support Matrix

この matrix には symbol/import extraction が実装されている言語だけを含めます。その他の認識済み拡張子は inventory-only であり、言語サポートとは見なしません。default mode は `typescript-ast`, `python-light`, `go-light` を使い、`--code-parser tree-sitter` は対応 source file を `tree-sitter-*` profiles に切り替えます。Ruby は互換 grammar package を選ぶまで inventory-only です。構造 parser evidence はより強い根拠として扱い、lightweight row は canonical claim の前に source で確認してください。

| 言語 | 拡張子 | Extraction profile | Indexed evidence |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast`; optional `tree-sitter-typescript` / `tree-sitter-tsx` | function, class, method, variable, interface, type, enum, import, export, call, common HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast`; optional `tree-sitter-javascript` | function, class, method, variable, import, export, `require()` call, call, common HTTP route |
| Python | `.py` | `python-light`; optional `tree-sitter-python` | function, class, `import`, `from ... import` |
| Go | `.go` | `go-light`; optional `tree-sitter-go` | function, method, type, const, var, single import, import block |
| Rust | `.rs` | default inventory-only; optional `tree-sitter-rust` | function, struct, enum, trait, impl, `use` import |
| Java | `.java` | default inventory-only; optional `tree-sitter-java` | class, interface, enum, method, import |
| PHP | `.php` | default inventory-only; optional `tree-sitter-php` | function, class, interface, trait, method, namespace use |
| Kotlin | `.kt`, `.kts` | default inventory-only; optional `tree-sitter-kotlin` | function, class, object, import |
| Swift | `.swift` | default inventory-only; optional `tree-sitter-swift` | function, class, struct, protocol, enum, import |
| C | `.c`, `.h` | default inventory-only; optional `tree-sitter-c` | function, struct, enum, include |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | default inventory-only; optional `tree-sitter-cpp` | function, class/struct, namespace, enum, include/using |
| C# | `.cs` | default inventory-only; optional `tree-sitter-csharp` | class, interface, struct, enum, method, using |

Config ファイル (`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`) は、別の configuration evidence として indexed されます。

## ポリシーと side effect

- git リポジトリでは、`core.hooksPath` が未設定の場合にデフォルトで `git config core.hooksPath .githooks` を設定します。
- 既存の `core.hooksPath` がある場合、bootstrap はその値を保持し、git config の変更をスキップしたことを報告します。
- `--no-git-config` を使うと、`core.hooksPath` を変更せず hook ファイルだけをインストールします。
- 既存の `AGENTS.md`、`CLAUDE.md`、`wiki/AGENTS.md` は project-wiki marker block の外側を保持します。
- 生成される運用文書はデフォルトで英語です。プロジェクトの canonical wiki content はユーザー指示または既存のプロジェクト言語に従います。

## Inspiration

このプロジェクトは Andrej Karpathy の [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern に影響を受けています。長いチャット履歴からプロジェクトコンテキストを毎回再構築するのではなく、作業の近くに永続的な markdown wiki を置くという考え方です。

Project Wiki Bootstrap はその考え方を、Codex と Claude Code でインストールして使える bootstrap に適用しています。リポジトリローカルの指示、起動 hook、migration helper、任意の code evidence を提供します。

## Development

ソースは TypeScript です。コミット済みの `dist/` ディレクトリは、npm binary と skill インストールで使われるコンパイル結果です。

Repository layout:

- `src/init-project-wiki.ts`: CLI entrypoint
- `src/args.ts`: command-line argument parsing
- `src/hooks.ts`: Codex、Claude Code、git hook 生成
- `src/install-skill.ts`: user/project skill installer
- `src/templates.ts`: 生成される instruction と wiki template
- `src/code-index.ts`: 任意の SQLite code evidence index
- `src/wiki-files.ts`: wiki file discovery と markdown helper
- `src/migration.ts`: 既存 wiki migration
- `src/modes.ts`: lint、search、refresh、capture、prune mode
- `dist/`: コンパイル結果

Development commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 配下の TypeScript を変更した場合は、コミット前に rebuild して `dist/` を合わせてください。

## License

MIT
