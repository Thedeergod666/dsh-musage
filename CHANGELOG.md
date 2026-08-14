# Changelog

## v0.0.1 — 2026-08-14

### Added
- **PoC**: 1 个 Cordis Plugin Package, 1 个 Slot (`conversation.composer.dock`)
- **MiniMax Coding Plan 用量实时显示**: 5h / 周 两个窗口的已用百分比 + 重置倒计时
- 复用 DSH 模型设置里已配的 `minimax` / `minimax-cn` API Key, 无需重复配置
- 兼容 2026-06-01 前后双 schema (percent-based / count-based)
- 内存缓存 30s TTL避重复请求; 错误指数退避最 30min
- 默认 60s 轮询间隔, 失败不递增请求
