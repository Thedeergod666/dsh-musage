// client.js — DSH Client 半边
//
// 责任: 在 `conversation.input.dock` Slot (composer 卡**上方**自己的行, full width)
//       注册一行 status readout, 永远显示, **右对齐** (靠近 model select 上方).
//       失败显示 ⚠, 成功显示 "5h 28% · 7d 14%", 加载中显示 ···.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.
//
// v0.0.10: 用 input.dock (full-width row, 在 composer 卡上方) 而不是 input.left
//          (input.left 的 marginLeft: auto / flex 布局不生效 —— 它不像 flex 容器).
//          input.dock 容器是 normal flow, 内部靠 text-align: right 控制右对齐.

const REFRESH_INTERVAL_MS = 60_000;

function formatPercent(used) {
  if (typeof used !== "number" || !isFinite(used)) return "—";
  return Math.round(used) + "%";
}

function formatResetsIn(resetsAtMs) {
  if (typeof resetsAtMs !== "number" || !resetsAtMs) return "";
  const ms = resetsAtMs - Date.now();
  if (ms <= 0) return " 即将重置";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return h + "h" + m + "m 重置";
  return m + "m 重置";
}

function useQuota(timer) {
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
    const dispose = timer.interval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      alive = false;
      try { dispose(); } catch (e) {}
    };
  }, [timer]);

  return state;
}

function InlineReadout(timer) {
  const state = useQuota(timer);

  // 容器: full width, right-align 内容
  const containerStyle = {
    width: "100%",
    textAlign: "right",
    padding: "2px 0",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  };

  // 内部 span: inline-block, 只占自己宽度
  const innerBaseStyle = {
    display: "inline-block",
    padding: "2px 8px",
  };

  // 加载中
  if (!state.loaded) {
    return React.createElement(
      "div",
      { style: containerStyle },
      React.createElement(
        "span",
        {
          title: "dsh-musage · MiniMax\n加载中...",
          style: Object.assign({}, innerBaseStyle, {
            color: "var(--dsh-text-muted, #888)",
          }),
        },
        React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
        React.createElement(
          "span",
          { style: { opacity: 0.6, fontSize: 10 } },
          "···"
        )
      )
    );
  }

  // 失败
  if (!state.ok) {
    return React.createElement(
      "div",
      { style: containerStyle },
      React.createElement(
        "span",
        {
          title: "dsh-musage · MiniMax (失败)\n" + (state.message || "unknown"),
          style: Object.assign({}, innerBaseStyle, {
            color: "var(--dsh-text-warning, #f5a623)",
            cursor: "help",
          }),
        },
        React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
        React.createElement("span", { style: { fontWeight: 600 } }, "⚠")
      )
    );
  }

  // 成功
  const fiveHrPct = state.fiveHour ? formatPercent(state.fiveHour.usedPercent) : "—";
  const weeklyPct = state.weekly ? formatPercent(state.weekly.usedPercent) : "—";

  return React.createElement(
    "div",
    { style: containerStyle },
    React.createElement(
      "span",
      {
        title:
          "dsh-musage · MiniMax\n" +
          "5h: " + fiveHrPct + "  " + (state.fiveHour ? formatResetsIn(state.fiveHour.resetsAt) : "") + "\n" +
          "7d: " + weeklyPct + "  " + (state.weekly ? formatResetsIn(state.weekly.resetsAt) : ""),
        style: Object.assign({}, innerBaseStyle, {
          color: "var(--dsh-text-muted, #888)",
        }),
      },
      React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
      React.createElement("span", { style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } }, fiveHrPct),
      React.createElement(
        "span",
        { style: { opacity: 0.5, fontSize: 10 } },
        "·"
      ),
      React.createElement(
        "span",
        { style: { fontWeight: 600, color: "var(--dsh-text, #eee)" } },
        weeklyPct
      )
    )
  );
}

return {
  inject: ["timer"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;
    const timer = ctx.timer;

    slots.inject("conversation.input.dock", () => {
      return slots.register(
        {
          name: "conversation.input.dock",
          id: "musage-minimax",
          order: 5,
          label: "MiniMax",
        },
        function () { return InlineReadout(timer); }
      );
    });
  },
};
