// Phase 1 - the workout loop. Proves that set-level performance is stored, that
// a draft survives closing the app, that finishing hands the trainer something
// to review, and that a forged exercise index cannot write rows the workout
// never prescribed.
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

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);

const dashboard = await trainer.request('/api/dashboard');
const traineeId = dashboard.data.clients[0].id;

const template = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({
    name: `Set Logging ${stamp}`,
    description: 'Two movements',
    exercises: [
      { name: 'Back squat', sets: 3, reps: 5, restSeconds: 120 },
      { name: 'Pull-up', sets: 3, reps: 8, restSeconds: 90 }
    ]
  })
});
assert.equal(template.status, 201);
const templateId = template.data.template.id;

// A junk due date used to reach a DATE column raw and surface as a 500.
const badDate = await trainer.request('/api/assigned-workouts', {
  method: 'POST',
  body: JSON.stringify({ templateId, traineeId, dueDate: 'not-a-day' })
});
assert.equal(badDate.status, 422);
assert.equal(badDate.data.error.code, 'DUE_DATE_INVALID');

const assigned = await trainer.request('/api/assigned-workouts', {
  method: 'POST',
  body: JSON.stringify({ templateId, traineeId, dueDate: '2026-09-01' })
});
assert.equal(assigned.status, 201);
const assignmentId = assigned.data.assignment.id;
const logsPath = `/api/assigned-workouts/${assignmentId}/logs`;

// A forged exercise index must not write a row for a movement that was never
// prescribed; this workout has exactly two.
const forged = await trainee.request(logsPath, {
  method: 'PATCH',
  body: JSON.stringify({ sets: [{ exerciseIndex: 7, setIndex: 0, reps: 5, completed: true }] })
});
assert.equal(forged.status, 422);
assert.equal(forged.data.error.code, 'SET_LOG_INVALID');

// A load without a unit is not a measurement.
const unitless = await trainee.request(logsPath, {
  method: 'PATCH',
  body: JSON.stringify({ sets: [{ exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 100 }] })
});
assert.equal(unitless.status, 422);

// Partial save: first exercise done, second untouched.
const draft = await trainee.request(logsPath, {
  method: 'PATCH',
  body: JSON.stringify({
    sets: [
      { exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 100, loadUnit: 'kg', exertion: 7, restSeconds: 120, completed: true },
      { exerciseIndex: 0, setIndex: 1, reps: 5, loadValue: 102.5, loadUnit: 'kg', exertion: 8, painFlag: true, note: 'left knee twinge', completed: true }
    ]
  })
});
assert.equal(draft.status, 200);
assert.equal(draft.data.draft.status, 'DRAFT');
assert.equal(draft.data.draft.setCount, 2);

// Closing and reopening the app must return the same work, not an empty form.
const resumed = await trainee.request(logsPath);
assert.equal(resumed.status, 200);
assert.equal(resumed.data.assignment.exercises.length, 2);
const draftLog = resumed.data.logs.find(log => log.status === 'DRAFT');
assert.ok(draftLog, 'draft should be readable by its author');
assert.equal(draftLog.sets.length, 2);
assert.equal(draftLog.sets[1].load_value, 102.5);
assert.equal(draftLog.sets[1].pain_flag, true);
assert.equal(draftLog.sets[1].note, 'left knee twinge');

// Unfinished self-reported work stays with its author until it is submitted.
const trainerMidway = await trainer.request(logsPath);
assert.equal(trainerMidway.status, 200);
assert.equal(trainerMidway.data.logs.filter(log => log.status === 'DRAFT').length, 0);

// A second draft save overwrites the first rather than stacking up.
const draftAgain = await trainee.request(logsPath, {
  method: 'PATCH',
  body: JSON.stringify({ sets: [{ exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 100, loadUnit: 'kg', completed: true }] })
});
assert.equal(draftAgain.status, 200);
assert.equal(draftAgain.data.draft.id, draft.data.draft.id);

// Finishing replaces the draft with one final log.
const key = `wl_${stamp}_${Math.random().toString(36).slice(2, 10)}`;
const finished = await trainee.request(logsPath, {
  method: 'POST',
  headers: { 'Idempotency-Key': key },
  body: JSON.stringify({
    sets: [
      { exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 100, loadUnit: 'kg', exertion: 7, completed: true },
      { exerciseIndex: 0, setIndex: 1, reps: 5, loadValue: 102.5, loadUnit: 'kg', exertion: 8, completed: true },
      { exerciseIndex: 1, setIndex: 0, reps: 8, exertion: 6, completed: true }
    ]
  })
});
assert.equal(finished.status, 201);
assert.equal(finished.data.log.setCount, 3);
assert.equal(finished.data.log.completedCount, 2, 'both exercises had every recorded set completed');

// This is the gap the audit opened on: the trainer can now read back what was
// actually lifted, not just a completion flag.
const review = await trainer.request(logsPath);
assert.equal(review.status, 200);
const finalLog = review.data.logs.find(log => log.status === 'FINAL');
assert.ok(finalLog, 'trainer must see the finished log');
assert.equal(finalLog.sets.length, 3);
assert.equal(finalLog.sets[0].reps, 5);
assert.equal(finalLog.sets[0].load_value, 100);
assert.equal(finalLog.sets[0].load_unit, 'kg');
assert.equal(finalLog.sets[2].reps, 8);
assert.equal(review.data.logs.filter(log => log.status === 'DRAFT').length, 0, 'finishing consumes the draft');

const afterFinish = await trainee.request('/api/assigned-workouts');
assert.equal(afterFinish.data.assignments.find(item => item.id === assignmentId).status, 'COMPLETED');

// Replaying the same idempotency key must not write a second log.
const replay = await trainee.request(logsPath, {
  method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ sets: [] })
});
assert.equal(replay.status, 200);
assert.equal(replay.data.log.id, finished.data.log.id);

// Set-level performance is personal data and belongs in the export.
const exported = await trainee.request('/api/me/export');
assert.equal(exported.status, 200);
assert.ok(exported.data.authoredSetLogs.length >= 3);

// An unrelated account must not reach the logs by guessing the assignment id.
const outsider = await new Actor().start();
const notice = (await outsider.request('/api/privacy')).data.noticeVersion;
const registered = await outsider.request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Outside Probe',
    email: `probe_logs_${stamp}@ptrainer.local`,
    password: 'ProbeAccount1!',
    role: 'TRAINEE',
    privacyAccepted: true,
    privacyNoticeVersion: notice
  })
});
if (registered.status === 429) {
  console.error('Registration rate limit is spent for this address; restart the app and rerun.');
  process.exit(2);
}
assert.equal(registered.status, 201);
const stolen = await outsider.request(logsPath);
assert.equal(stolen.status, 403, 'guessing an assignment id must not expose another trainee workout');
const stolenWrite = await outsider.request(logsPath, { method: 'PATCH', body: JSON.stringify({ sets: [] }) });
assert.equal(stolenWrite.status, 403);

console.log(JSON.stringify({
  dueDateValidation: 'pass',
  forgedExerciseIndexRejected: 'pass',
  unitlessLoadRejected: 'pass',
  resumableDraft: 'pass',
  draftPrivateUntilSubmitted: 'pass',
  draftOverwrittenNotStacked: 'pass',
  setLevelPerformanceStored: 'pass',
  trainerReviewsActualResults: 'pass',
  draftConsumedOnFinish: 'pass',
  idempotentFinish: 'pass',
  setLogsExported: 'pass',
  crossAccountLogAccessDenied: 'pass'
}, null, 2));
