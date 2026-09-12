import baseWorker from "./worker.js";

export const X_PROFILE_TRACKING = Object.freeze({
  path: "/x/",
  name: "X Profile",
  url: "https://vintagealarm.github.io/x/",
  eventLabel: "Xプロフィール専用URL発行",
  eventAt: "2026-09-11T14:18:50.000Z",
});

const TREND_BUCKET_MS = Object.freeze({
  datetimeFiveMinutes: 5 * 60 * 1000,
  datetimeFifteenMinutes: 15 * 60 * 1000,
  datetimeHour: 60 * 60 * 1000,
  date: 24 * 60 * 60 * 1000,
});

function patchPage(row) {
  if (!row || row.path !== X_PROFILE_TRACKING.path) return row;
  return { ...row, name: X_PROFILE_TRACKING.name, mapped: true };
}

function patchFlow(flow) {
  if (!flow) return flow;
  const out = { ...flow };
  if (out.destinationPath === X_PROFILE_TRACKING.path) {
    out.destinationName = X_PROFILE_TRACKING.name;
    out.destinationMapped = true;
  }
  if (
    out.sourceCleanPath === X_PROFILE_TRACKING.path ||
    out.sourcePath === X_PROFILE_TRACKING.path
  ) {
    out.sourceName = X_PROFILE_TRACKING.name;
  }
  return out;
}

function countProfileEntries(period) {
  return (period?.pages || [])
    .filter((row) => row?.path === X_PROFILE_TRACKING.path)
    .reduce((sum, row) => sum + Number(row?.visits || 0), 0);
}

function bucketStartMs(value) {
  if (!value) return NaN;
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return parsed;
  const dateOnly = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(dateOnly) ? dateOnly : NaN;
}

export function buildFreshness(payload) {
  const queryAt = payload?.generatedAt || null;
  const queryAtMs = bucketStartMs(queryAt);
  const trend = Array.isArray(payload?.combined?.trend)
    ? payload.combined.trend
    : Array.isArray(payload?.trend)
      ? payload.trend
      : [];
  const bucketKind = payload?.combined?.trendBucket || payload?.trendBucket || null;
  const bucketWidthMs = TREND_BUCKET_MS[bucketKind] || 0;

  let latest = null;
  let latestMs = -Infinity;
  for (const row of trend) {
    if (Number(row?.pageviews || 0) <= 0 && Number(row?.visits || 0) <= 0) continue;
    const startMs = bucketStartMs(row?.bucket);
    if (!Number.isFinite(startMs) || startMs <= latestMs) continue;
    latest = row;
    latestMs = startMs;
  }

  if (!latest || !Number.isFinite(latestMs)) {
    return {
      queryOk: true,
      queryAt,
      bucketKind,
      latestEventBucket: null,
      bucketStart: null,
      bucketEnd: null,
      eventGapSeconds: null,
      note: "No non-zero event bucket exists in the selected window. This can mean no traffic or delayed ingestion; the dashboard query itself succeeded.",
    };
  }

  const bucketEndMs = latestMs + bucketWidthMs;
  const gapMs = Number.isFinite(queryAtMs)
    ? Math.max(0, queryAtMs - (bucketWidthMs ? bucketEndMs : latestMs))
    : null;

  return {
    queryOk: true,
    queryAt,
    bucketKind,
    latestEventBucket: String(latest.bucket || ""),
    bucketStart: new Date(latestMs).toISOString(),
    bucketEnd: bucketWidthMs ? new Date(bucketEndMs).toISOString() : null,
    eventGapSeconds: gapMs == null ? null : Math.floor(gapMs / 1000),
    note: "EVENT GAP is time since the latest non-zero Cloudflare trend bucket, not a guaranteed ingestion-lag measurement. It also includes periods with no visitors.",
  };
}

export function patchPeriod(period) {
  if (!period || typeof period !== "object") return period;
  const patched = { ...period };
  if (Array.isArray(patched.pages)) patched.pages = patched.pages.map(patchPage);
  if (Array.isArray(patched.entryPages)) patched.entryPages = patched.entryPages.map(patchPage);
  if (Array.isArray(patched.flows)) patched.flows = patched.flows.map(patchFlow);
  if (Array.isArray(patched.externalEntryFlows)) patched.externalEntryFlows = patched.externalEntryFlows.map(patchFlow);
  if (Array.isArray(patched.internalFlows)) patched.internalFlows = patched.internalFlows.map(patchFlow);
  patched.xProfileEntries = countProfileEntries(patched);
  return patched;
}

export function patchAnalyticsPayload(payload) {
  if (!payload || typeof payload !== "object" || payload.error) return payload;

  const patched = { ...payload, profileTracking: X_PROFILE_TRACKING };
  patched.current = patchPeriod(payload.current);
  patched.previous = patchPeriod(payload.previous);

  if (payload.legacy) {
    patched.legacy = {
      ...payload.legacy,
      current: patchPeriod(payload.legacy.current),
      previous: patchPeriod(payload.legacy.previous),
    };
  }

  if (payload.combined) {
    patched.combined = {
      ...payload.combined,
      current: patchPeriod(payload.combined.current),
      previous: patchPeriod(payload.combined.previous),
    };
  }

  patched.freshness = buildFreshness(patched);
  return patched;
}

export function patchDashboardHtml(html) {
  const systemEvent = JSON.stringify({
    platform: "X Profile",
    label: X_PROFILE_TRACKING.eventLabel,
    postUrl: X_PROFILE_TRACKING.url,
    postedAt: X_PROFILE_TRACKING.eventAt,
    linkAddedAt: X_PROFILE_TRACKING.eventAt,
    targetPath: X_PROFILE_TRACKING.path,
    system: true,
  });

  const freshnessRenderer = `const statusEl=document.getElementById("updated");
  const freshness=data.freshness||{};
  const fmtFreshTime=(value)=>value?new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(new Date(value)):"—";
  const fmtFreshGap=(seconds)=>{if(seconds==null)return "—";const mins=Math.floor(Number(seconds)/60);if(mins<1)return "<1m";if(mins<60)return mins+"m";const hours=Math.floor(mins/60);const rest=mins%60;return hours+"h"+(rest?rest+"m":"");};
  if(statusEl){
    const queryTime=fmtFreshTime(freshness.queryAt||data.generatedAt);
    if(freshness.latestEventBucket){
      const range=freshness.bucketEnd?fmtFreshTime(freshness.bucketStart)+"–"+fmtFreshTime(freshness.bucketEnd):fmtFreshTime(freshness.bucketStart);
      statusEl.textContent="QUERY OK "+queryTime+" · LAST EVENT "+range+" · EVENT GAP ≥"+fmtFreshGap(freshness.eventGapSeconds);
    }else{
      statusEl.textContent="QUERY OK "+queryTime+" · LAST EVENT なし（選択期間）";
    }
    statusEl.title="QUERY OK = Cloudflare API応答成功。EVENT GAPは最新の非ゼロ集計bucketからの経過で、計測遅延だけでなく無流入時間も含みます。";
  }`;

  return String(html)
    .replace(
      "const campaigns=getCampaigns();",
      `const campaigns=[...getCampaigns(),${systemEvent}];`,
    )
    .replace(
      'const platform=item.migration?"MIGRATION":item.platform==="YouTube"?"YOUTUBE":"X";',
      'const platform=item.migration?"MIGRATION":item.platform==="X Profile"?"X PROFILE":item.platform==="YouTube"?"YOUTUBE":"X";',
    )
    .replace(
      'const platform=item.platform==="YouTube"?"YouTube":"X";',
      'const platform=item.platform==="X Profile"?"X Profile":item.platform==="YouTube"?"YouTube":"X";',
    )
    .replace(
      'const color=item.migration?"#706d67":platform==="YouTube"?COLORS.YouTube:COLORS.X;',
      'const color=item.migration?"#706d67":platform==="X Profile"?"#13766e":platform==="YouTube"?COLORS.YouTube:COLORS.X;',
    )
    .replace(
      "eventIndex(campaigns)+",
      'eventIndex(campaigns)+\'<section class="card kpi"><div class="label">X PROFILE ENTRY</div><div class="value">\'+n(c.xProfileEntries||0)+\'</div><div class="delta">専用URL /x/ の入口</div></section>\'+',
    )
    .replace(
      'document.getElementById("updated").textContent=\'更新 \'+new Date(data.generatedAt).toLocaleString("ja-JP");',
      freshnessRenderer,
    );
}

function cloneResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (!response.ok) return response;

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return cloneResponse(response, patchDashboardHtml(await response.text()));
    }

    if (url.pathname === "/api/analytics" || url.pathname === "/api/ai-export") {
      const payload = patchAnalyticsPayload(await response.json());
      return cloneResponse(response, JSON.stringify(payload));
    }

    return response;
  },
};
