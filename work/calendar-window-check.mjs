// The calendar reads assigned_workouts by a date window instead of by page, and
// a window is a request-supplied filter on somebody's coaching schedule. Two
// things have to hold: it must select the right days, and it must not widen who
// the caller can see. The denied cases below are the point of this file.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
const notice = (await (await fetch(`${base}/api/privacy`)).json()).noticeVersion;

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
  async register(role) {
    const email = `calendar_${role}_${stamp}_${Math.random().toString(36).slice(2, 8)}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Calendar ${role}`, email, password: 'ProbeAccount1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) {
      console.error('This check registers one account and the registration rate limit is');
      console.error('already spent. The buckets are in memory, so restarting the app clears');
      console.error('them; then run this again.');
      process.exit(2);
    }
    assert.equal(result.status, 201, `register failed: ${JSON.stringify(result.data).slice(0, 160)}`);
    return this;
  }
}

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);
const traineeId = (await trainer.request('/api/dashboard')).data.clients[0].id;

// --- setup: one dated workout, one with no date at all --------------------
// Dates well clear of today so a repeatedly-run suite cannot collide with the
// seeded demo assignment, and clear of a month boundary so "the month before"
// and "the month after" are unambiguous.
const template = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({ name: `Calendar probe ${stamp}`, exercises: [{ name: 'Back squat', sets: 3, reps: 5, restSeconds: 120 }] })
});
assert.equal(template.status, 201);
const templateId = template.data.template.id;

const dueDate = '2027-04-15';
const dated = await trainer.request('/api/assigned-workouts', {
  method: 'POST', body: JSON.stringify({ templateId, traineeId, startDate: dueDate })
});
assert.equal(dated.status, 201, JSON.stringify(dated.data).slice(0, 200));
const datedId = dated.data.assignment.id;

const undated = await trainer.request('/api/assigned-workouts', {
  method: 'POST', body: JSON.stringify({ templateId, traineeId })
});
assert.equal(undated.status, 201);
const undatedId = undated.data.assignment.id;

const idsIn = result => new Set(result.data.assignments.map(item => item.id));

// --- the window selects the right days ------------------------------------
const april = await trainee.request('/api/assigned-workouts?from=2027-04-01&to=2027-04-30');
assert.equal(april.status, 200);
assert.equal(idsIn(april).has(datedId), true, 'a workout due inside the window is returned');

// A DATE column reaches the client as YYYY-MM-DD text. If it arrives as a
// timestamp instead, every browser west of UTC files the workout a day early.
const returned = april.data.assignments.find(item => item.id === datedId);
assert.equal(returned.dueDate, dueDate, `dueDate must be a plain calendar date, got ${JSON.stringify(returned.dueDate)}`);

const march = await trainee.request('/api/assigned-workouts?from=2027-03-01&to=2027-03-31');
assert.equal(idsIn(march).has(datedId), false, 'a workout outside the window is not returned');

// A single-day window is the narrowest legitimate one.
const oneDay = await trainee.request(`/api/assigned-workouts?from=${dueDate}&to=${dueDate}`);
assert.equal(idsIn(oneDay).has(datedId), true, 'a one-day window still finds that day');

// Unscheduled work has no square to sit in, so it belongs to no window - but it
// must still be reachable when no window is asked for.
assert.equal(idsIn(april).has(undatedId), false, 'an undated workout is not in a date window');
const everything = await trainee.request('/api/assigned-workouts?limit=200');
assert.equal(idsIn(everything).has(undatedId), true, 'an undated workout is still listed without a window');

// --- a malformed window is refused, not silently ignored ------------------
for (const [label, queryString] of [
  ['a start with no end', 'from=2027-04-01'],
  ['an end with no start', 'to=2027-04-30'],
  ['end before start', 'from=2027-04-30&to=2027-04-01'],
  ['a date that does not exist', 'from=2027-02-30&to=2027-03-01'],
  ['a range longer than a year', 'from=2026-01-01&to=2027-06-01'],
  ['text where a date belongs', 'from=yesterday&to=tomorrow']
]) {
  const rejected = await trainee.request(`/api/assigned-workouts?${queryString}`);
  assert.equal(rejected.status, 422, `${label} must be refused, got ${rejected.status}`);
  assert.equal(rejected.data.error.code, 'DATE_WINDOW_INVALID');
}

// --- denied: the window must not widen who the caller can see -------------
// An unconnected trainer naming somebody else's trainee, inside a window that
// definitely contains that trainee's workout.
const outsider = await new Actor().start();
await outsider.register('TRAINER');
const stolen = await outsider.request(`/api/assigned-workouts?from=2027-04-01&to=2027-04-30&traineeId=${encodeURIComponent(traineeId)}`);
assert.equal(stolen.status, 200, 'the request is answered, but from the caller own rows');
assert.equal(stolen.data.assignments.length, 0, 'naming another coach client returns nothing');
assert.equal(JSON.stringify(stolen.data).includes(datedId), false, 'no identifier from the other relationship leaks');

// A trainee cannot read a window of anybody else. The parameter is ignored for
// their role, so they get their own rows rather than the ones they asked for.
const traineeAsksForAnother = await trainee.request(`/api/assigned-workouts?from=2027-04-01&to=2027-04-30&traineeId=${encodeURIComponent('usr_' + '0'.repeat(20))}`);
assert.equal(traineeAsksForAnother.status, 200);
assert.equal(idsIn(traineeAsksForAnother).has(datedId), true, 'a trainee still sees their own window');
assert.equal(traineeAsksForAnother.data.assignments.every(item => item.traineeId === traineeAsksForAnother.data.assignments[0].traineeId), true);

// --- the window pages like every other list -------------------------------
const firstPage = await trainee.request('/api/assigned-workouts?from=2027-04-01&to=2027-04-30&limit=1');
assert.equal(firstPage.data.assignments.length <= 1, true, 'limit still applies inside a window');

console.log(JSON.stringify({
  windowSelectsTheRightDays: 'pass',
  dueDateIsACalendarDate: 'pass',
  undatedWorkExcludedFromWindows: 'pass',
  malformedWindowRefused: 'pass',
  windowCannotWidenAccess: 'pass',
  paginationSurvivesTheWindow: 'pass'
}, null, 2));
