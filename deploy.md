# 部署指南

v0.1.0 起本插件是**可安装 bundle**: 仓库带 `package.json` (`dsh.bundle` manifest) +
`cordis.patch.yml` (插入 `musage` 行), host/client 半边在 `dsh/index.js` / `dsh/client.js`.
用 `dsh plugin add` 一条命令安装, 与 in-box 插件 / dsh-market 装的插件同一机制.

> v0.0.x 的 `cordis_define` 手动部署形态 (复制 host.js / client.js 全文粘进
> `code.host` / `code.client`) 已退役, 两个源文件已删除. 旧动态插件
> (`musage-1`) 如仍在跑, 在 设置 → Plugins 里停用/移除, 避免双份轮询.

## 桌面端 (DeepSeek Harness.app)

桌面端是 DSH 官方产品, 与 `dsh web` 共用同一套 profile + bundle 机制, 但**安装入口和验证方式都不一样**. 以下结论基于 DSH 桌面端 `0.2.0-rc.2` (macOS arm64) 实测.

### 装: 侧边栏「插件」页

侧边栏点 **插件** (在「新会话」下面、「工作区」上面), **+ 添加插件**, 粘 `github:Thedeergod666/dsh-musage`, 回车 → **安装** → **立即启用**.

**别去 设置 → 内置插件.** `@deepseek-ai/dsh-client-ui-settings-plugins` 自己的 README 写明"该分区只是一个壳…只读清单注册了一个", 它列的是随应用附送的官方插件, 搜不到社区插件也装不了. 装插件只有侧边栏那个页面.

### 不用重启

桌面端 profile 默认开着 HMR. `dsh-base` 的 shipped patch 里 `hmr` 行是:

```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: !!js "!ctx.get('profileContext')"
```

desktop 下 `runProfile` 会 `hostCtx.provide("profileContext", …)`, 所以表达式求值为 `false` = **启用**, 装完直接生效. 保险起见刷一下页面.

> 注意别被旧 CLI 误导. `dsh --profile web --dump-config` 这类命令用的是**本机 PATH 上的 dsh CLI**,
> 它的 `dsh-web-app` bundle 可能比桌面端旧得多, dump 出来会显示 `hmr … disabled: true` 等
> 跟桌面端实际行为相反的结果. 诊断桌面端问题不要用 PATH 上的 CLI.

### CLI 装不了 desktop profile (故意的)

```console
$ dsh plugin --profile desktop add github:Thedeergod666/dsh-musage
error: profile "desktop" is managed exclusively by the Electron application
```

`@deepseek-ai/dsh@0.2.0-rc.2` 的 `lib/bin.js` 里 `rejectElectronProfile()` 无条件拦 `desktop`,
由构造参数 `manageDesktopProfile` 放行, 而该参数只由 Electron 宿主进程传入. 桌面端只有两个入口:
侧边栏插件页, 和它内置的 `plugin_manager` 工具 (`install_bundle` / `list_bundles` / `set_plugin` …).

`tool-plugin-manager` 在 shipped patch 里是 `disabled: true`. 要让 agent 装插件, 在 profile patch 加:

```yaml
- id: tool-plugin-manager
  disabled: false
```

再用 `cordis` (Creator) 预设起会话, `plugin_manager` 工具才会挂上 — 预设决定模型能不能看见工具.

### 桌面端模型 provider 迁移

桌面端首次初始化时 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `llm-pi-ai` 行**只有 `minimax-cn`**.
从 Web profile 迁过来时, 光有 API Key 不会让 provider 出现 —— 必须把 provider 声明写进 patch.

API Key 本身**不用搬**: `~/.dsh/.credentials.yaml` 在 `$DSH_HOME` 层级, 两个 profile 共用, 已经带上了
`MINIMAX_CN_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `ZAI_CODING_CN_API_KEY` /
`KIMI_CODING_API_KEY` / `VOLCENGINE*` / `KUNBOT*` 等 ref.

要补的只有 `llm-pi-ai` 行的 `config.providers` 映射. **Loader 的 `config` 是整体替换、不做深合并**,
所以新 provider 必须追加进现有 `providers` 映射里, 不能新起一行 —— 否则会把桌面端自己写的
`minimax-cn` 整块冲掉.

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      minimax-cn: { … }        # 保留桌面端自带版本, 别覆盖
      openrouter: { … }        # 以下新增
      zai-coding-cn: { … }
      kimi-coding: { … }
```

> **重要**: profile patch 是**启动时**读的. 应用在跑的时候改 patch, 即使 HMR 重载了 Loader 树,
> 设置页也可能还持有会话开始时的快照. 改完 provider 先 **刷新页面**, 不生效再重启应用.
> 改之前先备份: `cp cordis.patch.yml cordis.patch.yml.bak-$(date +%s)`.

### 验证方式不同

`deploy.md` 上面那条 `curl 'http://127.0.0.1:19387/musage/quota?provider=deepseek'` **在桌面端用不了**:

```console
$ curl -i http://127.0.0.1:19387/
HTTP/1.1 401 Unauthorized
dsh web authentication required; reopen the URL printed by dsh web.
```

桌面端 web server 要鉴权, token 是进程内随机值、只经 IPC 传给 Electron, **不落盘**, 终端里拿不到.
插件的请求是浏览器里带 `credentials: "same-origin"` 发的, 所以 UI 正常.

桌面端只能看 UI: 打开任意会话, composer 工具栏 model 选择器左侧出现用量气泡, 切 model 跟着换 provider.

### 装完 profile 目录的变化

```console
~/.dsh/profiles/desktop/
├── package.json        # dependencies 加了 dsh-musage, bundles 末尾追加
├── pnpm-lock.yaml      # 新增
├── node_modules/       # 新增, 只装 profile 自己装的 bundle
├── cordis.patch.yml    # 官方组合包开关写这里; community bundle 的开关写 package.json 的 bundles
└── .plugin-manager/    # 新增, pnpm 运行记录
```

零依赖 + 无 `scripts`, 所以 pnpm 11 **不会**拦构建脚本, 装的时候不需要"允许这些脚本"那一步.

### `github:` spec 拉的是远端 HEAD

`github:Thedeergod666/dsh-musage` 装的是远端 HEAD 的内容, **不是你本地工作区**. 本地改了
`dsh/client.js` 不会生效, 除非先 commit + push. 装完核一下实际版本:

```sh
grep -m1 '"version"' ~/.dsh/profiles/desktop/node_modules/dsh-musage/package.json
```

(实测现象: 远端 HEAD 写的 `0.1.1`, 而本地工作区已经是 `0.1.2` —— 因为 0.1.2 的改动没提交.)

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
| `dashscope` / `bailian` / `qwen` / `coding-plan` 等 | 12 个候选 ref 任一命中即可 (`DASHSCOPE_API_KEY` / `DASHSCOPE_CODING_*` / `BAILIAN_*` / `QWEN_*` / `CODING_PLAN_API_KEY` / `ALIBABA_*`) | `bailian.console.aliyun.com` → `modelstudio.console.alibabacloud.com` (POST, 国内宿主返 `ConsoleNeedLogin` 时回退国际宿主) |

> **百炼的 key 不能用错**: Coding Plan 用 `sk-sp-` 开头的专用 key + 专用 Base URL
> (`coding.dashscope.aliyuncs.com`), 与按量计费的 `sk-` key / `dashscope.aliyuncs.com`
> **不互通**. 但用量查询走的是控制台 API, 填对 `sk-sp-` key 即可, route id 随便起都能识别.

## 验证

1. `dsh web` 起来后, 打开任一会话, composer 工具栏 (紧邻 model select, DSH 0.1.x
   RC 架构下在 model select **右侧**、send 按钮之前; 更老架构在左侧) 出现
   当前 model 对应 provider 的用量. **切 model** 自动切 provider.
2. host 路由可直接探 (v0.1.3 起信任 localhost + 任意 IP 字面量的直连 Host):

```sh
curl 'http://127.0.0.1:3080/musage/quota?provider=deepseek'
# → {"ok":true,"provider":"deepseek","balance":41.15,...,"display":{...}}
```

> **桌面端不适用**: 桌面端 web server 要鉴权, 终端 curl 一定 401. 只能看 UI. 见上文「验证方式不同」.

## 故障排查

| 现象 | 原因 | 修复 |
|---|---|---|
| composer 工具栏里没出现任何东西 | Slot 注册失败 / client 半边没加载 | 刷新页面; 看 `/private/tmp/dsh.log` 查 `[musage-client]` 输出 |
| 显示 `musage` 不变 | model 切换的 provider route id 不在 `PROVIDER_ALIASES` 里 | 在 `dsh/client.js` 的 `PROVIDER_ALIASES` 加一行 |
| 切 deepseek 不变 | DSH 用 `deepseek-official` 实际 provider id (带后缀) | v0.0.19 已修, 升级 plugin |
| 显示 `Provider ⚠` 黄色 | 失败 (key 错 / 余额空 / schema 错) | hover 看 tooltip 拿具体 message, 看 `/private/tmp/dsh.log` 查 host parse 错误 |
| 百炼恒显 `Bailian ⚠` | 填了按量计费的 `sk-` key, 而非 Coding Plan 专用 `sk-sp-` key | 换 `sk-sp-` 专用 key; 两个 key 体系不互通. 仍失败看 log 里是不是 `ConsoleNeedLogin` (两个宿主都试过了) |
| `curl /musage/quota` 返回 HTML 首页 | host 半边没加载 (bundle 未进 bundles 列表 / 未重启) | 查 profile `package.json` 的 `dsh.profile.bundles`; 重启 `dsh web` |
| `quota 路由 HTTP 403` | Host 不是直连地址, 或请求跨源 | v0.1.3 起放行 `localhost` / `*.localhost` / `::1` / 任意 IPv4·IPv6 **字面量** (含 LAN 地址), 域名 Host 仍拒绝 —— IP 字面量不可能被 DNS rebinding 劫持. 跨源 (`Origin` 与 `Host` 不一致) 或 `sec-fetch-site: cross-site` 一律 403. 若你在 `dsh web` 绑 `0.0.0.0` 后从局域网另一台机器访问仍 403, 确认用的是 IP 地址而非域名 |
| `Cannot read properties of undefined (reading 'maxBytes')` | stdio 写成数组而不是对象 `{stdin,stdout,stderr}` | v0.0.15 已修, 升级 plugin |
| **桌面端**: 设置里搜不到社区插件 | 找的是 设置 → 内置插件, 那是只读清单 | 去侧边栏 **插件** 页, 「新会话」下面那个风车图标 |
| **桌面端**: `dsh plugin --profile desktop add` 报 `managed exclusively` | 设计如此, desktop profile 由 Electron 独占 | 用侧边栏插件页; 或开 `tool-plugin-manager` 后用 `plugin_manager` 工具 |
| **桌面端**: 切到某 provider 的模型, 侧栏什么都不显示 | 该 provider 不在 `PROVIDER_ALIASES` (如 `kunbot-*` / `volcengine-*`) | 改 `dsh/client.js` 的别名表并 push, 再重装 |
| **桌面端**: 设置 → 模型 里 provider 列表没变 | patch 是启动时读的, 设置页持有会话开始的快照 | 刷新页面; 不行就重启桌面端 |
| **桌面端**: API Key 填了但 provider 不出现 | 桌面端只预置 `minimax-cn`, Key 不会自动建 provider | 写 `llm-pi-ai` 行的 `config.providers`, 见「桌面端模型 provider 迁移」 |
| **桌面端**: 本地改了 `client.js` 没反应 | `github:` spec 装的是远端 HEAD, 不是本地工作区 | commit + push 后重装; 见「`github:` spec 拉的是远端 HEAD」 |
| **桌面端**: 改完 patch 发现 dump 里报错和桌面端行为对不上 | 用了 PATH 上过期的 `dsh` CLI 组合出的结果 | 用桌面端 asar 里的 `dsh-app-boot` 复现 `loadProfileDirectory` + `composeEntries` |

## 调试方法 (核心经验)

plugin 的 host / client 端 `console.log` 会写进 `/private/tmp/dsh.log` (DSH 主进程 stdout). 加诊断代码后:

```bash
# 看 host 端 fetch 链路
grep '\[musage\] \[' /private/tmp/dsh.log | tail -20

# 看 client 端 model 订阅
grep '\[musage-client\]' /private/tmp/dsh.log | tail -10
```

15 步踩坑沉淀在 [`docs/cordis-pitfalls.md`](./docs/cordis-pitfalls.md).
