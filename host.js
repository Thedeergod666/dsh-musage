// host.js — DSH Host 半边
//
// 责任: 多 provider 通用 quota fetch.
//       调 DSH 自己的 `credentials` Service 拿用户已配的 API Key;
//       用 `subprocess` 调 `curl` 拉各 provider 的用量 (DSH 部署没有
//       fetch provider, 且 DSH `web.fetch` 协议本身不允许加 Authorization
//       header —— 只能走 curl); 30s 内存缓存 + 指数退避; 暴露
//       host.handle('quota:fetch', { provider, force }) 给 Client 端调用.
//
// v0.0.17: 通用化. 之前 v0.0.1 → v0.0.16 hardcode minimax, 现在:
//   - PROVIDERS map 注册多个 source (minimax / deepseek)
//   - handler 接受 { provider: 'minimax' | 'deepseek', force?: bool }
//   - 解析器按 provider 分发 (parseMinimax / parseDeepseekBalance)
//
// 关键决策:
//   - DSH 在用户已配的 <provider> 路由都按 `<UPPER_PROVIDER>_API_KEY` 命名规范存储
//     (推导规则见 dsh-client-ui-settings-models/lib/client.js:476). 例如
//     `minimax-cn` → `MINIMAX_CN_API_KEY`, `deepseek` → `DEEPSEEK_API_KEY`.
//   - minimax API 2026-06-01 改了 schema, 兼容 percent-based + count-based 两种.
//   - 不模仿 Musage 自己存 keys.json, 全部走 DSH credentials.resolve() ——
//     密钥安全 + 用户配置零重复.
//   - `subprocess` 调 curl: DSH 部署里没有 fetch provider, 且 WebFetchProvider
//     协议只支持 GET + url, 不能加 headers.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.host` 字段.
//       不能出现 import / require / JSX / TypeScript 类型注解 / 全局变量.

const POLL_INTERVAL_MS = 60_000;
const CACHE_TTL_MS = 30_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

// ============================================================
// Provider 注册表
// ============================================================
// 每个 provider:
//   - refs: 候选 credentials ref 列表, 按优先级尝试
//   - urls: { primary, fallback? } 端点
//   - parse: (body) => { ok, ...data | kind, message }
//
// minimax: percent-based / count-based 双 schema (来自 ccswitch 逆向)
// deepseek: user/balance 端点, 返回 USD 余额数组 (来自 Musage deepseek.rs)

const PROVIDERS = {
  minimax: {
    refs: ["MINIMAX_CN_API_KEY", "MINIMAX_EN_API_KEY", "MINIMAX_API_KEY"],
    urls: {
      MINIMAX_CN_API_KEY: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
      MINIMAX_EN_API_KEY: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
      MINIMAX_API_KEY:   "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    },
    parse: parseMinimaxResponse,
    formatOk: (data) => ({ kind: "quota", display: data.display, ...data }),
  },
  deepseek: {
    refs: ["DEEPSEEK_API_KEY"],
    urls: {
      DEEPSEEK_API_KEY: "https://api.deepseek.com/user/balance",
    },
    parse: parseDeepseekBalance,
    formatOk: (data) => ({ kind: "balance", display: data.display, ...data }),
  },
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
  if (typeof v !== "number") return null;
  if (v >= 1e12 && v <= 4e12) return v;
  return nowMs() + v * 1000;
}

// ----- minimax schema parser (2026-06-01 双 schema 兼容) -----

function parseMinimaxResponse(body) {
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
  const entry = arr.find((r) => r && r.model_name === "general") || arr[0];
  if (!entry) return { ok: false, kind: "parse", message: "找不到可用 model_remains 条目" };

  const fiveHour = parseMinimaxWindow(entry, "current_interval_", "current_interval_usage_count", "current_interval_total_count", "end_time");
  const weekly = parseMinimaxWindow(entry, "current_weekly_", "current_weekly_usage_count", "current_weekly_total_count", "weekly_end_time");

  if (!fiveHour && !weekly) {
    return { ok: false, kind: "schema_unknown", message: "MiniMax 响应字段都不认识" };
  }
  return {
    ok: true,
    provider: "minimax",
    fiveHour, weekly,
    display: {
      fiveHrPct: fiveHour ? Math.max(0, Math.min(100, Math.round(fiveHour.usedPercent))) : null,
      weeklyPct: weekly ? Math.max(0, Math.min(100, Math.round(weekly.usedPercent))) : null,
      fiveHrResetsIn: fiveHour ? formatResetsIn(fiveHour.resetsAt) : null,
      weeklyResetsIn: weekly ? formatResetsIn(weekly.resetsAt) : null,
    },
  };
}

function parseMinimaxWindow(entry, prefix, legacyRemaining, legacyTotal, endTimeKey) {
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

// ----- deepseek balance parser (从 Musage deepseek.rs 抄, v0.0.19 验证) -----
// 真实 schema:
//   { "is_available": true,
//     "balance_infos": [ { "currency": "CNY", "total_balance": "43.97",
//                            "granted_balance": "0.00", "topped_up_balance": "43.97" } ] }
//
// v0.0.19 之前我抄的是 ccswitch 老 schema ({"balance": ["10.50"]}) 错, 真实字段是
// balance_infos[].total_balance (string 数字, 需要 parseFloat).

function parseDeepseekBalance(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, kind: "parse", message: "DeepSeek 响应不是对象" };
  }
  if (json.is_available === false) {
    return { ok: false, kind: "server_error", message: "DeepSeek 账号 is_available=false" };
  }
  const infos = json.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) {
    return { ok: false, kind: "parse", message: "balance_infos 字段为空" };
  }
  const first = infos[0];
  const totalStr = first && first.total_balance;
  if (typeof totalStr !== "string" && typeof totalStr !== "number") {
    return { ok: false, kind: "parse", message: "balance_infos[0].total_balance 不存在" };
  }
  const balance = parseFloat(totalStr);
  if (!isFinite(balance)) {
    return { ok: false, kind: "parse", message: "balance 解析成数字失败: " + totalStr };
  }
  const currency = (first && first.currency) || "USD";
  return {
    ok: true,
    provider: "deepseek",
    balance,
    currency,
    display: {
      balanceUsd: balance,
      balanceText: formatBalance(balance, currency),
    },
  };
}

function formatBalance(n, currency) {
  // 简洁显示: 数字 + currency 符号. 大数取整, 小数 2 位.
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  const text = (n >= 100) ? n.toFixed(0) : (n >= 10 ? n.toFixed(2) : n.toFixed(2));
  return symbol + text;
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

function classifyHttpStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status >= 500) return "server_error";
  return "server_error";
}

function parseCurlOutput(rawText) {
  if (typeof rawText !== "string") return { body: "", statusCode: 0 };
  const lastNl = rawText.lastIndexOf("\n");
  if (lastNl < 0) return { body: rawText, statusCode: 0 };
  const body = rawText.slice(0, lastNl);
  const statusText = rawText.slice(lastNl + 1).trim();
  const statusCode = parseInt(statusText, 10);
  if (isNaN(statusCode)) return { body: rawText, statusCode: 0 };
  return { body, statusCode };
}

return {
  inject: ["credentials", "subprocess", "timer"],

  apply(ctx) {
    // 每个 (provider, ref) 一份 cache. 但实际我们想按 provider 一份.
    // key: provider 名.
    const cache = Object.create(null);
    const activeRef = Object.create(null);
    let curlPath = null;

    async function loadApiKey(provider) {
      const cfg = PROVIDERS[provider];
      if (!cfg) return { ref: null, key: null };
      if (activeRef[provider]) {
        const credentials = ctx.get("credentials");
        if (credentials) {
          const hit = await credentials.resolve(activeRef[provider]);
          if (hit && hit.value) return { ref: activeRef[provider], key: hit.value };
        }
      }
      const credentials = ctx.get("credentials");
      if (!credentials) return { ref: null, key: null };
      for (const ref of cfg.refs) {
        try {
          const hit = await credentials.resolve(ref);
          if (hit && hit.value) {
            activeRef[provider] = ref;
            return { ref, key: hit.value };
          }
        } catch (e) {}
      }
      return { ref: null, key: null };
    }

    async function resolveCurl() {
      if (curlPath) return curlPath;
      const subprocess = ctx.get("subprocess");
      if (!subprocess) {
        console.error("[musage] subprocess service 不可用 (ctx.get returned undefined)");
        throw new Error("subprocess service 不可用");
      }
      try {
        curlPath = await subprocess.resolveExecutable("curl");
        console.log("[musage] resolveExecutable('curl') -> " + curlPath);
      } catch (e) {
        console.error("[musage] resolveExecutable('curl') 失败: " + (e && e.stack || e));
        throw new Error("找不到 curl: " + (e && e.message || String(e)));
      }
      return curlPath;
    }

    async function curlFetch(url, key) {
      const subprocess = ctx.get("subprocess");
      if (!subprocess) throw new Error("subprocess service 不可用");
      const c = await resolveCurl();
      let handle;
      try {
        handle = subprocess.spawn({
          argv: [
            c, "-sS",
            "--max-time", String(Math.floor(REQUEST_TIMEOUT_MS / 1000)),
            "-w", "\n%{http_code}",
            "-H", "Authorization: Bearer " + key,
            "-H", "Accept: application/json",
            url,
          ],
          cwd: "/",
          stdio: {
            stdin: "ignore",
            stdout: { maxBytes: 8 * 1024 * 1024 },
            stderr: { maxBytes: 64 * 1024 },
          },
          graceMs: REQUEST_TIMEOUT_MS,
        });
        console.log("[musage] [" + url + "] spawn OK pid=" + handle.pid);
      } catch (e) {
        console.error("[musage] spawn 抛异常: " + (e && e.stack || e));
        throw e;
      }
      let outcome;
      try {
        outcome = await handle.done;
        console.log("[musage] [" + url + "] done exitCode=" + outcome.exitCode + " signal=" + outcome.signal);
      } catch (e) {
        console.error("[musage] await done 抛异常: " + (e && e.stack || e));
        throw e;
      }
      const stdout = handle.collected && handle.collected.stdout
        ? handle.collected.stdout.readFrom(0)
        : { text: "", nextOffset: 0, lossy: false };
      const stderr = handle.collected && handle.collected.stderr
        ? handle.collected.stderr.readFrom(0)
        : { text: "", nextOffset: 0, lossy: false };
      console.log("[musage] [" + url + "] stdout.len=" + stdout.text.length + " stderr.len=" + stderr.text.length);
      if (outcome.exitCode !== 0) {
        return {
          ok: false,
          kind: "network",
          message: "curl 退出 " + outcome.exitCode + " · " + stderr.text.slice(0, 200),
        };
      }
      const { body, statusCode } = parseCurlOutput(stdout.text);
      console.log("[musage] [" + url + "] statusCode=" + statusCode + " body.len=" + body.length);
      if (statusCode === 0) {
        return { ok: false, kind: "network", message: "curl 输出没拿到 HTTP 状态: " + stdout.text.slice(0, 200) };
      }
      if (statusCode !== 200) {
        return {
          ok: false,
          kind: classifyHttpStatus(statusCode),
          httpStatus: statusCode,
          message: "HTTP " + statusCode + " · " + body.slice(0, 200),
        };
      }
      return { ok: true, body };
    }

    async function fetchProviderQuota(provider) {
      const cfg = PROVIDERS[provider];
      if (!cfg) {
        return { ok: false, kind: "other", message: "未知 provider: " + provider };
      }
      const { ref, key } = await loadApiKey(provider);
      if (!key) {
        return {
          ok: false,
          kind: "unconfigured",
          message: "未配置 " + provider + " API Key (在 DSH 模型设置里配置对应 provider)",
        };
      }
      const url = cfg.urls[ref] || cfg.urls[cfg.refs[0]];
      let raw;
      try {
        raw = await curlFetch(url, key);
        if (!raw.ok) return raw;
      } catch (e) {
        return { ok: false, kind: "network", message: "fetch 异常: " + (e && e.message || String(e)) };
      }
      const parsed = cfg.parse(raw.body);
      console.log("[musage] [" + provider + "] parsed.ok=" + parsed.ok + " display=" + (parsed.ok ? JSON.stringify(parsed.display) : "") + " err=" + (parsed.ok ? "" : parsed.message));
      if (parsed.ok) {
        parsed.url = url;
        parsed.ref = ref;
      }
      return parsed;
    }

    async function getQuota(provider) {
      const c = cache[provider];
      if (c && c.expiresAt > nowMs()) return c.value;
      const result = await fetchProviderQuota(provider);
      if (result.ok) {
        cache[provider] = { value: result, expiresAt: nowMs() + CACHE_TTL_MS, streak: 0 };
      } else {
        const prev = c ? c.streak : 0;
        const nextStreak = prev + 1;
        const backoffMs = computeBackoffMs(nextStreak);
        cache[provider] = { value: result, expiresAt: nowMs() + backoffMs, streak: nextStreak };
      }
      return result;
    }

    // 后台轮询: 60s 拉一次每个已知 provider
    const disposeTimer = ctx.timer.interval(async () => {
      for (const provider of Object.keys(PROVIDERS)) {
        try {
          await getQuota(provider);
        } catch (e) {}
      }
    }, POLL_INTERVAL_MS);
    // 立即尝一次
    ctx.timer.timeout(() => {
      for (const provider of Object.keys(PROVIDERS)) {
        getQuota(provider);
      }
    }, 100);

    // Host handler: 客户端入口
    const disposeHandle = harness.handle("quota:fetch", async (args) => {
      const provider = (args && args.provider) || "minimax";
      const forceRefresh = !!(args && args.force === true);
      if (forceRefresh) cache[provider] = null;
      return getQuota(provider);
    });

    ctx.effect(() => {
      return () => {
        try { disposeTimer(); } catch (e) {}
        try { disposeHandle(); } catch (e) {}
        for (const k of Object.keys(cache)) cache[k] = null;
      };
    });
  },
};
