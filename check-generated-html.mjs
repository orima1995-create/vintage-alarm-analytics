import vm from "node:vm";
import worker, { aggregateSnsEntries, campaignWindow, campaignSummary, mergePeriodData, mergeTrendPoints, parseYouTubeVideoUrl, splitPeriod } from "./worker.js";
import assert from "node:assert/strict";

const start = '2026-09-08T00:00:00Z';
const partial = campaignWindow(start, 24, Date.parse(start) + 3600000);
assert.equal(partial.complete, false);
assert.equal(partial.elapsedHours, 1);
assert.equal(Date.parse(partial.start) - Date.parse(partial.beforeStart), Date.parse(partial.end) - Date.parse(partial.start));
assert.equal(campaignWindow(start, 24, Date.parse(start) + 48 * 3600000).elapsedHours, 24);
assert.throws(() => campaignWindow(start, 2));
assert.throws(() => campaignWindow('invalid', 24));
assert.throws(() => campaignWindow(start, 24, Date.parse(start) - 1));
const shorts = parseYouTubeVideoUrl("https://youtube.com/shorts/MWoqA4L2wdM?si=test");
assert.equal(shorts.videoId, "MWoqA4L2wdM");
assert.equal(shorts.kind, "shorts");
assert.equal(shorts.canonicalUrl, "https://www.youtube.com/shorts/MWoqA4L2wdM");
const shortLink = parseYouTubeVideoUrl("https://youtu.be/MWoqA4L2wdM?si=test");
assert.equal(shortLink.videoId, "MWoqA4L2wdM");
assert.equal(shortLink.kind, "video");
assert.equal(shortLink.canonicalUrl, "https://www.youtube.com/watch?v=MWoqA4L2wdM");
const watchLink = parseYouTubeVideoUrl("https://www.youtube.com/watch?v=MWoqA4L2wdM&feature=share");
assert.equal(watchLink.videoId, "MWoqA4L2wdM");
assert.throws(() => parseYouTubeVideoUrl("https://example.com/watch?v=MWoqA4L2wdM"));
const flow = (destination, source, count) => ({ count, dimensions: { requestPath: destination, refererHost: 'vintagealarm.github.io', refererPath: source }, sum: { visits: 0 } });
const summary = campaignSummary({ viewer: { accounts: [{ entries: [], flows: [flow('/cyma-time-o-vox/', '/cyma-time-o-vox/', 9), flow('/pierce-duofon/', '/cyma-time-o-vox/', 2)] }] } }, '/cyma-time-o-vox/');
assert.equal(summary.nextPages, 2);
assert.equal(summary.xEntries, 0);
const platformData = { viewer: { accounts: [{ entries: [
  { dimensions: { requestPath: "/basis-alarm/", refererHost: "youtube.com" }, sum: { visits: 3 } },
  { dimensions: { requestPath: "/basis-alarm/", refererHost: "t.co" }, sum: { visits: 2 } },
], flows: [] }] } };
const youtubeSummary = campaignSummary(platformData, "/basis-alarm/", "YouTube");
assert.equal(youtubeSummary.platformEntries, 3);
assert.equal(youtubeSummary.youtubeEntries, 3);
assert.equal(youtubeSummary.xEntries, 0);
assert.equal(youtubeSummary.targetEntries, 3);
const xSummary = campaignSummary(platformData, "/basis-alarm/", "X");
assert.equal(xSummary.platformEntries, 2);
assert.equal(xSummary.xEntries, 2);
assert.equal(xSummary.youtubeEntries, 0);
assert.throws(() => campaignSummary({}, '/'));

const entry = (requestPath, refererHost, visits) => ({ dimensions: { requestPath, refererHost }, sum: { visits } });
const aggregated = aggregateSnsEntries([
  entry("/orima1995-creator.github.io/cyma-time-o-vox/", "t.co", 4),
  entry("/cyma-time-o-vox", "x.com", 1),
  entry("/pierce-duofon/", "m.facebook.com", 2),
  entry("/pierce-duofon/", "m.facebook.com", 2),
  entry("/pierce-duofon/", "instagram.com", 2),
  entry("/unknown/", "t.co", 1),
  entry("/basis-alarm/", "google.com", 9),
  entry("/basis-alarm/", "", 8),
  entry("/basis-alarm/", "vintagealarm.github.io", 7),
]);
assert.equal(aggregated.total, 12);
assert.deepEqual(aggregated.pages.map(p => p.total), [5, 6, 0, 1]);
assert.equal(aggregated.pages[1].values.Facebook, 4);
assert.equal(aggregateSnsEntries([]).total, 0);
assert.equal(aggregateSnsEntries([]).complete, true);
assert.equal(aggregateSnsEntries(undefined).complete, false);
assert.equal(aggregateSnsEntries(Array.from({ length: 1000 }, () => entry("/", "t.co", 1))).complete, false);

const thirtyDayRanges = splitPeriod("2026-08-11T12:00:00Z", "2026-09-10T12:00:00Z");
assert.equal(thirtyDayRanges.length, 5);
assert.equal(thirtyDayRanges[0].start.toISOString(), "2026-08-11T12:00:00.000Z");
assert.equal(thirtyDayRanges.at(-1).end.toISOString(), "2026-09-10T12:00:00.000Z");
assert.ok(thirtyDayRanges.every((range, index) =>
  range.end - range.start <= 7 * 24 * 60 * 60 * 1000 &&
  (!index || range.start.getTime() === thirtyDayRanges[index - 1].end.getTime())
));
const periodPart = (count, visits, path) => ({ viewer: { accounts: [{
  total: [{ count, sum: { visits } }],
  pages: [{ count, sum: { visits }, dimensions: { requestPath: path } }],
  referers: [], flows: [], entries: [], countries: [], devices: [],
}] } });
const mergedPeriod = mergePeriodData([periodPart(20, 20, "/"), periodPart(6, 6, "/")]);
assert.equal(mergedPeriod.viewer.accounts[0].total[0].count, 26);
assert.equal(mergedPeriod.viewer.accounts[0].total[0].sum.visits, 26);
assert.equal(mergedPeriod.viewer.accounts[0].pages[0].count, 26);
const mergedTrend = mergeTrendPoints([
  [{ bucket: "2026-09-09", pageviews: 20, visits: 20, x: 0 }],
  [{ bucket: "2026-09-09", pageviews: 2, visits: 2, x: 1 }, { bucket: "2026-09-10", pageviews: 4, visits: 4, x: 1 }],
]);
assert.deepEqual(mergedTrend.map(point => [point.bucket, point.pageviews, point.visits, point.x]), [
  ["2026-09-09", 22, 22, 1],
  ["2026-09-10", 4, 4, 1],
]);

const apiPassword = "api-test-password";
const apiAuth = Buffer.from(`admin:${apiPassword}`).toString("base64");
const queriedHosts = [];
const fakeAnalyticsFetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  const host = request.variables.filter.AND.find(part => part.requestHost)?.requestHost;
  queriedHosts.push(host);
  const value = host === "vintagealarm.github.io" ? 5 : 9;
  const account = request.query.includes("VintageAlarmTrend")
    ? { totals: [{ count: value, sum: { visits: value }, dimensions: { bucket: "2026-09-10" } }], acquisition: [] }
    : {
        total: [{ count: value, sum: { visits: value } }],
        pages: [{ count: value, sum: { visits: value }, dimensions: { requestPath: "/" } }],
        referers: [], flows: [], entries: [], countries: [], devices: [],
      };
  return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), {
    headers: { "Content-Type": "application/json" },
  });
};
const analyticsApiResponse = await worker.fetch(
  new Request("https://dashboard.test/api/analytics?window=7d", { headers: { Authorization: `Basic ${apiAuth}` } }),
  {
    DASHBOARD_PASSWORD: apiPassword,
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    REQUEST_HOST: "vintagealarm.github.io",
    LEGACY_REQUEST_HOST: "orima1995-create.github.io",
    ANALYTICS_FETCH: fakeAnalyticsFetch,
  },
);
assert.equal(analyticsApiResponse.status, 200);
const analyticsPayload = await analyticsApiResponse.json();
assert.equal(analyticsPayload.host, "vintagealarm.github.io");
assert.equal(analyticsPayload.current.visits, 5);
assert.equal(analyticsPayload.legacy.host, "orima1995-create.github.io");
assert.equal(analyticsPayload.legacy.current.visits, 9);
assert.equal(queriedHosts.filter(host => host === "vintagealarm.github.io").length, 3);
assert.equal(queriedHosts.filter(host => host === "orima1995-create.github.io").length, 3);

const password = "ci-test-password";
const auth = Buffer.from(`admin:${password}`).toString("base64");
const response = await worker.fetch(
  new Request("https://dashboard.test/", {
    headers: { Authorization: `Basic ${auth}` },
  }),
  { DASHBOARD_PASSWORD: password },
);

if (!response.ok) {
  throw new Error(`Dashboard HTML request failed: HTTP ${response.status}`);
}

const html = await response.text();
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());

if (!scripts.length) {
  throw new Error("No inline dashboard script found in generated HTML.");
}

scripts.forEach((script, index) => {
  try {
    new vm.Script(script, { filename: `dashboard-inline-${index + 1}.js` });
  } catch (error) {
    console.error(`Generated dashboard script ${index + 1} is invalid.`);
    throw error;
  }
});

const dashboardScript = scripts.join("\n");
// Exercise the actual generated chart function without the dashboard's DOM boot.
const chartSource = dashboardScript.slice(dashboardScript.indexOf('const HOST_MIGRATION ='), dashboardScript.indexOf('function entryBars('));
assert.ok(chartSource.includes('function lineChart('));
const chartContext = vm.createContext({
  window: { __vaWindowStart: '2026-09-03T00:00:00Z', __vaWindowEnd: '2026-09-10T14:00:00Z' },
  bucketTime: v => Date.parse(v), bucketLabel: v => v, esc: v => String(v),
  COLORS: { X: '#111', YouTube: '#f00' }
});
vm.runInContext(chartSource, chartContext);
const chart = vm.runInContext('lineChart', chartContext);
const points = [{ bucket: '2026-09-03T00:00:00Z', visits: 1 }, { bucket: '2026-09-10T00:00:00Z', visits: 2 }];
const series = [{ key: 'visits', label: 'Visits', color: '#111' }];
const campaigns = [{ linkAddedAt: '2026-09-09T16:00:00Z', platform: 'YouTube', label: 'VIDEO' }, { linkAddedAt: '2026-09-09T17:00:00Z', platform: 'X', label: 'POST' }];
const marked = chart(points, series, campaigns, true);
assert.ok(marked.includes('HOST MIGRATION'));
assert.ok(marked.includes('YT · VIDEO'));
assert.ok(marked.includes('X · POST'));
const markerLabels = [...marked.matchAll(/<text data-event-marker="label"[^>]*y="([^"]+)"[^>]*text-anchor="([^"]+)"/g)];
assert.equal(markerLabels.length, 3);
assert.equal(new Set(markerLabels.map(match => match[1])).size, 3);
assert.ok(markerLabels.every(match => match[2] === "end"));
assert.equal(campaigns.length, 2); // Fixed events must never enter saved campaign records.
assert.ok(!chart(points, series, campaigns).includes('HOST MIGRATION')); // Discovery charts are separate.
chartContext.window.__vaWindowStart = '2026-09-11T00:00:00Z';
chartContext.window.__vaWindowEnd = '2026-09-12T00:00:00Z';
assert.ok(!chart(points, series, [], true).includes('HOST MIGRATION'));
assert.ok(chart([], series, [], true).includes('時系列データなし'));
const requiredFragments = [
  "/^\\d{4}-\\d{2}-\\d{2}$/",
  "/\\s+/g",
  "/[\\s_\\-（）()％%]/g",
  "/^\\uFEFF/",
  'ch==="\\n"',
  'ch!=="\\r"',
];

for (const fragment of requiredFragments) {
  if (!dashboardScript.includes(fragment)) {
    throw new Error(`Generated dashboard script lost required escape sequence: ${fragment}`);
  }
}

const contentIndex = html.indexOf('<div id="content"></div>');
const discoveryIndex = html.indexOf('<div id="discovery"></div>');
if (contentIndex < 0 || discoveryIndex < 0 || contentIndex > discoveryIndex) {
  throw new Error("Analytics content must render before discovery tools.");
}

const requiredLayoutFragments = [
  'class="card primary-chart"',
  'class="card summary-chart"',
  'class="card drawer campaign"',
  'class="card drawer raw"',
  'class="discovery-shell"',
  '["Basis Alarm","Pierce Duofon","Cyma Time-O-Vox"]',
  '{name:"Basis Alarm",path:"/basis-alarm/"}',
  'option value="YouTube"',
  '"/api/youtube-preview"',
  'key:"youtube",label:"YouTube"',
  'HOST SCOPE · SEPARATE MEASUREMENT',
  'HOST TRANSITION · VISITS',
  'LEGACY HOST DETAILS',
  'function hostTrendPoints(',
];

for (const fragment of requiredLayoutFragments) {
  if (!html.includes(fragment)) {
    throw new Error(`Generated dashboard HTML lost required layout fragment: ${fragment}`);
  }
}

console.log(`Generated dashboard JavaScript OK (${scripts.length} inline script(s)).`);
