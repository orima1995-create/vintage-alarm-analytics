const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULT_HOST = "orima1995-create.github.io";
const BASE_PATH = "/orima1995-creator.github.io";

export default {
  async fetch(request, env) {
    const auth = requireBasicAuth(request, env);
    if (auth) return auth;

    const url = new URL(request.url);

    if (url.pathname === "/api/analytics") {
      return analyticsResponse(url, env);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return htmlResponse(DASHBOARD_HTML);
    }

    return new Response("Not found", { status: 404 });
  },
};

function requireBasicAuth(request, env) {
  if (!env.DASHBOARD_PASSWORD) {
    return new Response("DASHBOARD_PASSWORD is not configured.", { status: 503 });
  }

  const expectedUser = "admin";
  const header = request.headers.get("Authorization") || "";

  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const splitAt = decoded.indexOf(":");
      const user = decoded.slice(0, splitAt);
      const password = decoded.slice(splitAt + 1);
      if (user === expectedUser && password === env.DASHBOARD_PASSWORD) return null;
    } catch {}
  }

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="VINTAGE ALARM ANALYTICS", charset="UTF-8"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

async function analyticsResponse(url, env) {
  try {
    requireEnv(env, "CF_API_TOKEN");
    requireEnv(env, "CF_ACCOUNT_ID");

    const windowSpec = normalizeWindow(url.searchParams.get("window"));
    const now = new Date();
    const currentStart = new Date(now.getTime() - windowSpec.ms);
    const previousStart = new Date(now.getTime() - windowSpec.ms * 2);
    const host = env.REQUEST_HOST || DEFAULT_HOST;

    const [current, previous, trendResult] = await Promise.all([
      fetchPeriod(env, host, currentStart, now),
      fetchPeriod(env, host, previousStart, currentStart),
      fetchTrend(env, host, currentStart, now, windowSpec),
    ]);

    const payload = {
      generatedAt: now.toISOString(),
      windowKey: windowSpec.key,
      windowLabel: windowSpec.label,
      windowStart: currentStart.toISOString(),
      windowEnd: now.toISOString(),
      host,
      current: normalizePeriod(current),
      previous: normalizePeriod(previous),
      trend: trendResult.points,
      trendBucket: trendResult.bucketField,
      trendWarning: trendResult.warning || null,
    };

    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

function requireEnv(env, key) {
  if (!env[key]) throw new Error(`${key} is not configured.`);
}

function normalizeWindow(value) {
  const windows = {
    "1h": {
      key: "1h",
      label: "直近1時間",
      ms: 60 * 60 * 1000,
      bucketCandidates: ["datetimeFiveMinutes", "datetimeFifteenMinutes", "datetimeHour"],
    },
    "3h": {
      key: "3h",
      label: "直近3時間",
      ms: 3 * 60 * 60 * 1000,
      bucketCandidates: ["datetimeFifteenMinutes", "datetimeFiveMinutes", "datetimeHour"],
    },
    "24h": {
      key: "24h",
      label: "直近24時間",
      ms: 24 * 60 * 60 * 1000,
      bucketCandidates: ["datetimeHour", "datetimeFifteenMinutes"],
    },
    "7d": {
      key: "7d",
      label: "直近7日",
      ms: 7 * 24 * 60 * 60 * 1000,
      bucketCandidates: ["date", "datetimeHour"],
    },
    "30d": {
      key: "30d",
      label: "直近30日",
      ms: 30 * 24 * 60 * 60 * 1000,
      bucketCandidates: ["date", "datetimeHour"],
    },
  };
  return windows[value] || windows["7d"];
}

async function fetchPeriod(env, host, start, end) {
  const query = `
query VintageAlarmAnalytics(
  $accountTag: string!
  $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
        sum { visits }
      }
      pages: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 100
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      referers: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 100
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { refererHost refererPath }
      }
      flows: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 200
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { requestPath refererHost refererPath countryName deviceType }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 100
        orderBy: [count_DESC]
      ) {
        count
        dimensions { countryName }
      }
      devices: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 30
        orderBy: [count_DESC]
      ) {
        count
        dimensions { deviceType }
      }
    }
  }
}
`;

  return cloudflareGraphQL(env, query, {
    accountTag: env.CF_ACCOUNT_ID,
    filter: {
      AND: [
        {
          datetime_geq: start.toISOString(),
          datetime_leq: end.toISOString(),
        },
        { requestHost: host },
        { bot: 0 },
      ],
    },
  });
}

async function fetchTrend(env, host, start, end, windowSpec) {
  let lastError = null;

  for (const bucketField of windowSpec.bucketCandidates) {
    const orderBy = bucketField + "_ASC";
    const query = `
query VintageAlarmTrend(
  $accountTag: string!
  $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      totals: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 2000
        orderBy: [${orderBy}]
      ) {
        count
        sum { visits }
        dimensions { bucket: ${bucketField} }
      }
      acquisition: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 5000
        orderBy: [${orderBy}]
      ) {
        count
        sum { visits }
        dimensions { bucket: ${bucketField} refererHost }
      }
    }
  }
}
`;

    try {
      const data = await cloudflareGraphQL(env, query, {
        accountTag: env.CF_ACCOUNT_ID,
        filter: {
          AND: [
            {
              datetime_geq: start.toISOString(),
              datetime_leq: end.toISOString(),
            },
            { requestHost: host },
            { bot: 0 },
          ],
        },
      });

      return {
        bucketField,
        points: normalizeTrend(data),
        warning: null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    bucketField: null,
    points: [],
    warning: lastError instanceof Error ? lastError.message : "Trend data unavailable.",
  };
}

function normalizeTrend(data) {
  const account = data?.viewer?.accounts?.[0] || {};
  const points = new Map();

  const ensure = (bucket) => {
    const key = String(bucket || "");
    if (!points.has(key)) {
      points.set(key, {
        bucket: key,
        pageviews: 0,
        visits: 0,
        x: 0,
        instagram: 0,
        facebook: 0,
        otherSns: 0,
        search: 0,
        direct: 0,
        ai: 0,
        other: 0,
      });
    }
    return points.get(key);
  };

  for (const row of account.totals || []) {
    const point = ensure(row?.dimensions?.bucket);
    point.pageviews += row?.count || 0;
    point.visits += row?.sum?.visits || 0;
  }

  for (const row of account.acquisition || []) {
    const point = ensure(row?.dimensions?.bucket);
    const channel = classifyReferrer(row?.dimensions?.refererHost || "");
    const visits = row?.sum?.visits || 0;

    if (channel === "X") point.x += visits;
    else if (channel === "Instagram") point.instagram += visits;
    else if (channel === "Facebook") point.facebook += visits;
    else if (channel === "Other SNS") point.otherSns += visits;
    else if (channel === "Organic Search") point.search += visits;
    else if (channel === "Direct / Unknown") point.direct += visits;
    else if (channel === "AI Assistant") point.ai += visits;
    else if (channel === "Other Referral") point.other += visits;
  }

  return [...points.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

async function cloudflareGraphQL(env, query, variables) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare GraphQL HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join(" / "));
  }
  if (!payload.data) throw new Error("Cloudflare GraphQL returned no data.");

  return payload.data;
}

function normalizePeriod(data) {
  const account = data?.viewer?.accounts?.[0] || {};
  const total = account.total?.[0] || { count: 0, sum: { visits: 0 } };

  const pages = (account.pages || []).map((row) => {
    const meta = pageMeta(row?.dimensions?.requestPath || "/");
    return {
      path: meta.path,
      name: meta.name,
      mapped: meta.mapped,
      pageviews: row?.count || 0,
      visits: row?.sum?.visits || 0,
    };
  });

  const rawReferers = (account.referers || []).map((row) => ({
    host: row?.dimensions?.refererHost || "",
    path: row?.dimensions?.refererPath || "",
    pageviews: row?.count || 0,
    visits: row?.sum?.visits || 0,
  }));

  const rawFlows = (account.flows || []).map((row) => ({
    requestPath: row?.dimensions?.requestPath || "/",
    refererHost: row?.dimensions?.refererHost || "",
    refererPath: row?.dimensions?.refererPath || "",
    country: row?.dimensions?.countryName || "Unknown",
    device: row?.dimensions?.deviceType || "Unknown",
    pageviews: row?.count || 0,
    visits: row?.sum?.visits || 0,
  }));

  return {
    pageviews: total.count || 0,
    visits: total.sum?.visits || 0,
    pages,
    referrers: rawReferers,
    flows: buildFlows(rawFlows),
    channels: buildChannels(rawReferers),
    countries: (account.countries || []).map((row) => ({
      name: friendlyCountry(row?.dimensions?.countryName || "Unknown"),
      pageviews: row?.count || 0,
    })),
    devices: (account.devices || []).map((row) => ({
      name: friendlyDevice(row?.dimensions?.deviceType || "Unknown"),
      pageviews: row?.count || 0,
    })),
  };
}

const PAGE_NAMES = Object.freeze({
  "/": "TOP",
  "/history/": "HISTORY",
  "/owners-notes/": "OWNER'S NOTES",
  "/pierce-duofon/": "Pierce Duofon",
  "/cyma-time-o-vox/": "Cyma Time-O-Vox",
  "/cyma-time-o-vox/owners-note/": "Cyma OWNER'S NOTE",
  "/history/smartwatch/": "Smartwatch / HISTORY",
});

function cleanPath(path) {
  let out = String(path || "/").split(/[?#]/)[0];
  try { out = decodeURIComponent(out); } catch {}
  if (out.startsWith(BASE_PATH)) out = out.slice(BASE_PATH.length) || "/";
  if (!out.startsWith("/")) out = "/" + out;
  out = out.replace(/\/{2,}/g, "/");
  if (out !== "/" && !out.endsWith("/") && !out.split("/").pop().includes(".")) out += "/";
  return out;
}

function pageMeta(path) {
  const cleaned = cleanPath(path);
  return {
    path: cleaned,
    name: PAGE_NAMES[cleaned] || cleaned,
    mapped: Boolean(PAGE_NAMES[cleaned]),
  };
}

function friendlyPageName(path) {
  return pageMeta(path).name;
}

function buildFlows(rows) {
  return rows.map((row) => {
    const destination = pageMeta(row.requestPath);
    const channel = classifyReferrer(row.refererHost);
    let sourceName = channel;

    if (channel === "Internal Navigation") {
      sourceName = friendlyPageName(row.refererPath || "/");
    } else if (channel === "Direct / Unknown") {
      sourceName = "Direct";
    } else if (row.refererPath) {
      sourceName = channel + " · " + row.refererPath;
    }

    return {
      sourceName,
      sourceHost: row.refererHost,
      sourcePath: row.refererPath,
      destinationName: destination.name,
      destinationPath: destination.path,
      destinationMapped: destination.mapped,
      channel,
      country: friendlyCountry(row.country),
      device: friendlyDevice(row.device),
      pageviews: row.pageviews,
      visits: row.visits,
    };
  }).sort((a, b) => (b.visits - a.visits) || (b.pageviews - a.pageviews));
}

function buildChannels(rows) {
  const channels = {
    "X": { pageviews: 0, visits: 0 },
    "Instagram": { pageviews: 0, visits: 0 },
    "Facebook": { pageviews: 0, visits: 0 },
    "Other SNS": { pageviews: 0, visits: 0 },
    "Organic Search": { pageviews: 0, visits: 0 },
    "Direct / Unknown": { pageviews: 0, visits: 0 },
    "AI Assistant": { pageviews: 0, visits: 0 },
    "Other Referral": { pageviews: 0, visits: 0 },
    "Internal Navigation": { pageviews: 0, visits: 0 },
  };

  for (const row of rows) {
    const category = classifyReferrer(row.host);
    channels[category].pageviews += row.pageviews;
    channels[category].visits += row.visits;
  }

  return Object.entries(channels)
    .map(([name, values]) => ({ name, ...values }));
}

function classifyReferrer(host) {
  const value = String(host || "").toLowerCase();
  if (!value) return "Direct / Unknown";
  if (value === DEFAULT_HOST || value.endsWith("." + DEFAULT_HOST)) return "Internal Navigation";

  if (
    value === "x.com" ||
    value.endsWith(".x.com") ||
    value === "twitter.com" ||
    value.endsWith(".twitter.com") ||
    value === "t.co"
  ) return "X";

  if (value.includes("instagram.com")) return "Instagram";
  if (value.includes("facebook.com")) return "Facebook";

  if (
    value.includes("threads.net") ||
    value.includes("whatsapp.com") ||
    value.includes("line.me") ||
    value.includes("linkedin.com")
  ) return "Other SNS";

  if (
    value.includes("google.") ||
    value.includes("bing.com") ||
    value.includes("yahoo.") ||
    value.includes("duckduckgo.com") ||
    value.includes("yandex.")
  ) return "Organic Search";

  if (
    value.includes("chatgpt.com") ||
    value.includes("perplexity.ai") ||
    value.includes("claude.ai") ||
    value.includes("gemini.google.com") ||
    value.includes("copilot.microsoft.com")
  ) return "AI Assistant";

  return "Other Referral";
}

function friendlyCountry(value) {
  const map = {
    JP: "Japan",
    IE: "Ireland",
    US: "United States",
    DE: "Germany",
    GB: "United Kingdom",
    FR: "France",
    CH: "Switzerland",
  };
  return map[value] || value;
}

function friendlyDevice(value) {
  const map = {
    mobile: "Mobile",
    desktop: "Desktop",
    tablet: "Tablet",
  };
  return map[String(value).toLowerCase()] || value;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>VINTAGE ALARM ANALYTICS</title>
<style>
:root{--paper:#f2eee5;--ink:#181716;--muted:#706d67;--line:#c8c0b3;--card:#faf7f0;--accent:#8d2c23;--green:#315c3d;--blue:#365f7d;--gold:#9a7b4f;--violet:#7b5674;--soft:#e7dfd2}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif}
main{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:34px 0 64px}
header{display:flex;gap:18px;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--ink);padding-bottom:16px}
.eyebrow{font-size:11px;letter-spacing:.18em;color:var(--muted);font-weight:700}
h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(26px,5vw,42px);font-weight:500;letter-spacing:.02em;margin:5px 0 0}
.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
button{appearance:none;border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 12px;font:inherit;font-size:12px;cursor:pointer}
button.active{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button.refresh{border-color:var(--ink)}
.status{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px;margin:12px 0 20px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
.card{background:var(--card);border:1px solid var(--line);padding:16px;min-width:0}
.kpi{grid-column:span 2}
.kpi .label,.section-title{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:700}
.kpi .value{font-family:Georgia,"Times New Roman",serif;font-size:36px;margin-top:7px}
.delta{font-size:11px;margin-top:4px;color:var(--muted)}
.delta.up{color:#315c3d}.delta.down{color:var(--accent)}
.pages{grid-column:span 7}.channels{grid-column:span 5}.referrers{grid-column:1/-1}.half{grid-column:span 6}
.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:9px 6px;border-top:1px solid #ded7cc;vertical-align:top}
th{font-size:10px;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.path{display:block;color:var(--muted);font-size:10px;margin-top:2px;overflow-wrap:anywhere}
.flag{display:inline-block;margin-left:6px;padding:2px 5px;border:1px solid var(--accent);color:var(--accent);font-size:9px;letter-spacing:.08em}
.flow{grid-column:1/-1}.audit{grid-column:1/-1;border-color:var(--accent);color:var(--accent)}.chart-card{grid-column:1/-1}.chart-half{grid-column:span 6}.chart-wrap{width:100%;overflow:hidden}.chart-legend{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 0;font-size:10px;color:var(--muted)}.legend-dot{width:8px;height:8px;border-radius:999px;display:inline-block;margin-right:5px}.low-sample{grid-column:1/-1;border-style:dashed;color:var(--accent);display:flex;justify-content:space-between;gap:12px;align-items:center}.entry-bar{display:grid;grid-template-columns:minmax(120px,1fr) 3fr auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #ded7cc;font-size:12px}.entry-track,.flow-track{height:7px;background:var(--soft);overflow:hidden}.entry-fill,.flow-fill{height:100%;background:var(--ink)}.donut-grid{display:grid;grid-template-columns:160px minmax(0,1fr);gap:22px;align-items:center}.donut{width:150px;height:150px;border-radius:50%;position:relative;margin:auto}.donut:after{content:"";position:absolute;inset:28px;border-radius:50%;background:var(--card)}.donut-center{position:absolute;inset:0;display:grid;place-items:center;z-index:1;font-family:Georgia,"Times New Roman",serif;font-size:27px}.mix-list{display:grid;gap:7px;font-size:11px}.mix-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:7px;align-items:center}.flow-viz{display:grid;gap:8px}.flow-viz-row{display:grid;grid-template-columns:minmax(110px,1fr) auto minmax(110px,1fr) 2fr auto;gap:8px;align-items:center;font-size:11px}.campaign{grid-column:1/-1}.campaign-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:12px}.funnel-step{border:1px solid var(--line);padding:10px;min-height:74px}.funnel-step strong{display:block;font-family:Georgia,"Times New Roman",serif;font-size:24px;margin-top:5px}.campaign-form{display:grid;grid-template-columns:2fr 1.4fr 1.6fr repeat(4,1fr) auto;gap:7px;margin-top:14px}.campaign-form input,.campaign-form button{min-width:0;border:1px solid var(--line);background:transparent;padding:8px;font:inherit;font-size:11px}.campaign-list{margin-top:10px;display:grid;gap:6px;font-size:11px}.campaign-item{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #ded7cc;padding-top:7px}.muted{color:var(--muted)}details.raw{grid-column:1/-1}details.raw summary{cursor:pointer;font-size:11px;letter-spacing:.1em;color:var(--muted)}
.bar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-top:1px solid #ded7cc;font-size:12px}
.bar-wrap{grid-column:1/-1;height:3px;background:#e5ded2;margin-top:-3px}
.bar{height:100%;background:var(--ink)}
.error{border:1px solid var(--accent);padding:14px;color:var(--accent);background:#fff8f5;white-space:pre-wrap}
footer{margin-top:22px;color:var(--muted);font-size:10px;line-height:1.6}
@media(max-width:900px){.kpi{grid-column:span 4}.campaign-form{grid-template-columns:1fr 1fr}.campaign-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){main{width:min(100% - 20px,1120px);padding-top:20px}header{align-items:flex-start;flex-direction:column}.actions{justify-content:flex-start}.kpi{grid-column:span 6}.pages,.channels,.referrers,.half,.chart-half{grid-column:1/-1}.donut-grid{grid-template-columns:1fr}.campaign-grid{grid-template-columns:repeat(2,1fr)}.campaign-form{grid-template-columns:1fr}.flow-viz-row{grid-template-columns:1fr auto 1fr}.flow-viz-row .flow-track,.flow-viz-row .flow-count{grid-column:1/-1}.status{flex-direction:column}}
</style>
</head>
<body>
<main>
<header>
<div><div class="eyebrow">PRIVATE / CLOUDFLARE WEB ANALYTICS</div><h1>VINTAGE ALARM ANALYTICS</h1></div>
<div class="actions">
<button data-window="1h">1H</button>
<button data-window="3h">3H</button>
<button data-window="24h">24H</button>
<button data-window="7d" class="active">7D</button>
<button data-window="30d">30D</button>
<button class="refresh" id="refresh">REFRESH</button>
</div>
</header>
<div class="status"><span id="period">Loading…</span><span id="updated"></span></div>
<div id="content"></div>
<footer>Cloudflare Web Analytics / RUM。Page views と Visits は別定義。ページ表の ENTRY VISITS は、そのページが外部流入・直接流入の入口になった回数。内部遷移は0になり得る。検索露出は Search Console と分離して扱う。</footer>
</main>
<script>
let windowKey="7d";
const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#039;"}[c]));
const n=(v)=>new Intl.NumberFormat("ja-JP").format(Number(v||0));
const pct=(current,previous)=>{
  if(!previous)return current?null:0;
  return ((current-previous)/previous)*100;
};
const delta=(current,previous)=>{
  const d=pct(current,previous);
  if(d===null)return '<div class="delta">前期間 0 → '+n(current)+'</div>';
  const cls=d>0?"up":d<0?"down":"";
  const sign=d>0?"+":"";
  return '<div class="delta '+cls+'">前期間比 '+sign+d.toFixed(1)+'%</div>';
};
function rows(items,max=8){
  const maxValue=Math.max(1,...items.map(x=>Number(x.pageviews||0)));
  return items.slice(0,max).map(x=>{
    const width=x.pageviews?Math.max(2,(x.pageviews/maxValue)*100):0;
    return '<div class="bar-row"><span>'+esc(x.name)+'</span><strong>'+n(x.pageviews)+'</strong><div class="bar-wrap"><div class="bar" style="width:'+width+'%"></div></div></div>';
  }).join("");
}
const COLORS={pageviews:"#181716",visits:"#8d2c23",X:"#315c3d",Search:"#365f7d",Direct:"#9a7b4f",Meta:"#7b5674",AI:"#6b6b6b",Other:"#aaa197"};
function bucketTime(value){
  if(!value)return NaN;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(value+"T00:00:00Z").getTime();
  return new Date(value).getTime();
}
function bucketLabel(value){
  const t=bucketTime(value);
  if(!Number.isFinite(t))return value;
  const opts=(windowKey==="1h"||windowKey==="3h"||windowKey==="24h")
    ?{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Tokyo"}
    :{month:"numeric",day:"numeric",timeZone:"Asia/Tokyo"};
  return new Intl.DateTimeFormat("ja-JP",opts).format(new Date(t));
}
function lineChart(points,series,campaigns=[]){
  if(!points?.length)return '<div class="muted">時系列データなし</div>';
  const w=900,h=250,l=42,r=18,t=18,b=34,iw=w-l-r,ih=h-t-b;
  const start=new Date(window.__vaWindowStart||points[0].bucket).getTime();
  const end=new Date(window.__vaWindowEnd||points[points.length-1].bucket).getTime();
  const values=points.flatMap(p=>series.map(s=>Number(p[s.key]||0)));
  const max=Math.max(1,...values);
  const xFor=(bucket,index)=>{
    const bt=bucketTime(bucket);
    if(Number.isFinite(bt)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start){
      return l+Math.max(0,Math.min(1,(bt-start)/(end-start)))*iw;
    }
    return l+(points.length<=1?0:index/(points.length-1))*iw;
  };
  const yFor=v=>t+ih-(Number(v||0)/max)*ih;
  const grid=[0,.25,.5,.75,1].map(q=>{
    const y=t+ih-q*ih;
    return '<line x1="'+l+'" y1="'+y+'" x2="'+(w-r)+'" y2="'+y+'" stroke="#ded7cc" stroke-width="1"/><text x="'+(l-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="9" fill="#706d67">'+Math.round(max*q)+'</text>';
  }).join("");
  const lines=series.map(s=>{
    const pts=points.map((p,i)=>xFor(p.bucket,i)+','+yFor(p[s.key])).join(" ");
    return '<polyline fill="none" stroke="'+s.color+'" stroke-width="2.2" points="'+pts+'"/>';
  }).join("");
  const tickIdx=[0,Math.floor((points.length-1)/4),Math.floor((points.length-1)/2),Math.floor((points.length-1)*3/4),points.length-1].filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
  const ticks=tickIdx.map(i=>'<text x="'+xFor(points[i].bucket,i)+'" y="'+(h-8)+'" text-anchor="middle" font-size="9" fill="#706d67">'+esc(bucketLabel(points[i].bucket))+'</text>').join("");
  const markers=campaigns.map(item=>{
    if(!item.postedAt)return "";
    const mt=new Date(item.postedAt).getTime();
    if(!Number.isFinite(mt)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||mt<start||mt>end)return "";
    const x=l+((mt-start)/(end-start))*iw;
    return '<line x1="'+x+'" y1="'+t+'" x2="'+x+'" y2="'+(t+ih)+'" stroke="#8d2c23" stroke-width="1" stroke-dasharray="4 4"/><text x="'+Math.min(w-r-4,x+4)+'" y="'+(t+11)+'" font-size="9" fill="#8d2c23">'+esc(item.label||"X POST")+'</text>';
  }).join("");
  const legend='<div class="chart-legend">'+series.map(s=>'<span><i class="legend-dot" style="background:'+s.color+'"></i>'+esc(s.label)+'</span>').join("")+'</div>';
  return '<div class="chart-wrap"><svg viewBox="0 0 '+w+' '+h+'" width="100%" role="img">'+grid+lines+markers+ticks+'</svg></div>'+legend;
}
function entryBars(pages){
  const items=[...pages].sort((a,b)=>(b.visits-a.visits)||(b.pageviews-a.pageviews)).slice(0,8);
  const max=Math.max(1,...items.map(x=>x.visits));
  return items.map(x=>'<div class="entry-bar"><span><strong>'+esc(x.name)+'</strong><span class="path">'+esc(x.path)+'</span></span><div class="entry-track"><div class="entry-fill" style="width:'+((x.visits/max)*100)+'%"></div></div><strong>'+n(x.visits)+'</strong></div>').join("");
}
function channelColor(name){
  if(name==="X")return COLORS.X;
  if(name==="Organic Search")return COLORS.Search;
  if(name==="Direct / Unknown")return COLORS.Direct;
  if(name==="Instagram"||name==="Facebook"||name==="Other SNS")return COLORS.Meta;
  if(name==="AI Assistant")return COLORS.AI;
  return COLORS.Other;
}
function trafficMix(channels){
  const items=channels.filter(x=>x.name!=="Internal Navigation"&&x.visits>0);
  const total=items.reduce((s,x)=>s+x.visits,0);
  if(!total)return '<div class="muted">流入データなし</div>';
  let cursor=0;
  const stops=items.map(x=>{
    const start=cursor;
    cursor+=x.visits/total*100;
    return channelColor(x.name)+' '+start.toFixed(2)+'% '+cursor.toFixed(2)+'%';
  });
  const list=items.map(x=>'<div class="mix-row"><i class="legend-dot" style="background:'+channelColor(x.name)+'"></i><span>'+esc(x.name)+'</span><strong>'+n(x.visits)+' · '+((x.visits/total)*100).toFixed(0)+'%</strong></div>').join("");
  return '<div class="donut-grid"><div class="donut" style="background:conic-gradient('+stops.join(",")+')"><div class="donut-center">'+n(total)+'</div></div><div class="mix-list">'+list+'</div></div>';
}
function flowVisual(items){
  const list=items.slice(0,10);
  const max=Math.max(1,...list.map(x=>x.pageviews));
  if(!list.length)return '<div class="muted">内部遷移データなし</div>';
  return '<div class="flow-viz">'+list.map(x=>'<div class="flow-viz-row"><strong>'+esc(x.sourceName)+'</strong><span>→</span><strong>'+esc(x.destinationName)+'</strong><div class="flow-track"><div class="flow-fill" style="width:'+((x.pageviews/max)*100)+'%"></div></div><span class="flow-count">'+n(x.pageviews)+'</span></div>').join("")+'</div>';
}
function render(data){
  window.__vaLastData=data;
  window.__vaWindowStart=data.windowStart;
  window.__vaWindowEnd=data.windowEnd;
  const c=data.current,p=data.previous;
  document.getElementById("period").textContent=data.windowLabel || windowKey;
  document.getElementById("updated").textContent='更新 '+new Date(data.generatedAt).toLocaleString("ja-JP");
  const xNow=c.channels.find(x=>x.name==="X")?.visits||0;
  const xPrev=p.channels.find(x=>x.name==="X")?.visits||0;
  const searchNow=c.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const searchPrev=p.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const entryFlows=c.flows.filter(x=>x.visits>0 && x.channel!=="Internal Navigation");
  const internalFlows=c.flows.filter(x=>x.channel==="Internal Navigation");
  const trend=(data.trend||[]).map(x=>({...x,meta:(x.instagram||0)+(x.facebook||0)+(x.otherSns||0)}));
  const pagesPerVisit=c.visits?c.pageviews/c.visits:0;
  const watchEntry=c.pages.filter(x=>x.name==="Pierce Duofon"||x.name==="Cyma Time-O-Vox").reduce((s,x)=>s+x.visits,0);
  const watchShare=c.visits?(watchEntry/c.visits)*100:0;
  const unmapped=c.pages.filter(x=>!x.mapped);
  const audit=unmapped.length
    ? '<section class="card audit"><strong>MAPPING AUDIT</strong> · 未登録Path '+unmapped.map(x=>esc(x.path)).join(", ")+'</section>'
    : '';
  const flowRows=(items,internal=false)=>items.slice(0,20).map(x=>
    '<tr><td><strong>'+esc(x.sourceName)+'</strong>'+
    (x.sourceHost?'<span class="path">'+esc(x.sourceHost+(x.sourcePath||""))+'</span>':'')+
    '<span class="path">'+esc(x.country)+' · '+esc(x.device)+'</span>'+
    '</td><td>→</td><td><strong>'+esc(x.destinationName)+'</strong>'+
    (!x.destinationMapped?'<span class="flag">UNMAPPED</span>':'')+
    '<span class="path">'+esc(x.destinationPath)+'</span></td>'+
    '<td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>'
  ).join("");
  const lowSample=c.visits<30?'<section class="card low-sample"><strong>LOW SAMPLE</strong><span>'+n(c.visits)+' visits · まだ傾向断定は保留</span></section>':'';
  const trafficSeries=[{key:"pageviews",label:"Page views",color:COLORS.pageviews},{key:"visits",label:"Visits",color:COLORS.visits}];
  const acquisitionSeries=[{key:"x",label:"X",color:COLORS.X},{key:"search",label:"Search",color:COLORS.Search},{key:"direct",label:"Direct",color:COLORS.Direct},{key:"meta",label:"Meta",color:COLORS.Meta}];
  document.getElementById("content").innerHTML=
  '<div class="grid">'+audit+lowSample+
    '<section class="card kpi"><div class="label">VISITS</div><div class="value">'+n(c.visits)+'</div>'+delta(c.visits,p.visits)+'</section>'+
    '<section class="card kpi"><div class="label">PAGE VIEWS</div><div class="value">'+n(c.pageviews)+'</div>'+delta(c.pageviews,p.pageviews)+'</section>'+
    '<section class="card kpi"><div class="label">X VISITS</div><div class="value">'+n(xNow)+'</div>'+delta(xNow,xPrev)+'</section>'+
    '<section class="card kpi"><div class="label">ORGANIC SEARCH</div><div class="value">'+n(searchNow)+'</div>'+delta(searchNow,searchPrev)+'</section>'+
    '<section class="card kpi"><div class="label">PAGES / VISIT</div><div class="value">'+pagesPerVisit.toFixed(2)+'</div><div class="delta">回遊の粗い指標</div></section>'+
    '<section class="card kpi"><div class="label">WATCH ENTRY SHARE</div><div class="value">'+watchShare.toFixed(0)+'%</div><div class="delta">'+n(watchEntry)+' watch entries</div></section>'+
    '<section class="card chart-card"><div class="section-head"><div class="section-title">TRAFFIC TREND</div><span>'+esc(data.trendBucket||"no bucket")+'</span></div>'+lineChart(trend,trafficSeries)+(data.trendWarning?'<div class="path">'+esc(data.trendWarning)+'</div>':'')+'</section>'+
    '<section class="card chart-card"><div class="section-head"><div class="section-title">ACQUISITION TREND</div><span>X / Search / Direct / Meta</span></div>'+lineChart(trend,acquisitionSeries)+'</section>'+
    '<section class="card chart-half"><div class="section-head"><div class="section-title">ENTRY PAGES</div><span>入口回数</span></div>'+entryBars(c.pages)+'</section>'+
    '<section class="card chart-half"><div class="section-head"><div class="section-title">TRAFFIC MIX</div><span>Visits構成</span></div>'+trafficMix(c.channels)+'</section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">SITE FLOW</div><span>内部遷移</span></div>'+flowVisual(internalFlows)+'</section>'+
    '<section class="card pages"><div class="section-head"><div class="section-title">PAGES</div><span>'+n(c.pages.length)+' paths</span></div><table><thead><tr><th>PAGE</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+
      c.pages.slice(0,20).map(x=>'<tr><td><strong>'+esc(x.name)+'</strong>'+(!x.mapped?'<span class="flag">UNMAPPED</span>':'')+'<span class="path">'+esc(x.path)+'</span></td><td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>').join("")+
    '</tbody></table></section>'+
    '<section class="card channels"><div class="section-head"><div class="section-title">CHANNELS / PV</div></div>'+rows(c.channels,10)+'</section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">ENTRY SOURCE → PAGE</div><span>同一行で取得</span></div><table><thead><tr><th>SOURCE</th><th></th><th>DESTINATION</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+flowRows(entryFlows)+'</tbody></table></section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">SITE FLOW</div><span>内部遷移</span></div><table><thead><tr><th>FROM</th><th></th><th>TO</th><th class="num">PV</th><th class="num">VISITS</th></tr></thead><tbody>'+flowRows(internalFlows,true)+'</tbody></table></section>'+
    '<section class="card referrers"><div class="section-head"><div class="section-title">REFERRERS</div><span>raw host</span></div><table><thead><tr><th>HOST</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+
      c.referrers.slice(0,20).map(x=>'<tr><td><strong>'+esc(x.host||"(Direct)")+'</strong>'+(x.path?'<span class="path">'+esc(x.path)+'</span>':'')+'</td><td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>').join("")+
    '</tbody></table></section>'+
    '<section class="card half"><div class="section-head"><div class="section-title">COUNTRIES</div></div>'+rows(c.countries,10)+'</section>'+
    '<section class="card half"><div class="section-head"><div class="section-title">DEVICES</div></div>'+rows(c.devices,10)+'</section>'+
  '</div>';
}
async function load(){
  document.getElementById("content").innerHTML='<div class="card">Loading Cloudflare Web Analytics…</div>';
  try{
    const res=await fetch('/api/analytics?window='+encodeURIComponent(windowKey),{cache:"no-store"});
    const data=await res.json();
    if(!res.ok||data.error)throw new Error(data.error||('HTTP '+res.status));
    render(data);
  }catch(err){
    document.getElementById("content").innerHTML='<div class="error">'+esc(err.message)+'</div>';
  }
}
document.querySelectorAll("[data-window]").forEach(btn=>btn.addEventListener("click",()=>{
  windowKey=btn.dataset.window;
  document.querySelectorAll("[data-window]").forEach(x=>x.classList.toggle("active",x===btn));
  load();
}));
document.getElementById("refresh").addEventListener("click",load);
load();
</script>
</body>
</html>`;
