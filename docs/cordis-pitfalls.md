# DSH Cordis Plugin 踩坑笔记

dsh-musage v0.0.1 → v0.0.5 一路下来踩到的坑, 留给后续扩展 A 档 9 个 provider 时参考.

## 1. 动态 Client half 不能用浏览器 timer 全局

**症状**:
```
setInterval is not available in a dynamic client half — browser timer globals
are unavailable in dynamic packages. Declare inject: ['timer'] on the returned
plugin, query Client Service.listService for the exact API, and close over that
plugin ctx.
```

**原因**: DSH 沙箱禁止 `setInterval` / `setTimeout` / `requestAnimationFrame` 等.

**修法**:
```js
// 错
return {
  apply(ctx) {
    setInterval(refresh, 60_000)
  }
}

// 对
return {
  inject: ['timer'],
  async apply(ctx) {
    const timer = ctx.timer  // 闭包到 timer Service
    slots.inject('conversation.input.dock', () => {
      return slots.register(
        { name: '...', id: '...' },
        (props) => DockRow(timer)  // 把 timer 传给 React component
      )
    })
  }
}

// React 组件内部
function DockRow(timer) {
  React.useEffect(() => {
    const dispose = timer.interval(refresh, 60_000)  // 返 () => void
    return () => dispose()  // 清理
  }, [timer])
}
```

## 2. `web.fetch` 协议不支持自定义 header

**症状**: 调 `ctx.web.fetch({ url, headers: { Authorization: 'Bearer ...' } })` → 服务器收不到 Authorization.

**原因**: DSH `WebFetchRequest` 类型**只有 url 字段**:
```ts
export interface WebFetchRequest {
  readonly url: string;
}
```

`WebFetchProvider` 协议只支持 GET 公开网页, 不能加自定义 header. 是 LLM-safe 设计(不让 fetch 跑用户自己的 auth).

**修法**: 不用 `web.fetch`, 改用 `subprocess` 调 `curl`:
```js
const subprocess = ctx.get('subprocess')
const curlPath = await subprocess.resolveExecutable('curl')
const handle = subprocess.spawn({
  argv: [
    curlPath, '-sS', '-w', '\\n%{http_code}',
    '-H', 'Authorization: Bearer ' + key,
    url,
  ],
  cwd: '/',
  stdio: [
    'ignore',
    { maxBytes: 8 * 1024 * 1024 },  // 见下一坑
    { maxBytes: 64 * 1024 },
  ],
  graceMs: 15_000,
})
const outcome = await handle.done
const stdout = handle.collected.stdout.readFrom(0)
```

## 3. `subprocess.spawn` 不支持 `'collect'` 字符串的 stdio

**症状**:
```
fetch 异常: Cannot read properties of undefined (reading 'maxBytes')
```

**原因**: `SubprocessOutputMode` 枚举:
```ts
export type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect;
```

**没有 `'collect'` 字符串**. DSH 内部用 `mode.maxBytes` 读, 字符串 `.maxBytes` = undefined → 抛错.

**修法**: 用 `SubprocessCollect` 对象形式:
```js
// 错
stdio: ['ignore', 'collect', 'collect']  // 'collect' 非法

// 对
stdio: [
  'ignore',
  { maxBytes: 8 * 1024 * 1024 },  // 8MB stdout cap
  { maxBytes: 64 * 1024 },          // 64KB stderr cap
]
```

## 4. DSH 部署里通常没有 web fetch provider

**症状**: `fetch 异常: no usable web provider is registered`

**原因**: DSH `web.fetch` Service 是个抽象接口, 实际 fetch 能力要别人 (`dsh-web-search-deepseek` 之类) 调 `ctx.web.registerFetchProvider()` 注册. 当前部署**没有内置 fetch provider**.

**修法**: 同坑 2, 走 `subprocess` + curl.

**验证方法**:
```js
const web = ctx.get('web')
if (web) {
  try { await web.fetch({ url: 'https://example.com' }) } catch (e) { console.log(e) }
  // -> "no usable web provider is registered" = 没 provider
}
```

## 5. cordis_run update 不会重启 host 进程

**症状**: 更新 host.js 代码后, 浏览器仍跑旧代码, 报错跟之前一样.

**原因**: DSH update mode 只切 `currentPackageId`, 不一定重启 host 进程(取决于平台实现).

**修法**: 强制 stop + run:
```bash
cordis_stop(pluginId)   →  cordis_run(pluginId, packageId, mode: 'run')
```

或者把改动记在 `ctx.effect(() => () => { ... })` 的清理函数里, 每次 update 重建.

## 6. 浏览器缓存挡住 plugin bundle 更新

**症状**: `cordis_run` 成功后, 浏览器 UI 没变化.

**修法**: `Cmd+Shift+R` 硬刷新 (不走 cache). 不是 `Cmd+R`.

## 7. DSH credentials 推导规则

**规则** (见 `dsh-client-ui-settings-models/lib/client.js:476`):
```js
function deriveKeyRef(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
```

| provider route | credentials ref |
|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY` |
| `minimax-en` | `MINIMAX_EN_API_KEY` |
| `claude` | `CLAUDE_API_KEY` |

**调用方式**:
```js
const credentials = ctx.get('credentials')
const hit = await credentials.resolve('MINIMAX_CN_API_KEY')
if (hit) apiKey = hit.value
```

注意: 返回 `{ value, source }` 或 `undefined`. **空值**视为未配置(resolve 跳过, describe 报 unconfigured).

## 8. Slot 注册位置

| Slot kind | 适合我们的 | 备注 |
|---|---|---|
| `single` | 不能多于 1 个 | 替换原有 |
| `list` | 多 entry 叠加, 用 order 排 | 跟 DSH ship 的 entry 并列 |
| `keyed` | 按 key 路由 (e.g. tool.call.toolview) | 一般不用 |
| `chain` | selector 路由替换 | 整套替换 |

`conversation.input.dock` (list kind, session scope) — 我们用 order 5, DSH ship 用 0/10/20/50.

## 9. `cordis_inspect_self` 持久化层 vs 浏览器缓存

`cordis_inspect_self` 看到的是 cordis 持久化层 (server side), 跟浏览器无关. **即使 inspect 显示 v0.0.4, 浏览器仍可能跑 v0.0.3** —— 必须 `Cmd+Shift+R`.

## 10. 错误显示策略

**问题**: 一直显示 "暂不可用" → 干扰视觉.

**方案**: 失败时 `return null`, 整个 dock entry 隐藏. 反正用户在 DSH 设置里能看具体配置, dock 那边只显示**成功的状态**.

**保底**: 如果用户想知道为什么失败, 把 `state.message` 写到 `settings` 或 `logs` Service (后者 DSH 应该有), 不在 dock 里强行显示.

## 11. pkg-5 验证清单

```
[v] Slot 改 conversation.input.dock
[v] 失败时 return null 隐藏
[v] 加载中 return null, 不闪 "加载中"
[v] 成功正常显示 5h + 7d
[v] 60s 轮询 (ctx.timer.interval)
[v] 30s cache + 指数退避
[v] 复用 DSH 已配 MINIMAX_*_API_KEY
[ ] 待验证: minimax-cn API 实际响应是否被 DSH 沙箱出口允许
```

## 12. `SubprocessStdio` 是**对象**不是数组 (v0.0.15 修)

**症状** (调试走了 N 个版本才定位):
```
fetch 异常: Cannot read properties of undefined (reading 'maxBytes')
```

**根因**: DSH `SubprocessStdio` 协议结构是:
```ts
interface SubprocessStdio {
  stdin: SubprocessStdinMode;
  stdout: SubprocessOutputMode;
  stderr: SubprocessOutputMode;
}
```

是**对象** `{ stdin, stdout, stderr }`, **不是数组** `[]`。

**早期错误修复 (v0.0.4)**: 误以为是字符串 `'collect'` 错, 改成 `{ maxBytes: N }` 对象形式. 但**结构仍然是数组**:
```js
stdio: ['ignore', { maxBytes: 8MB }, { maxBytes: 64KB }]  // ❌ 错
```

DSH 内部读 `stdio.stdout.maxBytes` 时, 数组没有 `.stdout` 属性 → undefined → 抛错.

**正确 (v0.0.15)**:
```js
stdio: {
  stdin: 'ignore',
  stdout: { maxBytes: 8 * 1024 * 1024 },
  stderr: { maxBytes: 64 * 1024 },
}  // ✅ 对
```

**调试方法** (发现这个 bug 用了 v0.0.13 → v0.0.14): 在 host.js 的 spawn 前后加 `console.log`, 然后读 DSH 进程日志:
```bash
tail -f /private/tmp/dsh.log  # macOS 默认日志
```
plugin 的 `console.log` 会进 DSH 主进程的 stdout → 写进 `/private/tmp/dsh.log`.

## 13. Slot 位置选择 (input.left vs input.right vs input.dock vs composer.dock vs sidebar.footer.action vs shell.overlay)

| Slot | kind | scope | 实际位置 | 适用 |
|---|---|---|---|---|
| `conversation.composer.dock` | list | session | composer 卡**下方** (跟 DSH ship 的 stats line 并列) | 不推荐 — 跟 stats line 抢位置 |
| `conversation.input.dock` | list | session | composer 卡**上方**自己的行 (full width) | 适合长 readout, 右对齐用 text-align |
| `conversation.input.left` | list | session | composer 卡内, `Full access` 右边 | ✅ 紧邻 model select 左侧, **最贴** minimax |
| `conversation.input.model` | single | session | model select (DSH ship 独占) | 不可注册 |
| `conversation.input.right` | list | session | composer 卡内, model select 右边 (紧邻 send 按钮) | 不适合 "minimax 旁边" |
| `sidebar.footer.action` | list | root | 侧栏底部 | 离 composer 远, 但永远在 |
| `shell.overlay` | list | root | frame-wide 浮层 | 完全独立, 可 position: fixed 任意角落 |

**最贴 minimax select** 的 slot 是 `conversation.input.left`, 但右对齐需要 `width:100% + text-align:right` 容器级方案 (因为 input.left 容器不是 flex, `marginLeft: auto` 不生效).

**Slot 容器布局限制**: `input.left`/`input.right` 容器是 normal flow (非 flex), entry 默认 inline 紧邻. `shell.overlay` 是 frame-wide 浮层, layer click-through, entry 自管 pointer events.

**最终方案 (v0.0.13)**: `input.left` + `width:100%` + `text-align:right` 容器, 内部 `display:inline-block` span 只占自己宽度, 被父容器 text-align 推到右侧.
