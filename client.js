// client.js — DSH Client 半边
//
// 责任: 注册两个 Slot:
//   1. sidebar.footer.action —— 侧栏底部"用量"按钮(永远显示, 显示状态, 点击弹 modal)
//   2. conversation.input.right —— composer 卡右端(model select 左边)极简 inline readout
//
// 失败时: sidebar 按钮显示 "⚠", inline readout 隐藏 (return null)
// 加载中: 都不显示 (避免 "加载中" 闪一帧)
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.client` 字段.
//       不能出现 import / require / JSX / TypeScript 类型 / 全局变量.

const REFRESH_INTERVAL_MS = 60_000;

function formatPercent(used) {
  if (typeof used !== "number" || !isFinite(used)) return "—";
  const rounded = Math.round(used);
  return rounded + "%";
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

// ───────── Sidebar footer button ─────────

function SidebarButton(timer) {
  const state = useQuota(timer);
  const [open, setOpen] = React.useState(false);

  // 加载中: 显示 disabled 状态
  if (!state.loaded) {
    return React.createElement(
      "button",
      {
        type: "button",
        disabled: true,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "transparent",
          color: "var(--dsh-text-muted, #888)",
          border: "none",
          borderRadius: 6,
          cursor: "default",
          fontSize: 12,
          width: "100%",
        },
      },
      "MiniMax"
    );
  }

  // 文字: 成功显示 5h + 7d, 失败显示 ⚠
  const mainText = state.ok
    ? `MiniMax ${formatPercent(state.fiveHour && state.fiveHour.usedPercent)} · ${formatPercent(state.weekly && state.weekly.usedPercent)}`
    : "MiniMax ⚠";

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setOpen(true),
        title: state.ok
          ? `dsh-musage · MiniMax\n5h ${formatPercent(state.fiveHour && state.fiveHour.usedPercent)}\n7d ${formatPercent(state.weekly && state.weekly.usedPercent)}`
          : `dsh-musage · MiniMax (失败)\n${state.message || ""}`,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "transparent",
          color: state.ok ? "var(--dsh-text, #eee)" : "var(--dsh-text-warning, #f5a623)",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          width: "100%",
          textAlign: "left",
        },
      },
      mainText
    ),
    open && React.createElement(QuotaModal, {
      state,
      onClose: () => setOpen(false),
    })
  );
}

function QuotaModal({ state, onClose }) {
  // 简易 modal —— 用固定定位 + backdrop
  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  };
  const cardStyle = {
    background: "var(--dsh-bg-elevated, #1a1a1a)",
    color: "var(--dsh-text, #eee)",
    padding: "20px 24px",
    borderRadius: 12,
    minWidth: 320,
    maxWidth: 480,
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    border: "1px solid var(--dsh-border, #333)",
  };
  const rowStyle = {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderBottom: "1px solid var(--dsh-border, #2a2a2a)",
  };
  const titleStyle = {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 16,
  };
  const errStyle = {
    color: "var(--dsh-text-warning, #f5a623)",
    fontSize: 13,
    padding: "8px 0",
    wordBreak: "break-all",
  };

  return React.createElement(
    "div",
    { style: overlayStyle, onClick: onClose },
    React.createElement(
      "div",
      { style: cardStyle, onClick: (e) => e.stopPropagation() },
      React.createElement("div", { style: titleStyle }, "MiniMax Coding Plan"),

      state.ok && state.fiveHour && React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("span", null, "5h 用量"),
        React.createElement(
          "span",
          { style: { fontWeight: 600 } },
          formatPercent(state.fiveHour.usedPercent),
          React.createElement(
            "span",
            { style: { fontSize: 11, opacity: 0.6, marginLeft: 8 } },
            formatResetsIn(state.fiveHour.resetsAt)
          )
        )
      ),
      state.ok && state.weekly && React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("span", null, "7d 用量"),
        React.createElement(
          "span",
          { style: { fontWeight: 600 } },
          formatPercent(state.weekly.usedPercent),
          React.createElement(
            "span",
            { style: { fontSize: 11, opacity: 0.6, marginLeft: 8 } },
            formatResetsIn(state.weekly.resetsAt)
          )
        )
      ),

      !state.ok && React.createElement(
        "div",
        { style: errStyle },
        state.message || "未知错误"
      ),
      !state.ok && state.kind && React.createElement(
        "div",
        { style: { fontSize: 11, opacity: 0.5, marginTop: 4 } },
          "kind: " + state.kind
      ),

      React.createElement(
        "div",
        {
          style: {
            marginTop: 16,
            textAlign: "right",
            fontSize: 11,
            opacity: 0.5,
          },
        },
        "dsh-musage · 60s 自动刷新"
      )
    )
  );
}

// ───────── Inline readout in composer input.right ─────────

function InlineReadout(timer) {
  const state = useQuota(timer);

  // 加载中 / 失败: 隐藏
  if (!state.loaded) return null;
  if (!state.ok) return null;
  if (!state.fiveHour) return null;

  return React.createElement(
    "span",
    {
      title: "MiniMax " + formatPercent(state.fiveHour.usedPercent) + " 5h · " +
        (state.weekly ? formatPercent(state.weekly.usedPercent) + " 7d" : ""),
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
    React.createElement(
      "span",
      { style: { color: "var(--dsh-text-muted, #888)", fontWeight: 500 } },
      "MiniMax"
    ),
    React.createElement(
      "span",
      { style: { fontWeight: 600 } },
      formatPercent(state.fiveHour.usedPercent)
    )
  );
}

return {
  inject: ["timer"],

  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;
    const timer = ctx.timer;

    // 1. Sidebar footer action: always-visible button + modal
    slots.inject("sidebar.footer.action", () => {
      return slots.register(
        {
          name: "sidebar.footer.action",
          id: "musage-minimax",
          order: 0,
          label: "MiniMax",
        },
        () => SidebarButton(timer)
      );
    });

    // 2. Inline readout in composer input.right (visible only on success)
    slots.inject("conversation.input.right", () => {
      return slots.register(
        {
          name: "conversation.input.right",
          id: "musage-minimax",
          order: 0,
          label: "MiniMax",
        },
        () => InlineReadout(timer)
      );
    });
  },
};
