// client.js — DSH Client 半边
//
// 责任: 在 `conversation.composer.dock` Slot 里注册一行实时余额.
//       调 `host.call('minimax:fetch-quota', {})` 拉数据, 60s 轮询.
//       错误时静默显示简短提示, 不抢眼.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.
//
// 修复要点 (v0.0.2): 动态 Client half 不能用 setInterval / setTimeout 等
// 浏览器 timer 全局. 必须 inject: ['timer'], 拿到 ctx.timer Service.
// DSH 客户端 ctx.timer.interval(callback, delay) 返回 () => void 的 disposer.

const REFRESH_INTERVAL_MS = 60_000;

function formatPercent(used) {
  if (typeof used !== "number" || !isFinite(used)) return "—";
  const rounded = Math.round(used);
  return rounded + "%";
}

function formatResetsIn(resetsAtMs) {
  if (typeof resetsAtMs !== "number" || !resetsAtMs) return "";
  const ms = resetsAtMs - Date.now();
  if (ms <= 0) return " · 即将重置";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return " · " + h + "h" + m + "m 重置";
  return " · " + m + "m 重置";
}

function DockRow(timer) {
  // loaded: false (初次) / true (已尝试至少一次 fetch)
  const [state, setState] = React.useState({ ok: false, loaded: false, message: "加载中" });

  React.useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const result = await host.call("minimax:fetch-quota", {});
        if (alive) {
          setState(result
            ? { ...result, loaded: true }
            : { ok: false, loaded: true, kind: "other", message: "空响应" });
        }
      } catch (e) {
        if (alive) setState({ ok: false, loaded: true, kind: "network", message: String(e && e.message || e) });
      }
    }

    refresh();
    // 重要: 用 ctx.timer.interval 而不是 setInterval.
    const dispose = timer.interval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      alive = false;
      try { dispose(); } catch (e) {}
    };
  }, [timer]);

  // 加载中: 不显示 (避免一帧闪 "加载中")
  if (!state.loaded) return null;
  // 加载完成但失败: 不显示 (失败时整个 dock entry 隐藏, 避免长期 "暂不可用" 干扰)
  if (!state.ok) return null;

  // 成功: 5h + 7d 两个窗口
  const parts = [];
  if (state.fiveHour) {
    parts.push(
      React.createElement(
        "span",
        {
          key: "5h",
          style: { display: "inline-flex", alignItems: "center", gap: 4 },
          title: "5h 用量" + formatResetsIn(state.fiveHour.resetsAt).replace(" · ", " · 重置 "),
        },
        React.createElement("span", { style: { color: "var(--dsh-text-muted, #888)", fontWeight: 500 } }, "5h"),
        React.createElement(
          "span",
          { style: { fontVariantNumeric: "tabular-nums", fontWeight: 600 } },
          formatPercent(state.fiveHour.usedPercent)
        ),
        React.createElement(
          "span",
          { style: { color: "var(--dsh-text-muted, #888)", opacity: 0.7 } },
          formatResetsIn(state.fiveHour.resetsAt)
        )
      )
    );
  }
  if (state.weekly) {
    parts.push(
      React.createElement(
        "span",
        {
          key: "7d",
          style: { display: "inline-flex", alignItems: "center", gap: 4 },
          title: "周用量" + formatResetsIn(state.weekly.resetsAt).replace(" · ", " · 重置 "),
        },
        React.createElement("span", { style: { color: "var(--dsh-text-muted, #888)", fontWeight: 500 } }, "7d"),
        React.createElement(
          "span",
          { style: { fontVariantNumeric: "tabular-nums", fontWeight: 600 } },
          formatPercent(state.weekly.usedPercent)
        ),
        React.createElement(
          "span",
          { style: { color: "var(--dsh-text-muted, #888)", opacity: 0.7 } },
          formatResetsIn(state.weekly.resetsAt)
        )
      )
    );
  }

  const children = [];
  children.push(
    React.createElement(
      "span",
      {
        key: "label",
        style: { fontWeight: 500, color: "var(--dsh-text-muted, #888)" },
        title: "dsh-musage · MiniMax Coding Plan",
      },
      "MiniMax"
    )
  );
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      children.push(
        React.createElement(
          "span",
          { key: "sep" + i, style: { color: "var(--dsh-text-muted, #888)", opacity: 0.4 } },
          "·"
        )
      );
    }
    children.push(parts[i]);
  }

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        gap: 8,
        padding: "2px 8px",
        fontSize: 11,
        lineHeight: 1.4,
        color: "var(--dsh-text-muted, #888)",
      },
    },
    children
  );
}

return {
  inject: ["timer"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;

    // 关键: 把 ctx.timer 闭包到 React component 内部, 而不是依赖 setInterval.
    const timer = ctx.timer;

    slots.inject("conversation.input.dock", () => {
      return slots.register(
        {
          name: "conversation.input.dock",
          id: "musage-minimax",
          order: 5,
          label: "MiniMax",
        },
        (props) => DockRow(timer)
      );
    });
  },
};
