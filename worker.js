const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULT_HOST = "vintagealarm.github.io";
export const HOST_MIGRATION = Object.freeze({
  date: "2026-09-10",
  markerAt: "2026-09-10T00:00:00+09:00",
  precision: "day",
  oldHost: "orima1995-create.github.io",
  newHost: "vintagealarm.github.io",
  note: "2026-09-10 HOST MIGRATION · 日付基準線（JST、切替時刻ではありません）。新旧ホストは別計測。移行前を含む期間の増減は同条件比較ではありません。"
});
const LEGACY_HOST = "orima1995-create.github.io";
const LEGACY_BASE_PATH = "/orima1995-creator.github.io";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Read-only export uses a short-lived signed URL so ChatGPT/web tools can
    // fetch aggregate analytics without receiving the dashboard password.
    if (url.pathname === "/api/ai-export") {
      return aiExportResponse(request, url, env);
    }

    const auth = requireBasicAuth(request, env);
    if (auth) return auth;

    if (url.pathname === "/api/analytics") {
      return analyticsResponse(url, env);
    }
    if (url.pathname === "/api/campaign") {
      return campaignResponse(url, env);
    }

    if (url.pathname === "/api/ai-share-link") {
      return aiShareLinkResponse(request, url, env);
    }

    if (url.pathname === "/api/x-preview") {
      return xPreviewResponse(url);
    }

    if (url.pathname === "/api/youtube-preview") {
      return youtubePreviewResponse(url);
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

async function xPreviewResponse(url) {
  try {
    const raw = url.searchParams.get("url") || "";
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
      throw new Error("X post URL only.");
    }

    const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d{1,19})/);
    if (!match) throw new Error("Post URL format could not be recognized.");

    const postId = match[2];
    const canonicalUrl = `https://x.com/${match[1]}/status/${postId}`;
    const endpoint = new URL("https://publish.x.com/oembed");
    endpoint.searchParams.set("url", canonicalUrl);
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("dnt", "true");
    endpoint.searchParams.set("lang", "ja");

    const response = await fetch(endpoint.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`X oEmbed HTTP ${response.status}`);

    const data = await response.json();
    const text = extractPostText(data.html || "");

    return jsonResponse({
      url: canonicalUrl,
      postId,
      authorName: data.author_name || "",
      authorUrl: data.author_url || "",
      text,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}


export function parseYouTubeVideoUrl(raw) {
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  let kind = "video";
  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "shorts" && parts[1]) {
      videoId = parts[1];
      kind = "shorts";
    } else if (parts[0] === "embed" && parts[1]) {
      videoId = parts[1];
    } else if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v") || "";
    }
  } else {
    throw new Error("YouTube URL only.");
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error("YouTube video URL format could not be recognized.");
  }
  return {
    videoId,
    kind,
    canonicalUrl: kind === "shorts"
      ? "https://www.youtube.com/shorts/" + videoId
      : "https://www.youtube.com/watch?v=" + videoId,
  };
}
async function youtubePreviewResponse(url) {
  try {
    const raw = url.searchParams.get("url") || "";
    const parsed = parseYouTubeVideoUrl(raw);
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", parsed.canonicalUrl);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("YouTube oEmbed HTTP " + response.status);
    const data = await response.json();
    return jsonResponse({
      url: parsed.canonicalUrl,
      videoId: parsed.videoId,
      kind: parsed.kind,
      title: data.title || "",
      authorName: data.author_name || "",
      authorUrl: data.author_url || "",
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

function extractPostText(html) {
  const match = String(html).match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return "";
  return decodeHtmlText(
    match[1]
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const AI_EXPORT_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const AI_EXPORT_MIN_TTL_SECONDS = 5 * 60;

async function aiShareLinkResponse(request, url, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "GET only." }, 405);
  }

  try {
    requireEnv(env, "DASHBOARD_PASSWORD");

    const windowSpec = normalizeWindow(url.searchParams.get("window"));
    const requestedTtl = Number(url.searchParams.get("ttl") || 24 * 60 * 60);
    const ttlSeconds = Math.min(
      AI_EXPORT_MAX_TTL_SECONDS,
      Math.max(
        AI_EXPORT_MIN_TTL_SECONDS,
        Number.isFinite(requestedTtl) ? Math.floor(requestedTtl) : 24 * 60 * 60,
      ),
    );
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = await signAiExport(
      env,
      windowSpec.key,
      expires,
    );

    const shareUrl = new URL("/api/ai-export", url.origin);
    shareUrl.searchParams.set("window", windowSpec.key);
    shareUrl.searchParams.set("expires", String(expires));
    shareUrl.searchParams.set("sig", signature);

    return jsonResponse({
      url: shareUrl.toString(),
      windowKey: windowSpec.key,
      expiresAt: new Date(expires * 1000).toISOString(),
      ttlSeconds,
      scope: "aggregate analytics read-only",
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

async function aiExportResponse(request, url, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "GET only." }, 405);
  }

  try {
    requireEnv(env, "DASHBOARD_PASSWORD");

    const windowSpec = normalizeWindow(url.searchParams.get("window"));
    const expires = Number(url.searchParams.get("expires"));
    const signature = String(url.searchParams.get("sig") || "");

    if (!Number.isInteger(expires) || !signature) {
      return jsonResponse({ error: "Signed export URL required." }, 401);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expires <= nowSeconds) {
      return jsonResponse({ error: "Signed export URL expired." }, 410);
    }
    if (expires - nowSeconds > AI_EXPORT_MAX_TTL_SECONDS) {
      return jsonResponse({ error: "Signed export URL exceeds maximum TTL." }, 401);
    }

    const expected = await signAiExport(
      env,
      windowSpec.key,
      expires,
    );
    if (!timingSafeHexEqual(signature, expected)) {
      return jsonResponse({ error: "Invalid export signature." }, 401);
    }

    const response = await analyticsResponse(url, env);
    const payload = await response.json();
    if (!response.ok) return jsonResponse(payload, response.status);

    return jsonResponse({
      schemaVersion: "vintage-alarm-ai-export-v1",
      generatedAt: payload.generatedAt,
      windowKey: payload.windowKey,
      windowLabel: payload.windowLabel,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      host: payload.host,
      hostMigration: payload.hostMigration,
      current: aiExportPeriod(payload.current),
      previous: aiExportPeriod(payload.previous),
      trend: payload.trend,
      trendBucket: payload.trendBucket,
      trendWarning: payload.trendWarning,
      legacy: {
        host: payload.legacy.host,
        current: aiExportPeriod(payload.legacy.current),
        previous: aiExportPeriod(payload.legacy.previous),
        trend: payload.legacy.trend,
        trendBucket: payload.legacy.trendBucket,
        trendWarning: payload.legacy.trendWarning,
      },
      limitations: {
        searchConsole:
          "Not included: Search Console / Google AI snapshots currently live only in dashboard browser localStorage.",
        privacy:
          "Aggregate Cloudflare Web Analytics only; no IP addresses, cookies, or raw user-agent strings are exported.",
        attribution:
          "X/YouTube/SNS referrer paths can help diagnosis but do not guarantee post-level attribution.",
        hostSeparation:
          "The new and legacy GitHub Pages hosts are queried and reported separately. Their totals are never combined into one continuous series.",
      },
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

function aiExportPeriod(period) {
  const flows = Array.isArray(period?.flows) ? period.flows : [];
  return {
    pageviews: period?.pageviews || 0,
    visits: period?.visits || 0,
    pages: period?.pages || [],
    entryPages: [...(period?.pages || [])]
      .filter((page) => (page?.visits || 0) > 0)
      .sort((a, b) => (b.visits - a.visits) || (b.pageviews - a.pageviews)),
    channels: period?.channels || [],
    referrers: period?.referrers || [],
    externalEntryFlows: flows.filter(
      (flow) => flow.channel !== "Internal Navigation" && (flow.visits || 0) > 0,
    ),
    internalFlows: flows.filter(
      (flow) => flow.channel === "Internal Navigation" && (flow.pageviews || 0) > 0,
    ),
    snsEntries: period?.snsEntries || { pages: [], total: 0, complete: false },
    countries: period?.countries || [],
    devices: period?.devices || [],
  };
}

async function signAiExport(env, windowKey, expires) {
  requireEnv(env, "DASHBOARD_PASSWORD");
  requireEnv(env, "CF_API_TOKEN");

  // Derive a dedicated signing key from two Worker-only secrets. This avoids
  // exposing either secret and prevents a signed URL from becoming a simple
  // offline oracle for the Basic Auth password alone.
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(
      "vintage-alarm-ai-export-kdf-v1\u0000" +
      env.DASHBOARD_PASSWORD +
      "\u0000" +
      env.CF_API_TOKEN,
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = encoder.encode(
    "vintage-alarm-ai-export:" + windowKey + ":" + expires,
  );
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeHexEqual(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
    const legacyHost = env.LEGACY_REQUEST_HOST || HOST_MIGRATION.oldHost;

    const [current, previous, trendResult, legacyCurrent, legacyPrevious, legacyTrendResult] = await Promise.all([
      fetchPeriod(env, host, currentStart, now),
      fetchPeriod(env, host, previousStart, currentStart),
      fetchTrend(env, host, currentStart, now, windowSpec),
      fetchPeriod(env, legacyHost, currentStart, now),
      fetchPeriod(env, legacyHost, previousStart, currentStart),
      fetchTrend(env, legacyHost, currentStart, now, windowSpec),
    ]);

    const payload = {
      generatedAt: now.toISOString(),
      windowKey: windowSpec.key,
      windowLabel: windowSpec.label,
      windowStart: currentStart.toISOString(),
      windowEnd: now.toISOString(),
      host,
      hostMigration: HOST_MIGRATION,
      current: normalizePeriod(current),
      previous: normalizePeriod(previous),
      trend: trendResult.points,
      trendBucket: trendResult.bucketField,
      trendWarning: trendResult.warning || null,
      legacy: {
        host: legacyHost,
        current: normalizePeriod(legacyCurrent),
        previous: normalizePeriod(legacyPrevious),
        trend: legacyTrendResult.points,
        trendBucket: legacyTrendResult.bucketField,
        trendWarning: legacyTrendResult.warning || null,
      },
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

export function campaignWindow(start, hours, now = Date.now()) {
  const anchor = Date.parse(start);
  const duration = Number(hours) * 3600000;
  if (!Number.isFinite(anchor) || ![1, 24, 72].includes(Number(hours)) || anchor >= now) {
    throw new Error("施策開始日時は過去の日時、比較期間は1・24・72時間を指定してください。");
  }
  const elapsed = Math.min(duration, now - anchor);
  return { beforeStart: new Date(anchor - elapsed).toISOString(), start: new Date(anchor).toISOString(),
    end: new Date(anchor + elapsed).toISOString(), complete: elapsed === duration, elapsedHours: elapsed / 3600000 };
}

export function campaignSummary(data, target, platform = "X") {
  const account = data?.viewer?.accounts?.[0] || {};
  if (!Array.isArray(account.entries) || !Array.isArray(account.flows)) throw new Error("比較データを取得できませんでした。");
  const channel = platform === "YouTube" ? "YouTube" : "X";
  const entries = account.entries;
  const flows = normalizePeriod(data).flows;
  const platformEntries = entries.filter(x => classifyReferrer(x.dimensions?.refererHost || "") === channel).reduce((s,x) => s + (x.sum?.visits || 0), 0);
  const targetEntries = entries.filter(x => classifyReferrer(x.dimensions?.refererHost || "") === channel && cleanPath(x.dimensions?.requestPath || "/") === target).reduce((s,x) => s + (x.sum?.visits || 0), 0);
  return {
    platform,
    platformEntries,
    xEntries: channel === "X" ? platformEntries : 0,
    youtubeEntries: channel === "YouTube" ? platformEntries : 0,
    targetEntries,
    nextPages: flows.filter(x => x.channel === "Internal Navigation" && x.sourceCleanPath === target && x.destinationPath !== target).reduce((s,x) => s + x.pageviews, 0),
    possiblyTruncated: entries.length >= 1000 || account.flows.length >= 200
  };
}
async function campaignResponse(url, env) {
  let bounds;
  try { bounds = campaignWindow(url.searchParams.get("start"), url.searchParams.get("hours")); }
  catch (error) { return jsonResponse({ error: error.message }, 400); }
  try {
    requireEnv(env, "CF_API_TOKEN"); requireEnv(env, "CF_ACCOUNT_ID");
    const host = env.REQUEST_HOST || DEFAULT_HOST;
    const target = cleanPath(url.searchParams.get("target") || "/");
    const platform = url.searchParams.get("platform") === "YouTube" ? "YouTube" : "X";
    const [before, after] = await Promise.all([
      fetchPeriod(env, host, new Date(bounds.beforeStart), new Date(Date.parse(bounds.start) - 1)),
      fetchPeriod(env, host, new Date(bounds.start), new Date(Date.parse(bounds.end) - 1))
    ]);
    return jsonResponse({ ...bounds, target, platform, before: campaignSummary(before, target, platform), after: campaignSummary(after, target, platform) });
  } catch (error) { return jsonResponse({ error: error.message }, 500); }
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

const ANALYTICS_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;

export function splitPeriod(start, end, maxMs = ANALYTICS_CHUNK_MS) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !Number.isFinite(maxMs) || maxMs <= 0) {
    throw new Error("Invalid analytics period.");
  }

  const ranges = [];
  for (let cursor = startMs; cursor < endMs; cursor += maxMs) {
    ranges.push({
      start: new Date(cursor),
      end: new Date(Math.min(cursor + maxMs, endMs)),
    });
  }
  return ranges;
}

function mergeGroupedRows(accounts, field, dimensionKeys, limit) {
  const rows = new Map();
  for (const account of accounts) {
    for (const row of account?.[field] || []) {
      const dimensions = Object.fromEntries(dimensionKeys.map((key) => [key, row?.dimensions?.[key] || ""]));
      const key = JSON.stringify(dimensions);
      const current = rows.get(key) || { count: 0, sum: { visits: 0 }, dimensions };
      current.count += Number(row?.count || 0);
      current.sum.visits += Number(row?.sum?.visits || 0);
      rows.set(key, current);
    }
  }
  return [...rows.values()]
    .sort((a, b) => (b.count - a.count) || (b.sum.visits - a.sum.visits))
    .slice(0, limit);
}

export function mergePeriodData(parts) {
  const accounts = parts.map((part) => part?.viewer?.accounts?.[0] || {});
  const total = accounts.reduce((result, account) => {
    const row = account.total?.[0];
    result.count += Number(row?.count || 0);
    result.sum.visits += Number(row?.sum?.visits || 0);
    return result;
  }, { count: 0, sum: { visits: 0 } });

  return { viewer: { accounts: [{
    total: [total],
    pages: mergeGroupedRows(accounts, "pages", ["requestPath"], 100),
    referers: mergeGroupedRows(accounts, "referers", ["refererHost", "refererPath"], 100),
    flows: mergeGroupedRows(accounts, "flows", ["requestPath", "refererHost", "refererPath", "countryName", "deviceType"], 200),
    entries: mergeGroupedRows(accounts, "entries", ["requestPath", "refererHost"], 1000),
    countries: mergeGroupedRows(accounts, "countries", ["countryName"], 100),
    devices: mergeGroupedRows(accounts, "devices", ["deviceType"], 30),
  }] } };
}

async function fetchPeriod(env, host, start, end) {
  const parts = await Promise.all(
    splitPeriod(start, end).map((range) => fetchPeriodSlice(env, host, range.start, range.end)),
  );
  return parts.length === 1 ? parts[0] : mergePeriodData(parts);
}

async function fetchPeriodSlice(env, host, start, end) {
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
      entries: rumPageloadEventsAdaptiveGroups(
        filter: $filter
        limit: 1000
        orderBy: [count_DESC]
      ) {
        sum { visits }
        dimensions { requestPath refererHost }
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
          datetime_lt: end.toISOString(),
        },
        { requestHost: host },
        { bot: 0 },
      ],
    },
  });
}

async function fetchTrend(env, host, start, end, windowSpec) {
  let lastError = null;
  const ranges = splitPeriod(start, end);

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
      const data = await Promise.all(ranges.map((range) => cloudflareGraphQL(env, query, {
          accountTag: env.CF_ACCOUNT_ID,
          filter: {
            AND: [
              {
                datetime_geq: range.start.toISOString(),
                datetime_lt: range.end.toISOString(),
              },
              { requestHost: host },
              { bot: 0 },
            ],
          },
        })));

      return {
        bucketField,
        points: mergeTrendPoints(data.map(normalizeTrend)),
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

export function mergeTrendPoints(pointSets) {
  const points = new Map();
  for (const set of pointSets) {
    for (const point of set || []) {
      const current = points.get(point.bucket) || Object.fromEntries(Object.keys(point).map((key) => [key, key === "bucket" ? point.bucket : 0]));
      for (const [key, value] of Object.entries(point)) {
        if (key !== "bucket") current[key] = Number(current[key] || 0) + Number(value || 0);
      }
      points.set(point.bucket, current);
    }
  }
  return [...points.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
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
        youtube: 0,
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
    else if (channel === "YouTube") point.youtube += visits;
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
  const request = typeof env.ANALYTICS_FETCH === "function" ? env.ANALYTICS_FETCH : fetch;
  const response = await request(GRAPHQL_ENDPOINT, {
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
    snsEntries: aggregateSnsEntries(account.entries),
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
  "/basis-alarm/": "Basis Alarm",
  "/pierce-duofon/": "Pierce Duofon",
  "/cyma-time-o-vox/": "Cyma Time-O-Vox",
  "/cyma-time-o-vox/owners-note/": "Cyma OWNER'S NOTE",
  "/history/smartwatch/": "Smartwatch / HISTORY",
});

export function aggregateSnsEntries(rows) {
  const channels = ["X", "Instagram", "Facebook", "Other SNS"];
  const pages = [
    ["/cyma-time-o-vox/", "Cyma Time-O-Vox"],
    ["/pierce-duofon/", "Pierce Duofon"],
    ["/basis-alarm/", "Basis Alarm"],
    ["other", "Other pages"],
  ].map(([path, name]) => ({ path, name, values: Object.fromEntries(channels.map(c => [c, 0])), total: 0 }));
  for (const row of rows || []) {
    const channel = classifyReferrer(row?.dimensions?.refererHost);
    if (!channels.includes(channel)) continue;
    const path = cleanPath(row?.dimensions?.requestPath);
    const page = pages.find(p => p.path === path) || pages[3];
    const value = Number(row?.sum?.visits || 0);
    page.values[channel] += value;
    page.total += value;
  }
  return { pages, total: pages.reduce((sum, p) => sum + p.total, 0), complete: Array.isArray(rows) && rows.length < 1000 };
}

function cleanPath(path) {
  let out = String(path || "/").split(/[?#]/)[0];
  try { out = decodeURIComponent(out); } catch {}
  if (out === LEGACY_BASE_PATH || out.startsWith(LEGACY_BASE_PATH + "/")) {
    out = out.slice(LEGACY_BASE_PATH.length) || "/";
  }
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
      sourceCleanPath: channel === "Internal Navigation" ? cleanPath(row.refererPath || "/") : row.refererPath,
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
    "YouTube": { pageviews: 0, visits: 0 },
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
  if (
    value === DEFAULT_HOST ||
    value.endsWith("." + DEFAULT_HOST) ||
    value === LEGACY_HOST ||
    value.endsWith("." + LEGACY_HOST)
  ) return "Internal Navigation";

  if (
    value === "x.com" ||
    value.endsWith(".x.com") ||
    value === "twitter.com" ||
    value.endsWith(".twitter.com") ||
    value === "t.co"
  ) return "X";

  if (
    value === "youtu.be" ||
    value.endsWith(".youtu.be") ||
    value === "youtube.com" ||
    value.endsWith(".youtube.com") ||
    value.includes("youtube-nocookie.com")
  ) return "YouTube";

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
:root{--paper:#f1f4f1;--ink:#17201f;--muted:#687471;--line:#d6ddda;--card:#fbfcfb;--accent:#963c33;--green:#13766e;--blue:#426d87;--gold:#9a7b4f;--violet:#7b5674;--soft:#e8eeeb;--shadow:0 5px 18px rgba(31,52,48,.055)}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif}
main{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:26px 0 48px}
header{display:flex;gap:18px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ink);padding-bottom:12px}
.eyebrow{font-size:10px;letter-spacing:.2em;color:var(--green);font-weight:800}
h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(25px,4vw,36px);font-weight:500;letter-spacing:.015em;margin:4px 0 0}
.actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
button{appearance:none;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);padding:7px 10px;font:inherit;font-size:11px;cursor:pointer}
button:hover{border-color:var(--green)}
button.active{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button.refresh{border-color:var(--ink)}
.status{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:10px;margin:9px 0 12px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:14px;min-width:0}
.kpi{grid-column:span 2}
.kpi .label,.section-title{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:800}
.kpi .value{font-family:Georgia,"Times New Roman",serif;font-size:30px;line-height:1;margin-top:8px}
.delta{font-size:10px;margin-top:6px;color:var(--muted)}
.delta.up{color:#315c3d}.delta.down{color:var(--accent)}
.pages{grid-column:span 7}.channels{grid-column:span 5}.referrers{grid-column:1/-1}.half{grid-column:span 6}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.section-head>span{font-size:10px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{text-align:left;padding:7px 5px;border-top:1px solid var(--line);vertical-align:top}
th{font-size:9px;color:var(--muted);font-weight:700}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.path{display:block;color:var(--muted);font-size:9px;margin-top:2px;overflow-wrap:anywhere}
.flag{display:inline-block;margin-left:6px;padding:2px 5px;border:1px solid var(--accent);color:var(--accent);font-size:9px;letter-spacing:.08em}
.flow{grid-column:1/-1}.audit{grid-column:1/-1;border-color:var(--accent);color:var(--accent)}.host-scope{grid-column:1/-1}.host-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.host-block{border-top:1px solid var(--line);padding-top:9px}.host-block strong{font-family:Georgia,"Times New Roman",serif;font-size:22px}.host-block .path{margin-bottom:6px}.chart-card{grid-column:1/-1}.primary-chart{grid-column:span 8}.summary-chart{grid-column:span 4}.chart-half{grid-column:span 6}.chart-wrap{width:100%;overflow:hidden}.chart-wrap svg{display:block;max-height:205px}.chart-legend{display:flex;gap:12px;flex-wrap:wrap;margin:5px 0 0;font-size:9px;color:var(--muted)}.legend-dot{width:7px;height:7px;border-radius:999px;display:inline-block;margin-right:5px}.low-sample{grid-column:1/-1;border-style:dashed;color:var(--accent);display:flex;justify-content:space-between;gap:12px;align-items:center;padding:9px 12px}.entry-bar{display:grid;grid-template-columns:minmax(90px,1fr) 2fr auto;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:10px}.entry-track,.flow-track{height:6px;border-radius:99px;background:var(--soft);overflow:hidden}.entry-fill,.flow-fill{height:100%;background:var(--green)}.donut-grid{display:grid;grid-template-columns:112px minmax(0,1fr);gap:14px;align-items:center}.donut{width:106px;height:106px;border-radius:50%;position:relative;margin:auto}.donut:after{content:"";position:absolute;inset:22px;border-radius:50%;background:var(--card)}.donut-center{position:absolute;inset:0;display:grid;place-items:center;z-index:1;font-family:Georgia,"Times New Roman",serif;font-size:22px}.mix-list{display:grid;gap:5px;font-size:9px}.mix-row{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:6px;align-items:center}.flow-viz{display:grid;gap:6px}.flow-viz-row{display:grid;grid-template-columns:minmax(100px,1fr) auto minmax(100px,1fr) 2fr auto;gap:7px;align-items:center;font-size:10px}.campaign{grid-column:1/-1}.campaign-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:10px}.funnel-step{border:1px solid var(--line);border-radius:8px;padding:9px;min-height:66px}.funnel-step strong{display:block;font-family:Georgia,"Times New Roman",serif;font-size:21px;margin-top:5px}.campaign-form{display:grid;grid-template-columns:1fr 2fr 1.4fr 1.6fr repeat(4,1fr) auto;gap:6px;margin-top:12px}.campaign-form input,.campaign-form select,.campaign-form button{min-width:0;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);padding:7px;font:inherit;font-size:10px}.campaign-list{margin-top:9px;display:grid;gap:5px;font-size:10px}.campaign-item{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);padding-top:6px}.muted{color:var(--muted)}
details.drawer{grid-column:1/-1;padding:0}details.drawer>summary,details.discovery-shell>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;font-size:10px;letter-spacing:.13em;font-weight:800;color:var(--ink)}details.drawer>summary::-webkit-details-marker,details.discovery-shell>summary::-webkit-details-marker{display:none}details.drawer>summary:after,details.discovery-shell>summary:after{content:"＋";font-size:15px;color:var(--green)}details.drawer[open]>summary:after,details.discovery-shell[open]>summary:after{content:"−"}.drawer-content{padding:0 14px 14px}.drawer-meta{font-size:9px;letter-spacing:0;color:var(--muted);font-weight:600}.detail-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:10px}.detail-grid>.card{box-shadow:none;background:#fff;border-radius:9px}
.bar-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:10px}
.bar-wrap{grid-column:1/-1;height:3px;background:#e5ded2;margin-top:-3px}
.bar{height:100%;background:var(--green)}
#discovery{margin-top:10px}.discovery{padding:0 14px 14px}.discovery .grid{margin-top:0}.discovery-shell{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}.discovery-status{grid-column:1/-1}.index-table{grid-column:1/-1}.health{grid-column:span 4}.seo-kpi{grid-column:span 2}.seo-kpi .value{font-family:Georgia,"Times New Roman",serif;font-size:24px;margin-top:6px}.inbox{grid-column:1/-1}.inbox-controls{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:7px;align-items:center}.inbox-controls select,.inbox-controls input,.inbox-controls button,.index-select{border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);padding:7px;font:inherit;font-size:10px}.snapshot-list{display:grid;gap:6px;margin-top:8px}.snapshot-item{display:flex;justify-content:space-between;gap:12px;padding-top:6px;border-top:1px solid var(--line);font-size:10px}.drop-note{font-size:9px;color:var(--muted);line-height:1.55;margin-top:7px}.diagnostic{border-left:3px solid var(--accent)}.error{border:1px solid var(--accent);border-radius:10px;padding:12px;color:var(--accent);background:#fff8f5;white-space:pre-wrap}
.sns-row{padding:12px 0;border-top:1px solid var(--line)}.sns-heading{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:8px}.sns-heading span{font-variant-numeric:tabular-nums}.sns-track{display:flex;height:18px;background:var(--soft);border-radius:4px;overflow:hidden}.sns-track span{height:100%}.sns-breakdown{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;margin-top:7px}.sns-note{font-size:12px;line-height:1.6;color:var(--muted);margin:8px 0}.sns-heading strong{min-width:0}.sns-heading span{flex-shrink:0}@media(max-width:390px){.sns-heading{flex-wrap:wrap}.sns-breakdown{gap:6px 10px}}
footer{margin-top:16px;color:var(--muted);font-size:9px;line-height:1.6}
@media(max-width:980px){.kpi,.seo-kpi{grid-column:span 4}.health{grid-column:span 4}.primary-chart,.summary-chart{grid-column:span 6}.inbox-controls{grid-template-columns:1fr}.campaign-form{grid-template-columns:1fr 1fr}.campaign-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){main{width:min(100% - 20px,1240px);padding-top:18px}header{align-items:flex-start;flex-direction:column}.actions{justify-content:flex-start}.host-grid{grid-template-columns:1fr}.kpi,.seo-kpi,.health{grid-column:span 6}.pages,.channels,.referrers,.half,.chart-half,.primary-chart,.summary-chart{grid-column:1/-1}.donut-grid{grid-template-columns:100px minmax(0,1fr)}.campaign-grid{grid-template-columns:repeat(2,1fr)}.campaign-form{grid-template-columns:1fr}.flow-viz-row{grid-template-columns:1fr auto 1fr}.flow-viz-row .flow-track,.flow-viz-row .flow-count{grid-column:1/-1}.status{flex-direction:column}.detail-grid>.card{grid-column:1/-1}}@media(max-width:390px){main{width:calc(100% - 14px)}.actions{gap:4px}.actions button{padding:6px 8px}.seo-kpi,.health{grid-column:1/-1}details.drawer>summary,details.discovery-shell>summary{align-items:flex-start;flex-direction:column}.drawer-meta{line-height:1.5}}
.campaign-form{grid-template-columns:repeat(3,minmax(0,1fr))}.campaign-form label{min-width:0;font-size:11px}.campaign-form label input{display:block;width:100%;box-sizing:border-box;margin-top:4px}.campaign-item span{min-width:0;overflow-wrap:anywhere}#campaignCompare{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:12px 0}#campaignCompare select{max-width:100%;padding:6px}#campaignCompare label{min-width:0;max-width:100%}#campaignResult{font-size:12px;line-height:1.5;overflow-wrap:anywhere}#campaignResult th,#campaignResult td{padding:7px 4px;white-space:normal}@media(max-width:760px){.campaign-form{grid-template-columns:minmax(0,1fr)}}
</style>
</head>
<body>
<main>
<header>
<div><div class="eyebrow">PRIVATE / DISCOVERY DASHBOARD V3</div><h1>VINTAGE ALARM ANALYTICS</h1></div>
<div class="actions">
<button data-window="1h">1H</button>
<button data-window="3h">3H</button>
<button data-window="24h">24H</button>
<button data-window="7d" class="active">7D</button>
<button data-window="30d">30D</button>
<button class="refresh" id="aiShare">AI COPY</button>
<button class="refresh" id="refresh">REFRESH</button>
</div>
</header>
<div class="status"><span id="period">Loading…</span><span id="updated"></span></div>
<div id="content"></div>
<div id="discovery"></div>
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
const COLORS={pageviews:"#181716",visits:"#8d2c23",newHost:"#13766e",legacyHost:"#9a7b4f",X:"#315c3d",YouTube:"#a33b32",Search:"#365f7d",Direct:"#9a7b4f",Meta:"#7b5674",AI:"#6b6b6b",Other:"#aaa197"};
function bucketTime(value){
  if(!value)return NaN;
  if(/^\\d{4}-\\d{2}-\\d{2}$/.test(value))return new Date(value+"T00:00:00Z").getTime();
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
function hostTrendPoints(current,legacy){
  const points=new Map();
  const add=(items,key)=>items.forEach(item=>{
    const point=points.get(item.bucket)||{bucket:item.bucket,newVisits:0,legacyVisits:0};
    point[key]+=Number(item.visits||0);points.set(item.bucket,point);
  });
  add(current||[],"newVisits");add(legacy||[],"legacyVisits");
  return [...points.values()].sort((a,b)=>String(a.bucket).localeCompare(String(b.bucket)));
}
const HOST_MIGRATION = ${JSON.stringify(HOST_MIGRATION)};
function lineChart(points,series,campaigns=[],hostMigration=false){
  if(!points?.length)return '<div class="muted">時系列データなし</div>';
  const w=900,h=220,l=42,r=18,t=16,b=30,iw=w-l-r,ih=h-t-b;
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
  const events=(hostMigration ? [...campaigns,{linkAddedAt:HOST_MIGRATION.markerAt,label:"HOST MIGRATION",migration:true}] : campaigns)
    .map(item=>({...item,markerTime:new Date(item.linkAddedAt).getTime()}))
    .filter(item=>item.linkAddedAt&&Number.isFinite(item.markerTime)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&item.markerTime>=start&&item.markerTime<=end)
    .sort((a,b)=>a.markerTime-b.markerTime);
  const laneLastX=Array(6).fill(-Infinity);
  const markers=events.map(item=>{
    const x=l+((item.markerTime-start)/(end-start))*iw;
    let lane=laneLastX.findIndex(lastX=>x-lastX>=120);
    if(lane<0)lane=laneLastX.indexOf(Math.min(...laneLastX));
    laneLastX[lane]=x;
    const platform=item.platform==="YouTube"?"YouTube":"X";
    const color=item.migration?"#706d67":platform==="YouTube"?COLORS.YouTube:COLORS.X;
    const prefix=platform==="YouTube"?"YT":"X";
    const nearRight=x>w-r-150;
    const labelX=nearRight?x-5:x+5;
    const anchor=nearRight?"end":"start";
    const label=esc(item.migration?item.label:prefix+" · "+(item.label||"POST"));
    return '<line data-event-marker="line" x1="'+x+'" y1="'+t+'" x2="'+x+'" y2="'+(t+ih)+'" stroke="'+color+'" stroke-width="1" stroke-dasharray="4 4"/><text data-event-marker="label" x="'+labelX+'" y="'+(t+11+lane*13)+'" text-anchor="'+anchor+'" font-size="9" font-weight="700" fill="'+color+'" style="paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round">'+label+'</text>';
  }).join("");
  const legend='<div class="chart-legend">'+series.map(s=>'<span><i class="legend-dot" style="background:'+s.color+'"></i>'+esc(s.label)+'</span>').join("")+'</div>';
  return '<div class="chart-wrap"><svg viewBox="0 0 '+w+' '+h+'" width="100%" role="img">'+grid+lines+markers+ticks+'</svg></div>'+legend;
}
function entryBars(pages){
  const items=[...pages].sort((a,b)=>(b.visits-a.visits)||(b.pageviews-a.pageviews)).slice(0,6);
  const max=Math.max(1,...items.map(x=>x.visits));
  return items.map(x=>'<div class="entry-bar"><span><strong>'+esc(x.name)+'</strong><span class="path">'+esc(x.path)+'</span></span><div class="entry-track"><div class="entry-fill" style="width:'+((x.visits/max)*100)+'%"></div></div><strong>'+n(x.visits)+'</strong></div>').join("");
}
function channelColor(name){
  if(name==="X")return COLORS.X;
  if(name==="YouTube")return COLORS.YouTube;
  if(name==="Organic Search")return COLORS.Search;
  if(name==="Direct / Unknown")return COLORS.Direct;
  if(name==="Instagram")return "#925579";
  if(name==="Facebook")return "#426d9b";
  if(name==="Other SNS")return "#8a763a";
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
  const list=items.slice(0,7);
  const max=Math.max(1,...list.map(x=>x.pageviews));
  if(!list.length)return '<div class="muted">内部遷移データなし</div>';
  return '<div class="flow-viz">'+list.map(x=>'<div class="flow-viz-row"><strong>'+esc(x.sourceName)+'</strong><span>→</span><strong>'+esc(x.destinationName)+'</strong><div class="flow-track"><div class="flow-fill" style="width:'+((x.pageviews/max)*100)+'%"></div></div><span class="flow-count">'+n(x.pageviews)+'</span></div>').join("")+'</div>';
}
function snsEntryChart(data){
  if(!data)return '<div class="muted">SNS入口データを取得できませんでした。</div>';
  const channels=["X","Instagram","Facebook","Other SNS"];
  const max=Math.max(1,...data.pages.map(p=>p.total));
  const note=data.complete?'判別できたSNS入口 '+n(data.total)+'件':'取得上限に到達：表示分 '+n(data.total)+'件（全体比は算出保留）';
  return '<div class="sns-note">'+note+(data.total<30?' · 少数データ：傾向判断は保留':'')+'<br>棒の共通目盛り：0〜'+n(max)+'件</div>'+
    data.pages.map(p=>'<div class="sns-row"><div class="sns-heading"><strong>'+esc(p.name)+'</strong><span>'+n(p.total)+'件'+(data.complete&&data.total?' · SNS全体の'+(p.total/data.total*100).toFixed(0)+'%':'')+'</span></div><div class="sns-track" role="img" aria-label="'+esc(p.name+' '+channels.map(c=>c+' '+p.values[c]+'件').join('、'))+'">'+channels.map(c=>'<span style="width:'+(p.values[c]/max*100)+'%;background:'+channelColor(c)+'"></span>').join('')+'</div><div class="sns-breakdown">'+channels.map(c=>'<span><i class="legend-dot" style="background:'+channelColor(c)+'"></i>'+esc(c)+' '+n(p.values[c])+'</span>').join('')+'</div></div>').join('')+
    '<div class="sns-note">入口回数（人数・SNSクリック数ではありません）。Direct / UnknownにSNS由来が含まれる場合があります。Other pagesは上記3ページ以外。</div>';
}
const CAMPAIGN_KEY="vaCampaigns";
function normalizeCampaignRecord(item){
  const platform=item?.platform==="YouTube"?"YouTube":"X";
  return {
    ...item,
    platform,
    label:String(item?.label||(platform==="YouTube"?"YOUTUBE VIDEO":"X POST")),
    postUrl:String(item?.postUrl||""),
    postId:String(item?.postId||""),
    authorName:String(item?.authorName||""),
    postText:String(item?.postText||""),
    postedAt:String(item?.postedAt||""),
    linkAddedAt:item?.linkAddedAt||"",
    measuredAt:item?.measuredAt||null,
    targetPath:normalizeTargetPath(item?.targetPath||"/"),
    impressions:item?.impressions===null||item?.impressions===undefined?null:Number(item.impressions),
    engagements:item?.engagements===null||item?.engagements===undefined?null:Number(item.engagements),
    details:item?.details===null||item?.details===undefined?null:Number(item.details),
    linkClicks:item?.linkClicks===null||item?.linkClicks===undefined?null:Number(item.linkClicks),
    views:item?.views===null||item?.views===undefined?null:Number(item.views),
    likes:item?.likes===null||item?.likes===undefined?null:Number(item.likes),
    avgViewPercentage:item?.avgViewPercentage===null||item?.avgViewPercentage===undefined?null:Number(item.avgViewPercentage)
  };
}
function getCampaigns(){
  try{
    const parsed=JSON.parse(localStorage.getItem(CAMPAIGN_KEY)||"[]");
    return Array.isArray(parsed)?parsed.map(normalizeCampaignRecord):[];
  }catch{return[]}
}
function saveCampaigns(items){
  localStorage.setItem(CAMPAIGN_KEY,JSON.stringify(items.map(normalizeCampaignRecord)));
}
function normalizeTargetPath(value){
  let out=String(value||"/").trim();
  if(!out.startsWith("/"))out="/"+out;
  if(out!=="/"&&!out.endsWith("/"))out+="/";
  return out;
}
function campaignPanel(){
  const campaigns=getCampaigns().sort((a,b)=>String(b.postedAt||"").localeCompare(String(a.postedAt||"")));
  const active=campaigns[0]||null;
  if(!active){
    return '<div class="muted">X / YouTubeのリンク追加日時を登録すると、施策開始を折れ線に重ね、1・24・72時間の前後比較ができます。各プラットフォーム数値は手入力・空欄は未取得です。</div>'+campaignFormHtml();
  }
  const funnel='<div class="muted">プラットフォーム側の数値は手入力の累積値です。未入力は未取得。旧X記録はplatform未指定でもXとして読み込みます。前後比較は投稿別の完全帰属・満足度を示すものではありません。</div>';
  const list='<div class="campaign-list">'+campaigns.map((x,i)=>'<div class="campaign-item"><span><strong>['+esc(x.platform)+'] '+esc(x.label)+'</strong> · 開始 '+esc(x.linkAddedAt?new Date(x.linkAddedAt).toLocaleString():"未登録")+' · '+esc(x.targetPath||"/")+(x.authorName?' · '+esc(x.authorName):'')+(x.postUrl?'<span class="path">'+esc(x.postUrl)+'</span>':'')+'</span><button type="button" data-campaign-delete="'+i+'">削除</button></div>').join("")+'</div>';
  const compare='<form id="campaignCompare"><label>比較する施策 <select name="campaign">'+campaigns.map((x,i)=>'<option value="'+i+'">['+esc(x.platform)+'] '+esc(x.label)+'</option>').join('')+'</select></label> <label>期間 <select name="hours"><option value="1">1時間</option><option value="24" selected>24時間</option><option value="72">72時間</option></select></label> <button>前後比較を取得</button></form><div id="campaignResult" aria-live="polite">施策を選んで取得してください。上部の期間選択とは独立しています。</div>';
  return funnel+compare+campaignFormHtml()+list;
}
function campaignFormHtml(){
  return '<form class="campaign-form" id="campaignForm">'+
    '<select name="platform" aria-label="プラットフォーム"><option value="X">X</option><option value="YouTube">YouTube</option></select>'+
    '<input name="postUrl" type="url" aria-label="投稿URL" placeholder="X URL（本文のみ自動取得）">'+
    '<input name="label" placeholder="投稿名" required>'+
    '<label>投稿日時（任意・端末の時刻）<input name="postedAt" type="datetime-local"></label>'+
    '<label>リンク追加・施策開始（端末の時刻）<input name="linkAddedAt" type="datetime-local" required></label>'+
    '<label>数値を確認した日時（入力時は必須）<input name="measuredAt" type="datetime-local"></label>'+
    '<input name="targetPath" placeholder="/basis-alarm/" required>'+
    '<input name="impressions" aria-label="指標1" type="number" min="0" step="0.1" placeholder="表示回数（未取得は空欄）">'+
    '<input name="engagements" aria-label="指標2" type="number" min="0" step="0.1" placeholder="反応数（任意）">'+
    '<input name="details" aria-label="指標3" type="number" min="0" step="0.1" placeholder="詳細クリック数（任意）">'+
    '<input name="linkClicks" aria-label="リンククリック数" type="number" min="0" step="0.1" placeholder="リンククリック数（任意）">'+
    '<button type="submit">ADD</button></form>';
}
function applyCampaignPlatform(form){
  const platform=form.elements.platform?.value==="YouTube"?"YouTube":"X";
  const url=form.elements.postUrl;
  const metric1=form.elements.impressions;
  const metric2=form.elements.engagements;
  const metric3=form.elements.details;
  const link=form.elements.linkClicks;
  if(platform==="YouTube"){
    if(url)url.placeholder="YouTube / Shorts URL（タイトル自動取得）";
    if(metric1){metric1.placeholder="再生回数（未取得は空欄）";metric1.setAttribute("aria-label","再生回数");}
    if(metric2){metric2.placeholder="高評価数（任意）";metric2.setAttribute("aria-label","高評価数");}
    if(metric3){metric3.placeholder="平均視聴率 %（任意）";metric3.setAttribute("aria-label","平均視聴率");}
    if(link)link.placeholder="リンククリック数（分かる場合のみ）";
  }else{
    if(url)url.placeholder="X URL（本文のみ自動取得）";
    if(metric1){metric1.placeholder="表示回数（未取得は空欄）";metric1.setAttribute("aria-label","表示回数");}
    if(metric2){metric2.placeholder="反応数（任意）";metric2.setAttribute("aria-label","反応数");}
    if(metric3){metric3.placeholder="詳細クリック数（任意）";metric3.setAttribute("aria-label","詳細クリック数");}
    if(link)link.placeholder="リンククリック数（任意）";
  }
}
function bindCampaignUi(){
  const compare=document.getElementById("campaignCompare");
  if(compare)compare.addEventListener("submit",async event=>{
    event.preventDefault();
    const out=document.getElementById("campaignResult");
    const active=getCampaigns().sort((a,b)=>String(b.postedAt||"").localeCompare(String(a.postedAt||"")))[Number(compare.elements.campaign.value)];
    if(!active?.linkAddedAt){out.textContent="旧記録にはリンク追加日時がありません。投稿日時から推定せず、新しく施策を登録してください。";return;}
    compare.querySelector('button').disabled=true;
    out.textContent="比較データを取得中…";
    try{
      const res=await fetch('/api/campaign?start='+encodeURIComponent(active.linkAddedAt)+'&hours='+compare.elements.hours.value+'&target='+encodeURIComponent(active.targetPath)+'&platform='+encodeURIComponent(active.platform),{cache:"no-store"});
      const data=await res.json();if(!res.ok||data.error)throw new Error(data.error||("HTTP "+res.status));
      const fmt=value=>new Date(value).toLocaleString();
      const metric=value=>value===null||value===undefined?'未取得':esc(value);
      const platform=active.platform==="YouTube"?"YouTube":"X";
      const rows=[[platform+'からの入口回数','platformEntries'],[platform+' → 対象ページの入口回数','targetEntries'],['対象 → 別ページのPV','nextPages']];
      const manual=platform==="YouTube"
        ?'YouTube手入力累積：再生 '+metric(active.views)+' ／ 高評価 '+metric(active.likes)+' ／ 平均視聴率 '+(active.avgViewPercentage===null||active.avgViewPercentage===undefined?'未取得':esc(active.avgViewPercentage)+'%')+' ／ リンククリック '+metric(active.linkClicks)
        :'X手入力累積：表示 '+metric(active.impressions)+' ／ リンククリック '+metric(active.linkClicks);
      out.innerHTML='<p>['+esc(platform)+'] '+esc(active.label)+' · '+(data.complete?'期間完了':'途中経過：経過時間に合わせて比較')+'（各 '+data.elapsedHours.toFixed(2)+' 時間）</p><p>前：'+esc(fmt(data.beforeStart))+' → '+esc(fmt(data.start))+'<br>後：'+esc(fmt(data.start))+' → '+esc(fmt(data.end))+'</p><table><thead><tr><th>指標</th><th>前</th><th>後</th><th>差</th></tr></thead><tbody>'+rows.map(([label,key])=>'<tr><td>'+label+'</td><td>'+data.before[key]+'</td><td>'+data.after[key]+'</td><td>'+(data.after[key]-data.before[key])+'</td></tr>').join('')+'</tbody></table><p>'+manual+'<br>確認日時：'+(active.measuredAt?esc(fmt(active.measuredAt)):'未登録')+'</p><p>入口回数は人数・クリック数ではありません。別ページPVは全流入元を含み、同一ページ遷移を除外。プラットフォーム側の累積値は前後比較に使っていません。YouTubeアプリ等でRefererが落ちる場合はDirect / Unknownになり得ます。'+(data.before.possiblyTruncated||data.after.possiblyTruncated?'取得上限に到達：部分集計の可能性があります。':'')+'</p>';
    }catch(error){out.textContent='取得失敗：'+error.message;}finally{compare.querySelector('button').disabled=false;}
  });
  const form=document.getElementById("campaignForm");
  if(form){
    const platform=form.elements.platform;
    const postUrl=form.elements.postUrl;
    applyCampaignPlatform(form);
    if(platform)platform.addEventListener("change",()=>{
      if(postUrl){
        postUrl.value="";
        postUrl.dataset.postId="";
        postUrl.dataset.authorName="";
        postUrl.dataset.postText="";
        postUrl.dataset.state="";
      }
      applyCampaignPlatform(form);
    });
    if(postUrl)postUrl.addEventListener("change",async()=>{
      const value=String(postUrl.value||"").trim();
      if(!value)return;
      const currentPlatform=form.elements.platform?.value==="YouTube"?"YouTube":"X";
      postUrl.dataset.state="loading";
      try{
        const endpoint=currentPlatform==="YouTube"?"/api/youtube-preview":"/api/x-preview";
        const res=await fetch(endpoint+'?url='+encodeURIComponent(value),{cache:"no-store"});
        const preview=await res.json();
        if(!res.ok||preview.error)throw new Error(preview.error||("HTTP "+res.status));
        postUrl.value=preview.url||value;
        postUrl.dataset.postId=preview.postId||preview.videoId||"";
        postUrl.dataset.authorName=preview.authorName||"";
        postUrl.dataset.postText=preview.text||preview.title||"";
        if(!form.elements.label.value){
          const base=(preview.title||preview.text||"").replace(/\\s+/g," ").trim();
          form.elements.label.value=base?base.slice(0,60):(preview.authorName||(currentPlatform==="YouTube"?"YOUTUBE VIDEO":"X POST"));
        }
        postUrl.dataset.state="ready";
      }catch(err){
        postUrl.dataset.state="error";
        alert((currentPlatform==="YouTube"?"YouTube動画":"X投稿")+"の読込に失敗: "+err.message);
      }
    });
    form.addEventListener("submit",event=>{
      event.preventDefault();
      const fd=new FormData(form);
      const numeric=name=>String(fd.get(name)||'').trim()===''?null:Number(fd.get(name));
      const currentPlatform=String(fd.get("platform")||"X")==="YouTube"?"YouTube":"X";
      if(['impressions','engagements','details','linkClicks'].some(name=>numeric(name)!==null)&&!fd.get('measuredAt')){alert(currentPlatform+'数値を確認した日時を入力してください。');return;}
      if(new Date(String(fd.get('linkAddedAt'))).getTime()>Date.now()){alert('施策開始日時は過去の日時を入力してください。');return;}
      const items=getCampaigns();
      const metric1=numeric("impressions"),metric2=numeric("engagements"),metric3=numeric("details");
      items.push({
        platform:currentPlatform,
        label:String(fd.get("label")||(currentPlatform==="YouTube"?"YOUTUBE VIDEO":"X POST")),
        postUrl:String(fd.get("postUrl")||""),
        postId:String(form.elements.postUrl?.dataset.postId||""),
        authorName:String(form.elements.postUrl?.dataset.authorName||""),
        postText:String(form.elements.postUrl?.dataset.postText||""),
        postedAt:String(fd.get("postedAt")||""),
        linkAddedAt:new Date(String(fd.get("linkAddedAt"))).toISOString(),
        measuredAt:fd.get("measuredAt")?new Date(String(fd.get("measuredAt"))).toISOString():null,
        schemaVersion:3,
        targetPath:normalizeTargetPath(fd.get("targetPath")),
        impressions:currentPlatform==="X"?metric1:null,
        engagements:currentPlatform==="X"?metric2:null,
        details:currentPlatform==="X"?metric3:null,
        views:currentPlatform==="YouTube"?metric1:null,
        likes:currentPlatform==="YouTube"?metric2:null,
        avgViewPercentage:currentPlatform==="YouTube"?metric3:null,
        linkClicks:numeric("linkClicks")
      });
      saveCampaigns(items);
      render(window.__vaLastData);
      document.querySelector('details.campaign').open=true;
    });
  }
  document.querySelectorAll("[data-campaign-delete]").forEach(btn=>btn.addEventListener("click",()=>{
    const items=getCampaigns().sort((a,b)=>String(b.postedAt||"").localeCompare(String(a.postedAt||"")));
    items.splice(Number(btn.dataset.campaignDelete),1);
    saveCampaigns(items);
    render(window.__vaLastData);
  }));
}
function render(data){
  window.__vaLastData=data;
  window.__vaWindowStart=data.windowStart;
  window.__vaWindowEnd=data.windowEnd;
  const c=data.current,p=data.previous;
  const legacy=data.legacy||{};
  const lc=legacy.current||{pageviews:0,visits:0,pages:[],channels:[],referrers:[],flows:[],countries:[],devices:[]};
  document.getElementById("period").textContent=data.windowLabel || windowKey;
  document.getElementById("updated").textContent='更新 '+new Date(data.generatedAt).toLocaleString("ja-JP");
  const xNow=c.channels.find(x=>x.name==="X")?.visits||0;
  const xPrev=p.channels.find(x=>x.name==="X")?.visits||0;
  const searchNow=c.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const searchPrev=p.channels.find(x=>x.name==="Organic Search")?.visits||0;
  const entryFlows=c.flows.filter(x=>x.visits>0 && x.channel!=="Internal Navigation");
  const internalFlows=c.flows.filter(x=>x.channel==="Internal Navigation"&&x.sourceCleanPath!==x.destinationPath);
  const campaigns=getCampaigns();
  const trend=data.trend||[];
  const legacyTrend=legacy.trend||[];
  const transitionTrend=hostTrendPoints(trend,legacyTrend);
  const pagesPerVisit=c.visits?c.pageviews/c.visits:0;
  const watchEntry=c.pages.filter(x=>["Basis Alarm","Pierce Duofon","Cyma Time-O-Vox"].includes(x.name)).reduce((s,x)=>s+x.visits,0);
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
  const hostSeries=[{key:"newVisits",label:"NEW · "+data.host,color:COLORS.newHost},{key:"legacyVisits",label:"OLD · "+(legacy.host||HOST_MIGRATION.oldHost),color:COLORS.legacyHost}];
  const acquisitionSeries=[{key:"x",label:"X",color:COLORS.X},{key:"youtube",label:"YouTube",color:COLORS.YouTube},{key:"search",label:"Search",color:COLORS.Search},{key:"direct",label:"Direct",color:COLORS.Direct},{key:"instagram",label:"Instagram",color:channelColor("Instagram")},{key:"facebook",label:"Facebook",color:channelColor("Facebook")},{key:"otherSns",label:"Other SNS",color:channelColor("Other SNS")}];
  document.getElementById("content").innerHTML=
  '<div class="path">'+esc(HOST_MIGRATION.note)+'</div>'+
  '<div class="grid analytics-grid">'+audit+lowSample+
    '<section class="card host-scope"><div class="section-head"><div class="section-title">HOST SCOPE · SEPARATE MEASUREMENT</div><span>新旧を合算しません</span></div><div class="host-grid">'+
      '<div class="host-block"><span class="path">NEW · '+esc(data.host)+'</span><strong>'+n(c.visits)+' visits</strong><div class="delta">'+n(c.pageviews)+' page views · '+esc(data.windowLabel||windowKey)+'</div></div>'+
      '<div class="host-block"><span class="path">OLD · '+esc(legacy.host||HOST_MIGRATION.oldHost)+'</span><strong>'+n(lc.visits)+' visits</strong><div class="delta">'+n(lc.pageviews)+' page views · '+esc(data.windowLabel||windowKey)+'</div></div>'+
    '</div></section>'+
    '<section class="card kpi"><div class="label">NEW VISITS</div><div class="value">'+n(c.visits)+'</div>'+delta(c.visits,p.visits)+'</section>'+
    '<section class="card kpi"><div class="label">NEW PAGE VIEWS</div><div class="value">'+n(c.pageviews)+'</div>'+delta(c.pageviews,p.pageviews)+'</section>'+
    '<section class="card kpi"><div class="label">X VISITS</div><div class="value">'+n(xNow)+'</div>'+delta(xNow,xPrev)+'</section>'+
    '<section class="card kpi"><div class="label">ORGANIC SEARCH</div><div class="value">'+n(searchNow)+'</div>'+delta(searchNow,searchPrev)+'</section>'+
    '<section class="card kpi"><div class="label">PAGES / VISIT</div><div class="value">'+pagesPerVisit.toFixed(2)+'</div><div class="delta">回遊の粗い指標</div></section>'+
    '<section class="card kpi"><div class="label">WATCH ENTRY SHARE</div><div class="value">'+watchShare.toFixed(0)+'%</div><div class="delta">全流入 '+n(c.visits)+'件中 '+n(watchEntry)+'件</div></section>'+
    '<section class="card chart-card"><div class="section-head"><div class="section-title">HOST TRANSITION · VISITS</div><span>旧・新を別系列で表示</span></div>'+lineChart(transitionTrend,hostSeries,campaigns,true)+((data.trendWarning||legacy.trendWarning)?'<div class="path">'+esc([data.trendWarning,legacy.trendWarning].filter(Boolean).join(" / "))+'</div>':'')+'</section>'+
    '<section class="card primary-chart"><div class="section-head"><div class="section-title">NEW HOST TRAFFIC TREND</div><span>'+esc(data.trendBucket||"no bucket")+'</span></div>'+lineChart(trend,trafficSeries,campaigns,true)+(data.trendWarning?'<div class="path">'+esc(data.trendWarning)+'</div>':'')+'</section>'+
    '<section class="card summary-chart"><div class="section-head"><div class="section-title">TRAFFIC MIX</div><span>Visits構成</span></div>'+trafficMix(c.channels)+'</section>'+
    '<section class="card primary-chart"><div class="section-head"><div class="section-title">NEW HOST ACQUISITION TREND</div><span>流入元別の入口回数</span></div>'+lineChart(trend,acquisitionSeries,campaigns,true)+'</section>'+
    '<section class="card summary-chart"><div class="section-head"><div class="section-title">ENTRY PAGES</div><span>入口回数</span></div>'+entryBars(c.pages)+'</section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">SNS → WATCH ENTRY</div><span>判別できたSNS流入の着地先</span></div>'+snsEntryChart(c.snsEntries)+'</section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">SITE FLOW</div><span>内部遷移</span></div>'+flowVisual(internalFlows)+'</section>'+
    '<details class="card drawer campaign"><summary><span>CAMPAIGN FUNNEL</span><span class="drawer-meta">投稿ログはこのブラウザだけに保存</span></summary><div class="drawer-content">'+campaignPanel(entryFlows,internalFlows)+'</div></details>'+
    '<section class="card pages"><div class="section-head"><div class="section-title">PAGES</div><span>'+n(c.pages.length)+' paths</span></div><table><thead><tr><th>PAGE</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+
      c.pages.slice(0,20).map(x=>'<tr><td><strong>'+esc(x.name)+'</strong>'+(!x.mapped?'<span class="flag">UNMAPPED</span>':'')+'<span class="path">'+esc(x.path)+'</span></td><td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>').join("")+
    '</tbody></table></section>'+
    '<section class="card channels"><div class="section-head"><div class="section-title">CHANNELS / PV</div></div>'+rows(c.channels,10)+'</section>'+
    '<details class="card drawer raw"><summary><span>LEGACY HOST DETAILS</span><span class="drawer-meta">'+esc(legacy.host||HOST_MIGRATION.oldHost)+' · 別計測</span></summary><div class="drawer-content detail-grid">'+
      '<section class="card pages"><div class="section-head"><div class="section-title">OLD HOST PAGES</div><span>'+n(lc.pages.length)+' paths</span></div><table><thead><tr><th>PAGE</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+lc.pages.slice(0,20).map(x=>'<tr><td><strong>'+esc(x.name)+'</strong><span class="path">'+esc(x.path)+'</span></td><td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>').join("")+'</tbody></table></section>'+
      '<section class="card channels"><div class="section-head"><div class="section-title">OLD HOST CHANNELS / PV</div></div>'+rows(lc.channels,10)+'</section>'+
    '</div></details>'+
    '<details class="card drawer raw"><summary><span>RAW / AUDIT TABLES</span><span class="drawer-meta">流入元・内部遷移・国・端末の詳細</span></summary><div class="drawer-content detail-grid">'+
    '<section class="card flow"><div class="section-head"><div class="section-title">ENTRY SOURCE → PAGE</div><span>同一行で取得</span></div><table><thead><tr><th>SOURCE</th><th></th><th>DESTINATION</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+flowRows(entryFlows)+'</tbody></table></section>'+
    '<section class="card flow"><div class="section-head"><div class="section-title">SITE FLOW</div><span>内部遷移</span></div><table><thead><tr><th>FROM</th><th></th><th>TO</th><th class="num">PV</th><th class="num">VISITS</th></tr></thead><tbody>'+flowRows(internalFlows,true)+'</tbody></table></section>'+
    '<section class="card referrers"><div class="section-head"><div class="section-title">REFERRERS</div><span>raw host</span></div><table><thead><tr><th>HOST</th><th class="num">PV</th><th class="num">ENTRY VISITS</th></tr></thead><tbody>'+
      c.referrers.slice(0,20).map(x=>'<tr><td><strong>'+esc(x.host||"(Direct)")+'</strong>'+(x.path?'<span class="path">'+esc(x.path)+'</span>':'')+'</td><td class="num">'+n(x.pageviews)+'</td><td class="num">'+n(x.visits)+'</td></tr>').join("")+
    '</tbody></table></section>'+
    '<section class="card half"><div class="section-head"><div class="section-title">COUNTRIES</div></div>'+rows(c.countries,10)+'</section>'+
    '<section class="card half"><div class="section-head"><div class="section-title">DEVICES</div></div>'+rows(c.devices,10)+'</section>'+
    '</div></details>'+
  '</div>';
  bindCampaignUi();
}
const DISCOVERY_KEY="vaDiscoverySnapshotsV1";
const INDEX_KEY="vaIndexStatusV1";
const KEY_PAGES=[
  {name:"TOP",path:"/"},
  {name:"HISTORY",path:"/history/"},
  {name:"OWNER'S NOTES",path:"/owners-notes/"},
  {name:"Basis Alarm",path:"/basis-alarm/"},
  {name:"Pierce Duofon",path:"/pierce-duofon/"},
  {name:"Cyma Time-O-Vox",path:"/cyma-time-o-vox/"}
];

function getDiscoverySnapshots(){
  try{
    const parsed=JSON.parse(localStorage.getItem(DISCOVERY_KEY)||"[]");
    return Array.isArray(parsed)?parsed:[];
  }catch{return[]}
}
function saveDiscoverySnapshots(items){
  localStorage.setItem(DISCOVERY_KEY,JSON.stringify(items.slice(-20)));
}
function getIndexStatus(){
  try{
    const parsed=JSON.parse(localStorage.getItem(INDEX_KEY)||"{}");
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{return{}}
}
function saveIndexStatus(value){
  localStorage.setItem(INDEX_KEY,JSON.stringify(value));
}
function normHeader(value){
  return String(value||"").trim().toLowerCase().replace(/[\\s_\\-（）()％%]/g,"");
}
function detectMetric(header){
  const h=normHeader(header);
  if(["clicks","click","クリック数","クリック"].includes(h))return "clicks";
  if(["impressions","impression","表示回数","インプレッション数","インプレッション"].includes(h))return "impressions";
  if(["ctr","クリック率"].includes(h))return "ctr";
  if(["position","avgposition","averageposition","掲載順位","平均掲載順位"].includes(h))return "position";
  return null;
}
function detectDimension(header){
  const h=normHeader(header);
  if(["date","日付"].includes(h))return "date";
  if(["query","queries","topqueries","クエリ","上位のクエリ"].includes(h))return "query";
  if(["page","pages","toppages","ページ","上位のページ"].includes(h))return "page";
  if(["country","countries","国","国名"].includes(h))return "country";
  if(["device","devices","デバイス"].includes(h))return "device";
  if(["searchappearance","検索での見え方"].includes(h))return "appearance";
  return "other";
}
function parseNumber(value){
  const raw=String(value??"").trim().replace(/,/g,"").replace(/[~－—-]$/,"");
  if(!raw)return 0;
  if(raw.endsWith("%"))return Number(raw.slice(0,-1))||0;
  return Number(raw)||0;
}
function parseCsv(text){
  const rows=[]; let row=[]; let cell=""; let quoted=false;
  const src=String(text||"").replace(/^\\uFEFF/,"");
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(quoted){
      if(ch==='"'&&src[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=false;}
      else cell+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===","){row.push(cell);cell="";}
      else if(ch==="\\n"){row.push(cell);rows.push(row);row=[];cell="";}
      else if(ch!=="\\r")cell+=ch;
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(v=>String(v).trim()!==""));
}
function normalizeCsvFile(name,text){
  const matrix=parseCsv(text);
  if(matrix.length<2)throw new Error(name+": データ行がありません");
  const headers=matrix[0].map(v=>String(v).trim());
  const metricCols={};
  headers.forEach((h,i)=>{const key=detectMetric(h);if(key)metricCols[key]=i;});
  const dimIndex=headers.findIndex(h=>!detectMetric(h));
  const dimension=dimIndex>=0?detectDimension(headers[dimIndex]):"other";
  const rows=matrix.slice(1).map(r=>({
    key:dimIndex>=0?String(r[dimIndex]||"").trim():"",
    clicks:metricCols.clicks!==undefined?parseNumber(r[metricCols.clicks]):0,
    impressions:metricCols.impressions!==undefined?parseNumber(r[metricCols.impressions]):0,
    ctr:metricCols.ctr!==undefined?parseNumber(r[metricCols.ctr]):0,
    position:metricCols.position!==undefined?parseNumber(r[metricCols.position]):0
  })).filter(r=>r.key||r.clicks||r.impressions||r.ctr||r.position);
  return {name,dimension,headers,rows};
}
function snapshotSummary(files,kind){
  const dateFile=files.find(f=>f.dimension==="date");
  const source=dateFile||files.find(f=>f.rows.length)||null;
  if(!source)return {clicks:0,impressions:0,ctr:0,position:0,estimated:true};
  const impressions=source.rows.reduce((s,r)=>s+r.impressions,0);
  const clicks=kind==="seo"?source.rows.reduce((s,r)=>s+r.clicks,0):0;
  const ctr=impressions?clicks/impressions*100:0;
  const weightedPos=source.rows.reduce((s,r)=>s+(r.position*r.impressions),0);
  const position=impressions?weightedPos/impressions:0;
  return {clicks,impressions,ctr,position,estimated:!dateFile};
}
function latestSnapshots(kind){
  return getDiscoverySnapshots().filter(x=>x.kind===kind).sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt)));
}
function discoveryDiagnosis(latest,previous,indexedCount){
  if(indexedCount<KEY_PAGES.length)return {label:"INDEX CHECK",detail:"主要ページのIndex確認が未完了。まず上流を確認。"};
  if(!latest)return {label:"NO DATA",detail:"Search ConsoleのCSVを読み込むと診断開始。"};
  if(latest.summary.impressions===0)return {label:"NO VISIBILITY YET",detail:"Index確認済みでもImpressionsが0。露出発生待ちか需要/検索面を確認。"};
  if(!previous)return {label:"BASELINE",detail:"初回スナップショット。次回Exportから変化判定。"};
  const impPrev=previous.summary.impressions||0;
  const impDelta=impPrev?(latest.summary.impressions-impPrev)/impPrev:null;
  const ctrPrev=previous.summary.ctr||0;
  const ctrDelta=ctrPrev?(latest.summary.ctr-ctrPrev)/ctrPrev:null;
  const posBad=previous.summary.position>0&&latest.summary.position>previous.summary.position+2;
  if(impDelta!==null&&impDelta<-.2&&posBad)return {label:"VISIBILITY / RANKING SUSPECTED",detail:"Impressions低下＋平均掲載順位悪化。Page / Queryへ掘る。"};
  if(impDelta!==null&&impDelta>.1&&ctrDelta!==null&&ctrDelta<-.2)return {label:"SNIPPET / INTENT SUSPECTED",detail:"露出増に対してCTR低下。Query / Page / title・descriptionを確認。"};
  return {label:"OBSERVE",detail:"強い異常パターンはまだなし。"};
}
function discoveryTrend(snapshot){
  const file=snapshot?.files?.find(f=>f.dimension==="date");
  if(!file?.rows?.length)return '<div class="muted">日付CSVを同時に読み込むと時系列が出ます。</div>';
  const points=file.rows
    .map(r=>({bucket:r.key,impressions:r.impressions,clicks:r.clicks}))
    .sort((a,b)=>bucketTime(a.bucket)-bucketTime(b.bucket));
  const series=snapshot.kind==="seo"
    ?[{key:"impressions",label:"Impressions",color:COLORS.Search},{key:"clicks",label:"Clicks",color:COLORS.visits}]
    :[{key:"impressions",label:"Google AI impressions",color:COLORS.AI}];
  const prevStart=window.__vaWindowStart,prevEnd=window.__vaWindowEnd;
  window.__vaWindowStart=points[0]?.bucket;window.__vaWindowEnd=points[points.length-1]?.bucket;
  const out=lineChart(points,series,[]);
  window.__vaWindowStart=prevStart;window.__vaWindowEnd=prevEnd;
  return out;
}
function discoveryTopRows(snapshot){
  if(!snapshot)return "";
  const priority=["page","query","country","device","appearance"];
  const file=priority.map(d=>snapshot.files.find(f=>f.dimension===d)).find(Boolean);
  if(!file)return "";
  const rows=[...file.rows].sort((a,b)=>b.impressions-a.impressions).slice(0,10);
  return '<section class="card index-table"><div class="section-head"><div class="section-title">DRILLDOWN / '+esc(file.dimension.toUpperCase())+'</div><span>'+esc(file.name)+'</span></div><table><thead><tr><th>'+esc(file.dimension.toUpperCase())+'</th><th class="num">IMP</th>'+(snapshot.kind==="seo"?'<th class="num">CLICK</th><th class="num">CTR</th><th class="num">POS</th>':'')+'</tr></thead><tbody>'+
    rows.map(r=>'<tr><td>'+esc(r.key)+'</td><td class="num">'+n(r.impressions)+'</td>'+(snapshot.kind==="seo"?'<td class="num">'+n(r.clicks)+'</td><td class="num">'+r.ctr.toFixed(1)+'%</td><td class="num">'+(r.position?r.position.toFixed(1):"—")+'</td>':'')+'</tr>').join("")+
    '</tbody></table></section>';
}
function renderDiscoveryInbox(){
  const mount=document.getElementById("discovery");
  const wasOpen=Boolean(mount.querySelector("details.discovery-shell")?.open);
  const seo=latestSnapshots("seo");
  const geo=latestSnapshots("geo");
  const latestSeo=seo[0]||null,prevSeo=seo[1]||null,latestGeo=geo[0]||null,prevGeo=geo[1]||null;
  const indexState=getIndexStatus();
  const indexedCount=KEY_PAGES.filter(p=>indexState[p.path]?.status==="indexed").length;
  const diagnosis=discoveryDiagnosis(latestSeo,prevSeo,indexedCount);
  const seoSummary=latestSeo?.summary||{impressions:0,clicks:0,ctr:0,position:0};
  const geoSummary=latestGeo?.summary||{impressions:0};
  const indexRows=KEY_PAGES.map(p=>{
    const state=indexState[p.path]||{status:"unknown",checkedAt:""};
    return '<tr><td><strong>'+esc(p.name)+'</strong><span class="path">'+esc(p.path)+'</span></td><td><select class="index-select" data-index-path="'+esc(p.path)+'"><option value="unknown" '+(state.status==="unknown"?"selected":"")+'>未確認</option><option value="indexed" '+(state.status==="indexed"?"selected":"")+'>INDEXED</option><option value="not_indexed" '+(state.status==="not_indexed"?"selected":"")+'>NOT INDEXED</option></select></td><td>'+esc(state.checkedAt||"—")+'</td></tr>';
  }).join("");
  const history=[...getDiscoverySnapshots()].sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt))).slice(0,6);
  const historyHtml=history.map(x=>'<div class="snapshot-item"><span><strong>'+(x.kind==="seo"?"SEO":"GOOGLE AI")+'</strong> · '+new Date(x.importedAt).toLocaleString("ja-JP")+' · '+x.files.length+' files</span><span>IMP '+n(x.summary.impressions)+(x.kind==="seo"?' / CLICK '+n(x.summary.clicks):'')+'</span></div>').join("");
  mount.innerHTML=
    '<details class="discovery-shell" '+(wasOpen?'open':'')+'><summary><span>DISCOVERY / SEO &amp; GEO TOOLS</span><span class="drawer-meta">INDEX '+indexedCount+'/'+KEY_PAGES.length+' · '+esc(diagnosis.label)+'</span></summary><div class="discovery"><div class="grid">'+
      '<section class="card inbox"><div class="section-head"><div class="section-title">DISCOVERY INBOX / ZERO-COST</div><span>Search Console CSVをローカル保存</span></div>'+
        '<div class="inbox-controls"><select id="discoveryKind"><option value="seo">通常SEO</option><option value="geo">Google生成AI</option></select><input id="discoveryFiles" type="file" accept=".csv,text/csv" multiple><button id="importDiscovery" type="button">IMPORT</button></div>'+
        '<div class="drop-note">Search Consoleで「エクスポート → CSV」。CSVが複数ならまとめて選択。API・Google Cloud・課金経路は使わない。データはこのブラウザのlocalStorageだけに保存。</div>'+
      '</section>'+
      '<section class="card seo-kpi"><div class="label">INDEX STATUS</div><div class="value">'+indexedCount+'/'+KEY_PAGES.length+'</div><div class="delta">手動URL検査の記録</div></section>'+
      '<section class="card seo-kpi"><div class="label">SEO IMPRESSIONS</div><div class="value">'+n(seoSummary.impressions)+'</div>'+(prevSeo?delta(seoSummary.impressions,prevSeo.summary.impressions):'<div class="delta">baseline待ち</div>')+'</section>'+
      '<section class="card seo-kpi"><div class="label">SEO CLICKS</div><div class="value">'+n(seoSummary.clicks)+'</div>'+(prevSeo?delta(seoSummary.clicks,prevSeo.summary.clicks):'<div class="delta">baseline待ち</div>')+'</section>'+
      '<section class="card seo-kpi"><div class="label">SEO CTR</div><div class="value">'+Number(seoSummary.ctr||0).toFixed(1)+'%</div><div class="delta">date CSV基準</div></section>'+
      '<section class="card seo-kpi"><div class="label">AVG POSITION</div><div class="value">'+(seoSummary.position?Number(seoSummary.position).toFixed(1):"—")+'</div><div class="delta">date CSVのimp加重</div></section>'+
      '<section class="card seo-kpi"><div class="label">GOOGLE AI IMP</div><div class="value">'+n(geoSummary.impressions)+'</div>'+(prevGeo?delta(geoSummary.impressions,prevGeo.summary.impressions):'<div class="delta">baseline待ち</div>')+'</section>'+
      '<section class="card health diagnostic"><div class="label">DISCOVERY HEALTH</div><div class="value" style="font-size:22px">'+esc(diagnosis.label)+'</div><div class="delta">'+esc(diagnosis.detail)+'</div></section>'+
      '<section class="card chart-card"><div class="section-head"><div class="section-title">SEO VISIBILITY TREND</div><span>imported CSV</span></div>'+discoveryTrend(latestSeo)+'</section>'+
      (latestGeo?'<section class="card chart-card"><div class="section-head"><div class="section-title">GOOGLE AI VISIBILITY TREND</div><span>imported CSV</span></div>'+discoveryTrend(latestGeo)+'</section>':'')+
      discoveryTopRows(latestSeo)+
      discoveryTopRows(latestGeo)+
      '<section class="card index-table"><div class="section-head"><div class="section-title">INDEX STATUS / MANUAL</div><span>Search Console URL検査の結果だけ記録</span></div><table><thead><tr><th>PAGE</th><th>STATUS</th><th>CHECKED</th></tr></thead><tbody>'+indexRows+'</tbody></table></section>'+
      '<section class="card inbox"><div class="section-head"><div class="section-title">IMPORT HISTORY</div><button id="clearDiscovery" type="button">CLEAR</button></div><div class="snapshot-list">'+(historyHtml||'<div class="muted">まだImportなし。</div>')+'</div></section>'+
    '</div></div></details>';
  bindDiscoveryInbox();
}
function bindDiscoveryInbox(){
  const importBtn=document.getElementById("importDiscovery");
  if(importBtn)importBtn.addEventListener("click",async()=>{
    const input=document.getElementById("discoveryFiles");
    const kind=document.getElementById("discoveryKind")?.value||"seo";
    const files=[...(input?.files||[])];
    if(!files.length){alert("CSVを選んでください");return;}
    try{
      const normalized=[];
      for(const file of files){
        if(!file.name.toLowerCase().endsWith(".csv"))continue;
        normalized.push(normalizeCsvFile(file.name,await file.text()));
      }
      if(!normalized.length)throw new Error("CSVを読めませんでした");
      const snapshot={kind,importedAt:new Date().toISOString(),files:normalized,summary:snapshotSummary(normalized,kind)};
      const items=getDiscoverySnapshots();items.push(snapshot);saveDiscoverySnapshots(items);
      renderDiscoveryInbox();
    }catch(err){alert("Import失敗: "+err.message);}
  });
  document.querySelectorAll("[data-index-path]").forEach(select=>select.addEventListener("change",()=>{
    const state=getIndexStatus();
    state[select.dataset.indexPath]={status:select.value,checkedAt:new Date().toLocaleDateString("ja-JP")};
    saveIndexStatus(state);renderDiscoveryInbox();
  }));
  const clear=document.getElementById("clearDiscovery");
  if(clear)clear.addEventListener("click",()=>{
    if(confirm("SEO/GEO Import履歴をこのブラウザから消しますか？")){
      localStorage.removeItem(DISCOVERY_KEY);renderDiscoveryInbox();
    }
  });
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
document.getElementById("aiShare").addEventListener("click",async()=>{
  const button=document.getElementById("aiShare");
  const original=button.textContent;
  button.disabled=true;
  button.textContent="WAIT";
  try{
    const linkResponse=await fetch("/api/ai-share-link?window="+encodeURIComponent(windowKey)+"&ttl=604800",{cache:"no-store"});
    const linkData=await linkResponse.json();
    if(!linkResponse.ok||linkData.error)throw new Error(linkData.error||("HTTP "+linkResponse.status));

    const exportResponse=await fetch(linkData.url,{cache:"no-store"});
    const exportData=await exportResponse.json();
    if(!exportResponse.ok||exportData.error)throw new Error(exportData.error||("HTTP "+exportResponse.status));

    const payload=JSON.stringify(exportData);
    try{
      await navigator.clipboard.writeText(payload);
      button.textContent="COPIED";
    }catch{
      window.prompt("Copy analytics JSON",payload);
      button.textContent="READY";
    }
    setTimeout(()=>{button.textContent=original;button.disabled=false;},1800);
  }catch(error){
    button.textContent="ERROR";
    alert("AI COPY: "+error.message);
    setTimeout(()=>{button.textContent=original;button.disabled=false;},1800);
  }
});
document.getElementById("refresh").addEventListener("click",()=>{load();renderDiscoveryInbox();});
renderDiscoveryInbox();
load();
</script>
</body>
</html>`;
