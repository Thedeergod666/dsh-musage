# 架构

## 整体结构 (v0.0.21)

```
┌─────────────────────────────────────────────────────────────┐
│ DSH webview (浏览器)                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ conversation.composer.bar (DSH ship 容器)             │  │
│  │  ┌──────────────────────────────────────────┐         │  │
│  │  │ [+][Full access]│[musage inline]│[model][↗] │         │  │
│  │  └──────────────────────────────────────────┘         │  │
│  │   modes (DSH flex)  ↑↑↑ 我们注册到 .trailing      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              ▲                                  │
              │ host.call (JSON)                │ host.handle
              │ "quota:fetch"                  │ (后台轮询 / 缓存)
              │ {provider: 'minimax'|'deepseek'|...}
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│ DSH host (Node.js)                                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ musage-minimax-quota Plugin (host)                    │  │
│  │  - 定时器 60s → 走 PROVIDERS[provider] 查表         │  │
│  │  - 30s TTL 缓存, 错误指数退避 (5s base, 30min cap)  │  │
│  │  - 5 个 provider 通用路径 (minimax / deepseek /     │  │
│  │    kimi / openrouter / zhipu), 每个独立 schema 解析 │  │
│  └───────────────────────────────────────────────────────┘  │
│        │                                                   │
│        │ subprocess.spawn({argv: ['curl', '-H', 'Bearer xxx', url]})│
│        ▼                                                   │
│  DSH subprocess Service (subprocess-local)                │
│        │ HTTPS                                             │
│        ▼                                                   │
│  api.minimaxi.com / api.deepseek.com / api.kimi.com /     │
│  openrouter.ai / open.bigmodel.cn                          │
└─────────────────────────────────────────────────────────────┘

Client 端:
┌─────────────────────────────────────────────────────────────┐
│ InlineReadout (React)                                       │
│  - useEffect subscribe ctx.modelDirectories.directoryFor(sessionId)│
│  - 状态变化 → setProvider(route → mapped)                  │
│  - useEffect 依赖 [provider, timer] → host.call('quota:fetch',  │ 
│    {provider})                                              │
│  - renderDisplay 按 provider 分发 5h/7d 双窗 或 余额         │
└─────────────────────────────────────────────────────────────┘
```

## 关键设计

### 1. 复用 DSH 已配 key (零凭证输入)
- 不读本地 `keys.json`, 走 DSH `credentials.resolve(ref)`
- ref 名按 DSH 客户端设置规则: `${PROVIDER_UPPER}_API_KEY`
  - `minimax-cn` → `MINIMAX_CN_API_KEY`
  - `deepseek` → `DEEPSEEK_API_KEY`
  - `kimi-coding` → `KIMI_CODING_API_KEY`
  - `zai-coding-cn` → `ZAI_CODING_CN_API_KEY`
  - `openrouter` → `OPENROUTER_API_KEY`
- 用户在 DSH 模型设置里配的 key 直接被用, plugin 完全不碰密钥存储

### 2. 多 provider 通用 host
- `PROVIDERS` 注册表: 每个 entry 含 `refs / urls / parse / authStyle?`
- `fetchProviderQuota(provider)` 查表, 走同一段 curl + 解析流程
- 5 个 parser 各自独立 (从 Musage 各 rs 文件抄 schema):
  - `parseMinimaxResponse`: 2026-06-01 双 schema (percent-based / count-based)
  - `parseDeepseekBalance`: `balance_infos[].total_balance` (v0.0.20 修对, 不是老 ccswitch `balance[]`)
  - `parseKimiResponse`: `limits[].detail.{limit,remaining,resetTime}` + `usage.{...}`
  - `parseOpenrouterResponse`: `total_credits - total_usage` = 余额
  - `parseZhipuResponse`: `unit=3` (5h) + `unit=6` (周) 双窗口, **智谱特殊 `Authorization: <key>` 不加 Bearer**
- 智谱 `authStyle: "raw"` 单独走 raw header 分支

### 3. 跟 DSH 模型自动切换
- client 端 `inject: ['timer', 'modelDirectories']`
- `models.directoryFor(sessionId).store.subscribe(callback)` 监听当前 model 切换
- `PROVIDER_ALIASES` 映射 DSH provider route id → 我方 PROVIDERS key:
  - `minimax-cn` / `minimax-en` / `minimax` → `minimax`
  - `deepseek` / `deepseek-official` → `deepseek` (DSH 实际用 `deepseek-official` 带 -official 后缀)
  - `kimi-coding` → `kimi`
  - `openrouter` → `openrouter`
  - `zai-coding-cn` → `zhipu`
- model 变化 → setProvider(mapped) → 立刻重 fetch 对应 provider

### 4. Slot 位置
注册到 `conversation.input.right` (list kind, scope session):
- DSH 渲染: `[rightItems, renderSlot("input.model"), ContextMeter, primary]`
- 我的 entry 紧邻 `model select` 左侧 (`.trailing` flex 容器内)
- `display: inline-flex; margin-left: auto` → 推自己到容器最右 → 贴 model select
- v0.0.8 之前用 `conversation.composer.dock` 错位 (`Full access` 旁边, 不挨 model select), 已弃

### 5. 错误退避
- 健康: 60s 轮询 + 30s 内存缓存
- 错误: 5s → 10s → 20s → ... → 30min cap
- 错误恢复: 立即回到正常 60s
- 失败时 client 显示 `Provider ⚠` (黄), hover 看具体错误 (`HTTP 401 · 余额 字段为空` 等), 不刷屏

### 6. 调试方法 (核心经验)
host.js 的 `console.log` 打 `/private/tmp/dsh.log` (DSH 进程 stdout). 加 8 处诊断点 (`resolveExecutable / spawn / done / stderr / statusCode / body / parsed`), 15 步踩坑在 `docs/cordis-pitfalls.md` 沉淀.

## 完整 package 演进

| 版本 | 关键变更 |
|---|---|
| v0.0.1 | PoC, `composer.dock` slot, `setInterval` (v0.0.2 修) |
| v0.0.2 | 改 `ctx.timer.interval` (动态 client half 禁用 setInterval) |
| v0.0.3 | 弃 `web.fetch` 改 `subprocess + curl` (DSH 部署无 fetch provider) |
| v0.0.4 | stdio 改 `{maxBytes: N}` 对象 (原 `'collect'` 字符串抛错) |
| v0.0.5 | Slot 改 `input.dock` |
| v0.0.6 | 拆 sidebar 按钮 + input.right (位置错) |
| v0.0.7-v0.0.8 | 改 `input.left` (但 `marginLeft:auto` 不工作) |
| v0.0.9 | 试 `marginLeft: auto` (无效) |
| v0.0.10 | 改 `input.dock` + `text-align: right` (flex 容器无效) |
| v0.0.11-v0.0.12 | 试 `shell.overlay` 浮窗 (估算 minimax 位置错) |
| v0.0.13 | **回到 `input.left` + `width:100% + text-align:right`**, 位置终于对 |
| v0.0.14 | 加全链路 `console.log` 诊断 |
| v0.0.15 | **stdio 改对象形式 `{stdin,stdout,stderr}`** (之前数组错) |
| v0.0.16 | **Slot 改 `input.right`** (DSH ship `.trailing` flex 容器, 紧贴 model select 左侧) |
| v0.0.17 | 通用化 host (PROVIDERS map, 走 `quota:fetch` handler) + client 跟 DSH model 切换 |
| v0.0.18 | 修 inject 名字 `models` → `modelDirectories` (DSH `super(ctx, "modelDirectories")` 实际名) |
| v0.0.19 | 修 `PROVIDER_ALIASES` 漏 `deepseek-official` (DSH 实际 provider id 带后缀) |
| v0.0.20 | 修 DeepSeek 解析走 Musage 真实 schema (`balance_infos[].total_balance`, 不是老 ccswitch `balance[]`) |
| v0.0.21 | 扩 5 个 provider (kimi / openrouter / zhipu) |
