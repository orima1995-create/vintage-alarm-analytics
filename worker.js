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

    const [current, previous] = await Promise.all([
      fetchPeriod(env, host, currentStart, now),
      fetchPeriod(env, host, previousStart, currentStart),
    ]);

    const payload = {
      generatedAt: now.toISOString(),
      windowKey: windowSpec.key,
      windowLabel: windowSpec.label,
      host,
      current: normalizePeriod(current),
      previous: normalizePeriod(previous),
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
    "1h": { key: "1h", label: "直近1時間", ms: 60 * 60 * 1000 },
    "3h": { key: "3h", label: "直近3時間", ms: 3 * 60 * 60 * 1000 },
    "24h": { key: "24h", label: "直近24時間", ms: 24 * 60 * 60 * 1000 },
    "7d": { key: "7d", label: "直近7日", ms: 7 * 24 * 60 * 60 * 1000 },
    "30d": { key: "30d", label: "直近30日", ms: 30 * 24 * 60 * 60 * 1000 },
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
:root{--paper:#f2eee5;--ink:#181716;--muted:#706d67;--line:#c8c0b3;--card:#faf7f0;--accent:#8d2c23}
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
.kpi{grid-column:span 3}
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
.flow{grid-column:1/-1}.audit{grid-column:1/-1;border-color:var(--accent);color:var(--accent)}
.bar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 0;border-top:1px solid #ded7cc;font-size:12px}
.bar-wrap{grid-column:1/-1;height:3px;background:#e5ded2;margin-top:-3px}
.bar{height:100%;background:var(--ink)}
.error{border:1px solid var(--accent);padding:14px;color:var(--accent);background:#fff8f5;white-space:pre-wrap}
footer{margin-top:22px;color:var(--muted);font-size:10px;line-height:1.6}
@media(max-width:760px){main{width:min(100% - 20px,1120px);padding-top:20px}header{align-items:flex-start;flex-direction:column}.actions{justify-content:flex-start}.kpi{grid-column:span 6}.pages,.channels,.referrers,.half{grid-column:1/-1}}
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
function render(data){
  const c=data.current,p=data.previous;
  document.getElementById("period").textContent=data.windowLabel || windowKey;
  document.getElementById("updated").textContent='更新 '+new Date(data.generatedAt).toLocaleString("ja-JP");
  const xNow=c.channels.find(x=>x.name==="X")?.visits||0;
  const xPrev=p.channels.find(x=>x.name==="X")?.visits||0;
  const searchNow=c.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const searchPrev=p.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const entryFlows=c.flows.filter(x=>x.visits>0 && x.channel!=="Internal Navigation");
  const internalFlows=c.flows.filter(x=>x.channel==="Internal Navigation");
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
  document.getElementById("content").innerHTML=
  '<div class="grid">'+audit+
    '<section class="card kpi"><div class="label">PAGE VIEWS</div><div class="value">'+n(c.pageviews)+'</div>'+delta(c.pageviews,p.pageviews)+'</section>'+
    '<section class="card kpi"><div class="label">VISITS</div><div class="value">'+n(c.visits)+'</div>'+delta(c.visits,p.visits)+'</section>'+
    '<section class="card kpi"><div class="label">X VISITS</div><div class="value">'+n(xNow)+'</div>'+delta(xNow,xPrev)+'</section>'+
    '<section class="card kpi"><div class="label">ORGANIC SEARCH</div><div class="value">'+n(searchNow)+'</div>'+delta(searchNow,searchPrev)+'</section>'+
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
