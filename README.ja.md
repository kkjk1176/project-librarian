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

最新 clean 大規模レポート: `benchmarks/reports/current-large.json`、2026-06-09T08:08:07.238Z 生成、Node v22.19.0、darwin arm64、Apple M4 Pro、commit `18e730882c4f`、測定実行 5 回と破棄したウォームアップ実行 1 回。時間測定状態は `stable`、unstable metrics は `none`、git 状態の指紋は clean です。

| 項目 | 結果 |
| --- | ---: |
| Markdown コンテキスト推定回避量の中央値 | 99.61% |
| Markdown コンテキスト推定回避量の最小値 | 99.43% |
| 読み取り時間削減の中央値 | 99.47% |
| 読み取り時間削減の最小値 | 99.26% |
| 測定した wiki ページ | 1,601 |
| コード index ファイル | 1,608 |
| コード index 時間 | 336.312ms |
| コード index スループット | 4,781.27 files/sec |
| 増分 index 時間 | 186.776ms |
| 全体に対する増分時間削減 | 45.52% |
| アーキテクチャレポート時間 | 251.175ms |
| アーキテクチャレポート根拠テーブル | 6 |
| アーキテクチャレポート route | 24 |
| サンプルリポジトリ | 3 |
| ベンチマーク実行 | 5 |
| ウォームアップ実行 | 1 |
| 時間測定状態 | stable |
| 不安定な測定値 | none |

シナリオ要約:

| シナリオ | 規模 | 結果 |
| --- | ---: | --- |
| 文書の多い wiki | 500ページ | 99.74% Markdown コンテキスト推定回避、99.47% 読み取り削減、43.83ms query |
| モノレポ wiki | 320ページ | 99.43% Markdown コンテキスト推定回避、99.26% 読み取り削減、81.12ms doctor |
| スコープ別ルーター wiki | 720ページ | 99.61% Markdown コンテキスト推定回避、99.55% 読み取り削減、67.684ms refresh |
| コードの多い混合 index | 1,608ファイル | 336.312ms full index、186.776ms incremental、251.175ms report、626.969ms Tree-sitter index |
| サンプルリポジトリ検証 | 3リポジトリ、16ファイル | 132.363ms コード index 中央値、135.694ms アーキテクチャレポート中央値 |

主張範囲: トークン推定値は `ceil(characters / 4)` による Markdown コンテキストサイズ推定です。モデル tokenizer 出力や API 課金カウンターではなく、実際の LLM トークン使用量を測定していません。ベンチマークは、targeted retrieval で読む wiki コンテキストが、fixture の全 wiki Markdown ファイルを読む naive full-wiki scan に比べてどれだけ Markdown コンテキスト入力を避けるかを比較します。コード index 測定値は生成/サンプルリポジトリで測定したローカル CLI 子プロセス時間です。

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
7. 診断は壊れたリンク、重複 route、orphan page、古いページ、欠落した TL;DR、根拠 gap、マイグレーションコピーリスクを報告します。

マイグレーションはレビュー優先です。`--migrate` は既存 `wiki/` を `wiki_legacy*` として保存し、migration inbox を作成し、legacy Markdown を新しい canonical truth に直接コピーしません。

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

重要なオプション: `--migrate`, `--lint`, `--link-check`, `--quality-check`, `--doctor`, `--doctor --fix`, `--query`, `--refresh-index`, `--capture-inbox`, `--issue-draft`, `--issue-create`, `--glossary-init`, `--prune-check`, `--review-migration`, `--no-git-config`, `--code-index`, `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`.

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
