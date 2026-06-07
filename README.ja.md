# Project Wiki Bootstrap

人間と LLM エージェントのために、低トークンのプロジェクト計画 wiki を bootstrap します。

言語: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成される wiki は、起動コンテキストを小さく保つために次のファイルだけをロードします。

- `wiki/startup.md`: 現在のプロジェクトコンテキストの compact な要約
- `wiki/index.md`: 次に読む詳細ファイルを選ぶルーター

詳細な canonical、decision、meta、source ファイルは、現在の作業で必要なときだけ Read On Demand で読みます。

## 目次

- [クイックスタート](#クイックスタート)
- [Skill Actions](#skill-actions)
- [Skill の使い方](#skill-の使い方)
- [インストールされるもの](#インストールされるもの)
- [生成される Wiki モデル](#生成される-wiki-モデル)
- [仕組み](#仕組み)
- [ポリシーと副作用](#ポリシーと副作用)
- [開発](#開発)
- [ライセンス](#ライセンス)

## クイックスタート

`npx` は初回インストールと bootstrap にだけ使います。その後の運用は Codex または Claude Code にインストールされた skill から行います。

複数プロジェクトで使うユーザー単位インストール:

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
npx project-wiki-bootstrap
```

1 つのリポジトリで共有するプロジェクト単位インストール:

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
npx project-wiki-bootstrap
```

既存 wiki/docs 構造の migration:

```bash
npx project-wiki-bootstrap --migrate
```

git config を変更せず hook ファイルだけをインストール:

```bash
npx project-wiki-bootstrap --no-git-config
```

1 つの agent だけにインストールする場合は、`--agents both` の代わりに `--agents codex` または `--agents claude` を使います。

## Skill Actions

このパッケージをインストールすると、Codex と Claude Code に `project-wiki-bootstrap` という 1 つの skill が追加されます。この skill は次の project wiki action をサポートします。

- Bootstrap または update: `AGENTS.md`、`CLAUDE.md`、`wiki/`、Codex hook、Claude Code hook、git hook ファイルを作成または更新します。
- Validate: 必須ファイル、metadata header、routing、hook 設定、実行権限、git hook 設定を確認します。
- Search: パス、タイトル、metadata、本文から関連する wiki page を探します。
- Refresh index: `wiki/index.md` の auto-discovered page block を更新します。
- Capture candidate: 内容を canonical truth にせず、`wiki/inbox/project-candidates.md` に候補として保存します。
- Prune check: pending、stale、proposed、undecided に見える active wiki page を報告します。
- Glossary init: プロジェクト用語の canonical な置き場が必要なとき、`wiki/canonical/glossary.md` を作成します。
- Migration: 既存 wiki を保存して新しい wiki を作り、legacy markdown inventory と migration inbox を生成します。
- Migration review: 処理済み migration inbox status を review page と verification page に同期します。
- No-git-config setup: `core.hooksPath` を変更せず hook ファイルだけをインストールします。

## Skill の使い方

インストール後、Codex では自然言語で依頼します。

- "このプロジェクトに project-wiki-bootstrap を適用して。"
- "プロジェクト wiki 設定を検証して。"
- "認証の意思決定を project wiki から探して。"
- "wiki index を更新して。"
- "この内容を project wiki candidate としてキャプチャして。"
- "migration された wiki inbox をレビューして。"

Claude Code では skill を直接呼び出すか、自然言語で依頼します。

- `/project-wiki-bootstrap`
- "プロジェクト wiki を初期化して。"
- "プロジェクト wiki が正常か確認して。"
- "リリースリスクに関する wiki ノートを探して。"

Skill はこれらの依頼を内部的に適切な lifecycle operation にマッピングします。プロジェクト wiki と hook は、プロジェクトルートで bootstrap が実行されたときだけ作成されます。

## インストールされるもの

プロジェクト指示ファイル:

- `AGENTS.md`: プロジェクト全体に適用される compact な wiki-first 指示
- `CLAUDE.md`: `AGENTS.md` を取り込む Claude Code 互換ファイル
- `wiki/AGENTS.md`: wiki 内部の詳細な編集ルール

起動 hook:

- `.codex/hooks.json`: Codex `SessionStart` hook 登録
- `.codex/hooks/wiki-session-start.js`: compact な起動コンテキスト注入器
- `.claude/settings.json`: Claude Code `SessionStart` hook 登録
- `.claude/hooks/wiki-session-start.js`: Claude Code 用の compact な起動コンテキスト注入器

Git hook ファイル:

- `.githooks/prepare-commit-msg`: 任意の git commit hook エントリーポイント
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer 生成器

Wiki ファイルとディレクトリ:

- `wiki/startup.md`: セッション開始要約
- `wiki/index.md`: read/update/token-budget ヒントを含むルーティングインデックス
- `wiki/canonical/`: 現在のプロジェクト正本
- `wiki/decisions/`: プロジェクト意思決定履歴
- `wiki/meta/`: wiki 運用ルールと意思決定ポリシー
- `wiki/sources/`: source summary
- `wiki/inbox/`: まだ canonical truth ではない captured candidate
- `wiki/migration/`: 生成された migration inventory、plan、verification、review 状態

このプロジェクトは外部オーケストレーションレイヤーから独立しています。どのオーケストレーションフレームワーク向けの project memory file も作成しません。

## 生成される Wiki モデル

- `wiki/startup.md`: セッション開始用の compact な要約とプロジェクト状態。
- `wiki/index.md`: 人間とエージェントにどの詳細ファイルを読むか、または更新するかを示すルーター。
- `wiki/canonical/`: brief、assumptions、risks、open questions、optional glossary などの現在のプロジェクト正本。
- `wiki/decisions/`: プロジェクト意思決定履歴、recent decisions、Decision Pack template、Full ADR template。
- `wiki/meta/`: wiki operating model、decision policy、bootstrap decisions、language policy、lint と migration ルール。
- `wiki/sources/`: wiki に影響した source summary と参考リンク。
- `wiki/inbox/`: まだ canonical truth ではない captured candidate。
- `wiki/migration/`: 生成された migration inventory、plan、verification、review 状態。

## 仕組み

LLM コーディングエージェントは、長いチャット履歴や大きなドキュメントツリーを読み直さずに、現在のプロジェクト意図、意思決定、前提、リスクをすばやく復元できるときに最も有用です。

このプロジェクトは、常に有用なルーティングコンテキストと詳細なプロジェクト知識を分離する、小さく持続可能な wiki 構造を作ります。製品ドキュメント、アーキテクチャドキュメント、issue tracker を置き換えるものではありません。リポジトリの近くにあり、通常作業の中で更新しやすい、低トークンのプロジェクト計画 source of truth を提供することが目的です。

主な設計:

- 低トークンの起動コンテキスト: 初期コンテキストは `wiki/startup.md` と `wiki/index.md` が中心です。
- Read On Demand ルーティング: 詳細な canonical docs、decisions、source notes、migration pages、meta docs は必要なときだけ読みます。
- プロジェクト知識の分離: 現在の正本は `wiki/canonical/`、理由と履歴は `wiki/decisions/`、wiki 運用ルールは `wiki/meta/` に置きます。
- エージェント指示のサポート: Codex と Claude Code が読める compact なプロジェクト指示を生成します。
- Codex と Claude Code の起動 hook: 両方のツールに compact な wiki 起動コンテキストを注入する `SessionStart` hook を登録します。
- Git commit trailer: 任意の `prepare-commit-msg` hook で wiki 影響範囲を commit trailer に残します。
- 冪等な bootstrap: スクリプトを再実行しても、管理対象の運用ファイルを更新し、starter プロジェクト wiki ページは保持します。
- npx-first skill インストール: global npm install なしで Codex と Claude Code skill wrapper をユーザーまたはプロジェクト scope にインストールします。

一般的な流れ:

1. プロジェクトに wiki を bootstrap します。
2. セッション開始時に `wiki/startup.md` と `wiki/index.md` を読みます。
3. 現在の作業で必要なときだけ詳細 wiki ページを読みます。
4. プロジェクト計画の内容が変わったら、同じターンで関連する canonical、decision、source、meta page を更新します。
5. インストール済み skill を通じて Codex または Claude Code に wiki の検証、検索、更新、キャプチャ、migration を依頼します。
6. wiki 関連の変更をコミットするときは、生成された git hook に wiki trailer を付けさせます。

このプロジェクトは Andrej Karpathy の [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) パターンから影響を受けています。原資料や会話履歴から毎回コンテキストを再構築する代わりに、LLM の助けで維持される永続的な markdown wiki を置くというアイデアです。

## ポリシーと副作用

Git の副作用:

- git リポジトリでは、デフォルトで `git config core.hooksPath .githooks` を設定します。
- `core.hooksPath` を変更せず hook ファイルだけをインストールするには、`npx project-wiki-bootstrap --no-git-config` を使います。
- プロジェクトがすでに別の `core.hooksPath` を使っている場合は、実行前に確認するか、実行後に git config を戻してください。

言語ポリシー:

- このリポジトリ README は GitHub 配布のため、デフォルトで英語です。
- ローカライズ文書は [韓国語](README.ko.md)、[日本語](README.ja.md)、[簡体字中国語](README.zh.md) で提供されます。
- root `AGENTS.md`、`wiki/AGENTS.md`、`wiki/startup.md`、`wiki/index.md`、migration 運用ページ、wiki meta ページを含む生成運用文書は、デフォルトで英語です。
- プロジェクト canonical wiki content は韓国語や英語に固定されません。LLM は明示的なユーザー指示、既存プロジェクト言語、source document、team context を見て言語を選ぶべきです。シグナルがなければ、現在の会話やリポジトリですでに使われている言語に従います。

エージェント互換性:

- Codex は `AGENTS.md` と `.codex/hooks/wiki-session-start.js` を使って compact な起動コンテキストを読みます。
- Claude Code は `AGENTS.md` ではなく `CLAUDE.md` を読み、`.claude/hooks/wiki-session-start.js` で同じ compact な起動コンテキストを使います。
- 生成される `CLAUDE.md` は `@AGENTS.md` で `AGENTS.md` を取り込むため、プロジェクト全体のルールを 1 か所に保てます。

## 開発

ソースは TypeScript で、コミットされる `dist/` ディレクトリは npm bin と skill インストールで使われるコンパイル済み JavaScript です。

リポジトリ構成:

- `src/init-project-wiki.ts`: CLI エントリーポイントと最上位 orchestration。
- `src/args.ts`: command-line 引数の解析と mode flag。
- `src/types.ts`: status、migration row、hook config、query result、prune candidate の共有 TypeScript 契約。
- `src/workspace.ts`: リポジトリ相対の filesystem helper、markdown metadata helper、実行権限、共通 command check。
- `src/hooks.ts`: Codex と Claude Code `SessionStart` hook 生成、git hook 生成、git hook 設定。
- `src/install-skill.ts`: Codex と Claude Code 用の npx ベースのユーザー/プロジェクト skill installer。
- `src/templates.ts`: 生成される `AGENTS.md`、`CLAUDE.md`、wiki starter page、wiki meta page、source summary template。
- `src/wiki-files.ts`: wiki file discovery、markdown table parsing、wiki link helper、metadata summary、marked-section preservation。
- `src/migration.ts`: 既存 wiki migration、migration inbox、migration verification、semantic review sync。
- `src/modes.ts`: `--lint`、`--query`、`--refresh-index`、`--capture-inbox`、`--prune-check` などの lifecycle command。
- `dist/`: zero-build 実行のためにコミットされる build output。

開発コマンド:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

`src/` 以下の TypeScript ファイルを変更した場合は、コミット前に再 build して対応する `dist/` ファイルを最新に保ちます。

## ライセンス

MIT
