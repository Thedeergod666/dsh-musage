# 架构

## 整体结构

```
┌─────────────────────────────────────────────────────────────┐
│ DSH webview (浏览器)                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ conversation.composer.dock Slot                       │  │
│  │ ┌───────────────────────────────────────────────────┐ │  │
│  │ │ stats line (DSH ship)                            │ │  │
│  │ │ musage-minimax (我们的插件)                       │ │  │
│  │ └───────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              ▲                                  │
              │ host.call (JSON)                │ host.handle
              │ "minimax:fetch-quota"          │ (后台轮询 / 缓存)
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│ DSH host (Node.js)                                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ musage-minimax Plugin (host)                          │  │
│  │  - 定时器 (60s) → fetch quota → 缓存                   │  │
│  │  - 30s TTL, 错误指数退避 (5s base, 30min cap)         │  │
│  │  - 双 schema 解析 (percent / count)                    │  │
│  └───────────────────────────────────────────────────────┘  │
│        │                                                   │
│        │ web.fetch({url, headers: {Authorization: Bearer}})│
│        ▼                                                   │
│  DSH web.fetch Service (reqwest + 沙箱)                   │
│        │                                                   │
│        │ HTTPS                                             │
│        ▼                                                   │
│  api.minimaxi.com / api.minimax.io                        │
└─────────────────────────────────────────────────────────────┘
```

## 关键设计

### 1. 复用 DSH 已配 key
- 不读本地 `keys.json`, 走 DSH `credentials.resolve(ref)`
- ref 从 `llm.listConfigurableProviders()` 查 minimax 那条记录的 `credentialRef` 字段
- 用户在 DSH 模型设置里配的 key 直接被用

### 2. 双 schema 兼容
MiniMax API 2026-06-01 改 schema, 新旧两种都见过:
- **percent-based**: `current_interval_remaining_percent` + `current_interval_status`
- **count-based**: `current_interval_total_count` + `current_interval_usage_count`(字段名是 "usage" 实际是 "remaining")

`parse_minimax()` 先试 percent, 失败回退 count. status 不为 1 时跳过 (用户在套餐外).

### 3. 错误退避
- 健康: 60s 轮询 + 30s 缓存
- 错误: 5s → 10s → 20s → ... → 30min cap
- 错误恢复: 立即回到正常 60s

### 4. Slot 选择
注册到 `conversation.composer.dock` (list kind, scope session):
- 永远在 composer 卡片下方
- 不抢 composer 卡内空间
- list 可以叠加, 跟 DSH ship 的 stats line 并列
- 每次 session 切换自动 unmount/remount (safe)

### 5. 数据流
- Host 端缓存是 source of truth
- Client 端每 60s 调 `host.call('minimax:fetch-quota', {})` 拉新数据
- 切换 session 时 React.useEffect 自动重 fetch
- 错误时静默显示 "key 未配" / "网络失败" / 隐藏

## Provider 扩展预留

PoC 只 1 个 minimax. 架构已经预留扩展:
- A 档 9 个 (minimax / deepseek / siliconflow / tokendance / zhipu / tavily / zenmux / openrouter / custom) 走 `web.fetch` + JSONPath 路径, 模板化
- 抽 `universal_provider.js` 基类, 9 个 provider 只需填 (endpoint / authHeader / parserPath)
- 详见 [roadmap](#roadmap) 节

## Roadmap

- **v0.0.x** (初期): minimax 1 个 PoC, 验证模式
- **v0.1.x**: 加 deepseek / siliconflow / zhipu / openrouter / tavily / zenmux / tokendance 7 个纯 Bearer
- **v0.2.x**: 多 instance (DSH 已配 2 个 DeepSeek key), 显示 topology 切换
- **v0.3.x**: Cookie 5 provider (stepfun / xiaomi / anysearch / claude_official / kimi) 走 DSH `credentials` 单值字符串, 失去一键登录但保留"用过一段时间过期提醒"
- **v0.4.x**: 子期可以加 `systemPrompt.variable` 让模型在每轮推理前看到"哪家还剩多少", 避免 429
- **v0.5.x**: 火山方舟管控面 (HMSAC 签名) 单独插件, 不走本仓, 单独仓库
