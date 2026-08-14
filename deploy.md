# 部署指南

DSH 插件的部署不算"安装": 它把 `host.js` + `client.js` 两个文件的源码塞进 DSH 运行时定义.

## 一次性准备

需要知道 DSH 运行时 **cordis_define** 工具接受什么样格式的代码. 简化版:

```js
cordis_define({
  plugin: { kind: 'new', idPrefix: 'musage' },
  name: 'musage-minimax-quota',
  purpose: 'DSH composer 下方显示 MiniMax Coding Plan 实时余额',
  code: {
    host: '<把 host.js 全文作为字符串>',
    client: '<把 client.js 全文作为字符串>',
  },
})
```

## 步骤

### 1. 复制 host.js 全文

```bash
cat host.js | pbcopy   # macOS
# 或:
cat host.js | xclip -selection clipboard   # Linux
```

### 2. 复制 client.js 全文

```bash
cat client.js | pbcopy
```

### 3. cordis_define Package

在 DSH 会话里告诉 agent: "把 host.js / client.js 部署成新插件 `musage-minimax-quota`". agent 会调用 `cordis_define` 并粘贴源码.

### 4. cordis_run 启动

`cordis_define` 成功后拿到 `pluginId` + `packageId`, 调 `cordis_run` 启动.

### 5. 验证

打开 DSH 任一会话, `composer` 紧下方状态栏应当出现一行 minimax 余额. 没看到 → `cordis_inspect_self` 查诊断.

## 升级

Plugin 是 immutable 的: 每次改源码都会产生新 package. 流程:

1. 改 `host.js` / `client.js`
2. commit to git
3. `cordis_define({ plugin: { kind: 'existing', pluginId: '...' }, ... })` (kind: existing)
4. 拿到新 `packageId` 后, `cordis_run({ pluginId, packageId, mode: 'update' })`

`cordis_run` 不同 mode:

| 模式 | 用途 |
|---|---|
| `run` | 首次启动 / 重启 / 回滚 |
| `update` | 从当前版本切换到新版本 |

## 审批

DSH 首次运行一个 Client Package 可能要求你审批 (用户授权). 同意后啥时候都能跑.

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| 状态栏没出现 | Slot 注册失败 | `cordis_inspect_self` 查消息 |
| `key not configured` | DSH 模型设置没有 minimax | 去 DSH 设置填 key |
| `auth failed` | key 错 / 失效 | 重新填 |
| 一直 5h 28% 数字不刷新 | 缓存 30s TTL 或后端错误 | 检查 `cordis_inspect_self` 输出 |
