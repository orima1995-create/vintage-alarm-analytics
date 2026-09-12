import profileWorker, { buildFreshness, patchAnalyticsPayload, patchDashboardHtml, X_PROFILE_TRACKING } from './profile-worker.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const payload = patchAnalyticsPayload({
  generatedAt: '2026-09-12T05:50:00.000Z',
  trendBucket: 'datetimeFiveMinutes',
  trend: [
    { bucket: '2026-09-12T05:35:00.000Z', pageviews: 2, visits: 1 },
    { bucket: '2026-09-12T05:40:00.000Z', pageviews: 0, visits: 0 },
  ],
  current: {
    pages: [{ path: '/x/', name: '/x/', mapped: false, pageviews: 3, visits: 2 }],
    flows: [{ sourcePath: '', sourceCleanPath: '', destinationPath: '/x/', destinationName: '/x/', destinationMapped: false, visits: 2, pageviews: 3 }],
  },
  previous: { pages: [] },
  legacy: { current: { pages: [] }, previous: { pages: [] } },
  combined: {
    current: { pages: [{ path: '/x/', name: '/x/', mapped: false, pageviews: 3, visits: 2 }] },
    previous: { pages: [] },
    trendBucket: 'datetimeFiveMinutes',
    trend: [
      { bucket: '2026-09-12T05:35:00.000Z', pageviews: 2, visits: 1 },
      { bucket: '2026-09-12T05:40:00.000Z', pageviews: 0, visits: 0 },
    ],
  },
});

assert(payload.profileTracking.path === '/x/', 'missing profileTracking metadata');
assert(payload.current.pages[0].name === 'X Profile', 'profile page name was not mapped');
assert(payload.current.pages[0].mapped === true, 'profile page must be mapped');
assert(payload.current.xProfileEntries === 2, 'profile entry count mismatch');
assert(payload.combined.current.xProfileEntries === 2, 'combined profile entry count mismatch');
assert(payload.current.flows[0].destinationName === 'X Profile', 'profile flow destination was not mapped');
assert(payload.freshness.queryOk === true, 'freshness query status missing');
assert(payload.freshness.latestEventBucket === '2026-09-12T05:35:00.000Z', 'latest event bucket mismatch');
assert(payload.freshness.bucketEnd === '2026-09-12T05:40:00.000Z', 'bucket end mismatch');
assert(payload.freshness.eventGapSeconds === 600, 'event gap mismatch');

const noEvent = buildFreshness({
  generatedAt: '2026-09-12T05:50:00.000Z',
  trendBucket: 'datetimeFifteenMinutes',
  trend: [{ bucket: '2026-09-12T05:30:00.000Z', pageviews: 0, visits: 0 }],
});
assert(noEvent.queryOk === true, 'zero-event query must still be marked successful');
assert(noEvent.latestEventBucket === null, 'zero-event window must not invent an event');

const fixture = [
  'const campaigns=getCampaigns();',
  'const platform=item.migration?"MIGRATION":item.platform==="YouTube"?"YOUTUBE":"X";',
  'const platform=item.platform==="YouTube"?"YouTube":"X";',
  'const color=item.migration?"#706d67":platform==="YouTube"?COLORS.YouTube:COLORS.X;',
  'eventIndex(campaigns)+',
  'document.getElementById("updated").textContent=\'更新 \'+new Date(data.generatedAt).toLocaleString("ja-JP");'
].join('\n');
const patchedHtml = patchDashboardHtml(fixture);
assert(patchedHtml.includes('Xプロフィール専用URL発行'), 'system timeline event was not injected');
assert(patchedHtml.includes('X PROFILE ENTRY'), 'profile KPI was not injected');
assert(patchedHtml.includes('X Profile'), 'profile event platform was not injected');
assert(patchedHtml.includes('QUERY OK'), 'freshness query status was not injected');
assert(patchedHtml.includes('EVENT GAP'), 'event-gap display was not injected');
assert(X_PROFILE_TRACKING.url === 'https://vintagealarm.github.io/x/', 'profile URL changed unexpectedly');

const auth = `Basic ${Buffer.from('admin:test-password').toString('base64')}`;
const dashboardResponse = await profileWorker.fetch(
  new Request('https://dashboard.example/', { headers: { Authorization: auth } }),
  { DASHBOARD_PASSWORD: 'test-password' },
  {},
);
assert(dashboardResponse.ok, 'wrapped dashboard did not render');
const dashboardHtml = await dashboardResponse.text();
assert(dashboardHtml.includes('X PROFILE ENTRY'), 'real dashboard HTML is missing profile KPI');
assert(dashboardHtml.includes('Xプロフィール専用URL発行'), 'real dashboard HTML is missing profile system event');
assert(dashboardHtml.includes('item.platform==="X Profile"'), 'real dashboard HTML is missing X Profile marker handling');
assert(dashboardHtml.includes('QUERY OK'), 'real dashboard HTML is missing query freshness status');
assert(dashboardHtml.includes('EVENT GAP'), 'real dashboard HTML is missing event-gap status');

console.log('X profile attribution + analytics freshness wrapper: OK');
