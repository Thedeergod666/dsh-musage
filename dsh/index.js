// dsh/index.js — DSH Host 半边 (bundle 形态)
//
// 责任: 多 provider 通用 quota fetch.
//       调 DSH 自己的 `credentials` Service 拿用户已配的 API Key;
//       用 `subprocess` 调 `curl` 拉各 provider 的用量 (DSH 部署没有
//       fetch provider, 且 DSH `web.fetch` 协议本身不允许加 Authorization
//       header —— 只能走 curl); 30s 内存缓存 + 指数退避.
//
// 形态说明 (v0.1.0): 本文件是 npm/GitHub 可安装 bundle 的 host 入口,
// 通过仓库根 cordis.patch.yml 的 `musage` 行挂载 (package.json 的
// dsh.bundle manifest). 旧的 cordis_define 手动部署形态 (host.js 函数体)
// 已退役 —— 服务访问从 `ctx.get(name)` 改为 inject 声明后的属性访问
// `ctx.<name>`, client 调用入口从 `harness.handle('quota:fetch')` 改为
// webServer 路由 `GET /musage/quota?provider=<p>&force=1` (JSON 返回同
// 一个 result 对象, client 半边用同源 fetch 调).
//
// 关键决策 (继承自 host.js v0.0.21):
//   - DSH 在用户已配的 <provider> 路由都按 `<UPPER_PROVIDER>_API_KEY` 命名规范存储
//     (推导规则见 dsh-client-ui-settings-models/lib/client.js:476). 例如
//     `minimax-cn` → `MINIMAX_CN_API_KEY`, `deepseek` → `DEEPSEEK_API_KEY`.
//   - minimax API 2026-06-01 改了 schema, 兼容 percent-based + count-based 两种.
//   - 不模仿 Musage 自己存 keys.json, 全部走 DSH credentials.resolve() ——
//     密钥安全 + 用户配置零重复.
//   - `subprocess` 调 curl: DSH 部署里没有 fetch provider, 且 WebFetchProvider
//     协议只支持 GET + url, 不能加 headers.

const POLL_INTERVAL_MS = 5 * 60_000;
const CACHE_TTL_MS = 30_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export const name = "musage";
export const inject = ["credentials", "subprocess", "timer"];

// ============================================================
// Provider 注册表
// ============================================================
// 每个 provider:
//   - refs: 候选 credentials ref 列表, 按优先级尝试
//   - urls: { ref: endpoint } 端点
//   - parse: (body) => { ok, ...data | kind, message }
//   - authHeaders: (key) => string[] Authorization header 列表 (默认 Bearer)
//   - method / body / fallbackUrl: 可选, 非 GET 端点或双宿主端点用
//
// minimax: percent-based / count-based 双 schema (来自 ccswitch 逆向)
// deepseek: user/balance 端点, 返回 CNY/USD 余额 (来自 Musage deepseek.rs)
// dashscope: 阿里云百炼 Coding Plan (Model Studio) 三窗口套餐用量
//   (5h 滚动 / 周 / 月), POST 控制台 API, 国内/国际双宿主回退

const BAILIAN_QUOTA_PATH = "/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2";
const BAILIAN_QUOTA_URL_CN = "https://bailian.console.aliyun.com" + BAILIAN_QUOTA_PATH;
const BAILIAN_QUOTA_URL_INTL = "https://modelstudio.console.alibabacloud.com" + BAILIAN_QUOTA_PATH;

const PROVIDERS = {
  minimax: {
    refs: ["MINIMAX_CN_API_KEY", "MINIMAX_EN_API_KEY", "MINIMAX_API_KEY"],
    urls: {
      MINIMAX_CN_API_KEY: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
      MINIMAX_EN_API_KEY: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
      MINIMAX_API_KEY:   "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    },
    parse: parseMinimaxResponse,
  },
  deepseek: {
    refs: ["DEEPSEEK_API_KEY"],
    urls: {
      DEEPSEEK_API_KEY: "https://api.deepseek.com/user/balance",
    },
    parse: parseDeepseekBalance,
  },
  kimi: {
    refs: ["KIMI_CODING_API_KEY", "KIMI_API_KEY"],
    urls: {
      KIMI_CODING_API_KEY: "https://api.kimi.com/coding/v1/usages",
      KIMI_API_KEY:         "https://api.kimi.com/coding/v1/usages",
    },
    parse: parseKimiResponse,
  },
  openrouter: {
    refs: ["OPENROUTER_API_KEY"],
    urls: {
      OPENROUTER_API_KEY: "https://openrouter.ai/api/v1/credits",
    },
    parse: parseOpenrouterResponse,
  },
  zhipu: {
    // ZAI_API_KEY: route id "zai" 的 <UPPER>_API_KEY 推导 (DSH 常见写法)
    refs: ["ZAI_CODING_CN_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
    urls: {
      ZAI_CODING_CN_API_KEY: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
      ZHIPU_API_KEY:          "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    },
    parse: parseZhipuResponse,
    // 智谱特殊: Authorization header 不加 "Bearer " 前缀 (来自 Musage zhipu.rs 注释)
    authHeaders: (key) => ["Authorization: " + key],
  },
  dashscope: {
    // DSH 里配百炼 Coding Plan 的 route id 五花八门 (dashscope / bailian /
    // qwen / coding-plan / ...), 全部按 <UPPER_ROUTE>_API_KEY 规范列进来.
    // 注意 Coding Plan key 是 sk-sp- 开头的专用 key, 与按量计费 sk- key 不通用.
    refs: [
      "DASHSCOPE_API_KEY", "DASHSCOPE_CODING_API_KEY", "DASHSCOPE_CODING_PLAN_API_KEY",
      "BAILIAN_API_KEY", "BAILIAN_CODING_API_KEY", "BAILIAN_CODING_PLAN_API_KEY",
      "QWEN_API_KEY", "QWEN_CODING_API_KEY", "QWEN_TOKEN_PLAN_API_KEY",
      "CODING_PLAN_API_KEY", "ALIBABA_CODING_PLAN_API_KEY", "ALIBABA_CLOUD_API_KEY",
    ],
    urls: {
      // 所有 ref 同一个端点 (urls[ref] 缺省时回退 urls[refs[0]]);
      // 国内宿主优先, ConsoleNeedLogin 时回退国际宿主
      DASHSCOPE_API_KEY: BAILIAN_QUOTA_URL_CN,
    },
    fallbackUrl: BAILIAN_QUOTA_URL_INTL,
    method: "POST",
    body: "{}",
    authHeaders: (key) => [
      "Authorization: Bearer " + key,
      "x-api-key: " + key,
      "X-DashScope-API-Key: " + key,
    ],
    parse: parseDashscopeCodingPlan,
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

export function parseMinimaxResponse(body) {
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

export function parseDeepseekBalance(body) {
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

// ----- kimi parser (Musage kimi.rs schema: 5h 窗口 + 7d 窗口) -----
//   { "limits": [ { "detail": { "limit": 100, "remaining": 72, "resetTime": "..." } } ],
//     "usage": { "limit": 1000, "remaining": 742, "resetTime": 1749840000 } }

function parseKimiResponse(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, kind: "parse", message: "Kimi 响应不是对象" };
  }
  // 错误响应: {"code": "permission_denied", ...}
  if (json.code && json.code !== 200 && json.code !== "200") {
    return { ok: false, kind: "server_error", message: "Kimi 返错: " + (json.code || "?") + " · " + (json.msg || "") };
  }
  // 5h 窗口: limits[0].detail
  const firstLimit = Array.isArray(json.limits) && json.limits[0] && json.limits[0].detail;
  const five = firstLimit || {};
  const fiveHrLimit = Number(five.limit) || 0;
  const fiveHrRemaining = Number(five.remaining) || 0;
  const fiveHrResetsAt = parseKimiResetTime(five.resetTime);
  // 7d 窗口: usage
  const week = json.usage || {};
  const weeklyLimit = Number(week.limit) || 0;
  const weeklyRemaining = Number(week.remaining) || 0;
  const weeklyResetsAt = parseKimiResetTime(week.resetTime);
  if (!fiveHrLimit && !weeklyLimit) {
    return { ok: false, kind: "parse", message: "Kimi 响应没有 5h/7d 限额" };
  }
  return {
    ok: true,
    provider: "kimi",
    fiveHour: { limit: fiveHrLimit, remaining: fiveHrRemaining, resetsAt: fiveHrResetsAt },
    weekly:   { limit: weeklyLimit,   remaining: weeklyRemaining,   resetsAt: weeklyResetsAt },
    display: {
      fiveHrPct:     fiveHrLimit     > 0 ? Math.round((fiveHrLimit - fiveHrRemaining) / fiveHrLimit * 100) : null,
      weeklyPct:     weeklyLimit     > 0 ? Math.round((weeklyLimit - weeklyRemaining) / weeklyLimit * 100) : null,
      fiveHrResetsIn: fiveHrResetsAt ? formatResetsIn(fiveHrResetsAt) : null,
      weeklyResetsIn: weeklyResetsAt ? formatResetsIn(weeklyResetsAt) : null,
    },
  };
}

function parseKimiResetTime(v) {
  if (typeof v === "number") {
    if (v >= 1e12 && v <= 4e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }
  if (typeof v === "string" && v.length > 0) {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  return null;
}

// ----- openrouter parser (Musage openrouter.rs: total_credits - total_usage) -----

function parseOpenrouterResponse(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, kind: "parse", message: "OpenRouter 响应不是对象" };
  }
  const data = json.data;
  if (!data || typeof data !== "object") {
    return { ok: false, kind: "parse", message: "data 字段缺失" };
  }
  const total = Number(data.total_credits);
  const used = Number(data.total_usage);
  if (!isFinite(total) || !isFinite(used)) {
    return { ok: false, kind: "parse", message: "total_credits / total_usage 不是数字" };
  }
  const remaining = total - used;
  return {
    ok: true,
    provider: "openrouter",
    balance: remaining,
    totalCredits: total,
    usedCredits: used,
    currency: "USD",
    display: {
      balanceUsd: remaining,
      balanceText: formatBalance(remaining, "USD"),
    },
  };
}

// ----- zhipu (智谱 GLM Coding Plan) parser (Musage zhipu.rs) -----
//   { "code": 200, "success": true,
//     "data": { "limits": [ { "type": "CREDIT_LIMIT", "unit": 3, "usage": 2000,
//                "remaining": 0, "percentage": 100, "nextResetTime": 1786969101067 }, ... ] } }
// unit=3 是 5h 窗口, unit=6 是周窗口. percentage 直接是已用 0-100 (服务器算好).

function parseZhipuResponse(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, kind: "parse", message: "智谱响应不是对象" };
  }
  if (json.success === false) {
    return { ok: false, kind: "server_error", message: "智谱 success=false · " + (json.msg || "") };
  }
  const data = json.data;
  if (!data || !Array.isArray(data.limits)) {
    return { ok: false, kind: "parse", message: "data.limits 缺失" };
  }
  // unit=3 = 5h, unit=6 = 周. 找 limit
  const fiveHr = data.limits.find((l) => l && (l.unit === 3 || l.unit === "3"));
  const weekly = data.limits.find((l) => l && (l.unit === 6 || l.unit === "6"));
  if (!fiveHr && !weekly) {
    return { ok: false, kind: "parse", message: "找不到 unit=3 (5h) 或 unit=6 (周) 的 limit" };
  }
  function pickWindow(w) {
    if (!w) return null;
    const limit = Number(w.usage) || 0;
    const remaining = Number(w.remaining) || 0;
    const pct = (typeof w.percentage === "number") ? w.percentage : (limit > 0 ? Math.round((limit - remaining) / limit * 100) : null);
    const resetsAt = parseEndTime(w.nextResetTime);
    return { limit, remaining, usedPercent: pct, resetsAt };
  }
  const f = pickWindow(fiveHr);
  const w = pickWindow(weekly);
  return {
    ok: true,
    provider: "zhipu",
    fiveHour: f,
    weekly: w,
    display: {
      fiveHrPct:     f ? f.usedPercent : null,
      weeklyPct:     w ? w.usedPercent : null,
      fiveHrResetsIn: f && f.resetsAt ? formatResetsIn(f.resetsAt) : null,
      weeklyResetsIn: w && w.resetsAt ? formatResetsIn(w.resetsAt) : null,
    },
  };
}

function formatBalance(n, currency) {
  // 简洁显示: 数字 + currency 符号. 大数取整, 小数 2 位.
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  return symbol + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
}

// ----- dashscope (阿里云百炼 / Model Studio Coding Plan) parser -----
// 端点: POST bailian.console.aliyun.com (国内) / modelstudio.console.alibabacloud.com
//       (国际) /data/api.json?action=...queryCodingPlanInstanceInfoV2
// 鉴权: Coding Plan 专用 key (sk-sp- 开头), Bearer + x-api-key +
//       X-DashScope-API-Key 三 header 同发 (控制台 API 对 header 的接受
//       方式随宿主而异, 同发已被第三方实现验证可行)
// schema:
//   { "code": "Success" | "200" | "ConsoleNeedLogin" | ...,
//     "data": { "codingPlanInstanceInfos": [ {
//       "codingPlanQuotaInfo": {
//         "per5HourUsedQuota": 123, "per5HourTotalQuota": 6000,
//         "per5HourQuotaNextRefreshTime": 1780000000,   // unix 秒
//         "perWeekUsedQuota": ..., "perWeekTotalQuota": ..., "perWeekQuotaNextRefreshTime": ...,
//         "perBillMonthUsedQuota": ..., "perBillMonthTotalQuota": ..., "perBillMonthQuotaNextRefreshTime": ... } } ] } }
// 套餐额度按"模型调用次数"计 (Pro: 5h 6000 / 周 45000 / 月 90000).

export function parseDashscopeWindow(q, usedKey, totalKey, resetKey) {
  const used = Number(q[usedKey]);
  const total = Number(q[totalKey]);
  const resetRaw = Number(q[resetKey]);
  if (!isFinite(used) || !isFinite(total) || total <= 0) return null;
  const resetsAt = (isFinite(resetRaw) && resetRaw > 1e9) ? resetRaw * 1000 : null;
  return {
    used, total,
    usedPercent: Math.max(0, Math.min(100, Math.round((used / total) * 100))),
    resetsAt,
  };
}

export function parseDashscopeCodingPlan(body) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { ok: false, kind: "parse", message: "JSON 解析失败" };
  }
  if (!json || typeof json !== "object") {
    return { ok: false, kind: "parse", message: "百炼响应不是对象" };
  }
  if (json.code === "ConsoleNeedLogin") {
    // 专用信号: fetch 层会用另一宿主重试一次
    return { ok: false, kind: "console_need_login", message: "该宿主要求登录态" };
  }
  if (json.code !== "Success" && json.code !== "200") {
    return {
      ok: false,
      kind: (json.code === "InvalidApiKey" || json.code === "Unauthorized") ? "auth_failed" : "server_error",
      message: "百炼返错: " + (json.code || "?") + " · " + (json.message || json.msg || ""),
    };
  }
  const infos = json.data && json.data.codingPlanInstanceInfos;
  if (!Array.isArray(infos) || infos.length === 0) {
    return { ok: false, kind: "parse", message: "codingPlanInstanceInfos 为空 (未订阅 Coding Plan?)" };
  }
  const quota = infos[0] && infos[0].codingPlanQuotaInfo;
  if (!quota || typeof quota !== "object") {
    return { ok: false, kind: "parse", message: "codingPlanQuotaInfo 缺失" };
  }
  const fiveHour = parseDashscopeWindow(quota,
    "per5HourUsedQuota", "per5HourTotalQuota", "per5HourQuotaNextRefreshTime");
  const weekly = parseDashscopeWindow(quota,
    "perWeekUsedQuota", "perWeekTotalQuota", "perWeekQuotaNextRefreshTime");
  const monthly = parseDashscopeWindow(quota,
    "perBillMonthUsedQuota", "perBillMonthTotalQuota", "perBillMonthQuotaNextRefreshTime");
  if (!fiveHour && !weekly && !monthly) {
    return { ok: false, kind: "schema_unknown", message: "百炼响应里没有可识别的 5h/周/月窗口" };
  }
  return {
    ok: true,
    provider: "dashscope",
    fiveHour, weekly, monthly,
    display: {
      fiveHrPct: fiveHour ? fiveHour.usedPercent : null,
      weeklyPct: weekly ? weekly.usedPercent : null,
      monthlyPct: monthly ? monthly.usedPercent : null,
      fiveHrResetsIn: fiveHour ? formatResetsIn(fiveHour.resetsAt) : null,
      weeklyResetsIn: weekly ? formatResetsIn(weekly.resetsAt) : null,
      monthlyResetsIn: monthly ? formatResetsIn(monthly.resetsAt) : null,
    },
  };
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
  return "client_error";
}

export function parseCurlOutput(rawText) {
  if (typeof rawText !== "string") return { body: "", statusCode: 0 };
  const lastNl = rawText.lastIndexOf("\n");
  if (lastNl < 0) return { body: rawText, statusCode: 0 };
  const body = rawText.slice(0, lastNl);
  const statusText = rawText.slice(lastNl + 1).trim();
  const statusCode = parseInt(statusText, 10);
  if (isNaN(statusCode)) return { body: rawText, statusCode: 0 };
  return { body, statusCode };
}

// ----- 路由信任检查 (同源 + 直连 host 才放行, 形态抄自 modlens) -----

// localhost 或任意 IP 字面量 (含 LAN 地址). IP 字面量不可能被 DNS
// rebinding 劫持, 域名 Host 才是 rebinding 攻击面 —— 因此 loopback 之外的
// LAN 直连 (dsh web 绑 0.0.0.0 后从局域网另一台机器开 GUI) 也能用, 而
// rebinder 的域名 Host 永远进不来.
function isDirectHost(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "[::1]") return true;
  // IPv6 字面量: 十六进制+冒号 且必须含冒号 (纯 hex 单词不是 IP)
  if (/^[0-9a-f:]*:[0-9a-f:]*$/i.test(hostname)) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);      // IPv4 字面量
}

export function isTrustedRequest(req) {
  const host = req.headers && req.headers.host;
  if (typeof host !== "string" || host === "") return false;
  let hostUrl;
  try {
    hostUrl = new URL("http://" + host);
  } catch {
    return false;
  }
  if (!isDirectHost(hostUrl.hostname)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

export function apply(ctx) {
  // 每个 provider 一份 cache. key: provider 名.
  const cache = Object.create(null);
  const activeRef = Object.create(null);
  let curlPath = null;

  async function loadApiKey(provider) {
    const cfg = PROVIDERS[provider];
    if (!cfg) return { ref: null, key: null };
    const credentials = ctx.credentials;
    if (!credentials) return { ref: null, key: null };
    if (activeRef[provider]) {
      const hit = await credentials.resolve(activeRef[provider]);
      if (hit && hit.value) return { ref: activeRef[provider], key: hit.value };
    }
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
    const subprocess = ctx.subprocess;
    if (!subprocess) {
      console.error("[musage] subprocess service 不可用 (inject 未生效)");
      throw new Error("subprocess service 不可用");
    }
    try {
      curlPath = await subprocess.resolveExecutable("curl");
      console.log("[musage] resolveExecutable('curl') -> " + curlPath);
    } catch (e) {
      console.error("[musage] resolveExecutable('curl') 失败: " + ((e && e.stack) || e));
      throw new Error("找不到 curl: " + ((e && e.message) || String(e)));
    }
    return curlPath;
  }

  // curl 配置文件值转义: 反斜杠 + 双引号 (curl -K 语法)
  function curlConfigQuote(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async function curlFetch(url, authHeaders, opts) {
    const subprocess = ctx.subprocess;
    if (!subprocess) throw new Error("subprocess service 不可用");
    const c = await resolveCurl();
    const options = opts || {};
    // 鉴权 header 全部走 stdin 配置文件 (`curl -K -`), 不进 argv ——
    // argv 里的 -H "Authorization: ..." 会把 API Key 暴露给本机任意用户
    // 的 `ps` 输出; stdin 配置只被子进程自己读到.
    const configLines = ["header = \"Accept: application/json\""];
    for (const header of authHeaders) {
      configLines.push("header = \"" + curlConfigQuote(header) + "\"");
    }
    if (options.method && options.method !== "GET") {
      configLines.push("request = \"" + options.method + "\"");
    }
    if (options.body !== undefined) {
      // curl data 默认 content-type 是 form-urlencoded; JSON API 需要显式声明
      configLines.push("header = \"Content-Type: application/json\"");
      configLines.push("data = \"" + curlConfigQuote(options.body) + "\"");
    }
    const configText = configLines.join("\n") + "\n";
    let handle;
    try {
      handle = subprocess.spawn({
        argv: [
          c, "-sS",
          "--max-time", String(Math.floor(REQUEST_TIMEOUT_MS / 1000)),
          "-w", "\n%{http_code}",
          "-K", "-",
          url,
        ],
        cwd: "/",
        stdio: {
          stdin: { data: configText },
          stdout: { maxBytes: 8 * 1024 * 1024 },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: REQUEST_TIMEOUT_MS,
      });
      console.log("[musage] [" + url + "] spawn OK pid=" + handle.pid);
    } catch (e) {
      console.error("[musage] spawn 抛异常: " + ((e && e.stack) || e));
      throw e;
    }
    let outcome;
    try {
      outcome = await handle.done;
      console.log("[musage] [" + url + "] done exitCode=" + outcome.exitCode + " signal=" + outcome.signal);
    } catch (e) {
      console.error("[musage] await done 抛异常: " + ((e && e.stack) || e));
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
    const headers = cfg.authHeaders ? cfg.authHeaders(key) : ["Authorization: Bearer " + key];
    const spawnOpts = { method: cfg.method, body: cfg.body };
    let usedUrl = url;
    let raw;
    try {
      raw = await curlFetch(url, headers, spawnOpts);
      if (!raw.ok) return raw;
    } catch (e) {
      return { ok: false, kind: "network", message: "fetch 异常: " + ((e && e.message) || String(e)) };
    }
    let parsed = cfg.parse(raw.body);
    // 双宿主端点 (百炼国内/国际控制台): ConsoleNeedLogin 时换另一宿主重试一次
    if (!parsed.ok && parsed.kind === "console_need_login" && cfg.fallbackUrl && cfg.fallbackUrl !== url) {
      try {
        raw = await curlFetch(cfg.fallbackUrl, headers, spawnOpts);
        if (raw.ok) {
          parsed = cfg.parse(raw.body);
          usedUrl = cfg.fallbackUrl;
        }
      } catch (e) {}
    }
    console.log("[musage] [" + provider + "] parsed.ok=" + parsed.ok + " display=" + (parsed.ok ? JSON.stringify(parsed.display) : "") + " err=" + (parsed.ok ? "" : parsed.message));
    if (parsed.ok) {
      parsed.url = usedUrl;
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

  // 后台轮询: 60s 拉一次每个已知 provider (预热缓存)
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

  // Client 入口: webServer 路由 (web profile 下存在; headless 部署没有该
  // service, scoped ctx.inject 保证只在它出现时挂载, 其余环境零副作用).
  // GET /musage/quota?provider=<p>&force=1 → 200 + result JSON
  // (result 与旧 harness.handle('quota:fetch') 返回的同一个对象).
  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (scope) => {
      try {
        scope.webServer.register({
          name: "musage-quota",
          kind: "exact",
          path: "/musage/quota",
          handler: async (req, res) => {
            const send = (status, body) => {
              // no-store: 防浏览器启发式缓存 GET 响应导致 widget 展示旧数据
              res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
              res.end(JSON.stringify(body));
            };
            try {
              if (!isTrustedRequest(req)) {
                send(403, { ok: false, kind: "forbidden", message: "request refused: same-origin direct-host only" });
                return;
              }
              if (req.method !== "GET") {
                send(405, { ok: false, kind: "other", message: "method not allowed" });
                return;
              }
              const params = new URL(req.url, "http://localhost").searchParams;
              const provider = params.get("provider") || "minimax";
              const forceRefresh = params.get("force") === "1";
              if (!PROVIDERS[provider]) {
                send(404, { ok: false, kind: "other", message: "未知 provider: " + provider });
                return;
              }
              if (forceRefresh) cache[provider] = null;
              send(200, await getQuota(provider));
            } catch (e) {
              send(200, { ok: false, kind: "other", message: String((e && e.message) || e) });
            }
          },
        });
        console.log("[musage] route GET /musage/quota registered");
      } catch (e) {
        console.error("[musage] quota 路由注册失败: " + ((e && e.stack) || e));
      }
    });
  }

  ctx.effect(() => {
    return () => {
      try { disposeTimer(); } catch (e) {}
      for (const k of Object.keys(cache)) cache[k] = null;
    };
  });
}
