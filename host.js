// host.js — DSH Host 半边
//
// 责任: 调 DSH 自己的 `credentials` Service 拿用户已配的 MiniMax API Key;
//       用 `web.fetch` 拉 MiniMax Coding Plan 用量; 走 30s 内存缓存 + 指数
//       退避; 暴露 host.handle('minimax:fetch-quota', ...) 给 Client 端调用.
//
// 关键决策:
//   - DSH 在用户已配的 minimax / minimax-cn / minimax-en 三个 provider 都
//     按 `MINIMAX_<UPPER>_API_KEY` 命名规范存储 (推导规则见
//     dsh-client-ui-settings-models/lib/client.js:476).
//   - MiniMax API 2026-06-01 改了 schema, 兼容 percent-based + count-based 两种.
//   - 不模仿 Musage 自己存 keys.json, 全部走 DSH credentials.resolve() ——
//     密钥安全 + 用户配置零重复.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.host` 字段.
//       不能出现 import / require / JSX / TypeScript 类型注解 / 全局变量.

const POLL_INTERVAL_MS = 60_000;
const CACHE_TTL_MS = 30_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;

const MINIMAX_URL_CN = "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains";
const MINIMAX_URL_EN = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";

// 尝试多个 DSH credentials ref —— 用户在 DSH 设的 provider 不同, ref 命名不同.
// 顺序: CN 先 (国内最常见), 然后 EN, 最后通用.
const MINIMAX_CREDENTIAL_REFS = [
  "MINIMAX_CN_API_KEY",
  "MINIMAX_EN_API_KEY",
  "MINIMAX_API_KEY",
];

// 端点按 ref 配对: 拿到哪个 ref 就用对应 endpoint.
const REF_TO_URL = {
  MINIMAX_CN_API_KEY: MINIMAX_URL_CN,
  MINIMAX_EN_API_KEY: MINIMAX_URL_EN,
  MINIMAX_API_KEY: MINIMAX_URL_CN, // 默认走 CN, 用户没明示就 fallback 到 CN (国内用户占多)
};

function nowMs() {
  return Date.now();
}

function computeBackoffMs(streak) {
  if (streak <= 0) return 0;
  const ms = BACKOFF_BASE_MS * Math.pow(2, streak - 1);
  return Math.min(BACKOFF_MAX_MS, ms);
}

function parseEndTime(v) {
  // MiniMax 2026-06-01 改 schema: 新版 end_time 是 "距离重置的秒数" (duration),
  // 不是 epoch ms. 旧版 / 部分接口仍是 epoch ms.
  // 经验规则: [10^12, 4*10^12] 范围 = epoch ms (2001-09 ~ 2096-08), 否则 duration.
  if (typeof v !== "number") return null;
  if (v >= 1e12 && v <= 4e12) return v;
  return nowMs() + v * 1000;
}

function parseMinimax(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  const baseResp = json && json.base_resp;
  if (!baseResp || baseResp.status_code !== 0) {
    return {
      ok: false,
      kind: "server_error",
      message: (baseResp && baseResp.status_msg) || "API 返回 base_resp.status_code != 0",
    };
  }
  const arr = json && json.model_remains;
  if (!Array.isArray(arr) || arr.length === 0) {
    return { ok: false, kind: "parse", message: "model_remains 为空" };
  }
  // 优先选 model_name == "general" (新 schema 唯一稳定标识), fallback 取第一条.
  const entry = arr.find((r) => r && r.model_name === "general") || arr[0];
  if (!entry) return { ok: false, kind: "parse", message: "找不到可用 model_remains 条目" };

  const fiveHour = parseWindow(
    entry,
    "current_interval_",
    "current_interval_usage_count",
    "current_interval_total_count",
    "end_time"
  );
  const weekly = parseWindow(
    entry,
    "current_weekly_",
    "current_weekly_usage_count",
    "current_weekly_total_count",
    "weekly_end_time"
  );

  if (!fiveHour && !weekly) {
    return { ok: false, kind: "schema_unknown", message: "MiniMax 响应字段都不认识" };
  }
  return { ok: true, fiveHour, weekly };
}

function parseWindow(entry, prefix, legacyRemaining, legacyTotal, endTimeKey) {
  // 新 schema: current_interval_remaining_percent + current_interval_status
  const newPercent = entry[prefix + "remaining_percent"];
  const newStatus = entry[prefix + "status"];
  if (typeof newPercent === "number" && newStatus === 1) {
    return {
      usedPercent: Math.max(0, 100 - newPercent),
      remainingPercent: newPercent,
      resetsAt: parseEndTime(entry[endTimeKey]),
      schema: "percent",
    };
  }
  // 旧 schema: current_interval_total_count + current_interval_usage_count
  // (注意: usage_count 字段名实际是 "剩余", 满 = total, 跟直觉相反)
  const total = entry[prefix + "total_count"];
  const remaining = entry[legacyRemaining] || entry[prefix + "usage_count"];
  if (typeof total === "number" && total > 0 && typeof remaining === "number") {
    return {
      usedPercent: Math.max(0, ((total - remaining) / total) * 100),
      remainingPercent: Math.max(0, (remaining / total) * 100),
      resetsAt: parseEndTime(entry[endTimeKey]),
      schema: "count",
    };
  }
  return null;
}

function classifyHttpStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status >= 500) return "server_error";
  return "server_error";
}

return {
  inject: ["credentials", "web", "timer"],

  apply(ctx) {
    // 单实例缓存: { value, expiresAt, streak }
    let cache = null;
    let activeRef = null; // 这一轮 fetch 用的 ref, 记下来下次直接用 (避免每 tick 遍历)

    async function loadApiKey() {
      // 优先用上次成功的 ref (性能 + 行为稳定)
      if (activeRef) {
        const credentials = ctx.get("credentials");
        if (credentials) {
          const hit = await credentials.resolve(activeRef);
          if (hit && hit.value) return { ref: activeRef, key: hit.value };
        }
      }
      // 遍历尝试所有 known ref
      const credentials = ctx.get("credentials");
      if (!credentials) return { ref: null, key: null };
      for (const ref of MINIMAX_CREDENTIAL_REFS) {
        try {
          const hit = await credentials.resolve(ref);
          if (hit && hit.value) {
            activeRef = ref;
            return { ref, key: hit.value };
          }
        } catch (e) {
          // 忽略单个 ref 的失败, 继续尝试下一个
        }
      }
      return { ref: null, key: null };
    }

    async function fetchQuotaOnce() {
      const { ref, key } = await loadApiKey();
      if (!key) {
        return {
          ok: false,
          kind: "unconfigured",
          message: "未配置 MiniMax API Key (在 DSH 模型设置里配置 minimax / minimax-cn / minimax-en 任一 provider)",
        };
      }
      const web = ctx.get("web");
      if (!web) {
        return { ok: false, kind: "server_error", message: "web.fetch Service 不可用" };
      }
      const url = REF_TO_URL[ref] || MINIMAX_URL_CN;
      let result;
      try {
        result = await web.fetch({
          url,
          method: "GET",
          headers: {
            Authorization: "Bearer " + key,
            Accept: "application/json",
          },
        });
      } catch (e) {
        return { ok: false, kind: "network", message: "fetch 异常: " + (e && e.message || String(e)) };
      }
      if (!result) {
        return { ok: false, kind: "network", message: "fetch 返回空" };
      }
      if (result.status !== 200) {
        return {
          ok: false,
          kind: classifyHttpStatus(result.status),
          httpStatus: result.status,
          message: "HTTP " + result.status + " · " + String(result.body || "").slice(0, 200),
        };
      }
      const parsed = parseMinimax(result.body);
      if (parsed.ok) {
        parsed.url = url;
        parsed.ref = ref;
      }
      return parsed;
    }

    async function getQuota() {
      if (cache && cache.expiresAt > nowMs()) return cache.value;
      const result = await fetchQuotaOnce();
      if (result.ok) {
        cache = { value: result, expiresAt: nowMs() + CACHE_TTL_MS, streak: 0 };
      } else {
        const nextStreak = (cache ? cache.streak : 0) + 1;
        const backoffMs = computeBackoffMs(nextStreak);
        cache = { value: result, expiresAt: nowMs() + backoffMs, streak: nextStreak };
      }
      return result;
    }

    // 后台轮询: 首次 100ms 发起, 之后 60s 一次
    const disposeTimer = ctx.timer.interval(async () => {
      try {
        await getQuota();
      } catch (e) {
        // swallow — 错误已经在 cache 里, 不抛
      }
    }, POLL_INTERVAL_MS);
    // 立即尝一次 (不阻塞 apply)
    ctx.timer.timeout(() => { getQuota(); }, 100);

    // Host handler: 客户端拉数据入口
    const disposeHandle = harness.handle("minimax:fetch-quota", async (args) => {
      const forceRefresh = !!(args && args.force === true);
      if (forceRefresh) cache = null;
      return getQuota();
    });

    // 清理
    ctx.effect(() => {
      return () => {
        try { disposeTimer(); } catch (e) {}
        try { disposeHandle(); } catch (e) {}
        cache = null;
      };
    });
  },
};
