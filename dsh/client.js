// dsh/client.js — DSH Client 半边 (bundle 形态)
//
// 责任: 在 `conversation.input.right` Slot (composer 卡内, model select 紧邻左侧)
//       注册一行 status readout, 通过 margin-left:auto 推到容器右 → 贴 model select.
//       订阅当前会话的 model 选中 (ctx.modelDirectories.directoryFor), 切换
//       provider 时自动重 fetch 对应 quota / balance.
//
// 形态说明 (v0.1.0): 手写的 lazy-CJS bundle 协议
//       (window.__ModuleLoader__.load + factory(require) 返回 cordis-plugin
//       exports), 无构建步骤, 与 in-box 插件 / modlens 同一形态. 旧
//       cordis_define 形态里 runner 注入的 `host` / `React` 闭包符号, 在
//       这里换成 `require('react')` 与对 host 半边路由的同源 fetch:
//       GET /musage/quota?provider=<p> → 旧 host.call('quota:fetch') 的
//       同一个 result JSON.
//
// v0.0.17: 跟 DSH 当前 model 切换, 自动切 provider.
//   - inject: ['timer', 'modelDirectories']
//   - slot 注册时通过 props.sessionId 拿 ModelDirectory
//   - useEffect subscribe directory.store, 状态变化 (current.provider 切换) 触发
//     useState 变更 → useEffect 依赖 [provider, timer] 重 fetch
//   - 渲染: minimax 时 "MiniMax 5h X% | 7d Y%", deepseek 时 "DeepSeek $X.XX"

window.__ModuleLoader__.load({
  id: "dsh-musage",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    const REFRESH_INTERVAL_MS = 60_000;

    // DSH provider route id → 我们 host PROVIDERS key 的映射.
    // DSH 把用户配的 provider route id 存在 directory.store.getSnapshot().current.provider 里.
    // 例如 "minimax-cn" / "deepseek" / "minimax-en" / "anthropic" / "openai" 等等.
    // 我们只关注 PROVIDERS 里有的. 其它 provider 显示 "musage".

    const PROVIDER_ALIASES = {
      "minimax-cn": "minimax",
      "minimax-en": "minimax",
      "minimax": "minimax",
      "deepseek": "deepseek",
      "deepseek-official": "deepseek",  // DSH dsh-llm-deepseek 实际 provider id (带后缀)
      "kimi-coding": "kimi",
      "openrouter": "openrouter",
      "zai-coding-cn": "zhipu",
    };

    function readActiveProvider(snapshot) {
      if (!snapshot) return null;
      const cur = snapshot.current;
      if (!cur) return null;
      const route = cur.provider;
      if (!route) return null;
      return PROVIDER_ALIASES[route] || null;
    }

    // 同源 fetch host 半边路由; 404 = host 半边没挂上 (无 web profile).
    async function fetchQuota(provider) {
      const res = await fetch("/musage/quota?provider=" + encodeURIComponent(provider), {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("quota 路由 HTTP " + res.status);
      }
      return res.json();
    }

    function InlineReadout(props, models, timer) {
      const [state, setState] = React.useState({
        ok: false, loaded: false, kind: "other", message: "加载中", display: null,
      });
      const [provider, setProvider] = React.useState(null);
      const [retrySeq, setRetrySeq] = React.useState(0);

      // 订阅 model directory 变化, 提取 active provider
      // v0.0.18: service 名是 "modelDirectories" (DSH ModelDirectoryResolver super(ctx, "modelDirectories")),
      //          不是 "models" (v0.0.17 写错, 导致 ctx.get undefined → 整个 component return → 啥都不显示).
      //          不 fallback: 没 model 上下文时 null → 显示 "musage".
      const modelsSvc = models;
      React.useEffect(() => {
        if (!modelsSvc || !props || !props.sessionId) {
          console.log("[musage-client] skip: no models or no sessionId. models=" + !!modelsSvc + " sessionId=" + (props && props.sessionId) + " → no fallback (没订阅到 provider)");
          setProvider(null);
          return;
        }
        let directory;
        try {
          directory = modelsSvc.directoryFor(props.sessionId);
          console.log("[musage-client] directoryFor ok: " + (directory ? "have directory" : "null"));
        } catch (e) {
          console.error("[musage-client] directoryFor 抛异常: " + ((e && e.stack) || e) + " → no fallback");
          setProvider(null);
          return;
        }
        if (!directory || !directory.store) {
          console.log("[musage-client] directory 缺失 → no fallback");
          setProvider(null);
          return;
        }
        const updateProvider = () => {
          try {
            const snap = directory.store.getSnapshot();
            const p = readActiveProvider(snap);
            console.log("[musage-client] model 变化: current.provider=" + (snap && snap.current && snap.current.provider) + " → mapped=" + p);
            setProvider(p);  // 不 fallback minimax, 拿不到就 null → 显示 "musage"
          } catch (e) {
            console.error("[musage-client] readActiveProvider 抛异常: " + ((e && e.stack) || e));
            setProvider(null);
          }
        };
        updateProvider();
        const stop = directory.store.subscribe(updateProvider);
        return () => { stop(); };
      }, [modelsSvc, props && props.sessionId]);

      // 每次 provider 切换或 timer 变化, 重 fetch
      React.useEffect(() => {
        if (!provider) {
          setState({ ok: false, loaded: true, kind: "other", message: "未选中支持的 provider", display: null });
          return;
        }
        let alive = true;
        async function refresh() {
          try {
            const result = await fetchQuota(provider);
            if (alive) setState(result
              ? { ...result, loaded: true }
              : { ok: false, loaded: true, kind: "other", message: "空响应", display: null });
          } catch (e) {
            if (alive) setState({ ok: false, loaded: true, kind: "network", message: String((e && e.message) || e), display: null });
          }
        }
        refresh();
        const dispose = timer.interval(refresh, REFRESH_INTERVAL_MS);
        return () => {
          alive = false;
          try { dispose(); } catch (e) {}
        };
      }, [provider, timer, retrySeq]);

      // 容器: display: inline-flex + margin-left: auto → 推 .trailing flex 容器右 → 贴 model select.
      const containerStyle = {
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "auto",
        gap: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        userSelect: "none",
      };

      // 加载中
      if (!state.loaded) {
        return React.createElement(
          "div",
          {
            title: "dsh-musage · 加载中...",
            style: Object.assign({}, containerStyle, { color: "var(--dsh-text-muted, #888)" }),
          },
          React.createElement("span", { style: { fontWeight: 500 } }, provider || "···"),
          React.createElement("span", { style: { opacity: 0.6, fontSize: 10 } }, "···")
        );
      }

      if (!provider) {
        return React.createElement(
          "div",
          {
            title: "dsh-musage · 当前模型未在 musage 支持列表内",
            style: Object.assign({}, containerStyle, { color: "var(--dsh-text-muted, #888)" }),
          },
          React.createElement("span", { style: { fontWeight: 500 } }, "musage")
        );
      }

      if (!state.ok) {
        return React.createElement(
          "div",
          {
            title: "dsh-musage · " + provider + " (失败)\n" + (state.message || "unknown"),
            style: Object.assign({}, containerStyle, { color: "var(--dsh-text-warning, #f5a623)", cursor: "help" }),
          },
          React.createElement("span", { style: { fontWeight: 500 } }, providerLabel(provider)),
          React.createElement("span", { style: { fontWeight: 600 } }, "⚠")
        );
      }

      // 成功: 不同 provider 不同渲染
      const d = state.display || {};
      return React.createElement(
        "div",
        {
          title: state.title
            || ("dsh-musage · " + provider + "\n" + JSON.stringify(d, null, 2)),
          style: Object.assign({}, containerStyle, { color: "var(--dsh-text-muted, #888)" }),
        },
        ...renderDisplay(provider, d)
      );
    }

    function providerLabel(p) {
      if (p === "minimax") return "MiniMax";
      if (p === "deepseek") return "DeepSeek";
      if (p === "kimi") return "Kimi";
      if (p === "openrouter") return "OpenRouter";
      if (p === "zhipu") return "Zhipu";
      return p;
    }

    function renderDisplay(provider, d) {
      if (provider === "minimax") {
        const fiveHrPct = (typeof d.fiveHrPct === "number") ? d.fiveHrPct + "%" : "—";
        const weeklyPct = (typeof d.weeklyPct === "number") ? d.weeklyPct + "%" : "—";
        return [
          React.createElement("span", { key: "p", style: { fontWeight: 500 } }, "MiniMax"),
          React.createElement("span", { key: "5", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "5h " + fiveHrPct),
          React.createElement("span", { key: "sep1", style: { opacity: 0.5, fontSize: 10 } }, "|"),
          React.createElement("span", { key: "7", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "7d " + weeklyPct),
        ];
      }
      if (provider === "deepseek") {
        const txt = d.balanceText || ("$" + (d.balanceUsd != null ? d.balanceUsd.toFixed(2) : "0.00"));
        return [
          React.createElement("span", { key: "p", style: { fontWeight: 500 } }, "DeepSeek"),
          React.createElement("span", { key: "b", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, txt),
        ];
      }
      if (provider === "kimi") {
        // kimi schema 同 minimax: 5h + 7d 已用%
        const fiveHrPct = (typeof d.fiveHrPct === "number") ? d.fiveHrPct + "%" : "—";
        const weeklyPct = (typeof d.weeklyPct === "number") ? d.weeklyPct + "%" : "—";
        return [
          React.createElement("span", { key: "p", style: { fontWeight: 500 } }, "Kimi"),
          React.createElement("span", { key: "5", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "5h " + fiveHrPct),
          React.createElement("span", { key: "sep1", style: { opacity: 0.5, fontSize: 10 } }, "|"),
          React.createElement("span", { key: "7", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "7d " + weeklyPct),
        ];
      }
      if (provider === "openrouter") {
        const txt = d.balanceText || ("$" + (d.balanceUsd != null ? d.balanceUsd.toFixed(2) : "0.00"));
        return [
          React.createElement("span", { key: "p", style: { fontWeight: 500 } }, "OpenRouter"),
          React.createElement("span", { key: "b", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, txt),
        ];
      }
      if (provider === "zhipu") {
        // 智谱 schema 同 minimax: 5h + 7d 已用%
        const fiveHrPct = (typeof d.fiveHrPct === "number") ? d.fiveHrPct + "%" : "—";
        const weeklyPct = (typeof d.weeklyPct === "number") ? d.weeklyPct + "%" : "—";
        return [
          React.createElement("span", { key: "p", style: { fontWeight: 500 } }, "Zhipu"),
          React.createElement("span", { key: "5", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "5h " + fiveHrPct),
          React.createElement("span", { key: "sep1", style: { opacity: 0.5, fontSize: 10 } }, "|"),
          React.createElement("span", { key: "7", style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, "7d " + weeklyPct),
        ];
      }
      return [React.createElement("span", { key: "p" }, provider)];
    }

    function apply(ctx) {
      const slots = ctx.slots;
      if (!slots || typeof slots.inject !== "function") {
        console.log("[musage-client] skip: slots service 不可用");
        return;
      }
      const timer = ctx.timer;
      const models = ctx.modelDirectories;
      slots.inject("conversation.input.right", function* () {
        yield slots.register(
          {
            name: "conversation.input.right",
            id: "musage",
            order: 0,
            label: "musage",
          },
          (props) => InlineReadout(props, models, timer)
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["timer", "modelDirectories"];
    return module.exports;
  },
});
