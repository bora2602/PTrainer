// Two unrelated accounts, each trying to reach the other's records by ID.
// Guessing an identifier must not be enough to read or change anything.
const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
const notice = (await (await fetch(`${base}/api/privacy`)).json()).noticeVersion;

async function signUp(role) {
  const start = await fetch(`${base}/api/session`);
  let cookie = (start.headers.get('set-cookie') || '').split(';')[0];
  let { csrfToken } = await start.json();
  const email = `probe_${role}_${stamp}_${Math.random().toString(36).slice(2, 8)}@ptrainer.local`;
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Probe ${role}`, email, password: 'ProbeAccount1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
  });
  if (response.status === 429) {
    console.error('This check needs to register two accounts, and the registration rate');
    console.error('limit is already spent for this address. The buckets are in memory, so');
    console.error('`docker compose restart app` clears them; then run this again.');
    process.exit(2);
  }
  if (!response.ok) throw new Error(`register failed ${response.status}: ${(await response.text()).slice(0, 120)}`);
  cookie = (response.headers.get('set-cookie') || '').split(';')[0] || cookie;
  csrfToken = (await response.json()).csrfToken;
  const call = (method, path, body) => fetch(base + path, {
    method,
    // Content-Type is always sent so a rejection comes from the authorization
    // check rather than from the content-type guard running first.
    headers: { cookie, 'X-CSRF-Token': csrfToken, ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}')
  });
  return { email, call };
}

const alice = await signUp('TRAINEE');
const mallory = await signUp('TRAINEE');

const created = await alice.call('POST', '/api/nutrition-entries', {
  entryDate: new Date().toISOString().slice(0, 10),
  entryType: 'BREAKFAST',
  description: 'private entry belonging to the first account',
  calories: 420
});
if (!created.ok) throw new Error(`setup failed ${created.status}: ${(await created.text()).slice(0, 160)}`);
const entry = (await created.json()).entry;
const entryId = entry?.id;
if (!entryId) throw new Error('no entry id returned');

const failures = [];
const report = [];

function check(label, status, body) {
  const blocked = status !== 200 && status !== 201 && status !== 204;
  report.push(`${blocked ? 'blocked' : 'LEAK   '} ${String(status).padEnd(4)} ${label}`);
  if (!blocked) failures.push(`${label} succeeded (${status}) ${String(body).slice(0, 90)}`);
}

// Mallory should not see, edit, or delete Alice's entry.
const read = await mallory.call('GET', '/api/nutrition-entries');
const readBody = await read.text();
report.push(`${readBody.includes(entryId) ? 'LEAK   ' : 'blocked'} ${read.status}    list does not contain the other account's entry`);
if (readBody.includes(entryId)) failures.push('nutrition list exposed another account entry');

const patched = await mallory.call('PATCH', `/api/nutrition-entries/${entryId}`, {
  entryDate: new Date().toISOString().slice(0, 10), entryType: 'DINNER', description: 'tampered by an intruder'
});
check(`PATCH /api/nutrition-entries/{other account id}`, patched.status, await patched.text());

const deleted = await mallory.call('DELETE', `/api/nutrition-entries/${entryId}`);
check(`DELETE /api/nutrition-entries/{other account id}`, deleted.status, await deleted.text());

// Identifiers from other areas should be equally useless.
const workout = await mallory.call('GET', '/api/assigned-workouts/assigned_demo_1');
check('GET /api/assigned-workouts/assigned_demo_1 (seeded, not theirs)', workout.status, await workout.text());

const relationship = await mallory.call('DELETE', '/api/relationships/usr_someone/usr_else');
check('DELETE /api/relationships/{ids they do not own}', relationship.status, await relationship.text());

// The entry must still be intact and unchanged afterwards.
const after = await alice.call('GET', '/api/nutrition-entries');
const stillThere = (await after.text()).includes('private entry belonging to the first account');
report.push(`${stillThere ? 'intact ' : 'LOST   '} --   original entry survived the tampering attempts`);
if (!stillThere) failures.push('the original entry was modified or deleted by the other account');

console.log(report.join('\n'));
if (failures.length) {
  console.error(`\nFAILED - ${failures.length} problem(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nPASSED - one account cannot reach another account records by ID');
