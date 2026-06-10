# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![代码依据索引](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

面向 Codex、Claude Code、Cursor 和 Gemini CLI 的简洁项目记忆与代码依据。

Project Librarian 会创建仓库本地规划 wiki、简洁启动 hook，以及可选 SQLite 代码依据索引。代理可以从项目计划开始，被路由到正确文档，并在不反复扫描整个仓库的情况下查看由代码支撑的依据。

语言: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

## 为什么存在

LLM 编码代理经常在每个会话开始时重新发现项目，浪费上下文和工具调用：读取旧对话、扫描 Markdown、搜索源码，并猜测哪些文件重要。

Project Librarian 给代理两个本地事实来源。

| 表面 | 代理获得什么 |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | 简短的会话启动摘要和路由器，只读取相关规划页面。 |
| `wiki/canonical/` 和 `wiki/decisions/` | 当前项目事实、约束、风险、包契约、CLI 行为和持久决策。 |
| `.codex/`、`.claude/`、`.cursor/` 和 `.gemini/` hooks | 不加载整个 wiki 的 Codex/Claude Code/Cursor/Gemini CLI 启动上下文。 |
| `GEMINI.md` 和 `.cursor/rules/` | 将 Gemini CLI 和 Cursor 路由到同一个紧凑 wiki-first 契约的 instruction 文件。 |
| `.project-wiki/code-evidence.sqlite` | 可再生成的代码依据，用于文件、符号、import、route、所有权、工作区图、报告和影响检查。 |
| 诊断和迁移模式 | 链接检查、质量检查、迁移收件箱、过期信号报告，以及工作流暴露问题时的 issue draft。 |

核心不是“写更多文档”，而是让代理第一次读取保持小，并给它可靠路线进入更深的项目事实和代码依据。

## 基准结果

基准是维护者发布依据，不是公开用户工作流。它让 README 和发布说明用有边界的数字说明价值，而不是使用模糊性能描述。

最新 clean 大规模报告：`benchmarks/reports/current-large.json`，生成于 2026-06-10T06:06:44.178Z，Node v22.19.0，darwin arm64，Apple M4 Pro，commit `9ddec8521a43`，5 次测量运行和 1 次丢弃的预热运行。时间测量状态为 `variable`；unstable metrics 为 `code.tree_sitter_code_index_ms`；git 状态指纹为 clean。

比较基准：wiki 路由行里的“未使用 Project Librarian”指 naive full-wiki Markdown scan；“使用 Project Librarian”指只读取 `wiki/startup.md`、`wiki/index.md` 和 query 返回的 target 文档。代码更新行比较全量代码索引 rebuild 与 Project Librarian 增量 reindex。

| 工作负载 | 未使用 Project Librarian | 使用 Project Librarian | 差异 |
| --- | ---: | ---: | ---: |
| 文档密集 wiki，500页 | Markdown 估算 868,731 tokens；full-wiki read 7.594ms | Markdown 估算 2,260 tokens；targeted read 0.035ms | 上下文减少 99.74%；读取时间减少 99.53% |
| Monorepo wiki，320页 | Markdown 估算 407,584 tokens；full-wiki read 4.604ms | Markdown 估算 2,339 tokens；targeted read 0.035ms | 上下文减少 99.43%；读取时间减少 99.24% |
| 分范围路由 wiki，720页 | Markdown 估算 988,117 tokens；full-wiki read 10.731ms | Markdown 估算 3,839 tokens；targeted read 0.048ms | 上下文减少 99.61%；读取时间减少 99.59% |
| 代码索引更新，1,608个文件 | 全量 rebuild 341.451ms | 2 个变更文件增量 reindex 187.588ms | wall-clock 减少 45.36% |

其他测量依据：

| 指标 | 测量值 | 比较状态 |
| --- | ---: | --- |
| Markdown 上下文估算避免量中位数 | 99.61% | 从 full-wiki vs targeted-context 比较行得出 |
| 读取时间降低中位数 | 99.53% | 从 full-wiki vs targeted-context 比较行得出 |
| 架构报告时间 | 258.757ms | 功能计时测量值；没有 no-Project-Librarian baseline |
| 架构报告依据表 | 6 | 功能输出测量值 |
| 架构报告 route | 24 | 功能输出测量值 |
| Tree-sitter 代码索引时间 | 653.668ms | 功能计时测量值；本次 run 中 unstable |
| Tree-sitter parser profiles | 14 | 功能输出测量值 |
| 样本仓库代码索引时间中位数 | 136.278ms | 明确样本仓库的观测计时 |
| 样本仓库架构报告时间中位数 | 137.325ms | 明确样本仓库的观测计时 |
| 基准运行 | 5 | 测量 protocol |
| 预热运行 | 1 | 测量 protocol |
| 时间测量状态 | variable | `code.tree_sitter_code_index_ms` 为 unstable |
| Claimable metrics | 20 | 可作为 timing claim 的指标 |
| 不稳定指标 | code.tree_sitter_code_index_ms | release timing claim 前需要 rerun |

声明边界：token 估算值是使用 `ceil(characters / 4)` 得到的 Markdown 上下文大小估算。它不是模型 tokenizer 输出，也不是 API 计费计数器，更不是实际 LLM token 使用量。基准比较 targeted retrieval 读取的 wiki 上下文，相比读取 fixture 中所有 wiki Markdown 文件的 naive full-wiki scan，能避免多少 Markdown 上下文输入。代码索引指标是在生成/样本仓库上测得的本地 CLI 子进程时间。

## 安装

只在初始 skill 安装时使用 `npx`。

```bash
npx project-librarian install-skill --scope user --agents all
```

安装到当前仓库:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill` 只复制可复用的 skill 文件。它不会创建或更新 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`wiki/`、`.cursor/rules/`、`.cursor/hooks.json`、`.gemini/settings.json`、`.codex/hooks.json` 或 `.claude/settings.json`。

| 场景 | 命令 |
| --- | --- |
| 为所有支持的 agent 全局安装 | `npx project-librarian install-skill --scope user --agents all` |
| 安装到当前仓库 | `npx project-librarian install-skill --scope project --agents all` |
| 只安装 Codex | `npx project-librarian install-skill --agents codex` |
| 只安装 Claude Code | `npx project-librarian install-skill --agents claude` |
| 只安装 Cursor | `npx project-librarian install-skill --agents cursor` |
| 只安装 Gemini CLI | `npx project-librarian install-skill --agents gemini` |
| 预览安装结果 | `npx project-librarian install-skill --scope project --agents all --dry-run` |

## 代理运行路径

安装后，代理应使用 `node` 运行已安装的本地副本，而不是 `npx`。这可以避免受限代理环境中的网络访问和未固定版本的包执行。

| 安装位置 | 运行路径 |
| --- | --- |
| 项目范围 Codex skill | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| 项目范围 Claude skill | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| 项目范围 Cursor skill | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 项目范围 Gemini skill | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| 用户范围 Codex skill | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| 用户范围 Claude skill | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| 用户范围 Cursor skill | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| 用户范围 Gemini skill | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

下面示例使用:

```bash
PROJECT_LIBRARIAN="node .codex/skills/project-librarian/dist/init-project-wiki.js"
```

请使用与你的安装位置匹配的本地运行路径。

## 常见代理工作流

在项目根目录创建或更新 wiki。

```bash
$PROJECT_LIBRARIAN
```

Wiki 验证和维护：

| 目的 | 代理命令 |
| --- | --- |
| 创建或更新 wiki | `$PROJECT_LIBRARIAN` |
| 迁移已有 docs/wiki | `$PROJECT_LIBRARIAN --migrate` |
| 验证生成的设置 | `$PROJECT_LIBRARIAN --lint` |
| 检查链接和文档质量 | `$PROJECT_LIBRARIAN --doctor` |
| 诊断前刷新生成的路由 | `$PROJECT_LIBRARIAN --doctor --fix` |
| 搜索 project wiki | `$PROJECT_LIBRARIAN --query "authentication decisions"` |
| 保存候选备注 | `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate" --content "Details"` |
| 报告过期或未解决的 wiki 页面 | `$PROJECT_LIBRARIAN --prune-check` |
| 不修改 git config 安装 hook 文件 | `$PROJECT_LIBRARIAN --no-git-config` |

代码依据：

| 目的 | 代理命令 |
| --- | --- |
| 创建默认依据缓存 | `$PROJECT_LIBRARIAN --code-index --code-scope src` |
| 构建多个范围 | `$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api` |
| 要求增量更新 | `$PROJECT_LIBRARIAN --code-index --incremental` |
| 强制完整重建 | `$PROJECT_LIBRARIAN --code-index --code-index-full` |
| 使用可选 Tree-sitter backend | `$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter` |
| 查看缓存状态 | `$PROJECT_LIBRARIAN --code-status` |
| 列出已索引文件 | `$PROJECT_LIBRARIAN --code-files` |
| 输出架构/所有权报告 | `$PROJECT_LIBRARIAN --code-report` |
| 只输出一个报告 section | `$PROJECT_LIBRARIAN --code-report --code-report-section routes` |
| 查看影响依据 | `$PROJECT_LIBRARIAN --code-impact healthHandler` |
| 搜索已索引符号 | `$PROJECT_LIBRARIAN --code-search-symbol Auth` |
| 执行保守的只读 SQL | `$PROJECT_LIBRARIAN --code-query "select path from files order by path"` |

代码依据模式一次只能运行一个。`--incremental`、`--code-index-full` 和 `--code-parser` 只有与 `--code-index` 一起使用时才有效。

## 会安装什么

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
- 作为可丢弃代码依据缓存的 `.project-wiki/code-evidence.sqlite`

## 工作方式

1. Bootstrap 创建保留优先的 wiki 结构，以及由 marker 定界的代理指令 section。
2. 会话启动 hook 只注入带字符预算的 `wiki/startup.md` 和 `wiki/index.md`。
3. 详细规划事实位于 canonical、decision、source、meta page，代理按需读取。
4. `--refresh-index` 路由新的 wiki page；route 很多时拆分到 `wiki/indexes/auto-*.md` 分范围路由器。
5. `--code-index` 在 `.project-wiki/` 下创建可丢弃 SQLite 依据缓存。
6. `--code-report`、`--code-impact`、`--code-search-symbol`、`--code-query` 为规划更新提供代码依据。
7. 诊断报告坏链接、重复 route、orphan page、过期页面、缺少 TL;DR、依据 gap 和迁移策略违规。

迁移以审查为先。`--migrate` 会把已有 `wiki/` 保存为 `wiki_legacy*`，写入 migration inbox 和 unit-level coverage ledger，并把 legacy 含义按当前 wiki 规则重构。保留或复制的 legacy 内容只要符合新 wiki 的策略和结构即可接受；新的 wiki 不应依赖引用 `wiki_legacy*` 才能被理解。

## 语言支持表

| 语言 | 扩展名 | 默认提取 | Tree-sitter 提取 | 索引的依据 |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | 函数、类、方法、变量、interface、type、enum、import、export、调用、常见 HTTP route |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | 函数、类、方法、变量、import、export、`require()` 调用、常见 HTTP route |
| Python | `.py` | `python-light` | `tree-sitter-python` | 函数、类、`import`、`from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | 函数、方法、类型、const、var、单个 import、import block |
| Rust | `.rs` | 仅清单 | `tree-sitter-rust` | 函数、struct、enum、trait、impl、`use` import |
| Java | `.java` | 仅清单 | `tree-sitter-java` | 类、interface、enum、方法、import |
| PHP | `.php` | 仅清单 | `tree-sitter-php` | 函数、类、interface、trait、方法、namespace use |
| Kotlin | `.kt`, `.kts` | 仅清单 | `tree-sitter-kotlin` | 函数、类、object、import |
| Swift | `.swift` | 仅清单 | `tree-sitter-swift` | 函数、类、struct、protocol、enum、import |
| C | `.c`, `.h` | 仅清单 | `tree-sitter-c` | 函数、struct、enum、include |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | 仅清单 | `tree-sitter-cpp` | 函数、class/struct、namespace、enum、include/using |
| C# | `.cs` | 仅清单 | `tree-sitter-csharp` | class、interface、struct、enum、方法、using |

`.rb`、`.vue` 和 `.css` 会被识别，但仅进入清单。配置文件会作为配置依据或清单依据被索引。

## CLI 参考

代理执行使用本地运行路径。

```bash
$PROJECT_LIBRARIAN [init] [options]
$PROJECT_LIBRARIAN install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]
```

重要选项：`--migrate`, `--lint`, `--link-check`, `--quality-check`, `--doctor`, `--doctor --fix`, `--migration-lint`, `--migration-quality-check`, `--migration-doctor`, `--query`, `--refresh-index`, `--capture-inbox`, `--issue-draft`, `--issue-create`, `--glossary-init`, `--prune-check`, `--review-migration`, `--no-git-config`, `--code-index`, `--code-report`, `--code-impact`, `--code-search-symbol`, `--code-query`.

## 开发

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

维护者基准命令位于 [benchmarks/README.md](benchmarks/README.md)。它们用于发布依据和公开声明验证，不是普通最终用户设置流程。

## 灵感

本项目受到 Andrej Karpathy 的 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 模式启发。

## 许可证

MIT
