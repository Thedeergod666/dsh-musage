# Changelog

## Unreleased

### Added
- **根目录 `screenshots.json`**: 按 awesome-dsh-plugin 注册表 maintainer 在 PR #3940 里的
  要求, 截图数据改放本仓库根目录 (新格式 `{"screenshots":[{"src","alt"}]}`), 不再改共享的
  `data/screenshots.json` —— 后者是所有投稿共用的单个无序文件, maintainer 说最夸张时有 108 个
  PR 同时改它, 合掉任意一个其余全部要 rebase. 同时删掉旧格式的 `docs/awesome-dsh-plugin-screenshots.json`.

### Fixed
- **README 的 slot 位置描述与实际不符**: 一直写「紧邻 model select 左侧」, 但 v0.1.2 起
  DSH 0.1.x RC 架构下 `conversation.input.right` slot 落在 model select **右侧**、send 按钮之前.
  现按架构版本分别说明.
- **deploy.md 没跟上 v0.1.3 的路由信任检查**: 故障排查表和验证章节仍描述旧的
  loopback-only 规则, 与 `dsh/index.js` 的 `isDirectHost()` 实际行为矛盾 —— 现放行
  localhost / `*.localhost` / `::1` / 任意 IPv4·IPv6 字面量 (含 LAN 直连), 域名 Host 仍拒绝.
- **deploy.md 缺百炼 provider 章节**: 补 route id / 12 个 API Key ref 候选 / 双宿主回退端点,
  以及 `sk-sp-` 专用 key 与按量 `sk-` key 不互通的坑; 故障排查表加 `Bailian ⚠` 一行.

### Removed
- CHANGELOG 里 v0.0.21 时代残留的 `## 状态` / `## 下一步` 段 (内容已完全过时, 且 Notes
  与 v0.0.21 条目重复), 改为文件末尾一份 `## Roadmap`

## v0.1.3 — 2026-10-05

### Added
- **dashscope provider (阿里云百炼 / Model Studio Coding Plan)**: 三窗口套餐用量
  (5h 滚动 / 周 / 月, 按模型调用次数计), 控制台 API `queryCodingPlanInstanceInfoV2`,
  国内 (`bailian.console.aliyun.com`) / 国际 (`modelstudio.console.alibabacloud.com`)
  双宿主, `ConsoleNeedLogin` 时自动回退. 唯一 POST 端点 (`{}` body), Bearer +
  `x-api-key` + `X-DashScope-API-Key` 三 header 同发.
  - 新 ref 候选: `DASHSCOPE_API_KEY` / `BAILIAN_*_API_KEY` / `QWEN_*_API_KEY` /
    `CODING_PLAN_API_KEY` 等 (DSH route id → `<UPPER>_API_KEY` 规范)
  - client alias: `dashscope` / `bailian` / `qwen` / `coding-plan` / `alibaba-coding` 等
  - widget 显示 `Bailian 5h X% | Wk Y% | Mo Z%`
- 补齐 README 已写但 client 漏掉的 alias: `kimi` / `zhipu`
- `npm test` 烟测 (`test/musage-smoke.mjs`): dashscope parser / 路由信任检查 /
  curl 输出拆分 / 既有 parser 回归

### Security
- **鉴权 header 移出 argv**: curl 的 `-H "Authorization: ..."` 原来拼在 argv 里,
  API Key 会暴露给本机任意用户的 `ps` 输出; 现在全部经 stdin curl 配置
  (`curl -K -`) 下发, argv 里不再出现任何密钥
- **路由信任检查放宽到 IP 字面量**: 原来只放行 loopback Host, `dsh web` 绑
  0.0.0.0 后从局域网另一台机器开 GUI 时 widget 403; 现在 localhost + 任意 IP
  字面量直连 Host 都放行 (IP 字面量不可能被 DNS rebinding 劫持, 域名 Host
  仍拒绝)
- 路由响应补 `cache-control: no-store`, 防浏览器启发式缓存导致 widget 旧数据

### Changed
- 后台预热轮询 60s → 5min (widget 挂载时 client 仍每 60s 刷新, 减少
  provider API 无谓请求)
- 4xx 非鉴权错误归类 `client_error` (原误标 `server_error`)

## v0.1.2 — 2026-09-04

### Fixed
- **client 端 `props.sessionId` 在 DSH 0.1.x RC slot 系统下永远是 undefined**: 新架构的 `conversation.input.*` slot 把 `{ session: ConversationSnapshot, input: InputState }` 作为 owner prop 传下来, 不再传 `props.sessionId`. v0.1.1 的代码用 `props.sessionId` 直接拿, 拿到 undefined → `setProvider(null)` → fallback 文本 "musage" 在 error boundary 下被吞掉, composer 完全不显示 readout.
  - 修复: `dsh/client.js` `InlineReadout` 兼容两种架构, 优先用 `props.session.sessionId`, 回落到 `props.sessionId`
  - 影响版本: v0.1.1 (任何装在 DSH 0.1.1-rc.x / 0.1.2-rc.x 上的 bundle 都触发; 旧 DSH 不受影响, 走 `props.sessionId` 分支)
  - 验证: 装在 DSH 0.1.1-rc.2 (本地 `.dsh/profiles/web`) 后, refresh 页面, MiniMax-M3 模型下应出现 `MiniMax 5h X% | 7d Y%`
  - 顺带说明: `conversation.input.right` slot 在新架构里位置变成 model select **右边** (send 按钮之前), 不是老架构的"model select 左边". 老架构下的截图 (`docs/assets/screenshots/screenshot-2-minimax.png`) 是 v0.0.x 时代的, 位置会跟新架构不同, 但功能完整.

## v0.1.1 — 2026-08-18

### Fixed
- **client 端 `slots` service 注入声明缺失**: `dsh/client.js` 的 `apply(ctx)` 里访问 `ctx.slots`,但 `exports.inject` 只声明了 `timer` / `modelDirectories`。Cordis 的 `ctx.<name>` proxy 要求属性必须先在 inject 数组里声明, 否则启动期抛 `cannot get property "slots" without inject`, client loader entry 整个拒绝挂载, DSH Web UI 顶部 composer 的 quota readout 不渲染。
  - 修复: `exports.inject = ["slots", "timer", "modelDirectories"]`
  - 影响版本: v0.1.0 (今天发布的 bundle 形态首版)
  - 触发条件: `dsh` 启用 client half 加载 (`platform: web` profile) 时必触发

## v0.1.0 — 2026-08-18

### Changed
- **转可安装 bundle 形态** (目标: dsh-market / awesome-dsh-plugin 上架):
  - 新增 `package.json`: `dsh.bundle` manifest (`patch: ./cordis.patch.yml`) + `dsh.client` manifest (`platform: web`), exports `.` → `dsh/index.js`, `./client` → `dsh/client.js`, 零 npm 依赖
  - 新增 `cordis.patch.yml`: 插入 `musage` 行 (bundle 层挂载)
  - host 半边: `dsh/index.js` (ESM `export const name/inject` + `export function apply(ctx)`); 服务访问 `ctx.get(name)` → inject 属性访问 `ctx.<name>`
  - client 半边: `dsh/client.js` (手写 lazy-CJS `window.__ModuleLoader__.load` 工厂, 同 modlens 形态); `React` 由闭包符号改 `require('react')`
  - **client→host 通道改造**: `harness.handle('quota:fetch')` / `host.call` → webServer 路由 `GET /musage/quota?provider=<p>&force=1` (JSON 返回同一 result 对象), 路由带同源 loopback 信任检查
- 安装方式: `dsh plugin --profile web add github:Thedeergod666/dsh-musage` (或本地 `add .`, link 安装)
- README / deploy.md / docs/architecture.md 同步更新

### Removed
- `host.js` / `client.js` (cordis_define 手动部署形态退役; 旧动态插件请在 设置 → Plugins 停用避免双份轮询)

### Notes
- 端到端验证 (本地 link 安装): pnpm 安装 + `reconcilePlugins` 自动追加 bundles 列表 ✅; host 路由 / client widget 于下次 `dsh web` 重启生效 (bundle 层持久化已就位)
- 上架材料: 注册表 PR 条目见 `docs/awesome-dsh-plugin-entry.yml` (仓库满 1 天后提交)

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

## Roadmap

- 扩 B 档 provider (tavily / zenmux / stepfun / siliconflow / claude_official), 走同 A 档模板
- 火山方舟 (HMAC 签名) 单独插件 (需要复杂签名代码, 不适合放现有 host 半边)
- 加 `systemPrompt.variable` 让模型在每轮推理前看到"哪家还剩多少", 避免 429
- 重录 widget 截图: `docs/assets/screenshots/*.png` 仍是 v0.0.x 老架构的位置 (model select 左侧)
