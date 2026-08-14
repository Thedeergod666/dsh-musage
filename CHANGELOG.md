# Changelog

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
