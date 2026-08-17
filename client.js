// client.js — DSH Client 半边
//
// 责任: 在 `shell.overlay` Slot (frame-wide 浮层, 页面**最顶层**) 注册一个
//       小型 chip, **视觉上贴近 DSH 顶部右上角 user info chip 旁边**.
//
// 浮窗位置: position: fixed; top: 12px; right: 130px (跟 user chip 平行, 在它左边).
//          user chip 大约在 right: 24px / top: 12px. 我们浮在它旁边.
//
// 失败显示 ⚠, 成功显示 "5h 28% · 7d 14%", 加载中显示 ···.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.
//
// v0.0.12: 用户最终目标位置是 DSH 顶部右侧 user info chip 旁边. 之前 v0.0.11
//          放在 minimax select 估算位置错. 用户截图显示目标 chip 在 DSH
//          滚动条左侧 (chat area 右上角).

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

function OverlayFloater(timer) {
  const state = useQuota(timer);

  // shell.overlay 容器是 frame-wide 浮层. 我们内部容器相对 viewport 固定到
  // **DSH 顶部右上角 user chip 旁边**. user chip 大约在 right: 24px / top: 12px.
  const containerStyle = {
    position: "fixed",
    top: 12,
    right: 130,        // user chip 左侧 (user chip 宽约 100px, 留 ~30px 间距)
    zIndex: 9000,
    pointerEvents: "auto",
    padding: "4px 10px",
    borderRadius: 8,
    background: "var(--dsh-bg-elevated, rgba(20,20,20,0.85))",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid var(--dsh-border, rgba(255,255,255,0.08))",
    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  };

  // 加载中
  if (!state.loaded) {
    return React.createElement(
      "div",
      {
        title: "dsh-musage · MiniMax\n加载中...",
        style: Object.assign({}, containerStyle, {
          color: "var(--dsh-text-muted, #888)",
        }),
      },
      React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
      " ",
      React.createElement("span", { style: { opacity: 0.6 } }, "···")
    );
  }

  // 失败
  if (!state.ok) {
    return React.createElement(
      "div",
      {
        title: "dsh-musage · MiniMax (失败)\n" + (state.message || "unknown"),
        style: Object.assign({}, containerStyle, {
          color: "var(--dsh-text-warning, #f5a623)",
        }),
      },
      React.createElement("span", { style: { fontWeight: 500 } }, "MiniMax"),
      " ",
      React.createElement("span", { style: { fontWeight: 600 } }, "⚠")
    );
  }

  // 成功
  const fiveHrPct = state.fiveHour ? formatPercent(state.fiveHour.usedPercent) : "—";
  const weeklyPct = state.weekly ? formatPercent(state.weekly.usedPercent) : "—";

  return React.createElement(
    "div",
    {
      title:
        "dsh-musage · MiniMax\n" +
        "5h: " + fiveHrPct + "  " + (state.fiveHour ? formatResetsIn(state.fiveHour.resetsAt) : "") + "\n" +
        "7d: " + weeklyPct + "  " + (state.weekly ? formatResetsIn(state.weekly.resetsAt) : ""),
      style: Object.assign({}, containerStyle, {
        color: "var(--dsh-text, #eee)",
      }),
    },
    React.createElement("span", { style: { fontWeight: 500, opacity: 0.7 } }, "MiniMax"),
    " ",
    React.createElement("span", { style: { fontWeight: 600 } }, fiveHrPct),
    " ",
    React.createElement("span", { style: { opacity: 0.5, fontSize: 10 } }, "·"),
    " ",
    React.createElement("span", { style: { fontWeight: 600 } }, weeklyPct)
  );
}

return {
  inject: ["timer"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;
    const timer = ctx.timer;

    slots.inject("shell.overlay", () => {
      return slots.register(
        {
          name: "shell.overlay",
          id: "musage-minimax",
          order: 50,
          label: "MiniMax",
        },
        function () { return OverlayFloater(timer); }
      );
    });
  },
};