// test/musage-smoke.mjs — 单元烟测 (无网络, 无 DSH):
//   1. dashscope (阿里云百炼 Coding Plan) parser: 成功三窗口 / ConsoleNeedLogin /
//      鉴权错 / 未订阅
//   2. isTrustedRequest: loopback + LAN IP 字面量放行, 域名 Host / cross-site /
//      Origin 不匹配拒绝 (DNS-rebinding 防护)
//   3. parseCurlOutput: -w "\n%{http_code}" 拆分
//   4. 既有 parser 回归 (deepseek / minimax fixture)
//
// 运行: npm test (或 node test/musage-smoke.mjs)

import {
  parseDashscopeCodingPlan,
  isTrustedRequest,
  parseCurlOutput,
  parseDeepseekBalance,
  parseMinimaxResponse,
} from "../dsh/index.js";

const failed = [];
function check(cond, label) {
  if (!cond) failed.push(label);
}

// ── 1. dashscope Coding Plan parser ──────────────────────────────────────

const bailianOk = JSON.stringify({
  code: "Success",
  data: {
    codingPlanInstanceInfos: [
      {
        codingPlanQuotaInfo: {
          per5HourUsedQuota: 1500, per5HourTotalQuota: 6000, per5HourQuotaNextRefreshTime: 1780000000,
          perWeekUsedQuota: 9000, perWeekTotalQuota: 45000, perWeekQuotaNextRefreshTime: 1780100000,
          perBillMonthUsedQuota: 10000, perBillMonthTotalQuota: 90000, perBillMonthQuotaNextRefreshTime: 1780200000,
        },
      },
    ],
  },
});

const r1 = parseDashscopeCodingPlan(bailianOk);
check(r1.ok === true, "dashscope: success fixture should parse");
check(r1.display && r1.display.fiveHrPct === 25, `dashscope: 5h 1500/6000 = 25%, got ${r1.display && r1.display.fiveHrPct}`);
check(r1.display && r1.display.weeklyPct === 20, `dashscope: weekly 9000/45000 = 20%, got ${r1.display && r1.display.weeklyPct}`);
check(r1.display && r1.display.monthlyPct === 11, `dashscope: monthly 10000/90000 = 11%, got ${r1.display && r1.display.monthlyPct}`);
check(r1.fiveHour && r1.fiveHour.resetsAt === 1780000000000, "dashscope: unix-seconds reset time converted to ms");

const r2 = parseDashscopeCodingPlan(JSON.stringify({ code: "ConsoleNeedLogin" }));
check(r2.ok === false && r2.kind === "console_need_login", "dashscope: ConsoleNeedLogin signals host fallback");

const r3 = parseDashscopeCodingPlan(JSON.stringify({ code: "InvalidApiKey", message: "bad key" }));
check(r3.ok === false && r3.kind === "auth_failed", "dashscope: InvalidApiKey classified as auth_failed");

const r4 = parseDashscopeCodingPlan(JSON.stringify({ code: "Success", data: { codingPlanInstanceInfos: [] } }));
check(r4.ok === false && r4.kind === "parse", "dashscope: empty instance infos -> parse error (未订阅?)");

// ── 2. isTrustedRequest ───────────────────────────────────────────────────

function reqWith(host, extra) {
  return { headers: Object.assign({ host }, extra || {}) };
}
check(isTrustedRequest(reqWith("127.0.0.1:3080")) === true, "trust: loopback IPv4 allowed");
check(isTrustedRequest(reqWith("localhost:3080")) === true, "trust: localhost allowed");
check(isTrustedRequest(reqWith("192.168.1.5:3080")) === true, "trust: LAN IP literal allowed (0.0.0.0 deployments)");
check(isTrustedRequest(reqWith("[::1]:3080")) === true, "trust: IPv6 loopback literal allowed");
check(isTrustedRequest(reqWith("evil.example:3080")) === false, "trust: domain Host rejected (DNS-rebinding surface)");
check(isTrustedRequest(reqWith("deadbeef:3080")) === false, "trust: bare hex word is not an IP literal");
check(isTrustedRequest(reqWith("127.0.0.1:3080", { "sec-fetch-site": "cross-site" })) === false, "trust: cross-site browser request rejected");
check(isTrustedRequest(reqWith("127.0.0.1:3080", { origin: "http://evil.example" })) === false, "trust: mismatched Origin rejected");
check(isTrustedRequest(reqWith("127.0.0.1:3080", { origin: "http://127.0.0.1:3080" })) === true, "trust: same-origin browser request allowed");
check(isTrustedRequest({ headers: {} }) === false, "trust: missing Host rejected");

// ── 3. parseCurlOutput ────────────────────────────────────────────────────

const { body, statusCode } = parseCurlOutput('{"a":1}\n200');
check(statusCode === 200 && body === '{"a":1}', "parseCurlOutput: body/status split");
const noStatus = parseCurlOutput("no trailing status");
check(noStatus.statusCode === 0 && noStatus.body === "no trailing status", "parseCurlOutput: missing status tolerated");

// ── 4. 既有 parser 回归 ───────────────────────────────────────────────────

const ds = parseDeepseekBalance(JSON.stringify({
  is_available: true,
  balance_infos: [{ currency: "CNY", total_balance: "43.97" }],
}));
check(ds.ok === true && ds.balance === 43.97 && ds.display.balanceText === "¥43.97", "deepseek: CNY balance fixture");

const mm = parseMinimaxResponse(JSON.stringify({
  base_resp: { status_code: 0 },
  model_remains: [{
    model_name: "general",
    current_interval_remaining_percent: 80, current_interval_status: 1, end_time: 3600,
  }],
}));
check(mm.ok === true && mm.display.fiveHrPct === 20, "minimax: percent schema fixture (80% remaining = 20% used)");

if (failed.length > 0) {
  for (const item of failed) console.log("FAIL:", item);
  console.log("MUSAGE SMOKE FAILED");
  process.exit(1);
}
console.log("MUSAGE SMOKE PASSED");
