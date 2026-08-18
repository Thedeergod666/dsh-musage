# 部署指南

v0.1.0 起本插件是**可安装 bundle**: 仓库带 `package.json` (`dsh.bundle` manifest) +
`cordis.patch.yml` (插入 `musage` 行), host/client 半边在 `dsh/index.js` / `dsh/client.js`.
用 `dsh plugin add` 一条命令安装, 与 in-box 插件 / dsh-market 装的插件同一机制.

> v0.0.x 的 `cordis_define` 手动部署形态 (复制 host.js / client.js 全文粘进
> `code.host` / `code.client`) 已退役, 两个源文件已删除. 旧动态插件
> (`musage-1`) 如仍在跑, 在 设置 → Plugins 里停用/移除, 避免双份轮询.

## 用户安装 (从 GitHub)

```sh
dsh plugin --profile web add github:Thedeergod666/dsh-musage
```

重启 `dsh web` 后生效. 收录 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
注册表后, 也可以直接在 设置 → Plugin Market (dshmarket) 里一键安装/更新.

发布到 npm 后安装更快 (免构建授权, 市场走 npm tarball):

```sh
npm publish          # 零依赖包, 发布即用
dsh plugin --profile web add dsh-musage
```

## 本地开发

```sh
# 从仓库根目录 (link 安装, 源码改动直接生效):
dsh plugin --profile web add --config.minimum-release-age=0 .

# 改完 dsh/index.js / dsh/client.js 后刷新页面; host 侧改动需重启 dsh web
```

> `--config.minimum-release-age=0` 仅在 profile lockfile 里有"发布未满冷却期"的
> 包时需要 (例如当天发布的 dshmarket 新版), 是 pnpm 供应链策略的一次性放行,
> 不改任何持久配置.

## 升级 / 卸载

```sh
dsh plugin --profile web add github:Thedeergod666/dsh-musage   # 重装即升级
dsh plugin --profile web remove dsh-musage                     # 卸载
```

市场收录后, dshmarket 的 Updates 页会按 npm 版本 (或 pinned commit) 检测更新.

## 前置依赖

- DSH 部署里需要 `subprocess` + `credentials` + `timer` 三个 Service (DSH ship 自带, 不需额外安装)
- DSH 模型设置里配置好对应 provider 的 API Key (客户端 → 设置 → 模型 → 添加
  provider, 填 API Key; DSH 不一定 ship 的 provider 比如 `minimax-cn` /
  `kimi-coding` 手动输 provider id)

| Provider 名称 (DSH route id) | API Key ref | 端点 |
|---|---|---|
| `minimax-cn` / `minimax-en` / `minimax` | `MINIMAX_CN_API_KEY` / `MINIMAX_EN_API_KEY` / `MINIMAX_API_KEY` | DSH client adapter |
| `deepseek` / `deepseek-official` | `DEEPSEEK_API_KEY` | DSH client adapter |
| `kimi-coding` | `KIMI_CODING_API_KEY` | DSH 客户端自加 (无 ship adapter) |
| `openrouter` | `OPENROUTER_API_KEY` | DSH 客户端自加 |
| `zai-coding-cn` | `ZAI_CODING_CN_API_KEY` | DSH 客户端自加 |

## 验证

1. `dsh web` 起来后, 打开任一会话, composer 工具栏 (model select 左侧) 出现
   当前 model 对应 provider 的用量. **切 model** 自动切 provider.
2. host 路由可直接探 (同源 loopback 才放行):

```sh
curl 'http://127.0.0.1:3080/musage/quota?provider=deepseek'
# → {"ok":true,"provider":"deepseek","balance":41.15,...,"display":{...}}
```

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| composer 工具栏里没出现任何东西 | Slot 注册失败 / client 半边没加载 | 刷新页面; 看 `/private/tmp/dsh.log` 查 `[musage-client]` 输出 |
| 显示 `musage` 不变 | model 切换的 provider route id 不在 `PROVIDER_ALIASES` 里 | 在 `dsh/client.js` 的 `PROVIDER_ALIASES` 加一行 |
| 切 deepseek 不变 | DSH 用 `deepseek-official` 实际 provider id (带后缀) | v0.0.19 已修, 升级 plugin |
| 显示 `Provider ⚠` 黄色 | 失败 (key 错 / 余额空 / schema 错) | hover 看 tooltip 拿具体 message, 看 `/private/tmp/dsh.log` 查 host parse 错误 |
| `curl /musage/quota` 返回 HTML 首页 | host 半边没加载 (bundle 未进 bundles 列表 / 未重启) | 查 profile `package.json` 的 `dsh.profile.bundles`; 重启 `dsh web` |
| `quota 路由 HTTP 403` | 非同源 loopback 请求 | 路由只答本机 web UI 的同源请求, 属预期 |
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
