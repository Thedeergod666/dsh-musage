// client.js — DSH Client 半边
//
// 责任: 在 `conversation.composer.dock` Slot 里注册一行实时余额.
//       调 `host.call('minimax:fetch-quota', {})` 拉数据, 60s 轮询.
//       错误时静默显示简短提示, 不抢眼.
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
  if (ms <= 0) return " · 即将重置";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return " · " + h + "h" + m + "m 重置";
  return " · " + m + "m 重置";
}

function DockRow() {
  // 自定义状态管理 — 用 plain React, 不引外部 hook 库
  const [state, setState] = React.useState({ ok: false, message: "加载中" });
  const tickRef = React.useRef(0);

  React.useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const result = await host.call("minimax:fetch-quota", {});
        if (alive) setState(result || { ok: false, kind: "other", message: "空响应" });
      } catch (e) {
        if (alive) setState({ ok: false, kind: "network", message: String(e && e.message || e) });
      }
    }

    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // 状态显示
  if (!state.ok) {
    // 错误态: 短, 不抢眼
    const kind = state.kind || "other";
    const msg = state.message || "unknown";
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
          opacity: 0.7,
        },
      },
      React.createElement(
        "span",
        {
          style: { fontWeight: 500, color: "var(--dsh-text-muted, #888)" },
          title: "dsh-musage · MiniMax Coding Plan",
        },
        "MiniMax"
      ),
      React.createElement(
        "span",
        {
          style: { opacity: 0.85 },
          title: msg,
        },
        kind === "unconfigured" ? "未配置" : "暂不可用"
      )
    );
  }

  // 成功: 5h + 7d 两个窗口
  const parts = [];
  if (state.fiveHour) {
    parts.push(
      React.createElement(
        "span",
        {
          key: "5h",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          },
          title: "5h 用量" + formatResetsIn(state.fiveHour.resetsAt).replace(" · ", " · 重置 ")
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
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          },
          title: "周用量" + formatResetsIn(state.weekly.resetsAt).replace(" · ", " · 重置 ")
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

  // 分隔符
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
  async apply(ctx) {
    const slots = ctx.get("slots");
    if (slots === undefined) return;

    slots.inject("conversation.composer.dock", () => {
      return slots.register(
        {
          name: "conversation.composer.dock",
          id: "musage-minimax",
          order: 1,
          label: "MiniMax",
        },
        () => DockRow()
      );
    });
  },
};
