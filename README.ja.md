# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

人間と LLM コーディングエージェントが使う小さなプロジェクト計画 wiki を作成します。

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
- 既存 markdown 文書を移行するための migration support
- 大きなリポジトリでコード根拠に基づく wiki 更新を助ける任意の code evidence index

これにより、同じコンテキストを繰り返し集め直す作業を減らせます。エージェントは現在のプロジェクト意図から開始し、必要なときだけ詳細文書を読み、人間がレビューできるファイルにプロジェクトの意思決定を残せます。

## Quick Start

Codex と Claude Code 用の skill を一度インストールします。

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

現在のリポジトリ内にインストールする場合は `--scope project` を使います。

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

対象プロジェクトのルートで wiki を作成または更新します。

```bash
npx project-wiki-bootstrap
```

よく使うコマンド:

| 状況 | コマンド |
| --- | --- |
| wiki の作成または更新 | `npx project-wiki-bootstrap` |
| 既存 docs/wiki の移行 | `npx project-wiki-bootstrap --migrate` |
| git 設定を変更せず hook ファイルだけをインストール | `npx project-wiki-bootstrap --no-git-config` |
| 1 つのエージェントだけにインストール | `npx project-wiki-bootstrap install-skill --agents codex` または `--agents claude` |

## Skill Actions

インストール後、Codex または Claude Code に次の作業を依頼できます。

- プロジェクト wiki の作成、更新、検証
- wiki ページの検索
- `wiki/index.md` の更新
- 候補メモを `wiki/inbox/project-candidates.md` に保存
- stale または undecided 状態の wiki ページの報告
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

cache は `.project-wiki/` 配下に作成され、必要に応じて再生成できます。これは wiki 更新のための根拠であり、canonical wiki content ではありません。

便利なコマンド:

| 目的 | コマンド |
| --- | --- |
| cache の作成または更新 | `npx project-wiki-bootstrap --code-index --code-scope src` |
| 集計の表示 | `npx project-wiki-bootstrap --code-status` |
| indexed file の一覧 | `npx project-wiki-bootstrap --code-files` |
| symbol 検索 | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| read-only SQL の実行 | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

Code evidence indexing には `node:sqlite` を提供する Node runtime が必要です。基本の bootstrap コマンドは Node 18+ をサポートしますが、evidence index は現在 `node:sqlite` を含むより新しい Node release が必要です。

## Language Support Matrix

この matrix には symbol/import extraction が実装されている言語だけを含めます。その他の認識済み拡張子は inventory-only であり、言語サポートとは見なしません。

| 言語 | 拡張子 | Extraction profile | Indexed evidence |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | function, class, method, variable, interface, type, enum, import, export, call, common HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | function, class, method, variable, import, export, `require()` call, call, common HTTP route |
| Python | `.py` | `python-light` | function, class, `import`, `from ... import` |

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
