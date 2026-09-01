// The MVP journey end to end, on accounts that did not exist a moment ago:
// a trainer signs up, builds a profile, invites somebody; that person signs up,
// accepts, and does the workout; the trainer reads back what was actually
// lifted. This is plan section 17's definition of done, walked in one pass.
//
// The other suites test parts in isolation against seeded demo accounts. This
// one starts from nothing, which is the only way to catch a step that quietly
// depends on data the seed happened to provide.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
const step = message => console.log(`  ${message}`);

class Person {
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
  async signUp(role, label) {
    await this.request('/api/session');
    const notice = (await this.request('/api/privacy')).data.noticeVersion;
    this.email = `e2e_${label}_${stamp}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E ${label}`, email: this.email, password: 'JourneyPass1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) { console.error('Registration rate limit spent; restart the app and rerun.'); process.exit(2); }
    assert.equal(result.status, 201, `${label} could not register`);
    this.id = result.data.user.id;
    this.verificationToken = result.data.emailVerification?.demoVerificationToken;
    return result;
  }
}

console.log('Coaching journey:');

// 1. A trainer signs up and confirms their address.
const trainer = new Person();
const trainerSignup = await trainer.signUp('TRAINER', 'trainer');
assert.equal(trainerSignup.data.user.emailVerified, false);
assert.equal((await trainer.request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: trainer.verificationToken }) })).status, 200);
step('trainer registered and confirmed their email');

// 2. And fills in a profile.
const profile = await trainer.request('/api/me/profile', {
  method: 'PATCH',
  body: JSON.stringify({ name: 'E2E trainer', bio: 'Strength and conditioning.', specialties: 'Powerlifting', goals: '', preferredUnits: 'METRIC', timezone: 'America/Toronto' })
});
assert.equal(profile.status, 200);
step('trainer completed a profile');

// A brand-new trainer has no clients and no workouts to show.
const emptyDashboard = await trainer.request('/api/dashboard');
assert.equal(emptyDashboard.data.activeClients, 0);
assert.equal(emptyDashboard.data.clients.length, 0);
step('trainer dashboard starts empty');

// 3. The trainee signs up.
const trainee = new Person();
await trainee.signUp('TRAINEE', 'trainee');
step('trainee registered');

// 4. The trainer invites them, and the trainee accepts.
const invitation = await trainer.request('/api/invitations', {
  method: 'POST', body: JSON.stringify({ email: trainee.email, note: 'Looking forward to working together.' })
});
assert.equal(invitation.status, 201);
assert.equal(invitation.data.invitation.delivered, true, 'the invitation was handed to the mail transport');

// Somebody else holding the code must not be able to spend it.
const bystander = new Person();
await bystander.signUp('TRAINEE', 'bystander');
const stolen = await bystander.request(`/api/invitations/${invitation.data.invitation.inviteCode}/accept`, { method: 'POST', body: '{}' });
assert.equal(stolen.status, 403, 'an invitation belongs to the address it was sent to');

assert.equal((await trainee.request(`/api/invitations/${invitation.data.invitation.inviteCode}/accept`, { method: 'POST', body: '{}' })).status, 200);
step('trainee accepted the invitation; a bystander with the code could not');

const roster = await trainer.request('/api/dashboard');
assert.equal(roster.data.activeClients, 1);
assert.equal(roster.data.clients[0].id, trainee.id);
step('trainer now has one client');

// 5. The trainer builds a workout and assigns it.
const template = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Session A', description: 'Squat and press',
    exercises: [
      { name: 'Back squat', sets: 3, reps: 5, restSeconds: 180 },
      { name: 'Overhead press', sets: 3, reps: 8, restSeconds: 120 }
    ]
  })
});
assert.equal(template.status, 201);
const assignment = await trainer.request('/api/assigned-workouts', {
  method: 'POST',
  body: JSON.stringify({ templateId: template.data.template.id, traineeId: trainee.id, dueDate: new Date().toISOString().slice(0, 10) })
});
assert.equal(assignment.status, 201);
const assignmentId = assignment.data.assignment.id;
step('trainer created a template and assigned it');

// 6. The trainee sees it waiting.
const inbox = await trainee.request('/api/assigned-workouts');
assert.equal(inbox.data.assignments.some(item => item.id === assignmentId), true, 'the assignment reached the trainee');
const notifications = await trainee.request('/api/notifications');
assert.equal(notifications.data.notifications.some(item => item.event_type === 'WORKOUT_ASSIGNED'), true);
step('trainee sees the assignment and was notified');

// 7. They start it, get interrupted, and come back to it.
const logsPath = `/api/assigned-workouts/${assignmentId}/logs`;
const draft = await trainee.request(logsPath, {
  method: 'PATCH',
  body: JSON.stringify({ sets: [
    { exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 90, loadUnit: 'kg', exertion: 7, completed: true },
    { exerciseIndex: 0, setIndex: 1, reps: 5, loadValue: 95, loadUnit: 'kg', exertion: 8, completed: true }
  ] })
});
assert.equal(draft.status, 200);
const resumed = await trainee.request(logsPath);
const resumedDraft = resumed.data.logs.find(log => log.status === 'DRAFT');
assert.equal(resumedDraft.sets.length, 2, 'the interrupted workout came back');
assert.equal(resumedDraft.sets[1].load_value, 95);
step('trainee saved a partial workout and reopened it intact');

// The trainer must not see an unfinished session.
assert.equal((await trainer.request(logsPath)).data.logs.filter(log => log.status === 'DRAFT').length, 0);
step('the unfinished draft stayed private to the trainee');

// 8. They finish it.
const finished = await trainee.request(logsPath, {
  method: 'POST',
  headers: { 'Idempotency-Key': `e2e_${stamp}_finish` },
  body: JSON.stringify({ sets: [
    { exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 90, loadUnit: 'kg', exertion: 7, completed: true },
    { exerciseIndex: 0, setIndex: 1, reps: 5, loadValue: 95, loadUnit: 'kg', exertion: 8, completed: true },
    { exerciseIndex: 0, setIndex: 2, reps: 4, loadValue: 100, loadUnit: 'kg', exertion: 9.5, painFlag: true, note: 'right shoulder tightness', completed: true },
    { exerciseIndex: 1, setIndex: 0, reps: 8, loadValue: 40, loadUnit: 'kg', exertion: 7, completed: true },
    { exerciseIndex: 1, setIndex: 1, reps: 8, loadValue: 40, loadUnit: 'kg', exertion: 8, completed: true },
    { exerciseIndex: 1, setIndex: 2, reps: 6, loadValue: 40, loadUnit: 'kg', exertion: 9, completed: true }
  ] })
});
assert.equal(finished.status, 201);
assert.equal(finished.data.log.setCount, 6);
assert.equal(finished.data.log.completedCount, 2, 'both movements were completed');
step('trainee finished the workout, six sets recorded');

// 9. The trainer reviews what was actually lifted. This is the whole point.
const review = await trainer.request(logsPath);
const finalLog = review.data.logs.find(log => log.status === 'FINAL');
assert.ok(finalLog, 'the trainer can read the finished session');
assert.equal(finalLog.sets.length, 6);
const topSet = finalLog.sets.find(set => set.exercise_index === 0 && set.set_index === 2);
assert.equal(topSet.reps, 4);
assert.equal(topSet.load_value, 100);
assert.equal(topSet.exertion, 9.5);
assert.equal(topSet.pain_flag, true, 'the pain flag reaches the coach');
assert.equal(topSet.note, 'right shoulder tightness');
step('trainer reviewed the actual sets, loads, exertion and the pain flag');

assert.equal((await trainer.request('/api/assigned-workouts')).data.assignments.find(item => item.id === assignmentId).status, 'COMPLETED');

// 10. The trainer responds with a note, and the trainee gets it.
const note = await trainer.request('/api/trainer-notes', {
  method: 'POST',
  body: JSON.stringify({ traineeId: trainee.id, body: 'Stop at nine on the top set while that shoulder settles.', visibility: 'SHARED' })
});
assert.equal(note.status, 201);
assert.equal((await trainee.request('/api/trainer-notes')).data.notes.some(item => item.id === note.data.note.id), true);
step('trainer left coaching feedback and the trainee received it');

// 11. The trainee logs weight, in their own units, and the trainer can see it.
const weight = await trainee.request('/api/progress-entries', {
  method: 'POST', body: JSON.stringify({ metricType: 'weight', value: 176, unit: 'lb', measuredAt: new Date().toISOString() })
});
assert.equal(weight.status, 201);
assert.equal(weight.data.entry.value, 176, 'stored as entered');
assert.equal(weight.data.entry.normalized_unit, 'kg', 'and comparably');
const trainerView = await trainer.request(`/api/progress-entries?traineeId=${trainee.id}&metric=weight`);
assert.equal(trainerView.status, 200);
assert.equal(trainerView.data.entries.some(row => row.id === weight.data.entry.id), true);
step('trainee logged weight in pounds; the trainer sees it, normalized');

// 12. And can withdraw that access without ending the coaching.
assert.equal((await trainee.request(`/api/relationships/${trainer.id}/${trainee.id}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: { view_progress: false, view_nutrition: true, log_on_behalf: false } })
})).status, 200);
assert.equal((await trainer.request(`/api/progress-entries?traineeId=${trainee.id}`)).status, 403);
assert.equal((await trainer.request('/api/dashboard')).data.activeClients, 1, 'the coaching relationship is untouched');
step('trainee withdrew progress visibility; coaching continued');

console.log(JSON.stringify({
  trainerOnboarding: 'pass',
  emailVerification: 'pass',
  emptyStateForNewTrainer: 'pass',
  invitationAndAcceptance: 'pass',
  invitationBoundToItsAddress: 'pass',
  templateAndAssignment: 'pass',
  traineeNotified: 'pass',
  resumablePartialWorkout: 'pass',
  draftPrivateUntilSubmitted: 'pass',
  setLevelCompletion: 'pass',
  trainerReviewsActualPerformance: 'pass',
  painFlagReachesCoach: 'pass',
  coachingNoteDelivered: 'pass',
  progressInTraineeUnits: 'pass',
  visibilityWithdrawnWithoutEndingCoaching: 'pass'
}, null, 2));
