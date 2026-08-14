// client.js — DSH Client 半边
//
// 责任: 在 `conversation.input.left` Slot (composer 卡内, model select 左侧)
//       注册一行 status readout. 永远显示, 失败时显示 ⚠, 成功时显示用量百分比.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.
//
// v0.0.8: Slot 改 input.left (model select 左侧), 之前 v0.0.7 input.right 放错位置.
//         失败 / 加载中都不再 return null, 都显示一行 status.

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

  // 加载中
  if (!state.loaded) {
    return React.createElement(
      "span",
      {
        title: "dsh-musage · MiniMax\n加载中...",
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          fontSize: 11,
          color: "var(--dsh-text-muted, #888)",
          fontVariantNumeric: "tabular-nums",
          userSelect: "none",
        },
      },
      React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
      React.createElement(
        "span",
        { style: { opacity: 0.6, fontSize: 10 } },
        "···"
      )
    );
  }

  // 失败
  if (!state.ok) {
    return React.createElement(
      "span",
      {
        title: "dsh-musage · MiniMax (失败)\n" + (state.message || "unknown"),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          fontSize: 11,
          color: "var(--dsh-text-warning, #f5a623)",
          fontVariantNumeric: "tabular-nums",
          userSelect: "none",
          cursor: "help",
        },
      },
      React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
      React.createElement("span", { style: { fontWeight: 600 } }, "⚠")
    );
  }

  // 成功
  const fiveHrPct = state.fiveHour ? formatPercent(state.fiveHour.usedPercent) : "—";
  const weeklyPct = state.weekly ? formatPercent(state.weekly.usedPercent) : "—";

  return React.createElement(
    "span",
    {
      title:
        "dsh-musage · MiniMax\n" +
        "5h: " + fiveHrPct + "  " + (state.fiveHour ? formatResetsIn(state.fiveHour.resetsAt) : "") + "\n" +
        "7d: " + weeklyPct + "  " + (state.weekly ? formatResetsIn(state.weekly.resetsAt) : ""),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 11,
        color: "var(--dsh-text-muted, #888)",
        fontVariantNumeric: "tabular-nums",
        userSelect: "none",
      },
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
  );
}

return {
  inject: ["timer"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;
    const timer = ctx.timer;

    slots.inject("conversation.input.left", () => {
      return slots.register(
        {
          name: "conversation.input.left",
          id: "musage-minimax",
          order: 0,
          label: "MiniMax",
        },
        function () { return InlineReadout(timer); }
      );
    });
  },
};
