// Phase 2 - the remaining MVP-done gaps: email verification, an owned exercise
// library, coaching notes, progress correction and unit conversion, template
// lifecycle, and scheduled or bulk assignment.
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
  async register(role, label) {
    const notice = (await this.request('/api/privacy')).data.noticeVersion;
    const email = `p2_${label}_${stamp}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Phase Two ${label}`, email, password: 'PhaseTwoPass1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) { console.error('Registration rate limit spent; restart the app and rerun.'); process.exit(2); }
    assert.equal(result.status, 201);
    return { email, result };
  }
}

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);
const traineeId = (await trainer.request('/api/dashboard')).data.clients[0].id;

// --- A4 email verification -------------------------------------------------
const newcomer = new Actor(); await newcomer.start();
const { result: signup } = await newcomer.register('TRAINEE', 'verify');
assert.equal(signup.data.user.emailVerified, false, 'a new account starts unverified');
const verificationToken = signup.data.emailVerification.demoVerificationToken;
assert.ok(verificationToken, 'development must surface the token so the flow is testable');
assert.equal(signup.data.emailVerification.delivered, true);

const badToken = await newcomer.request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: 'not-a-real-token' }) });
assert.equal(badToken.status, 400);
assert.equal(badToken.data.error.code, 'VERIFICATION_TOKEN_INVALID');

const verified = await newcomer.request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verificationToken }) });
assert.equal(verified.status, 200);
assert.equal(verified.data.user.emailVerified, true);

// A token is single use, so a leaked link cannot be replayed.
const replayed = await newcomer.request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: verificationToken }) });
assert.equal(replayed.status, 400);

const resendAfter = await newcomer.request('/api/me/resend-verification', { method: 'POST', body: '{}' });
assert.equal(resendAfter.status, 409);
assert.equal(resendAfter.data.error.code, 'EMAIL_ALREADY_VERIFIED');
assert.equal((await newcomer.request('/api/me')).data.user.emailVerified, true);

// --- A5 exercise library ---------------------------------------------------
const library = await trainer.request('/api/exercises?limit=250');
assert.equal(library.status, 200);
assert.ok(library.data.catalogTotal >= 198, 'the bundled catalog is seeded into the table');
assert.ok(library.data.exercises.filter(item => item.visibility === 'PLATFORM').every(item => item.canManage === false), 'platform movements are not editable');
const searched = await trainer.request('/api/exercises?q=kettlebell&limit=20');
assert.ok(searched.data.exercises.some(item => item.name === 'Kettlebell swing' && item.equipment === 'Kettlebell'));

const ownName = `Sled drag ${stamp}`;
const created = await trainer.request('/api/exercises', {
  method: 'POST',
  body: JSON.stringify({ name: ownName, muscleGroup: 'Full body', equipment: 'Sled', instructions: 'Drive through the hips.', difficulty: 'ADVANCED' })
});
assert.equal(created.status, 201);
assert.equal(created.data.exercise.visibility, 'TRAINER');
const exerciseId = created.data.exercise.id;

const duplicate = await trainer.request('/api/exercises', { method: 'POST', body: JSON.stringify({ name: ownName, muscleGroup: 'Full body', equipment: 'Sled' }) });
assert.equal(duplicate.status, 409);
assert.equal(duplicate.data.error.code, 'EXERCISE_EXISTS');

const badMedia = await trainer.request('/api/exercises', { method: 'POST', body: JSON.stringify({ name: `Bad media ${stamp}`, mediaUrl: 'javascript:alert(1)' }) });
assert.equal(badMedia.status, 422);

const patched = await trainer.request(`/api/exercises/${exerciseId}`, { method: 'PATCH', body: JSON.stringify({ name: ownName, muscleGroup: 'Posterior chain', equipment: 'Sled', difficulty: 'INTERMEDIATE' }) });
assert.equal(patched.status, 200);
assert.equal(patched.data.exercise.version, 2, 'editing a movement bumps its version');

// One trainer's library is not another's.
const otherTrainer = new Actor(); await otherTrainer.start();
await otherTrainer.register('TRAINER', 'trainer2');
const otherView = await otherTrainer.request('/api/exercises?limit=250');
assert.equal(otherView.data.exercises.some(item => item.id === exerciseId), false, 'a trainer must not see another trainer movements');
const otherEdit = await otherTrainer.request(`/api/exercises/${exerciseId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }) });
assert.equal(otherEdit.status, 404);
const traineeLibrary = await trainee.request('/api/exercises');
assert.equal(traineeLibrary.status, 403);

const retired = await trainer.request(`/api/exercises/${exerciseId}`, { method: 'DELETE', body: '{}' });
assert.equal(retired.status, 200);
const afterRetire = await trainer.request('/api/exercises?limit=250');
assert.equal(afterRetire.data.exercises.some(item => item.id === exerciseId), false, 'retired movements leave the list');

// --- A6 coaching notes -----------------------------------------------------
const privateNote = await trainer.request('/api/trainer-notes', { method: 'POST', body: JSON.stringify({ traineeId, body: 'Watch the left knee on squats.', visibility: 'PRIVATE' }) });
assert.equal(privateNote.status, 201);
const sharedNote = await trainer.request('/api/trainer-notes', { method: 'POST', body: JSON.stringify({ traineeId, body: 'Great consistency this block.', visibility: 'SHARED' }) });
assert.equal(sharedNote.status, 201);

const traineeNotes = await trainee.request('/api/trainer-notes');
assert.equal(traineeNotes.status, 200);
assert.equal(traineeNotes.data.notes.some(note => note.id === sharedNote.data.note.id), true, 'a shared note reaches the trainee');
assert.equal(traineeNotes.data.notes.some(note => note.id === privateNote.data.note.id), false, 'a private coaching note stays private');
assert.equal(traineeNotes.data.notes.every(note => note.can_manage === false), true);

const traineeWrite = await trainee.request('/api/trainer-notes', { method: 'POST', body: JSON.stringify({ traineeId, body: 'Trying to write a coaching note.' }) });
assert.equal(traineeWrite.status, 403);
const outsiderEdit = await otherTrainer.request(`/api/trainer-notes/${privateNote.data.note.id}`, { method: 'PATCH', body: JSON.stringify({ body: 'Hijacked note.' }) });
assert.equal(outsiderEdit.status, 404);

const sharedLater = await trainer.request(`/api/trainer-notes/${privateNote.data.note.id}`, { method: 'PATCH', body: JSON.stringify({ body: 'Watch the left knee on squats.', visibility: 'SHARED' }) });
assert.equal(sharedLater.status, 200);
assert.equal((await trainee.request('/api/trainer-notes')).data.notes.some(note => note.id === privateNote.data.note.id), true);
assert.equal((await trainer.request(`/api/trainer-notes/${privateNote.data.note.id}`, { method: 'DELETE', body: '{}' })).status, 200);

// --- A7 / A8 progress correction and unit conversion -----------------------
const metrics = await trainee.request('/api/progress-metrics');
assert.ok(metrics.data.metrics.some(metric => metric.key === 'weight' && metric.canonicalUnit === 'kg'));

const inPounds = await trainee.request('/api/progress-entries', { method: 'POST', body: JSON.stringify({ metricType: 'weight', value: 180, unit: 'lb', measuredAt: new Date().toISOString(), note: 'imperial entry' }) });
assert.equal(inPounds.status, 201);
assert.equal(inPounds.data.entry.unit, 'lb', 'the entered unit is preserved exactly');
assert.equal(inPounds.data.entry.value, 180);
assert.equal(inPounds.data.entry.normalized_unit, 'kg');
assert.equal(Math.round(inPounds.data.entry.value_normalized * 100) / 100, 81.65, '180 lb normalizes to 81.65 kg');

// A known metric fixes what it measures; a waist in kilograms is a mistake.
const wrongDimension = await trainee.request('/api/progress-entries', { method: 'POST', body: JSON.stringify({ metricType: 'waist', value: 80, unit: 'kg' }) });
assert.equal(wrongDimension.status, 422);
assert.equal(wrongDimension.data.error.code, 'PROGRESS_INVALID');

const entryId = inPounds.data.entry.id;
const trainerEdit = await trainer.request(`/api/progress-entries/${entryId}`, { method: 'PATCH', body: JSON.stringify({ traineeId, metricType: 'weight', value: 1, unit: 'kg' }) });
assert.equal(trainerEdit.status, 403, 'only the author corrects their own measurement');
assert.equal(trainerEdit.data.error.code, 'PROGRESS_AUTHOR_REQUIRED');

const corrected = await trainee.request(`/api/progress-entries/${entryId}`, { method: 'PATCH', body: JSON.stringify({ metricType: 'weight', value: 179, unit: 'lb', measuredAt: new Date().toISOString() }) });
assert.equal(corrected.status, 200);
assert.equal(corrected.data.entry.value, 179);
assert.equal(Math.round(corrected.data.entry.value_normalized * 100) / 100, 81.19);

const history = await trainer.request(`/api/progress-entries?traineeId=${traineeId}&metric=weight`);
assert.equal(history.data.metric.key, 'weight');
assert.ok(history.data.entries.every(row => row.display_unit === history.data.displayUnit));

assert.equal((await trainee.request(`/api/progress-entries/${entryId}`, { method: 'DELETE', body: '{}' })).status, 200);
const afterDelete = await trainee.request('/api/progress-entries?metric=weight');
assert.equal(afterDelete.data.entries.some(row => row.id === entryId), false, 'a withdrawn measurement leaves the series');

// --- A9 template lifecycle -------------------------------------------------
const template = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({ name: `Lifecycle ${stamp}`, description: 'Original', exercises: [{ name: 'Front squat', sets: 3, reps: 5, restSeconds: 120 }] })
});
assert.equal(template.status, 201);
const templateId = template.data.template.id;

const edited = await trainer.request(`/api/workout-templates/${templateId}`, {
  method: 'PATCH',
  body: JSON.stringify({ name: `Lifecycle ${stamp}`, description: 'Revised', exercises: [{ name: 'Front squat', sets: 5, reps: 3, restSeconds: 150 }] })
});
assert.equal(edited.status, 200);
assert.equal(edited.data.template.version, 2);

const copy = await trainer.request(`/api/workout-templates/${templateId}/duplicate`, { method: 'POST', body: '{}' });
assert.equal(copy.status, 201);
assert.notEqual(copy.data.template.id, templateId);
assert.ok(copy.data.template.name.endsWith('copy'));

const foreignEdit = await otherTrainer.request(`/api/workout-templates/${templateId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hijacked template', exercises: [{ name: 'Nope', sets: 1, reps: 1 }] }) });
assert.equal(foreignEdit.status, 404);

// --- A10 scheduling and bulk assignment ------------------------------------
const noEndDate = await trainer.request('/api/assigned-workouts', { method: 'POST', body: JSON.stringify({ templateId, traineeId, startDate: '2026-09-01', frequency: 'WEEKLY' }) });
assert.equal(noEndDate.status, 422);
assert.equal(noEndDate.data.error.code, 'SCHEDULE_INVALID', 'a repeat with no end has no defensible occurrence count');

const series = await trainer.request('/api/assigned-workouts', {
  method: 'POST',
  body: JSON.stringify({ templateId, traineeIds: [traineeId], startDate: '2026-09-01', endDate: '2026-09-29', frequency: 'WEEKLY' })
});
assert.equal(series.status, 201);
assert.equal(series.data.assignments.length, 5, 'weekly from 1 to 29 September is five sessions');
assert.equal(new Set(series.data.assignments.map(item => item.seriesId)).size, 1, 'occurrences share one series');
assert.deepEqual(series.data.assignments.map(item => item.dueDate), ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
// Each occurrence carries its own snapshot so a later template edit cannot reach back.
assert.ok(series.data.assignments.every(item => item.templateSnapshot.exercises[0].sets === 5));

const unrelated = await trainer.request('/api/assigned-workouts', { method: 'POST', body: JSON.stringify({ templateId, traineeIds: [traineeId, 'usr_not_a_real_client'] }) });
assert.equal(unrelated.status, 403, 'one unconnected id in a bulk assign rejects the whole request');

const retiredTemplate = await trainer.request(`/api/workout-templates/${templateId}`, { method: 'DELETE', body: '{}' });
assert.equal(retiredTemplate.status, 200);
assert.equal((await trainer.request('/api/workout-templates')).data.templates.some(item => item.id === templateId), false);
// History made from the retired template must survive it.
const survivors = await trainer.request('/api/assigned-workouts');
assert.ok(survivors.data.assignments.some(item => item.id === series.data.assignments[0].id), 'retiring a template leaves its assignments intact');

console.log(JSON.stringify({
  emailVerificationIssued: 'pass',
  verificationTokenSingleUse: 'pass',
  resendRejectedWhenVerified: 'pass',
  exerciseLibrarySeeded: 'pass',
  trainerOwnedExercises: 'pass',
  duplicateExerciseRejected: 'pass',
  exerciseMediaSchemeRejected: 'pass',
  exerciseLibraryIsolatedPerTrainer: 'pass',
  exerciseRetirement: 'pass',
  privateNotesStayPrivate: 'pass',
  sharedNotesReachTrainee: 'pass',
  noteAuthorshipEnforced: 'pass',
  progressMetricDefinitions: 'pass',
  originalUnitPreserved: 'pass',
  unitConversionNormalized: 'pass',
  metricDimensionEnforced: 'pass',
  progressAuthorOwnership: 'pass',
  progressCorrectionAndWithdrawal: 'pass',
  templateVersioning: 'pass',
  templateDuplication: 'pass',
  templateOwnershipEnforced: 'pass',
  recurringScheduleExpansion: 'pass',
  bulkAssignRelationshipChecked: 'pass',
  retiredTemplateKeepsHistory: 'pass'
}, null, 2));
