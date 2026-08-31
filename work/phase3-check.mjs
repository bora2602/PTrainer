// Phase 3 - correctness, privacy, and lifecycle: invitation expiry, the second
// active trainer conflict, audit coverage for relationship changes, deletion
// that actually reaches health data, retention sweeps, and field-level
// relationship permissions.
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
    const email = `p3_${label}_${stamp}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Phase Three ${label}`, email, password: 'PhaseThreePass1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
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
const trainerId = (await trainer.request('/api/me')).data.user.id;
const traineeId = (await trainer.request('/api/dashboard')).data.clients[0].id;

// --- B7 field-level relationship permissions -------------------------------
const before = await trainer.request(`/api/progress-entries?traineeId=${traineeId}`);
assert.equal(before.status, 200, 'an accepted trainer can see progress by default');

// Writing in the trainee's name is off unless they turn it on.
const onBehalf = await trainer.request('/api/progress-entries', {
  method: 'POST', body: JSON.stringify({ traineeId, metricType: 'weight', value: 70, unit: 'kg' })
});
assert.equal(onBehalf.status, 403, 'accepting an invitation is not consent to be written about');
assert.equal(onBehalf.data.error.code, 'PROGRESS_FORBIDDEN');

// Only the trainee may change what the relationship grants.
const trainerGrab = await trainer.request(`/api/relationships/${trainerId}/${traineeId}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: { log_on_behalf: true } })
});
assert.equal(trainerGrab.status, 403, 'a trainer must not widen their own access');
assert.equal(trainerGrab.data.error.code, 'PERMISSIONS_TRAINEE_ONLY');

const badShape = await trainee.request(`/api/relationships/${trainerId}/${traineeId}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: 'everything' })
});
assert.equal(badShape.status, 422);

const granted = await trainee.request(`/api/relationships/${trainerId}/${traineeId}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: { view_progress: true, view_nutrition: true, log_on_behalf: true } })
});
assert.equal(granted.status, 200);
assert.equal(granted.data.relationship.permissions.log_on_behalf, true);

const allowedNow = await trainer.request('/api/progress-entries', {
  method: 'POST', body: JSON.stringify({ traineeId, metricType: 'weight', value: 70, unit: 'kg', note: 'recorded at the gym' })
});
assert.equal(allowedNow.status, 201, 'the grant is what makes writing possible');
await trainer.request(`/api/progress-entries/${allowedNow.data.entry.id}`, { method: 'DELETE', body: JSON.stringify({ traineeId }) });

// Withdrawing visibility closes the door again, without ending the coaching.
const withdrawn = await trainee.request(`/api/relationships/${trainerId}/${traineeId}`, {
  method: 'PATCH', body: JSON.stringify({ permissions: { view_progress: false, view_nutrition: false, log_on_behalf: false } })
});
assert.equal(withdrawn.status, 200);
assert.equal((await trainer.request(`/api/progress-entries?traineeId=${traineeId}`)).status, 403, 'progress visibility is revocable');
assert.equal((await trainer.request(`/api/nutrition-entries?traineeId=${traineeId}`)).status, 403, 'nutrition visibility is revocable');
// Coaching guidance is the trainer's own material and is not gated by it.
assert.equal((await trainer.request('/api/nutrition-target', { method: 'PATCH', body: JSON.stringify({ traineeId, calories: 2200 }) })).status, 200);
assert.equal((await trainer.request(`/api/trainer-notes?traineeId=${traineeId}`)).status, 200);

// Restore the default grant so the rest of the suite sees a normal relationship.
assert.equal((await trainee.request(`/api/relationships/${trainerId}/${traineeId}`, {
  method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', permissions: { view_progress: true, view_nutrition: true, log_on_behalf: false } })
})).status, 200);

// --- B4 relationship changes are audited -----------------------------------
const traineeAudit = await trainee.request('/api/me/audit-events');
const relationshipEvent = traineeAudit.data.events.find(event => event.action === 'RELATIONSHIP_UPDATED');
assert.ok(relationshipEvent, 'changing a coaching relationship is an audited action');
assert.equal(relationshipEvent.entity_type, 'relationship');
assert.ok('permissions' in relationshipEvent.metadata, 'the audit records what the permissions became');

// --- B2 an expired invitation must stop blocking that address --------------
// Throwaway trainers, so nothing in this section changes the demo trainer's
// roster - the smoke suite reasonably assumes clients[0] is the demo trainee.
const inviter = new Actor(); await inviter.start();
await inviter.register('TRAINER', 'inviter');
const guest = new Actor(); await guest.start();
const { email: guestEmail } = await guest.register('TRAINEE', 'invitee');

const firstInvite = await inviter.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: guestEmail, note: 'first attempt' }) });
assert.equal(firstInvite.status, 201);
const stillPending = await inviter.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: guestEmail }) });
assert.equal(stillPending.status, 409, 'a live invitation still blocks a duplicate');
assert.equal(stillPending.data.error.code, 'INVITE_EXISTS');

// Age the invitation past its expiry the way seven days would.
const expire = await fetch(`${base}/api/test/expire-invitation`, {
  method: 'POST',
  headers: { Cookie: inviter.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': inviter.csrf },
  body: JSON.stringify({ invitationId: firstInvite.data.invitation.id })
});
assert.equal(expire.status, 200, 'the test-only expiry hook must be available outside production');

const reInvite = await inviter.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: guestEmail, note: 'second attempt' }) });
assert.equal(reInvite.status, 201, 'a lapsed invitation must not lock the address out for good');

const lapsedAccept = await guest.request(`/api/invitations/${firstInvite.data.invitation.inviteCode}/accept`, { method: 'POST', body: '{}' });
assert.equal(lapsedAccept.status, 403, 'the expired code itself still cannot be redeemed');

// --- B3 a second active trainer is a conflict, not a crash -----------------
const rival = new Actor(); await rival.start();
await rival.register('TRAINER', 'rival');
// Both trainers have a live invitation out to the same person at once.
const rivalInvite = await rival.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: guestEmail, note: 'poaching' }) });
assert.equal(rivalInvite.status, 201);
assert.equal((await guest.request(`/api/invitations/${reInvite.data.invitation.inviteCode}/accept`, { method: 'POST', body: '{}' })).status, 200);

// Accepting the second one has to be refused cleanly, not trip a unique index.
const secondTrainer = await guest.request(`/api/invitations/${rivalInvite.data.invitation.inviteCode}/accept`, { method: 'POST', body: '{}' });
assert.equal(secondTrainer.status, 409, 'a second active trainer is reported, not thrown');
assert.equal(secondTrainer.data.error.code, 'RELATIONSHIP_EXISTS');

// --- B6 retention sweeps ---------------------------------------------------
const sweep = await fetch(`${base}/api/test/retention-sweep`, {
  method: 'POST',
  headers: { Cookie: inviter.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': inviter.csrf },
  body: '{}'
});
assert.equal(sweep.status, 200);
const sweepBody = await sweep.json();
assert.ok(Number.isInteger(sweepBody.summary.expiredInvitations));
assert.equal(sweepBody.summary.auditEvents, 0, 'audit retention stays off until somebody approves a period');

// --- B5 deletion reaches the health data -----------------------------------
const leaver = new Actor(); await leaver.start();
const { email: leaverEmail } = await leaver.register('TRAINEE', 'leaver');
const today = new Date().toISOString().slice(0, 10);
assert.equal((await leaver.request('/api/progress-entries', { method: 'POST', body: JSON.stringify({ metricType: 'weight', value: 88, unit: 'kg', note: 'private measurement' }) })).status, 201);
assert.equal((await leaver.request('/api/nutrition-entries', { method: 'POST', body: JSON.stringify({ entryDate: today, entryType: 'LUNCH', description: 'a meal nobody else should keep', calories: 600 }) })).status, 201);

const beforeDeletion = await leaver.request('/api/me/export');
assert.equal(beforeDeletion.data.progressEntries.length, 1);
assert.equal(beforeDeletion.data.nutritionEntries.length, 1);

const deletion = await leaver.request('/api/me/account', {
  method: 'DELETE', body: JSON.stringify({ password: 'PhaseThreePass1!', confirmation: 'DELETE PTRAINER ACCOUNT' })
});
assert.equal(deletion.status, 200);
assert.equal(deletion.data.purged.progressEntries, 1, 'measurements are removed, not just the name on them');
assert.equal(deletion.data.purged.nutritionEntries, 1);
// Counts only: the audit trail must not become the copy of what was deleted.
const auditMetadata = JSON.stringify(deletion.data.purged);
assert.equal(auditMetadata.includes('private measurement'), false);
assert.equal(auditMetadata.includes('a meal nobody else should keep'), false);

const verifyGone = await fetch(`${base}/api/test/health-data-count?email=${encodeURIComponent(leaverEmail)}`, { headers: { Cookie: inviter.cookie } });
assert.equal(verifyGone.status, 200);
const remaining = await verifyGone.json();
assert.equal(remaining.progressEntries, 0, 'no measurement survives the deletion');
assert.equal(remaining.nutritionEntries, 0, 'no meal note survives the deletion');
assert.equal(remaining.workoutLogs, 0);
assert.equal(remaining.setLogs, 0);

console.log(JSON.stringify({
  defaultViewingGranted: 'pass',
  writingOnBehalfDeniedByDefault: 'pass',
  trainerCannotWidenOwnAccess: 'pass',
  permissionShapeValidated: 'pass',
  traineeGrantEnablesWriting: 'pass',
  visibilityRevocable: 'pass',
  guidanceNotGatedByVisibility: 'pass',
  relationshipChangesAudited: 'pass',
  liveInvitationBlocksDuplicate: 'pass',
  expiredInvitationStopsBlocking: 'pass',
  expiredCodeStillUnredeemable: 'pass',
  secondActiveTrainerConflicts: 'pass',
  retentionSweepRuns: 'pass',
  auditRetentionOffByDefault: 'pass',
  deletionPurgesHealthData: 'pass',
  deletionAuditKeepsCountsOnly: 'pass'
}, null, 2));
