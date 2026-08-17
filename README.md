# dsh-musage

> DSH (DeepSeek Harness) 版的 [Musage](https://github.com/Thedeergod666/Musage) — 在 DSH composer 工具栏里实时显示 5 家 AI 套餐 provider 的用量余额, 跟着当前模型自动切换.

![demo](docs/assets/demo.gif)

## 这是什么

[Musage](https://github.com/Thedeergod666/Musage) 是我 (Thedeergod666) 维护的 Tauri 桌面应用, 核心功能是实时跨 **14 个** AI 套餐 provider 监控用量 (悬浮窗 + 系统托盘). 桌面形态完整有效, 但跟 DSH 这类 AI harness 生态割裂, 用户切到 DSH 工作时看不到用量.

**dsh-musage** 把 Musage 的核心能力**搬进 DSH 浏览器页面里**:

- ✅ **5 个 provider** 当前实装: MiniMax · DeepSeek · Kimi · OpenRouter · 智谱 GLM (zai-coding-cn)
- ✅ **跟着模型自动切换** — 切到 minimax-cn 显示套餐用量, 切到 deepseek 显示余额, 切到 zai-coding-cn 显示智谱套餐, … 全自动
- ✅ **复用 DSH 已配 API Key** — 在 DSH 模型设置里配过 minimax / deepseek / openrouter / zhipu 的话, plugin 立刻拿到, 不需重复填
- ✅ **5h + 周 双窗口套餐** (minimax / kimi / zhipu) 或 **余额** (deepseek / openrouter) 自动选合适显示
- ✅ **零侵入** — 注册到 `conversation.input.right` slot (紧邻 model select 左侧), 不挡对话/输入
- ✅ **失败静默** — 拉数据失败只显示 `Provider ⚠`, hover 看具体错误, 不刷屏

## 演示

![demo](docs/assets/demo.gif)

> (GIF: minimax 5h/周 双窗口 → 切到 deepseek 自动显示余额 → 切到 zai-coding-cn 显示智谱套餐. 中间切换无刷新无 loading 态.)

## 支持的 Provider

| Provider (DSH route id) | 显示 | 端点 | Schema 来源 |
|---|---|---|---|
| `minimax` / `minimax-cn` / `minimax-en` | `MiniMax 5h X% \| 7d Y%` | `api.minimaxi.com/coding_plan/remains` | Musage minimax.rs (ccswitch 逆向, 2026-06-01 双 schema) |
| `deepseek` / `deepseek-official` | `DeepSeek ¥X.XX` (CNY) / `$X.XX` (USD) | `api.deepseek.com/user/balance` | Musage deepseek.rs |
| `kimi` / `kimi-coding` | `Kimi 5h X% \| 7d Y%` | `api.kimi.com/coding/v1/usages` | Musage kimi.rs |
| `openrouter` | `OpenRouter $X.XX` | `openrouter.ai/api/v1/credits` | Musage openrouter.rs |
| `zhipu` / `zai-coding-cn` | `Zhipu 5h X% \| 7d Y%` | `open.bigmodel.cn/api/monitor/usage/quota/limit` | Musage zhipu.rs |

**显示**根据 `state.currency` 字段自动选 `¥` / `$` 符号, 同一份 plugin 国内/海外账号都直接显示对.

## 跟 [Musage](https://github.com/Thedeergod666/Musage) 桌面端的关系

| 维度 | [Musage](https://github.com/Thedeergod666/Musage) (桌面) | dsh-musage (本插件) |
|---|---|---|
| **形态** | 悬浮窗 + 系统托盘 + 系统启动 | DSH 页面内一行 |
| **覆盖 provider** | 14 个内置 (minimax / deepseek / xiaomi / tavily / zenmux / openrouter / kimi / zhipu / stepfun / siliconflow / claude_official / anysearch / volcengine_ark / tokendance) + 自定义 New API 中转站 | 5 个 (PoC 已覆盖 A 档最常见的 5 家) |
| **鉴权** | API Key + Cookie + WebView 一键登录 | 复用 DSH 模型设置已配 API Key (Bearer, 大多数) |
| **鉴权凭证来源** | 本地 `keys.json` (Unix 0600, 原子写) | DSH `credentials` Service (`.credentials.yaml`) |
| **跨屏置顶 / 系统托盘** | ✅ 私有 API | ❌ DSH 自身无此 slot |
| **WebView 一键登录** | ✅ (xiaomi / anysearch / stepfun / kimi 总套餐) | ❌ DSH 无 WebView 创建接口 |
| **发布渠道** | GitHub Releases (dmg / nsis / AppImage / deb / rpm) | DSH 运行时 Cordis Plugin (无独立分发, runtime 加载) |

**核心结论**: dsh-musage 是 Musage 在 DSH 内的**伴侣形态**, 不是替代品. 完整功能 (14 provider + 悬浮窗 + 托盘 + 一键登录) 仍然在 [Musage 桌面端](https://github.com/Thedeergod666/Musage). 本插件先做"DSH 内能用"路径, 5 个最常见 provider 已覆盖.

**为什么有这个项目**: 我用 DSH 写代码, 想一边写一边看套餐还剩多少, 不可能再开一个 Musage 桌面 app 切来切去. 直接嵌在 DSH composer 旁边最自然. 这也是**给 Musage 桌面端带量** — 体验到 DSH 端轻量用法的用户, 可能愿意装完整桌面 app 拿 14 provider + 系统托盘 + 跨屏置顶.

## 安装 / 部署

DSH 插件运行时直接加载, 不需要 `pnpm install` 之类:

1. 在 DSH 模型设置里配置好你要监控的 provider (minimax-cn / deepseek / zhipu 等)
2. 复制 [`host.js`](./host.js) 和 [`client.js`](./client.js) 全文
3. 详细步骤见 [`deploy.md`](./deploy.md)
4. 切到对应 model, DSH composer 工具栏里出现 `[Provider 5h X% | 7d Y%]` 或 `[Provider $X.XX]`

## 前置依赖

- DSH 部署里需要 `subprocess` + `credentials` + `timer` 三个 Service (DSH ship 自带, 不需额外安装)
- DSH 模型设置里配置好对应 provider 的 API Key (DSH 客户端 → 设置 → 模型 → 添加 provider, 填 API Key, 选 DSH 不一定 ship 的 provider 比如 `minimax-cn` / `kimi-coding` 时手动输 provider id)

## 架构

参见 [`docs/architecture.md`](./docs/architecture.md) + [`docs/cordis-pitfalls.md`](./docs/cordis-pitfalls.md) (15 个踩坑沉淀).

## License

MIT, Copyright (c) 2026 Thedeergod666.
