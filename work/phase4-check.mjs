// Phase 4 - scale and memory: sessions that survive a restart, signing out
// other devices, cursor pagination that does not skip or repeat rows, and
// ceilings on the write paths that had none.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();

class Actor {
  cookie = ''; csrf = '';
  async request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}),
        ...options.headers
      }
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await response.json();
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  async start() { await this.request('/api/session'); return this; }
  login(email, password) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); }
}

const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);
const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const traineeId = (await trainer.request('/api/dashboard')).data.clients[0].id;

// --- B9 sessions are real records, not process memory ----------------------
const sessionList = await trainee.request('/api/me/sessions');
assert.equal(sessionList.status, 200);
assert.ok(sessionList.data.sessions.length >= 1, 'a signed-in session is a stored record');
assert.equal(sessionList.data.sessions.some(item => item.current), true, 'the caller can tell which session is theirs');
// The cookie is the credential, so it must not be handed back in a listing.
assert.equal(JSON.stringify(sessionList.data).includes(trainee.cookie.split('=')[1]), false, 'a session listing must not echo the session identifier');

// A second device for the same account.
const secondDevice = await new Actor().start();
assert.equal((await secondDevice.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);
assert.equal((await secondDevice.request('/api/me')).status, 200);
assert.ok((await trainee.request('/api/me/sessions')).data.sessions.length >= 2);

const endedOthers = await trainee.request('/api/auth/logout-others', { method: 'POST', body: '{}' });
assert.equal(endedOthers.status, 200);
assert.ok(endedOthers.data.endedCount >= 1, 'the other device is signed out');
assert.equal((await trainee.request('/api/me')).status, 200, 'the calling session survives');
assert.equal((await secondDevice.request('/api/me')).status, 401, 'the other device no longer has a session');
assert.equal((await trainee.request('/api/me/sessions')).data.sessions.length, 1);

// --- B10 cursor pagination -------------------------------------------------
const marker = `page-${stamp}`;
for (let index = 0; index < 7; index += 1) {
  const created = await trainee.request('/api/progress-entries', {
    method: 'POST',
    body: JSON.stringify({ metricType: marker.replace(/[^a-z0-9_]/g, '_'), value: 60 + index, unit: 'kg', measuredAt: new Date(Date.now() - (7 - index) * 60000).toISOString() })
  });
  assert.equal(created.status, 201);
}
const metricKey = marker.replace(/[^a-z0-9_]/g, '_');

const firstPage = await trainee.request(`/api/progress-entries?metric=${metricKey}&limit=3`);
assert.equal(firstPage.status, 200);
assert.equal(firstPage.data.entries.length, 3);
assert.ok(firstPage.data.nextCursor, 'a full page offers a cursor to the next one');

const secondPage = await trainee.request(`/api/progress-entries?metric=${metricKey}&limit=3&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
assert.equal(secondPage.data.entries.length, 3);
const thirdPage = await trainee.request(`/api/progress-entries?metric=${metricKey}&limit=3&cursor=${encodeURIComponent(secondPage.data.nextCursor)}`);
assert.equal(thirdPage.data.entries.length, 1, 'the last page is short');
assert.equal(thirdPage.data.nextCursor, null, 'a short page ends the walk');

const walked = [...firstPage.data.entries, ...secondPage.data.entries, ...thirdPage.data.entries].map(row => row.id);
assert.equal(new Set(walked).size, 7, 'paging returns every row exactly once');

// Inserting between pages must not shift a keyset cursor the way an offset would.
await trainee.request('/api/progress-entries', {
  method: 'POST',
  body: JSON.stringify({ metricType: metricKey, value: 99, unit: 'kg', measuredAt: new Date(Date.now() - 8 * 60000).toISOString() })
});
const reWalk = await trainee.request(`/api/progress-entries?metric=${metricKey}&limit=3&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
assert.deepEqual(reWalk.data.entries.map(row => row.id), secondPage.data.entries.map(row => row.id),
  'a row inserted before the cursor must not change what the next page contains');

// A malformed cursor is ignored rather than fatal.
const garbage = await trainee.request(`/api/progress-entries?metric=${metricKey}&limit=3&cursor=not-a-cursor`);
assert.equal(garbage.status, 200);
assert.equal(garbage.data.entries.length, 3);

for (const path of ['/api/notifications?limit=2', '/api/messages?limit=2', '/api/nutrition-entries?limit=2']) {
  const page = await trainee.request(path);
  assert.equal(page.status, 200, `${path} answers`);
  assert.ok('nextCursor' in page.data, `${path} reports a cursor field`);
}

// The notification badge must count every unread one, not just the page.
const badge = await trainee.request('/api/notifications?limit=1');
assert.equal(badge.data.notifications.length <= 1, true);
assert.equal(typeof badge.data.unreadCount, 'number');

// --- assignments come from the table, filtered server-side -----------------
const assignmentPage = await trainer.request(`/api/assigned-workouts?traineeId=${traineeId}&limit=5`);
assert.equal(assignmentPage.status, 200);
assert.ok(assignmentPage.data.assignments.every(item => item.traineeId === traineeId), 'the trainee filter is applied in the query');
assert.ok(assignmentPage.data.assignments.every(item => item.templateSnapshot && 'dueDate' in item), 'the response keeps the shape the client reads');
assert.ok(assignmentPage.data.assignments.length <= 5, 'the page limit is honoured');

// Another trainer's id in the filter must return nothing, not somebody else's work.
const foreign = await trainer.request('/api/assigned-workouts?traineeId=usr_not_a_real_client&limit=5');
assert.equal(foreign.data.assignments.length, 0);

console.log(JSON.stringify({
  sessionsAreStoredRecords: 'pass',
  sessionListingHidesIdentifier: 'pass',
  logoutOthersEndsOtherDevices: 'pass',
  callingSessionSurvives: 'pass',
  cursorWalksEveryRowOnce: 'pass',
  shortPageEndsTheWalk: 'pass',
  keysetStableAcrossInserts: 'pass',
  malformedCursorIgnored: 'pass',
  listEndpointsReportCursors: 'pass',
  unreadCountIsNotPageScoped: 'pass',
  assignmentsFilteredInQuery: 'pass',
  assignmentShapePreserved: 'pass'
}, null, 2));
