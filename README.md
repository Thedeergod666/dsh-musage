# dsh-musage

> DSH (DeepSeek Harness) 版的 [Musage](https://github.com/Thedeergod666/Musage) — 在 DSH 对话页面下方的状态栏里实时显示 MiniMax Coding Plan 用量余额.

## 这是什么

[Musage](https://github.com/Thedeergod666/Musage) 是一个 Tauri 桌面应用, 核心功能是实时跨 14 个 AI 套餐 provider 监控用量. 桌面形态 (悬浮窗 + 托盘) 完整、有效, 但跟 DSH 这类 AI harness 生态割裂.

**dsh-musage** 是 Musage 在 DSH 里的 "伴侣形态":
- 复用 DSH 模型设置里已配的 MiniMax API Key, 不需重复填
- 在 DSH 对话页 `composer` 下方 (stats line 同侧) 注册一行实时余额, 永远贴底
- DSH 窗口内一眼看到"还剩多少", 模型工作时不影响视线
- 拉数据走 DSH 自家 `web.fetch` 通道, 不开新端口

## 跟 Musage 桌面端的关系

| 维度 | Musage (桌面) | dsh-musage (本插件) |
|---|---|---|
| 形态 | 悬浮窗 + 托盘 + 系统启动 | DSH 页面内一行 |
| 覆盖 provider | 14 个 (minimax / deepseek / xiaomi / tavily / zenmux / openrouter / kimi / zhipu / stepfun / siliconflow / claude_official / anysearch / volcengine_ark / tokendance) | PoC 阶段 1 个 (minimax), 后续扩展 A 档 9 个纯 Bearer provider |
| 鉴权 | API Key + Cookie + WebView 一键登录 | 复用 DSH 模型设置已配 API Key |
| 鉴权凭证来源 | 本地 `keys.json` (0600) | DSH `credentials` Service |
| 跨屏置顶 | ✅ (私有 API) | ❌ (DSH 页面内) |
| 系统托盘 | ✅ | ❌ (DSH 自身无此 Slot) |
| WebView 一键登录 | ✅ (xiaomi / anysearch / stepfun / kimi) | ❌ (DSH 无 WebView 创建接口) |
| 发布渠道 | GitHub Releases (dmg / nsis / AppImage / deb / rpm) | Cordis Plugin 运行时 |

**核心结论**: dsh-musage 不替代 Musage, 是补充. 完整功能 (14 provider + 浮窗 + 托盘 + 一键登录) 仍然在 Musage 桌面端. 本插件先做最简单的 1 个 provider 验证模式.

## 安装 / 部署

DSH 插件是 DSH 运行时直接加载, 不需要 `pnpm install` 之类. 部署流程:

1. 复制 [`host.js`](./host.js) 全文
2. 复制 [`client.js`](./client.js) 全文
3. 参见 [`deploy.md`](./deploy.md)
4. 在 DSH 主页 `composer` 下方状态栏, 出现 `MiniMax 5h 28% · 7d 14%` 一行

## 前置依赖

- DSH 模型设置里已经配置了 `minimax` / `minimax-cn` / `minimax-en` 任一 Provider
  - 没配置 → 插件显示 "配置 key" 提示, 不报错
- Musage 桌面端可独立运行 (本插件不依赖它)

## 架构

参见 [`docs/architecture.md`](./docs/architecture.md).

## License

MIT, Copyright (c) 2026 Thedeergod666.
