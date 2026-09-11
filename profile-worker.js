import baseWorker from "./worker.js";

export const X_PROFILE_TRACKING = Object.freeze({
  path: "/x/",
  name: "X Profile",
  url: "https://vintagealarm.github.io/x/",
  eventLabel: "Xプロフィール専用URL発行",
  eventAt: "2026-09-11T13:59:00.000Z",
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
