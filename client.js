// client.js — DSH Client 半边
//
// 责任: 在 `conversation.input.right` Slot (composer 卡内, model select 紧邻左侧)
//       注册一行 status readout, 通过 margin-left:auto 推到容器右 → 贴 model select.
//       订阅当前会话的 model 选中 (ctx.models.directoryFor), 切换 provider 时
//       自动重 fetch 对应 quota / balance.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.
//
// v0.0.17: 跟 DSH 当前 model 切换, 自动切 provider.
//   - inject: ['timer', 'models']
//   - slot 注册时通过 props.sessionId 拿 ModelDirectory
//   - useEffect subscribe directory.store, 状态变化 (current.provider 切换) 触发
//     useState 变更 → useEffect 依赖 [provider, timer] 重 fetch
//   - 渲染: minimax 时 "MiniMax 5h X% | 7d Y%", deepseek 时 "DeepSeek $X.XX"

const REFRESH_INTERVAL_MS = 60_000;

// DSH provider route id → 我们 host PROVIDERS key 的映射.
// DSH 把用户配的 provider route id 存在 directory.store.getSnapshot().current.provider 里.
// 例如 "minimax-cn" / "deepseek" / "minimax-en" / "anthropic" / "openai" 等等.
// 我们只关注 PROVIDERS 里有的 (minimax / deepseek). 其它 provider 显示 "—".

const PROVIDER_ALIASES = {
  "minimax-cn": "minimax",
  "minimax-en": "minimax",
  "minimax": "minimax",
  "deepseek": "deepseek",
};

function readActiveProvider(snapshot) {
  if (!snapshot) return null;
  const cur = snapshot.current;
  if (!cur) return null;
  const route = cur.provider;
  if (!route) return null;
  return PROVIDER_ALIASES[route] || null;
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
  //          加 fallback: 没 model 上下文时默认 'minimax' (DSH ship 几乎所有用户配了).
  const modelsSvc = models;
  React.useEffect(() => {
    if (!modelsSvc || !props || !props.sessionId) {
      console.log("[musage-client] skip: no models or no sessionId. models=" + !!modelsSvc + " sessionId=" + (props && props.sessionId) + " → fallback default 'minimax'");
      setProvider("minimax");
      return;
    }
    let directory;
    try {
      directory = modelsSvc.directoryFor(props.sessionId);
      console.log("[musage-client] directoryFor ok: " + (directory ? "have directory" : "null"));
    } catch (e) {
      console.error("[musage-client] directoryFor 抛异常: " + (e && e.stack || e) + " → fallback default 'minimax'");
      setProvider("minimax");
      return;
    }
    if (!directory || !directory.store) {
      console.log("[musage-client] directory 缺失 → fallback default 'minimax'");
      setProvider("minimax");
      return;
    }
    const updateProvider = () => {
      try {
        const snap = directory.store.getSnapshot();
        const p = readActiveProvider(snap);
        console.log("[musage-client] model 变化: current.provider=" + (snap && snap.current && snap.current.provider) + " → mapped=" + p);
        setProvider(p || "minimax");
      } catch (e) {
        console.error("[musage-client] readActiveProvider 抛异常: " + (e && e.stack || e));
        setProvider("minimax");
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
        const result = await host.call("quota:fetch", { provider: provider });
        if (alive) setState(result
          ? { ...result, loaded: true }
          : { ok: false, loaded: true, kind: "other", message: "空响应", display: null });
      } catch (e) {
        if (alive) setState({ ok: false, loaded: true, kind: "network", message: String(e && e.message || e), display: null });
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
  // 显示名: 简单 capitalize
  if (p === "minimax") return "MiniMax";
  if (p === "deepseek") return "DeepSeek";
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
  return [React.createElement("span", { key: "p" }, provider)];
}

return {
  inject: ["timer", "modelDirectories"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;
    const timer = ctx.timer;
    const models = ctx.get("modelDirectories");

    slots.inject("conversation.input.right", () => {
      return slots.register(
        {
          name: "conversation.input.right",
          id: "musage",
          order: 0,
          label: "musage",
        },
        (props) => InlineReadout(props, models, timer)
      );
    });
  },
};
