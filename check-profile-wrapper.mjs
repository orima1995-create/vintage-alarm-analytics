import profileWorker, { patchAnalyticsPayload, patchDashboardHtml, X_PROFILE_TRACKING } from './profile-worker.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const payload = patchAnalyticsPayload({
  current: {
    pages: [{ path: '/x/', name: '/x/', mapped: false, pageviews: 3, visits: 2 }],
    flows: [{ sourcePath: '', sourceCleanPath: '', destinationPath: '/x/', destinationName: '/x/', destinationMapped: false, visits: 2, pageviews: 3 }],
  },
  previous: { pages: [] },
  legacy: { current: { pages: [] }, previous: { pages: [] } },
  combined: { current: { pages: [{ path: '/x/', name: '/x/', mapped: false, pageviews: 3, visits: 2 }] }, previous: { pages: [] } },
});

assert(payload.profileTracking.path === '/x/', 'missing profileTracking metadata');
assert(payload.current.pages[0].name === 'X Profile', 'profile page name was not mapped');
assert(payload.current.pages[0].mapped === true, 'profile page must be mapped');
assert(payload.current.xProfileEntries === 2, 'profile entry count mismatch');
assert(payload.combined.current.xProfileEntries === 2, 'combined profile entry count mismatch');
assert(payload.current.flows[0].destinationName === 'X Profile', 'profile flow destination was not mapped');

const fixture = [
  'const campaigns=getCampaigns();',
  'const platform=item.migration?"MIGRATION":item.platform==="YouTube"?"YOUTUBE":"X";',
  'const platform=item.platform==="YouTube"?"YouTube":"X";',
  'const color=item.migration?"#706d67":platform==="YouTube"?COLORS.YouTube:COLORS.X;',
  'eventIndex(campaigns)+'
].join('\n');
const patchedHtml = patchDashboardHtml(fixture);
assert(patchedHtml.includes('Xプロフィール専用URL発行'), 'system timeline event was not injected');
assert(patchedHtml.includes('X PROFILE ENTRY'), 'profile KPI was not injected');
assert(patchedHtml.includes('X Profile'), 'profile event platform was not injected');
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

console.log('X profile attribution wrapper: OK');
