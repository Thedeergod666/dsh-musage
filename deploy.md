# 部署指南

DSH 插件部署不算"安装": 它把 `host.js` + `client.js` 两个文件的源码塞进 DSH 运行时定义.

## 一次性准备

需要知道 DSH 运行时 **cordis_define** 工具接受什么样格式的代码. 简化版:

```js
cordis_define({
  plugin: { kind: 'new', idPrefix: 'musage' },
  name: 'musage-minimax-quota',
  purpose: 'DSH composer 工具栏里显示 AI 套餐余额, 跟模型自动切换',
  code: {
    host: '<把 host.js 全文作为字符串>',
    client: '<把 client.js 全文作为字符串>',
  },
})
```

## 步骤

### 1. 配置 DSH 模型设置

plugin 复用 DSH 已配的 API key. 在 DSH 客户端 → 设置 → 模型 → 添加 provider, 填你要监控的 5 家之一:

| Provider 名称 (DSH route id) | API Key ref | 端点 |
|---|---|---|
| `minimax-cn` / `minimax-en` / `minimax` | `MINIMAX_CN_API_KEY` / `MINIMAX_EN_API_KEY` / `MINIMAX_API_KEY` | DSH client adapter |
| `deepseek` / `deepseek-official` | `DEEPSEEK_API_KEY` | DSH client adapter |
| `kimi-coding` | `KIMI_CODING_API_KEY` | DSH 客户端自加 (无 ship adapter) |
| `openrouter` | `OPENROUTER_API_KEY` | DSH 客户端自加 |
| `zai-coding-cn` | `ZAI_CODING_CN_API_KEY` | DSH 客户端自加 |

DSH ship 自带 deepseek / minimax 一类的 LLM adapter. minimax-cn / kimi-coding / zai-coding-cn / openrouter 是用户自己加的 provider route id (DSH 模型设置里手动新增).

### 2. 复制 host.js 全文

```bash
cat host.js | pbcopy   # macOS
# 或:
cat host.js | xclip -selection clipboard   # Linux
```

### 3. 复制 client.js 全文

```bash
cat client.js | pbcopy
```

### 4. cordis_define Package

在 DSH 会话里告诉 agent: "把 host.js / client.js 部署成新插件 `musage-minimax-quota`". agent 会调用 `cordis_define` 并粘贴源码.

### 5. cordis_run 启动

`cordis_define` 成功后拿到 `pluginId` + `packageId`, 调 `cordis_run` 启动.

### 6. 验证

打开 DSH 任一会话, `composer` 工具栏里 (model select 左侧) 应当出现一行当前 model 对应 provider 的用量. **切 model** 时, 该行自动切到对应 provider 的用量.

## 升级

Plugin immutable: 每次改源码都会产生新 package. 流程:

1. 改 `host.js` / `client.js`
2. commit to git
3. `cordis_define({ plugin: { kind: 'existing', pluginId: 'musage-1' }, ... })` (kind: existing)
4. 拿到新 `packageId` 后, `cordis_run({ pluginId: 'musage-1', packageId, mode: 'update' })`

`cordis_run` 不同 mode:

| 模式 | 用途 |
|---|---|
| `run` | 首次启动 / 重启 / 回滚到当前 package |
| `update` | 从当前版本切换到新 package |

## 审批

DSH 首次运行一个 Client Package 可能要求你审批 (用户授权). 同意后啥时候都能跑.

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| composer 工具栏里没出现任何东西 | Slot 注册失败 / inject 失败 | 读 `/private/tmp/dsh.log` 查 host/client console 输出 |
| 显示 `musage` 不变 | model 切换的 provider route id 不在 `PROVIDER_ALIASES` 里 | 在 client.js 的 `PROVIDER_ALIASES` 加一行 |
| 切 deepseek 不变 | DSH 用 `deepseek-official` 实际 provider id (带后缀) | v0.0.19 已修, 升级 plugin |
| 显示 `Provider ⚠` 黄色 | 失败 (key 错 / 余额空 / schema 错) | hover 看 tooltip 拿具体 message, 看 `/private/tmp/dsh.log` 查 host parse 错误 |
| `no usable web provider is registered` | DSH 部署没 fetch provider, plugin 走 subprocess curl (不走 web.fetch) | v0.0.3 已修, 升级 plugin |
| `Cannot read properties of undefined (reading 'maxBytes')` | stdio 写成数组而不是对象 `{stdin,stdout,stderr}` | v0.0.15 已修, 升级 plugin |

## 调试方法 (核心经验)

plugin 的 host / client 端 `console.log` 会写进 `/private/tmp/dsh.log` (DSH 主进程 stdout). 加诊断代码后:

```bash
# 看 host 端 fetch 链路
grep '\[musage\] \[' /private/tmp/dsh.log | tail -20

# 看 client 端 model 订阅
grep '\[musage-client\]' /private/tmp/dsh.log | tail -10
```

15 步踩坑沉淀在 [`docs/cordis-pitfalls.md`](./docs/cordis-pitfalls.md).
