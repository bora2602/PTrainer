// The workout loop as the product now runs it: a trainer builds a workout with
// target weights, saves it without assigning it, assigns it afterwards to more
// than one client; a client starts it, logs, and presses Done; the trainer
// reads back exactly what was lifted and how long it took.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

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
  async register(role, label) {
    const notice = (await this.request('/api/privacy')).data.noticeVersion;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Session ${label}`, email: `session_${label}_${stamp}@ptrainer.local`, password: 'SessionPass1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) { console.error('Registration rate limit spent; restart the app and rerun.'); process.exit(2); }
    assert.equal(result.status, 201);
    return result.data.user;
  }
}

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
const traineeLogin = await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!');
assert.equal(traineeLogin.status, 200);
const traineeId = traineeLogin.data.user.id;
const clients = (await trainer.request('/api/dashboard')).data.clients;
assert.ok(clients.length >= 2, 'the demo trainer coaches more than one client');
const secondClient = clients.find(client => client.id !== traineeId);

// --- the trainer's own exercise, and somebody else's -----------------------
const own = await trainer.request('/api/exercises', { method: 'POST', body: JSON.stringify({ name: `Landmine press ${stamp}`, muscleGroup: 'Shoulders', equipment: 'Barbell' }) });
assert.equal(own.status, 201);
const other = await new Actor().start();
await other.register('TRAINER', 'other');
const theirs = await other.request('/api/exercises', { method: 'POST', body: JSON.stringify({ name: `Secret move ${stamp}`, muscleGroup: 'Core', equipment: 'None' }) });
assert.equal(theirs.status, 201);

// --- build without assigning -----------------------------------------------
const created = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({
    name: `Session check ${stamp}`,
    description: 'Built first, assigned later',
    exercises: [
      { name: own.data.exercise.name, exerciseId: own.data.exercise.id, sets: 3, reps: 8, restSeconds: 90, targetLoad: 95, loadUnit: 'lb', note: 'Brace first' },
      { name: 'Walking lunge', exerciseId: theirs.data.exercise.id, sets: 2, reps: 12, restSeconds: 60 }
    ]
  })
});
assert.equal(created.status, 201, JSON.stringify(created.data));
const template = created.data.template;
assert.equal(template.exercises[0].targetLoad, 95);
assert.equal(template.exercises[0].loadUnit, 'lb');
assert.equal(template.exercises[0].note, 'Brace first');
assert.equal(template.exercises[0].exerciseId, own.data.exercise.id, 'a trainer can build on their own exercise');
assert.equal(template.exercises[1].exerciseId, null, "another trainer's exercise id is not kept");

const noUnit = await trainer.request('/api/workout-templates', {
  method: 'POST', body: JSON.stringify({ name: `No unit ${stamp}`, exercises: [{ name: 'Squat', sets: 3, reps: 5, targetLoad: 100 }] })
});
assert.equal(noUnit.status, 422, 'a target weight must say kg or lb');

const unassigned = await trainer.request(`/api/assigned-workouts?traineeId=${traineeId}&limit=200`);
assert.equal(unassigned.data.assignments.some(item => item.templateId === template.id), false, 'saving a workout assigns it to nobody');

// --- assign afterwards, to two clients at once ------------------------------
const assigned = await trainer.request('/api/assigned-workouts', {
  method: 'POST', body: JSON.stringify({ templateId: template.id, traineeIds: [traineeId, secondClient.id], startDate: today })
});
assert.equal(assigned.status, 201, JSON.stringify(assigned.data));
assert.equal(assigned.data.assignments.length, 2);
assert.deepEqual(new Set(assigned.data.assignments.map(item => item.traineeId)), new Set([traineeId, secondClient.id]));
const assignment = assigned.data.assignments.find(item => item.traineeId === traineeId);
assert.equal(assignment.templateSnapshot.exercises[0].targetLoad, 95, 'the client receives the prescribed weight');

const intruder = await trainer.request('/api/assigned-workouts', {
  method: 'POST', body: JSON.stringify({ templateId: template.id, traineeIds: [traineeId, (await other.request('/api/me')).data.user.id], startDate: today })
});
assert.ok(intruder.status >= 400, 'a trainer cannot assign to somebody they do not coach');

// --- the client's session --------------------------------------------------
const logsPath = `/api/assigned-workouts/${assignment.id}/logs`;
const startedAt = new Date(Date.now() - 42 * 60 * 1000).toISOString();
const started = await trainee.request(logsPath, { method: 'PATCH', body: JSON.stringify({ startedAt, sets: [] }) });
assert.equal(started.status, 200, JSON.stringify(started.data));
assert.equal(new Date(started.data.draft.startedAt).toISOString(), startedAt);

// Reopening the app must not restart the clock.
const resumed = await trainee.request(logsPath, { method: 'PATCH', body: JSON.stringify({ startedAt: new Date().toISOString(), sets: [{ exerciseIndex: 0, setIndex: 0, reps: 8, loadValue: 95, loadUnit: 'lb', completed: true }] }) });
assert.equal(new Date(resumed.data.draft.startedAt).toISOString(), startedAt, 'the first start wins');

const badClock = await trainee.request(logsPath, { method: 'PATCH', body: JSON.stringify({ startedAt: '2020-01-01T00:00:00.000Z', sets: [] }) });
assert.equal(badClock.status, 422);
assert.equal(badClock.data.error.code, 'SESSION_START_INVALID');

const draftView = await trainee.request(logsPath);
assert.equal(new Date(draftView.data.logs.find(log => log.status === 'DRAFT').startedAt).toISOString(), startedAt);

// Done, with the lunges skipped: the session is still over.
const key = `session_${stamp}_${Math.random().toString(36).slice(2, 10)}`;
const done = await trainee.request(logsPath, {
  method: 'POST',
  headers: { 'Idempotency-Key': key },
  body: JSON.stringify({ sets: [
    { exerciseIndex: 0, setIndex: 0, reps: 8, loadValue: 95, loadUnit: 'lb', exertion: 7, completed: true },
    { exerciseIndex: 0, setIndex: 1, reps: 8, loadValue: 100, loadUnit: 'lb', exertion: 8, completed: true },
    { exerciseIndex: 0, setIndex: 2, reps: 6, loadValue: 100, loadUnit: 'lb', exertion: 9.5, completed: true, note: 'Grip went' }
  ] })
});
assert.equal(done.status, 201, JSON.stringify(done.data));
assert.equal(done.data.log.completedCount, 1);
assert.ok(done.data.log.durationSeconds >= 42 * 60 && done.data.log.durationSeconds < 44 * 60, `duration was ${done.data.log.durationSeconds}`);

const clientList = await trainee.request('/api/assigned-workouts?limit=200');
assert.equal(clientList.data.assignments.find(item => item.id === assignment.id).status, 'COMPLETED', 'Done closes the workout');

// --- the trainer reads it back ---------------------------------------------
const review = await trainer.request(`/api/assigned-workouts?traineeId=${traineeId}&limit=200`);
const reviewed = review.data.assignments.find(item => item.id === assignment.id);
assert.equal(reviewed.status, 'COMPLETED');
assert.equal(reviewed.latestLog.completedCount, 1);
assert.equal(reviewed.latestLog.durationSeconds, done.data.log.durationSeconds);

const detail = await trainer.request(logsPath);
const finalLog = detail.data.logs.find(log => log.status === 'FINAL');
assert.ok(finalLog);
assert.equal(finalLog.durationSeconds, done.data.log.durationSeconds);
assert.deepEqual(finalLog.sets.map(set => [set.reps, set.load_value, set.load_unit, set.exertion]), [[8, 95, 'lb', 7], [8, 100, 'lb', 8], [6, 100, 'lb', 9.5]], 'the exact sets, in the unit they were lifted in');
assert.equal(finalLog.sets[2].note, 'Grip went');

// The other trainer learns nothing about it.
assert.equal((await other.request(logsPath)).status, 403);

console.log('session check passed: build, assign to many, start, resume, Done, review');
