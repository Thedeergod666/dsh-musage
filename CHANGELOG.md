# Changelog

## v0.0.21 — 2026-08-14

### Added
- **kimi** provider: 端点 `api.kimi.com/coding/v1/usages`, Bearer 鉴权, 双窗口 (5h + 7d 已用%)
- **openrouter** provider: 端点 `openrouter.ai/api/v1/credits`, 余额 = total_credits - total_usage (USD)
- **zhipu** provider: 端点 `open.bigmodel.cn/api/monitor/usage/quota/limit`, 智谱特殊 `Authorization: <key>` 不加 Bearer 前缀, unit=3 (5h) + unit=6 (周)
- 新 3 个 provider ref 名: `KIMI_CODING_API_KEY` / `OPENROUTER_API_KEY` / `ZAI_CODING_CN_API_KEY` (兼容 DSH credentials 命名规范)
- 新 3 个 client alias: `kimi-coding` / `openrouter` / `zai-coding-cn`
- 3 个新 display 分支: kimi (5h | 7d), openrouter ($余额), zhipu (5h | 7d)
- curlFetch 支持 `authStyle: "raw"` (zhipu)
- README + docs/architecture.md + deploy.md 全部更新到 v0.0.21 现状
- `docs/assets/demo.gif` 演示 gif

### Notes
- kimi-coding endpoint 用户配置正确时 schema: `limits[].detail.{limit,remaining,resetTime}` + `usage.{limit,remaining,resetTime}`
- 端点验证: openrouter 返 200 + balance_infos; zhipu 返 200 + 5h/7d 双窗口. kimi 返 403 (permission_denied, 用户订阅未开通, 但 schema 路径正确)
- 灵感: Musage kimi.rs / openrouter.rs / zhipu.rs

## 状态

✅ PoC 完整收尾, 5 provider 全实装 (minimax / deepseek / kimi / openrouter / zhipu).
✅ Slot 位置修对: `conversation.input.right`, 紧贴 model select 左侧, `margin-left: auto` 推右.
✅ 跟 DSH 当前 model 自动切换, 无需手动操作.
✅ 15 步踩坑沉淀在 `docs/cordis-pitfalls.md`.
✅ 演示 gif 准备好 README 截图.
✅ 仓库准备好 GitHub 推送 (5 provider 演示 + 完整 README + docs + 15 坑沉淀).

## 下一步

- 推 GitHub: 仓库完整, 走 `git remote add origin git@github.com:Thedeergod666/dsh-musage.git && git push -u origin main`
- 扩 B 档 5 provider (tavily / zenmux / stepfun / siliconflow / claude_official), 走同 A 档模板
- 火山方舟 (HMAC 签名) 单独插件 (需要复杂签名代码, 不适合放 host.js)
- 加 `systemPrompt.variable` 让模型在每轮推理前看到"哪家还剩多少", 避免 429

### Notes
- kimi-coding endpoint 用户配置正确时 schema: `limits[].detail.{limit,remaining,resetTime}` + `usage.{limit,remaining,resetTime}`
- 端点验证: openrouter 返 200 + balance_infos; zhipu 返 200 + 5h/7d 双窗口. kimi 返 403 (permission_denied, 用户订阅未开通, 但 schema 路径正确)
- 灵感: Musage kimi.rs / openrouter.rs / zhipu.rs

## v0.0.20 — 2026-08-14

### Fixed
- DeepSeek 解析走 Musage 真实 schema: `balance_infos[].total_balance` (string 数字), 不是老 ccswitch `balance[]`
- 加 `formatBalance(n, currency)`: 按 currency 字段选符号 (¥ CNY / $ USD)

## v0.0.15 — 2026-08-14

### Fixed
- **CRITICAL**: `SubprocessStdio` 协议是**对象** `{stdin, stdout, stderr}`, 不是数组
- v0.0.4 误改 `'collect'` 字符串 → `{maxBytes}` 对象, 但**结构还是数组**, DSH 内部读 `stdio.stdout.maxBytes` 时数组没 `.stdout` 属性 → undefined → 抛错
- 修正: `stdio: { stdin: 'ignore', stdout: { maxBytes: 8MB }, stderr: { maxBytes: 64KB } }`
- 验证: DSH 日志显示 `exitCode=0 statusCode=200 parsed.ok=true fiveHour=18% remaining=82%`

### Notes
- 这是 v0.0.1 → v0.0.15 共 15 版的**核心**修复
- 之前所有"位置问题"都搞错了方向, 真正的根因一直没暴露, 因为错误信息误导 (`maxBytes undefined` 看似错在 maxBytes 字段, 实际是 stdio 结构)

## v0.0.14 — 2026-08-14

### Added
- Host 全链路 `console.log` 诊断 (8 处: resolveExecutable / spawn / done / stderr / statusCode / body / parsed)
- 通过读 `/private/tmp/dsh.log` 定位 spawn 抛异常的根因

## v0.0.13 — 2026-08-14

### Changed
- Slot: `input.left` (位置对) + `width:100%` + `text-align:right` (右对齐)
- 之前 v0.0.8 → v0.0.12 一直搞错, 实际 input.left 容器不是 flex, `marginLeft:auto` 不生效
- 用容器级 text-align: right 解决

## v0.0.12 — 2026-08-14

### Tried
- `shell.overlay` 浮窗 `top:12 right:130` (估算 minimax 位置)
- 用户反馈"完全跑错地方了", 才意识到 input.left 位置本来就对, 缺的是右对齐

## v0.0.7 — 2026-08-14

### Changed
- 只用 `conversation.input.right` 一个 slot (composer 卡 model select 左边)
- 移除 v0.0.6 的 `sidebar.footer.action` 按钮 (位置错)
- 失败/加载中 inline readout 不再 `return null` 隐藏, 改成显示 `MiniMax ⚠` / `MiniMax ···`,
  让用户随时能看到 plugin 状态

## v0.0.6 — 2026-08-14 (skip)

### Notes
- v0.0.6 拆双 slot (sidebar 按钮 + composer inline), 但用户指出 sidebar 位置是错的
- v0.0.7 直接砍掉 sidebar, 单 inline readout

## v0.0.5 — 2026-08-14

### Changed
- **Slot 从 `conversation.composer.dock` 改 `conversation.input.dock`** (composer 卡上方, 自己的行, 不挤输入框)
- 失败时 `return null` 隐藏 dock entry (不再长期显示 "暂不可用" 干扰)
- 加载中 `return null`, 避免 "加载中" 文字闪一帧

### Notes
- v0.0.5 是当前 PoC 终点 — 验证了 DSH 里走 `subprocess` + curl 这条路对纯 Bearer API 有效
- 9 步踩坑已沉淀到 `docs/cordis-pitfalls.md`

## v0.0.4 — 2026-08-14

### Fixed
- `subprocess.spawn` stdio 不支持 `'collect'` 字符串, 改用 `SubprocessCollect` 对象 `{ maxBytes: 8MB }` 形式

## v0.0.3 — 2026-08-14

### Changed
- 弃用 `web.fetch`, 改用 `subprocess` 调 `curl` (DSH 部署里没有 web fetch provider, 且 `WebFetchProvider` 协议本身不支持 header)

### Notes
- 这是关键转折: DSH `WebFetchRequest` 只有 `url` 字段, 不能加 Authorization. 走 curl 唯一可行

## v0.0.2 — 2026-08-14

### Fixed
- Client half 改 `setInterval` → `ctx.timer.interval` (动态 Client half 禁用浏览器 timer 全局)
- 加 `inject: ['timer']` 到 Plugin returned object

## v0.0.1 — 2026-08-14

### Added
- **PoC**: 1 个 Cordis Plugin Package, 1 个 Slot (`conversation.composer.dock`)
- **MiniMax Coding Plan 用量实时显示**: 5h / 周 两个窗口的已用百分比 + 重置倒计时
- 复用 DSH 模型设置里已配的 `minimax` / `minimax-cn` API Key, 无需重复配置
- 兼容 2026-06-01 前后双 schema (percent-based / count-based)
- 内存缓存 30s TTL避重复请求; 错误指数退避最 30min
- 默认 60s 轮询间隔

### Known Issues
- v0.0.1 Slot Render 失败 (setInterval 不可用), v0.0.2 修复
