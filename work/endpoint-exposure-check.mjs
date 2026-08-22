// Probes every endpoint without signing in and fails if any of them answers
// with data. CSRF tokens are supplied deliberately, so a rejection proves the
// authentication check did the work rather than the CSRF check masking it.
const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';

const PUBLIC = [
  ['GET', '/healthz'], ['GET', '/readyz'],
  ['GET', '/api/session'], ['GET', '/api/privacy']
];

// Reachable without a session on purpose; they must not leak account data.
const AUTH_ENDPOINTS = [
  ['POST', '/api/auth/login'], ['POST', '/api/auth/register'],
  ['POST', '/api/auth/forgot-password'], ['POST', '/api/auth/reset-password']
];

const PROTECTED = [
  ['GET', '/api/me'], ['PATCH', '/api/me/profile'], ['GET', '/api/me/export'],
  ['GET', '/api/me/audit-events'], ['POST', '/api/me/privacy'], ['DELETE', '/api/me/account'],
  ['GET', '/api/dashboard'], ['GET', '/api/exercises'],
  ['GET', '/api/relationships'], ['POST', '/api/invitations'], ['GET', '/api/invitations'],
  ['GET', '/api/workout-templates'], ['POST', '/api/workout-templates'],
  ['GET', '/api/assigned-workouts'], ['POST', '/api/assigned-workouts'],
  ['POST', '/api/assigned-workouts/custom'],
  ['GET', '/api/progress-entries'], ['POST', '/api/progress-entries'],
  ['GET', '/api/nutrition-entries'], ['POST', '/api/nutrition-entries'],
  ['GET', '/api/nutrition-target'], ['POST', '/api/nutrition-target'],
  ['GET', '/api/food-products/3017624010701'],
  ['GET', '/api/messages'], ['POST', '/api/messages'],
  ['GET', '/api/notifications'],
  ['GET', '/api/subscription'], ['POST', '/api/billing/test-checkout']
];

const anon = await fetch(`${base}/api/session`);
const cookie = (anon.headers.get('set-cookie') || '').split(';')[0];
const { csrfToken } = await anon.json();

async function probe(method, path, extraHeaders = {}) {
  const headers = { cookie, 'X-CSRF-Token': csrfToken, ...extraHeaders };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers, body: method === 'GET' ? undefined : '{}'
  });
  return { status: response.status, body: (await response.text()).slice(0, 90) };
}

const leaks = [];
const rows = [];

for (const [method, path] of PROTECTED) {
  const { status, body } = await probe(method, path);
  const blocked = status !== 200 && status !== 201;
  rows.push(`${blocked ? 'blocked' : 'LEAK   '} ${String(status).padEnd(4)} ${method.padEnd(6)} ${path}`);
  if (!blocked) leaks.push(`${method} ${path} returned ${status}: ${body}`);
}

for (const [method, path] of PUBLIC) {
  const { status } = await probe(method, path);
  rows.push(`public  ${String(status).padEnd(4)} ${method.padEnd(6)} ${path}`);
}

for (const [method, path] of AUTH_ENDPOINTS) {
  const { status, body } = await probe(method, path);
  const safe = status !== 200 || !/"user"/.test(body);
  rows.push(`${safe ? 'auth-ok' : 'LEAK   '} ${String(status).padEnd(4)} ${method.padEnd(6)} ${path}`);
  if (!safe) leaks.push(`${method} ${path} returned an account without credentials`);
}

// /metrics must stay closed to anything arriving through the tunnel.
const direct = await probe('GET', '/metrics');
const proxied = await probe('GET', '/metrics', { 'X-Forwarded-For': '203.0.113.9' });
const cfProxied = await probe('GET', '/metrics', { 'CF-Connecting-IP': '203.0.113.9' });
// Any non-200 means the payload was withheld. Run through Cloudflare, a
// client-supplied CF-Connecting-IP is refused by Cloudflare itself with a 403
// before it ever reaches the app, which is a stronger stop than our own 404.
const metricsBlocked = probe => probe.status !== 200;
rows.push(`direct  ${direct.status}  GET    /metrics (no forwarding headers)`);
rows.push(`${metricsBlocked(proxied) ? 'blocked' : 'LEAK   '} ${proxied.status}  GET    /metrics (X-Forwarded-For)`);
rows.push(`${metricsBlocked(cfProxied) ? 'blocked' : 'LEAK   '} ${cfProxied.status}  GET    /metrics (CF-Connecting-IP)`);
if (!metricsBlocked(proxied)) leaks.push('/metrics is readable through a proxy without a token');
if (!metricsBlocked(cfProxied)) leaks.push('/metrics is readable through Cloudflare without a token');

console.log(rows.join('\n'));
console.log(`\n${PROTECTED.length} protected endpoints probed without credentials`);
if (leaks.length) {
  console.error(`\nFAILED - ${leaks.length} exposed:\n${leaks.join('\n')}`);
  process.exit(1);
}
console.log('PASSED - nothing answered without authentication');
