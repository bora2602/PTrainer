// The nutrition journal, checked over HTTP.
//
// The defect this file exists for: a journal day is a calendar day, and it was
// being returned as an instant. Postgres hands a `date` column to the pg driver,
// which builds a Date at the server's *local* midnight; JSON then serialises
// that as UTC. Run the server anywhere east of Greenwich and 2026-03-10 came
// back as "2026-03-09T15:00:00.000Z", so the edit form read the day before and
// saving moved the meal backwards a day. Nothing caught it because the
// container runs UTC, where local midnight and UTC midnight are the same
// instant and the bug is invisible.
//
// The fix is the one the rest of the schedule already uses - to_char(...,
// 'YYYY-MM-DD') - so this asserts the *shape* on the wire, not just the value.
// A check that only compared days would still pass on a UTC server after a
// regression.
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
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  async start() { await this.request('/api/session'); return this; }
  login(email, password) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); }
}

const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);

const DAY = '2027-03-10';
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

// --- a day saved is the day returned --------------------------------------
const created = await trainee.request('/api/nutrition-entries', {
  method: 'POST',
  body: JSON.stringify({ entryDate: DAY, entryType: 'LUNCH', description: `date probe ${stamp}`, calories: 500, proteinG: 30 })
});
assert.equal(created.status, 201, JSON.stringify(created.data).slice(0, 200));
const entryId = created.data.entry.id;

const listed = await trainee.request(`/api/nutrition-entries?date=${DAY}`);
assert.equal(listed.status, 200);
const mine = listed.data.entries.find(entry => entry.id === entryId);
assert.ok(mine, 'the entry just saved is not in its own day');
assert.match(String(mine.entry_date), CALENDAR_DAY,
  `entry_date must cross the wire as a calendar day, got ${JSON.stringify(mine.entry_date)}`);
assert.equal(mine.entry_date, DAY, 'the day read back is not the day written');

// --- editing an entry does not move it ------------------------------------
// The original bug surfaced here: the form filled itself from the wire value,
// so an edit that changed only the description silently rewrote the date.
const edited = await trainee.request(`/api/nutrition-entries/${entryId}`, {
  method: 'PATCH',
  body: JSON.stringify({ entryDate: mine.entry_date, entryType: 'LUNCH', description: `date probe edited ${stamp}`, calories: 500, proteinG: 30 })
});
assert.equal(edited.status, 200, JSON.stringify(edited.data).slice(0, 200));
assert.match(String(edited.data.entry.entry_date), CALENDAR_DAY,
  'the PATCH response must return a calendar day too, or a round trip through the form drifts');
assert.equal(edited.data.entry.entry_date, DAY, 'editing the description moved the entry to another day');

const afterEdit = await trainee.request(`/api/nutrition-entries?date=${DAY}`);
assert.ok(afterEdit.data.entries.some(entry => entry.id === entryId), 'the edited entry left its day');

// --- the day filter is exact ----------------------------------------------
const dayBefore = await trainee.request('/api/nutrition-entries?date=2027-03-09');
assert.equal(dayBefore.data.entries.some(entry => entry.id === entryId), false,
  'the entry leaks into the day before, which is what an instant-shaped date does');
const dayAfter = await trainee.request('/api/nutrition-entries?date=2027-03-11');
assert.equal(dayAfter.data.entries.some(entry => entry.id === entryId), false, 'the entry leaks into the day after');

// --- every listed entry is a calendar day ---------------------------------
const all = await trainee.request('/api/nutrition-entries?limit=50');
assert.equal(all.status, 200);
for (const entry of all.data.entries) {
  assert.match(String(entry.entry_date), CALENDAR_DAY,
    `an unfiltered listing returned ${JSON.stringify(entry.entry_date)}`);
}

// --- the cursor still pages, now that the sort key is a string ------------
// entry_date is part of the keyset. Casting it changed what the cursor carries,
// so this confirms a second page still arrives and does not repeat the first.
const firstPage = await trainee.request('/api/nutrition-entries?limit=1');
assert.equal(firstPage.status, 200);
assert.equal(firstPage.data.entries.length, 1);
if (firstPage.data.nextCursor) {
  const secondPage = await trainee.request(`/api/nutrition-entries?limit=1&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
  assert.equal(secondPage.status, 200, 'the cursor was rejected after the date cast');
  const firstIds = new Set(firstPage.data.entries.map(entry => entry.id));
  assert.ok(secondPage.data.entries.every(entry => !firstIds.has(entry.id)), 'the second page repeats the first');
}

// --- a rejected entry is rejected before it is stored ---------------------
const before = (await trainee.request(`/api/nutrition-entries?date=${DAY}`)).data.entries.length;
const bad = await trainee.request('/api/nutrition-entries', {
  method: 'POST', body: JSON.stringify({ entryDate: '10-03-2027', entryType: 'LUNCH', description: 'bad date', calories: 100 })
});
assert.equal(bad.status, 422, 'a malformed date should not be accepted');
const after = (await trainee.request(`/api/nutrition-entries?date=${DAY}`)).data.entries.length;
assert.equal(after, before, 'a rejected entry was stored anyway');

// --- only the author may change or delete --------------------------------
const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const traineeId = (await trainer.request('/api/dashboard')).data.clients[0].id;
const hijack = await trainer.request(`/api/nutrition-entries/${entryId}`, {
  method: 'DELETE', body: JSON.stringify({ traineeId })
});
assert.equal(hijack.status, 403, 'somebody other than the author deleted a journal entry');

// --- cleanup ---------------------------------------------------------------
assert.equal((await trainee.request(`/api/nutrition-entries/${entryId}`, { method: 'DELETE', body: '{}' })).status, 200);
const gone = await trainee.request(`/api/nutrition-entries?date=${DAY}`);
assert.equal(gone.data.entries.some(entry => entry.id === entryId), false, 'the deleted entry is still listed');

console.log(JSON.stringify({
  dayWrittenIsDayRead: 'pass',
  wireFormatIsCalendarDay: 'pass',
  editingDoesNotMoveTheDay: 'pass',
  dayFilterIsExact: 'pass',
  cursorStillPages: 'pass',
  malformedDateRejected: 'pass',
  authorOnlyMutation: 'pass',
  deleteRemovesIt: 'pass'
}, null, 2));
