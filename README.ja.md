# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![コード根拠インデックス](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

Codex、Claude Code、Cursor、Gemini CLI のための簡潔なプロジェクトメモリとコード根拠。

Project Librarian は、リポジトリローカルの計画 wiki、簡潔な起動 hook、任意の SQLite コード根拠 index を作成します。エージェントはプロジェクト計画から開始し、必要な文書へルーティングされ、リポジトリ全体を繰り返しスキャンせずにコードに基づく根拠を確認できます。

言語: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

## 存在理由

LLM コーディングエージェントは、セッションごとにプロジェクトを再発見するためにコンテキストとツール呼び出しを消費しがちです。古い会話の読み取り、Markdown のスキャン、ソース検索、関連ファイルの推測が繰り返されます。

Project Librarian はエージェントに 2 つのローカル正本を提供します。

| 表面 | エージェントが得るもの |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 短いセッション開始要約とルーター。必要な計画ページだけを読みます。 |
| `wiki/canonical/` および `wiki/decisions/` | 現在のプロジェクト事実、制約、リスク、パッケージ契約、CLI 動作、持続的な意思決定。 |
| `.codex/`、`.claude/`、`.cursor/`、`.gemini/` hook | 全 wiki をロードしない Codex/Claude Code/Cursor/Gemini CLI 起動コンテキスト。 |
| `GEMINI.md` および `.cursor/rules/` | Gemini CLI と Cursor を同じ簡潔な wiki-first 契約へルーティングする instruction ファイル。 |
| `.project-wiki/code-evidence.sqlite` | ファイル、シンボル、import、route、所有者、ワークスペースグラフ、レポート、影響確認のための再生成可能なコード根拠。 |
| 診断とマイグレーションモード | リンク確認、品質確認、マイグレーション受信箱、古い信号のレポート、作業フローの問題発見時の issue draft。 |

重要なのは「文書を増やすこと」ではありません。最初のエージェント読み取り量を小さく保ち、より深いプロジェクト正本とコード根拠への信頼できる経路を与えることです。

## ベンチマーク結果

ベンチマークはメンテナー向けリリース根拠であり、公開ユーザー向け作業フローではありません。README とリリースノートが曖昧な性能表現ではなく、境界付きの数値で説明できるようにする根拠です。

現在のローカル測定レポート: `benchmarks/reports/llm/current-local.json` と `benchmarks/reports/llm/current-local.md`。2026-06-10 生成、ChatGPT/Codex auth、`gpt-5.5`、`decision_lookup`、条件ごとに測定 1 回、ウォームアップなし。以下は実際の Codex JSONL usage とローカル wall-clock 測定です。正の delta は Project Librarian 条件が no-Project-Librarian control より多く使ったことを意味します。

| Scale | Project Librarian なし | Project Librarian あり | 実測 delta |
| --- | ---: | ---: | ---: |
| Small | total 102,655 tokens; input 101,226; 37.15s; command 9回 | total 176,104 tokens; input 173,733; 61.04s; command 15回 | tokens +71.55%; time +64.33%; commands +66.67% |
| Medium | total 79,340 tokens; input 78,348; 44.28s; command 5回 | total 165,840 tokens; input 163,856; 48.48s; command 10回 | tokens +109.02%; time +9.5%; commands +100% |
| Large | total 197,097 tokens; input 195,278; 45.87s; command 10回 | total 183,959 tokens; input 181,897; 49.42s; command 13回 | tokens -6.67%; time +7.72%; commands +30% |

Claim boundary: この承認済みローカル実行は benchmark claim gate を通過しましたが、clean release baseline ではありません。dirty worktree、条件ごとに 1 回の実行であり、runtime state files が生成 fixture ディレクトリに触れたため、post-run fixture fingerprint validator には clean isolated rerun が必要です。繰り返しの clean actual-LLM 実行で安定した delta が出るまで、Project Librarian の token/time 改善は主張しません。

## インストール

初期 skill install にだけ `npx` を使います。

```bash
npx project-librarian install-skill --scope user --agents all
```

現在のリポジトリにインストール:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill` は再利用可能な skill ファイルだけをコピーします。`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`wiki/`、`.cursor/rules/`、`.cursor/hooks.json`、`.gemini/settings.json`、`.codex/hooks.json`、`.claude/settings.json` は作成または更新しません。

| 状況 | コマンド |
| --- | --- |
| 対応するすべての agent にグローバルインストール | `npx project-librarian install-skill --scope user --agents all` |
| 現在のリポジトリにインストール | `npx project-librarian install-skill --scope project --agents all` |
| Codex のみ | `npx project-librarian install-skill --agents codex` |
| Claude Code のみ | `npx project-librarian install-skill --agents claude` |
| Cursor のみ | `npx project-librarian install-skill --agents cursor` |
| Gemini CLI のみ | `npx project-librarian install-skill --agents gemini` |
| インストール結果をプレビュー | `npx project-librarian install-skill --scope project --agents all --dry-run` |

## エージェント実行経路

インストール後、エージェントは `npx` ではなく、インストール済みのローカルコピーを `node` で実行してください。これにより、制限されたエージェント環境でネットワークアクセスと固定されていないパッケージ実行を避けられます。

| インストール先 | 実行経路 |
| --- | --- |
| プロジェクト範囲 Codex skill | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| プロジェクト範囲 Claude skill | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| プロジェクト範囲 Cursor skill | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| プロジェクト範囲 Gemini skill | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| ユーザー範囲 Codex skill | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| ユーザー範囲 Claude skill | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| ユーザー範囲 Cursor skill | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| ユーザー範囲 Gemini skill | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

以下の例では次を使います。

```bash
PROJECT_LIBRARIAN="node .codex/skills/project-librarian/dist/init-project-wiki.js"
```

インストール先に合うローカル実行経路を使ってください。

## 一般的なエージェント作業

プロジェクトルートで wiki を作成または更新します。

```bash
$PROJECT_LIBRARIAN
```

Wiki の検証と保守:

| 目的 | エージェントコマンド |
| --- | --- |
| wiki 作成または更新 | `$PROJECT_LIBRARIAN` |
| 既存 docs/wiki のマイグレーション | `$PROJECT_LIBRARIAN --migrate` |
| 生成された設定の検証 | `$PROJECT_LIBRARIAN --lint` |
| リンクと文書品質の確認 | `$PROJECT_LIBRARIAN --doctor` |
| 診断前に生成 routing を更新 | `$PROJECT_LIBRARIAN --doctor --fix` |
| project wiki 検索 | `$PROJECT_LIBRARIAN --query "authentication decisions"` |
| ページの wiki バックリンク/decision_ref 引用を表示 | `$PROJECT_LIBRARIAN --wiki-impact "decisions/release-policy"` |
| 候補メモの保存 | `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate" --content "Details"` |
| 古い、または未解決の wiki ページの報告 | `$PROJECT_LIBRARIAN --prune-check` |
| git config を変えず hook ファイルをインストール | `$PROJECT_LIBRARIAN --no-git-config` |

コード根拠:

| 目的 | エージェントコマンド |
| --- | --- |
| 既定の根拠 cache 作成 | `$PROJECT_LIBRARIAN --code-index --code-scope src` |
| 複数 scope の build | `$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api` |
| 増分更新を要求 | `$PROJECT_LIBRARIAN --code-index --incremental` |
| full rebuild を強制 | `$PROJECT_LIBRARIAN --code-index --code-index-full` |
| 任意の Tree-sitter backend を使用 | `$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter` |
| cache 状態を表示 | `$PROJECT_LIBRARIAN --code-status` |
| index 済みファイル一覧 | `$PROJECT_LIBRARIAN --code-files` |
| アーキテクチャ/所有者レポートを出力 | `$PROJECT_LIBRARIAN --code-report` |
| レポート section だけ出力 | `$PROJECT_LIBRARIAN --code-report --code-report-section routes` |
| 影響根拠を確認 | `$PROJECT_LIBRARIAN --code-impact healthHandler` |
| index 済みシンボルを検索 | `$PROJECT_LIBRARIAN --code-search-symbol Auth` |
| 保守的な読み取り専用 SQL を実行 | `$PROJECT_LIBRARIAN --code-query "select path from files order by path"` |

コード根拠モードは一度に 1 つだけ実行できます。`--incremental`、`--code-index-full`、`--code-parser` は `--code-index` と一緒に使う場合のみ有効です。

## インストールされるファイル

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
- 破棄可能なコード根拠 cache としての `.project-wiki/code-evidence.sqlite`

## 仕組み

1. Bootstrap は保存優先の wiki 構造と、marker で境界付けられたエージェント指示 section を作成します。
2. セッション開始 hook は文字数予算付きの `wiki/startup.md` と `wiki/index.md` だけを注入します。
3. 詳細な計画正本は canonical、decision、source、meta page にあり、エージェントが必要なときに読みます。
4. `--refresh-index` は新しい wiki page をルーティングし、route が多い場合は `wiki/indexes/auto-*.md` スコープ別ルーターに分割します。
5. `--code-index` は `.project-wiki/` 配下に破棄可能な SQLite 根拠 cache を作ります。
6. `--code-report`、`--code-impact`、`--code-search-symbol`、`--code-query` が計画更新用のコード根拠を提供します。
7. 診断は壊れたリンク、重複 route、orphan page、古いページ、欠落した TL;DR、根拠 gap、マイグレーション方針違反を報告します。

マイグレーションはレビュー優先です。`--migrate` は既存 `wiki/` を `wiki_legacy*` として保存し、migration inbox と unit-level coverage ledger を作成し、legacy の意味を現在の wiki ルールに合わせて再構成します。保持またはコピーした legacy 内容は、新しい wiki の方針と構造に合う場合は許容されます。新しい wiki は `wiki_legacy*` への参照に依存してはいけません。

## 言語サポート表

| 言語 | 拡張子 | 既定の抽出 | Tree-sitter 抽出 | index される根拠 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 関数、クラス、メソッド、変数、interface、type、enum、import、export、呼び出し、一般的な HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 関数、クラス、メソッド、変数、import、export、`require()` 呼び出し、一般的な HTTP route |
| Python | `.py` | `python-light` | `tree-sitter-python` | 関数、クラス、`import`、`from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | 関数、メソッド、型、const、var、単一 import、import block |
| Rust | `.rs` | 一覧のみ | `tree-sitter-rust` | 関数、struct、enum、trait、impl、`use` import |
| Java | `.java` | 一覧のみ | `tree-sitter-java` | クラス、interface、enum、メソッド、import |
| PHP | `.php` | 一覧のみ | `tree-sitter-php` | 関数、クラス、interface、trait、メソッド、namespace use |
| Kotlin | `.kt`, `.kts` | 一覧のみ | `tree-sitter-kotlin` | 関数、クラス、object、import |
| Swift | `.swift` | 一覧のみ | `tree-sitter-swift` | 関数、クラス、struct、protocol、enum、import |
| C | `.c`, `.h` | 一覧のみ | `tree-sitter-c` | 関数、struct、enum、include |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | 一覧のみ | `tree-sitter-cpp` | 関数、class/struct、namespace、enum、include/using |
| C# | `.cs` | 一覧のみ | `tree-sitter-csharp` | class、interface、struct、enum、メソッド、using |

`.rb`、`.vue`、`.css` は認識されますが一覧のみです。設定ファイルは設定根拠または一覧根拠として index されます。

## CLI リファレンス

エージェント実行にはローカル実行経路を使います。

```bash
$PROJECT_LIBRARIAN [init] [options]
$PROJECT_LIBRARIAN install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]
```

重要なオプション: `--migrate`, `--lint`, `--link-check`, `--quality-check`, `--doctor`, `--doctor --fix`, `--migration-lint`, `--migration-quality-check`, `--migration-doctor`, `--query`, `--wiki-impact`, `--refresh-index`, `--capture-inbox`, `--issue-draft`, `--issue-create`, `--glossary-init`, `--prune-check`, `--review-migration`, `--no-git-config`, `--code-index`, `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`.

## 開発

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

メンテナー向けベンチマークコマンドは [benchmarks/README.md](benchmarks/README.md) にあります。これはリリース根拠と公開主張の検証用であり、通常のエンドユーザー設定ではありません。

## 着想

このプロジェクトは Andrej Karpathy の [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) パターンに影響を受けています。

## ライセンス

MIT
