# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

为从小型仓库到大型项目和 monorepo 的场景，创建供人类和 LLM 编码代理共同使用的 token-efficient 项目规划 wiki。

语言: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

生成的 wiki 会保持启动上下文较小。

- `wiki/startup.md`: 当前项目摘要
- `wiki/index.md`: 下一步要读取的详细页面路由
- `wiki/canonical/`、`wiki/decisions/`、`wiki/sources/`、`wiki/meta/`: 仅在需要时读取的详细上下文

## 你会得到什么

Project Wiki Bootstrap 会创建一个仓库本地的规划记忆，让编码代理可以按固定方式读取。

核心功能:

- 面向 Codex 和 Claude Code 的 wiki-first 项目指令
- 只加载 compact 启动上下文的 session-start hook
- 记录当前项目事实、假设、风险、决策和 source 的 canonical 文档
- 用于发现坏链接、重复 route、orphan page、stale signal 和质量 gap 的 wiki diagnostics
- 用于迁移已有 markdown 文档的 migration support
- 面向大型仓库、帮助基于代码证据更新 wiki 的可选 code evidence index

这样可以减少反复收集相同上下文的工作。代理可以从当前项目意图开始，只在需要时读取详细文档，并把项目决策留在可供人类 review 的文件中。

## Quick Start

### 1. 安装 Skill

为 Codex 和 Claude Code 安装一次 skill。

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

如需安装到当前仓库内，请使用 `--scope project`。

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

`install-skill` 只会在 `.codex/skills/` 和/或 `.claude/skills/` 下安装可复用的 skill 文件。它不会创建或更新 `AGENTS.md`、`CLAUDE.md`、`wiki/`、`.codex/hooks.json` 或 `.claude/settings.json`。

安装选项:

| 场景 | 命令 |
| --- | --- |
| 为 Codex 和 Claude Code 全局安装 | `npx project-wiki-bootstrap install-skill --scope user --agents both` |
| 为当前仓库内的 Codex 和 Claude Code 安装 | `npx project-wiki-bootstrap install-skill --scope project --agents both` |
| 只为一个代理安装 | `npx project-wiki-bootstrap install-skill --agents codex` 或 `--agents claude` |

### 代理会话中的本地 Runner

安装 skill 后，Codex 和 Claude Code 应运行已安装的本地副本，而不是再次从 npm 获取包。这样可以避免受限代理环境中的 network failure，以及未固定公开包执行被拦截的问题。

常用本地 runner:

| 安装位置 | Runner |
| --- | --- |
| 项目范围 Codex skill | `node .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 项目范围 Claude skill | `node .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 用户范围 Codex skill | `node ~/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| 用户范围 Claude skill | `node ~/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |

直接在 shell 中运行的用户，在 registry access 可用时仍可使用 `npx project-wiki-bootstrap ...`。使用已安装 skill 的代理应优先使用本地 runner；如果失败，应报告真实错误，而不是手动重建生成文件作为 fallback。

### 2. 创建、更新和维护 Project Wiki

安装 skill 后，在目标项目根目录运行 wiki 命令。

```bash
npx project-wiki-bootstrap
```

Wiki 命令:

| 场景 | 命令 |
| --- | --- |
| 创建或更新 wiki | `npx project-wiki-bootstrap` |
| 迁移已有 docs/wiki 内容 | `npx project-wiki-bootstrap --migrate` |
| 检查链接和文档质量 | `npx project-wiki-bootstrap --doctor` |
| 先安全刷新 routing 再检查 | `npx project-wiki-bootstrap --doctor --fix` |
| 不修改 git 配置，只安装 hook 文件 | `npx project-wiki-bootstrap --no-git-config` |

## Skill Actions

安装后，可以让 Codex 或 Claude Code 执行以下任务。

- 创建、更新或验证项目 wiki
- 检查 wiki 链接、重复 route、orphan page 和文档质量
- 搜索 wiki 页面
- 刷新 `wiki/index.md`
- 将候选备注保存到 `wiki/inbox/project-candidates.md`
- 报告 stale 或 undecided 状态的 wiki 页面
- 为使用 skill 时发现的问题或副作用生成 GitHub issue body 草稿
- 创建 `wiki/canonical/glossary.md`
- 将已有 markdown 文档迁移到可 review 的 inbox
- 分析代码，并将有代码依据的项目信息写入 wiki

示例:

```text
Apply project-wiki-bootstrap to this project.
Validate the project wiki setup.
Search the project wiki for authentication decisions.
Analyze apps/web and packages/api, then update the wiki from the code.
Review the migrated wiki inbox.
```

在 Claude Code 中也可以使用 `/project-wiki-bootstrap`。

## Wiki Diagnostics

用于 review 或整理已有 wiki。

| 目的 | 命令 |
| --- | --- |
| 验证生成的 setup | `npx project-wiki-bootstrap --lint` |
| 检查坏链接、重复 index route 和 orphan page | `npx project-wiki-bootstrap --link-check` |
| 检查 stale page、unresolved signal、缺少 TL;DR、budget drift 和 evidence gap | `npx project-wiki-bootstrap --quality-check` |
| 一起运行 setup、link 和 quality 检查 | `npx project-wiki-bootstrap --doctor` |
| 先应用安全的 routing fix 再诊断 | `npx project-wiki-bootstrap --doctor --fix` |

坏链接会导致检查失败。重复 route、orphan page 和质量问题会作为 warning 报告，便于判断是否需要合并、routing、刷新或重写文档。

如需为问题或副作用生成 GitHub issue body 草稿，可运行 `npx project-wiki-bootstrap --issue-draft --issue-title "Report unexpected wiki hook behavior"`。该命令是 read-only，会输出包含复现步骤、期望行为与实际行为、受影响生成文件、环境信息和应附加 diagnostics 的模板；不会创建 GitHub issue，也不需要 network access。

在 GitHub 仓库中，如果用户明确批准，可以通过 GitHub CLI 创建真实 issue：`npx project-wiki-bootstrap --issue-create --issue-title "Report unexpected wiki hook behavior"`。该命令会先运行 `gh auth status`，再调用 `gh issue create --title ... --body-file ...`。它需要已认证的 `gh`、GitHub remote 和 network access。失败时会报告真实 error，不会 silently fallback 到 draft。

当使用此 skill 的 LLM 发现 project-wiki-bootstrap 的 bug、regression、workflow mismatch、令人困惑的生成行为或意外 side effect 时，除非用户明确表示不需要 issue draft，否则 LLM 会在完成工作前运行 read-only issue draft。这一步不会替代本地修复。

## 安装的文件

项目指令文件:

- `AGENTS.md`
- `CLAUDE.md`
- `wiki/AGENTS.md`

启动 hook:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`

可选 git hook 文件:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

wiki 目录:

- `wiki/canonical/`
- `wiki/decisions/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/inbox/`
- `wiki/migration/`

## Code Evidence Index

对于大型仓库，可以创建可丢弃的 SQLite evidence cache。

```bash
npx project-wiki-bootstrap --code-index --code-scope src
```

cache 会创建在 `.project-wiki/` 下，并可按需重新生成。它是 wiki 更新的依据，不是 canonical wiki content。除 `.env.example` 外的 `.env*` 文件，以及文件名明显包含 secret、credential、token、private、key 等敏感 config 术语的文件，默认会被排除。

有用命令:

| 目的 | 命令 |
| --- | --- |
| 创建或刷新 cache | `npx project-wiki-bootstrap --code-index --code-scope src` |
| 查看汇总 | `npx project-wiki-bootstrap --code-status` |
| 列出 indexed file | `npx project-wiki-bootstrap --code-files` |
| 搜索 symbol | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| 执行 read-only SQL | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

Code evidence indexing 需要提供 `node:sqlite` 的 Node runtime。基础 bootstrap 命令支持 Node 18+，但 evidence index 目前需要包含 `node:sqlite` 的更新 Node release。

## Language Support Matrix

下面的 matrix 只包含已实现 symbol/import extraction 的语言。其他可识别扩展名是 inventory-only，不计为语言支持。`typescript-ast` evidence 可作为更强的结构性证据；`python-light` 和 `go-light` 应作为快速 pointer，在写入高置信 canonical claim 前仍需回到 source 确认。

| 语言 | 扩展名 | Extraction profile | Indexed evidence |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | function, class, method, variable, interface, type, enum, import, export, call, common HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | function, class, method, variable, import, export, `require()` call, call, common HTTP route |
| Python | `.py` | `python-light` | function, class, `import`, `from ... import` |
| Go | `.go` | `go-light` | function, method, type, const, var, single import, import block |

Config 文件（`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`）会作为单独的 configuration evidence 被 indexed。

## 策略和 side effect

- 在 git 仓库中，如果 `core.hooksPath` 尚未设置，默认会设置 `git config core.hooksPath .githooks`。
- 如果已经存在其他 `core.hooksPath`，bootstrap 会保留该值，并报告已跳过 git config 修改。
- 使用 `--no-git-config` 时，只安装 hook 文件，不修改 `core.hooksPath`。
- 已有 `AGENTS.md`、`CLAUDE.md` 和 `wiki/AGENTS.md` 会保留 project-wiki marker block 之外的内容。
- 生成的运行文档默认使用英语。项目 canonical wiki content 应遵循用户指令或项目已有语言。

## Inspiration

这个项目受到 Andrej Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern 启发。它的思路是把持久 markdown wiki 放在工作附近，而不是每次都从很长的聊天历史中重建项目上下文。

Project Wiki Bootstrap 将这个想法改造成 Codex 和 Claude Code 可安装使用的 bootstrap，并提供仓库本地指令、启动 hook、migration helper 和可选 code evidence。

## Development

源码是 TypeScript。提交的 `dist/` 目录是 npm binary 和 skill 安装使用的编译结果。

Repository layout:

- `src/init-project-wiki.ts`: CLI entrypoint
- `src/args.ts`: command-line argument parsing
- `src/hooks.ts`: Codex、Claude Code 和 git hook 生成
- `src/install-skill.ts`: user/project skill installer
- `src/templates.ts`: 生成的 instruction 和 wiki template
- `src/code-index.ts`: 可选 SQLite code evidence index
- `src/wiki-files.ts`: wiki file discovery 和 markdown helper
- `src/migration.ts`: 现有 wiki migration
- `src/modes.ts`: lint、search、refresh、capture、prune mode
- `dist/`: 编译结果

Development commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

如果修改了 `src/` 下的 TypeScript，请在提交前 rebuild，确保 `dist/` 保持同步。

## License

MIT
