// host.js — DSH Host 半边
//
// 责任: 调 DSH 自己的 `credentials` Service 拿用户已配的 MiniMax API Key;
//       用 `subprocess` 调 `curl` 拉 MiniMax Coding Plan 用量 (DSH 部署没有
//       fetch provider, 且 DSH `web.fetch` 协议本身不允许加 Authorization
//       header —— 只能走 curl); 30s 内存缓存 + 指数退避; 暴露
//       host.handle('minimax:fetch-quota', ...) 给 Client 端调用.
//
// 关键决策:
//   - DSH 在用户已配的 minimax / minimax-cn / minimax-en 三个 provider 都
//     按 `MINIMAX_<UPPER>_API_KEY` 命名规范存储 (推导规则见
//     dsh-client-ui-settings-models/lib/client.js:476).
//   - MiniMax API 2026-06-01 改了 schema, 兼容 percent-based + count-based 两种.
//   - 不模仿 Musage 自己存 keys.json, 全部走 DSH credentials.resolve() ——
//     密钥安全 + 用户配置零重复.
//   - `subprocess` 调 curl (而不是 web.fetch): 因为 DSH 部署里没有 fetch
//     provider, 且 WebFetchProvider 协议只支持 GET + url, 不能加 headers.
//
// 部署: 这个文件的**函数体**会被原样塞进 `cordis_define` 的 `code.host` 字段.
//       不能出现 import / require / JSX / TypeScript 类型注解 / 全局变量.

const POLL_INTERVAL_MS = 60_000;
const CACHE_TTL_MS = 30_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const MINIMAX_URL_CN = "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains";
const MINIMAX_URL_EN = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";

const MINIMAX_CREDENTIAL_REFS = [
  "MINIMAX_CN_API_KEY",
  "MINIMAX_EN_API_KEY",
  "MINIMAX_API_KEY",
];

const REF_TO_URL = {
  MINIMAX_CN_API_KEY: MINIMAX_URL_CN,
  MINIMAX_EN_API_KEY: MINIMAX_URL_EN,
  MINIMAX_API_KEY: MINIMAX_URL_CN,
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

function classifyHttpStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status >= 500) return "server_error";
  return "server_error";
}

function parseCurlOutput(rawText) {
  // curl -w '\n%{http_code}' 输出: <body>\n<status>\n
  // 找到最后一个 \n, 之后是 status code, 之前是 body.
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
    let cache = null;
    let activeRef = null;
    let curlPath = null;

    async function loadApiKey() {
      if (activeRef) {
        const credentials = ctx.get("credentials");
        if (credentials) {
          const hit = await credentials.resolve(activeRef);
          if (hit && hit.value) return { ref: activeRef, key: hit.value };
        }
      }
      const credentials = ctx.get("credentials");
      if (!credentials) return { ref: null, key: null };
      for (const ref of MINIMAX_CREDENTIAL_REFS) {
        try {
          const hit = await credentials.resolve(ref);
          if (hit && hit.value) {
            activeRef = ref;
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
            c,
            "-sS",
            "--max-time", String(Math.floor(REQUEST_TIMEOUT_MS / 1000)),
            "-w", "\n%{http_code}",
            "-H", "Authorization: Bearer " + key,
            "-H", "Accept: application/json",
            url,
          ],
          cwd: "/",
          // SubprocessStdio 协议是**对象** { stdin, stdout, stderr }, 不是数组!
          // v0.0.4 只把 'collect' 改成 {maxBytes}, 但结构还是数组 -> DSH 内部读
          // stdio.stdout.maxBytes 时数组没有 .stdout 属性 -> undefined.
          // v0.0.15: 改成对象形式.
          stdio: {
            stdin: "ignore",
            stdout: { maxBytes: 8 * 1024 * 1024 },
            stderr: { maxBytes: 64 * 1024 },
          },
          graceMs: REQUEST_TIMEOUT_MS,
        });
        console.log("[musage] spawn OK pid=" + handle.pid + " argv[0]=" + c);
      } catch (e) {
        console.error("[musage] spawn 抛异常: " + (e && e.stack || e));
        throw e;
      }
      let outcome;
      try {
        outcome = await handle.done;
        console.log("[musage] done exitCode=" + outcome.exitCode + " signal=" + outcome.signal);
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
      console.log("[musage] stdout.len=" + stdout.text.length + " stderr.len=" + stderr.text.length);
      console.log("[musage] stderr.head=" + stderr.text.slice(0, 300));
      if (outcome.exitCode !== 0) {
        return {
          ok: false,
          kind: "network",
          message: "curl 退出 " + outcome.exitCode + " · " + stderr.text.slice(0, 200),
        };
      }
      const { body, statusCode } = parseCurlOutput(stdout.text);
      console.log("[musage] statusCode=" + statusCode + " body.len=" + body.length);
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
      const parsed = parseMinimax(body);
      console.log("[musage] parsed.ok=" + parsed.ok + " fiveHour=" + (parsed.ok ? JSON.stringify(parsed.fiveHour) : "") + " err=" + (parsed.ok ? "" : parsed.message));
      if (parsed.ok) {
        parsed.url = url;
      }
      return parsed;
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
      const url = REF_TO_URL[ref] || MINIMAX_URL_CN;
      try {
        const result = await curlFetch(url, key);
        if (result.ok) {
          result.ref = ref;
        }
        return result;
      } catch (e) {
        return { ok: false, kind: "network", message: "fetch 异常: " + (e && e.message || String(e)) };
      }
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

    const disposeTimer = ctx.timer.interval(async () => {
      try {
        await getQuota();
      } catch (e) {}
    }, POLL_INTERVAL_MS);
    ctx.timer.timeout(() => { getQuota(); }, 100);

    const disposeHandle = harness.handle("minimax:fetch-quota", async (args) => {
      const forceRefresh = !!(args && args.force === true);
      if (forceRefresh) cache = null;
      return getQuota();
    });

    ctx.effect(() => {
      return () => {
        try { disposeTimer(); } catch (e) {}
        try { disposeHandle(); } catch (e) {}
        cache = null;
      };
    });
  },
};
