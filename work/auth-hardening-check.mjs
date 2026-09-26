// The login and signup surface, exercised the way an attacker and a person each
// meet it: two-factor enrolment and sign-in, recovery codes, bot protection,
// account enumeration, rate limits, and the demo account's boundaries.
//
// Every assertion here is about a *denied* case as much as an allowed one, which
// is what CLAUDE.md §8 asks of anything touching authorization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { totpCode } from '../app/totp.mjs';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`  ok  ${label}`); };

// Solve a proof-of-work the way the browser does, so this file never depends on
// the server's own solver being reachable.
function solve(nonce, difficulty) {
  for (let candidate = 0; ; candidate += 1) {
    const digest = createHash('sha256').update(`${nonce}:${candidate}`).digest();
    let bits = 0;
    for (const byte of digest) { if (byte === 0) { bits += 8; continue; } bits += Math.clz32(byte) - 24; break; }
    if (bits >= difficulty) return String(candidate);
  }
}

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
  // Ask for a challenge and solve it, exactly as the page does.
  async solved(purpose) {
    const issued = await this.request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose }) });
    assert.equal(issued.status, 201, 'a challenge is issued');
    return { challengeNonce: issued.data.nonce, challengeSolution: solve(issued.data.nonce, issued.data.difficulty) };
  }
  async register(role, label, password = 'HardeningPass1!') {
    const notice = (await this.request('/api/privacy')).data.noticeVersion;
    const email = `harden_${label}_${stamp}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Harden ${label}`, email, password, role, privacyAccepted: true, privacyNoticeVersion: notice, ...(await this.solved('register')) })
    });
    if (result.status === 429) { console.error('Registration rate limit spent; restart the app and rerun.'); process.exit(2); }
    assert.equal(result.status, 201, `registration for ${label}: ${JSON.stringify(result.data)}`);
    return { email, password, user: result.data.user };
  }
  // Sign-in carries no challenge until this address has failed a couple of
  // times, and then it does. The page handles that by fetching one and retrying
  // once, so this does too - which is also how the escalation path gets tested.
  async login(email, password, extra = {}) {
    const first = await this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...extra }) });
    if (first.status !== 428) return first;
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...extra, ...(await this.solved('login')) }) });
  }
  loginRaw(email, password) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); }
}

console.log('\n1. Bot protection is server-side, single-use and purpose-bound');
{
  const visitor = await new Actor().start();
  const issued = await visitor.request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose: 'register' }) });
  assert.equal(issued.status, 201);
  check('a challenge carries a nonce and a difficulty', () => {
    assert.match(issued.data.nonce, /^[0-9a-f]{32}$/);
    assert.ok(issued.data.difficulty >= 13, 'difficulty is at least the base');
  });

  const notice = (await visitor.request('/api/privacy')).data.noticeVersion;
  const body = extra => JSON.stringify({ name: 'Bot Check', email: `bot_${stamp}@ptrainer.local`, password: 'HardeningPass1!', role: 'TRAINEE', privacyAccepted: true, privacyNoticeVersion: notice, ...extra });

  const noChallenge = await visitor.request('/api/auth/register', { method: 'POST', body: body({}) });
  check('registration without a challenge is refused with 428', () => {
    assert.equal(noChallenge.status, 428);
    assert.equal(noChallenge.data.error.code, 'CHALLENGE_REQUIRED');
  });

  const wrongAnswer = await visitor.request('/api/auth/register', { method: 'POST', body: body({ challengeNonce: issued.data.nonce, challengeSolution: '0' }) });
  check('a wrong solution is refused, not trusted', () => assert.equal(wrongAnswer.status, 428));

  // That attempt consumed the challenge, so a correct answer to it is now stale:
  // this is what stops one solved puzzle being replayed across many signups.
  const solution = solve(issued.data.nonce, issued.data.difficulty);
  const stale = await visitor.request('/api/auth/register', { method: 'POST', body: body({ challengeNonce: issued.data.nonce, challengeSolution: solution }) });
  check('a challenge cannot be reused once submitted', () => assert.equal(stale.status, 428));

  const reset = await visitor.request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose: 'reset' }) });
  const crossPurpose = await visitor.request('/api/auth/register', { method: 'POST', body: body({ challengeNonce: reset.data.nonce, challengeSolution: solve(reset.data.nonce, reset.data.difficulty) }) });
  check('a reset challenge does not satisfy registration', () => {
    assert.equal(crossPurpose.status, 428);
    assert.equal(crossPurpose.data.error.reason, 'CHALLENGE_PURPOSE');
  });

  const badPurpose = await visitor.request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose: 'anything' }) });
  check('an unknown challenge purpose is rejected', () => assert.equal(badPurpose.status, 422));
}

console.log('\n2. Registration does not disclose whether an address is taken');
{
  const visitor = await new Actor().start();
  const account = await visitor.register('TRAINEE', 'enum');
  const second = await new Actor().start();
  const notice = (await second.request('/api/privacy')).data.noticeVersion;
  const again = await second.request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Someone Else', email: account.email, password: 'DifferentPass1!', role: 'TRAINEE', privacyAccepted: true, privacyNoticeVersion: notice, ...(await second.solved('register')) })
  });
  check('a taken address answers 202, not 409', () => {
    assert.equal(again.status, 202);
    assert.equal(again.data.pending, true);
    assert.equal(JSON.stringify(again.data).includes('EMAIL_EXISTS'), false, 'no code that names the cause');
  });
  check('and issues no session for the address it did not create', () => assert.equal(again.data.user, undefined));

  const unknown = await new Actor().start();
  const missing = await unknown.login(`nobody_${stamp}@ptrainer.local`, 'WhateverPass1!');
  const wrong = await unknown.login(account.email, 'WrongPass1!');
  check('an unknown address and a wrong password are indistinguishable', () => {
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(missing.data.error, wrong.data.error);
  });
}

console.log('\n2b. Sign-in stays simple until it should not');
{
  // A fresh address has no history, so the first attempt carries no challenge at
  // all: this is the "keep normal login simple" requirement, asserted rather
  // than assumed.
  const clean = await new Actor().start();
  const account = await clean.register('TRAINEE', 'escalate');
  const straight = await clean.loginRaw(account.email, account.password);
  check('a first sign-in needs no browser check', () => {
    assert.equal(straight.status, 200);
    assert.equal(straight.data.user.email, account.email);
  });

  // Three wrong passwords, then the same address is made to pay.
  for (let attempt = 0; attempt < 3; attempt += 1) await clean.loginRaw(account.email, 'WrongPass1!');
  const escalated = await clean.loginRaw(account.email, account.password);
  check('after repeated failures a challenge is demanded', () => {
    assert.equal(escalated.status, 428);
    assert.equal(escalated.data.error.code, 'CHALLENGE_REQUIRED');
  });
  const solvedRetry = await clean.login(account.email, account.password);
  check('and solving it lets the right password through', () => assert.equal(solvedRetry.status, 200));
}

console.log('\n3. Two-factor enrolment, sign-in, replay and recovery');
{
  const owner = await new Actor().start();
  const account = await owner.register('TRAINER', '2fa');

  const noPassword = await owner.request('/api/me/2fa/setup', { method: 'POST', body: JSON.stringify({ password: 'NotThePassword1!' }) });
  check('enrolment needs the account password', () => assert.equal(noPassword.status, 401));

  const setup = await owner.request('/api/me/2fa/setup', { method: 'POST', body: JSON.stringify({ password: account.password }) });
  check('setup returns a secret and an otpauth uri', () => {
    assert.equal(setup.status, 201);
    assert.match(setup.data.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\//);
  });
  const secret = setup.data.secret;

  const stillOff = await owner.request('/api/me/2fa');
  check('an unconfirmed enrolment is not yet in force', () => {
    assert.equal(stillOff.data.enabled, false);
    assert.equal(stillOff.data.enrolling, true);
  });

  const badConfirm = await owner.request('/api/me/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: '000000' }) });
  check('a wrong code does not enable it', () => assert.equal(badConfirm.status, 422));

  const confirm = await owner.request('/api/me/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: totpCode(secret) }) });
  check('a real code from the app enables it and returns recovery codes', () => {
    assert.equal(confirm.status, 200);
    assert.equal(confirm.data.enabled, true);
    assert.equal(confirm.data.recoveryCodes.length, 10);
  });
  const recoveryCodes = confirm.data.recoveryCodes;

  // Sign in again from a clean client: password alone must not be enough.
  const returning = await new Actor().start();
  const firstStep = await returning.login(account.email, account.password);
  check('a correct password alone yields no session, only a ticket', () => {
    assert.equal(firstStep.status, 200);
    assert.equal(firstStep.data.twoFactorRequired, true);
    assert.ok(firstStep.data.ticket);
    assert.equal(firstStep.data.user, undefined);
  });
  const peek = await returning.request('/api/me');
  check('the pending session is still unauthenticated', () => assert.equal(peek.status, 401));

  const wrongCode = await returning.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: firstStep.data.ticket, code: '000000' }) });
  check('a wrong second factor is refused', () => assert.equal(wrongCode.status, 401));

  // Confirming enrolment consumed the current 30-second step, so this signs in
  // with the *next* one. That is not a test workaround - it is the replay guard
  // doing its job, and it means a person who has just enrolled waits for their
  // authenticator to roll over before the first sign-in. Verified below.
  const code = totpCode(secret, Date.now() + 30000);
  const reusedEnrolmentCode = await returning.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: firstStep.data.ticket, code: totpCode(secret) }) });
  check('the code that completed enrolment cannot also sign in', () => {
    assert.equal(reusedEnrolmentCode.status, 401);
    assert.match(reusedEnrolmentCode.data.error.message, /already been used/);
  });
  const second = await returning.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: firstStep.data.ticket, code }) });
  check('the right code completes the sign-in', () => {
    assert.equal(second.status, 200);
    assert.equal(second.data.user.email, account.email);
  });

  // Replay: the same code, a fresh ticket.
  const replayer = await new Actor().start();
  const replayTicket = (await replayer.login(account.email, account.password)).data.ticket;
  const replay = await replayer.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: replayTicket, code }) });
  check('the same code cannot be used twice', () => {
    assert.equal(replay.status, 401);
    assert.match(replay.data.error.message, /already been used/);
  });

  const forged = await new Actor().start();
  const noTicket = await forged.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: 'made-up-ticket', code: totpCode(secret) }) });
  check('an invented ticket is refused', () => assert.equal(noTicket.status, 401));

  // Recovery: one code, used once.
  const lostPhone = await new Actor().start();
  const recoveryTicket = (await lostPhone.login(account.email, account.password)).data.ticket;
  const recovered = await lostPhone.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: recoveryTicket, recoveryCode: recoveryCodes[0] }) });
  check('a recovery code signs in and reports how many are left', () => {
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.recoveryCodeUsed, true);
    assert.equal(recovered.data.recoveryCodesRemaining, 9);
  });
  const reuse = await new Actor().start();
  const reuseTicket = (await reuse.login(account.email, account.password)).data.ticket;
  const spent = await reuse.request('/api/auth/2fa', { method: 'POST', body: JSON.stringify({ ticket: reuseTicket, recoveryCode: recoveryCodes[0] }) });
  check('a spent recovery code is refused', () => assert.equal(spent.status, 401));

  // Disabling needs both factors, then sign-in is one step again.
  const disableNoCode = await lostPhone.request('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ password: account.password, code: '000000' }) });
  check('disabling refuses a wrong code', () => assert.equal(disableNoCode.status, 422));
  const disableNoPassword = await lostPhone.request('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ password: 'Nope1234!x', recoveryCode: recoveryCodes[1] }) });
  check('disabling refuses a wrong password', () => assert.equal(disableNoPassword.status, 401));
  const stillOn = await lostPhone.request('/api/me/2fa');
  check('and a refused attempt did not spend the recovery code', () => {
    assert.equal(stillOn.data.enabled, true);
    assert.equal(stillOn.data.recoveryCodesRemaining, 9);
  });
  // A recovery code is accepted here on purpose: "my phone is gone" is exactly
  // when somebody needs to turn this off, and that is what the codes are for.
  const disabled = await lostPhone.request('/api/me/2fa/disable', { method: 'POST', body: JSON.stringify({ password: account.password, recoveryCode: recoveryCodes[1] }) });
  check('disabling works with the password and a recovery code', () => assert.equal(disabled.status, 200));
  const plain = await new Actor().start();
  const afterOff = await plain.login(account.email, account.password);
  check('sign-in is one step again afterwards', () => {
    assert.equal(afterOff.status, 200);
    assert.equal(afterOff.data.twoFactorRequired, undefined);
    assert.equal(afterOff.data.user.email, account.email);
  });
}

console.log('\n4. The demo accounts open without credentials and stay fenced in');
{
  const visitor = await new Actor().start();
  const trainerDemo = await visitor.request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'trainer' }) });
  check('the trainer demo opens with no password', () => {
    assert.equal(trainerDemo.status, 200);
    assert.equal(trainerDemo.data.user.role, 'TRAINER');
    assert.equal(trainerDemo.data.user.demo, true);
  });

  const dashboard = await visitor.request('/api/dashboard');
  check('and lands on a populated roster', () => {
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.data.activeClients >= 5, `expected the sample roster, got ${dashboard.data.activeClients}`);
    assert.ok(dashboard.data.clients.every(client => client.assignedCount > 0), 'every sample client has a program');
  });

  const invite = await visitor.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: 'real.person@example.com' }) });
  check('a demo trainer cannot email a stranger an invitation', () => {
    assert.equal(invite.status, 403);
    assert.equal(invite.data.error.code, 'DEMO_ACCOUNT');
  });
  // The rule is about the recipient, not the feature: inviting a client is part
  // of what a trainer does and the demo is allowed to show it, as long as the
  // invitation cannot leave the demo.
  const internalInvite = await visitor.request('/api/invitations', { method: 'POST', body: JSON.stringify({ email: 'ellis@ptrainer.local' }) });
  check('but it may invite another demo account, so the flow is still shown', () => {
    assert.ok([201, 409].includes(internalInvite.status), `expected created or already-pending, got ${internalInvite.status}`);
  });
  const enrol = await visitor.request('/api/me/2fa/setup', { method: 'POST', body: JSON.stringify({ password: 'DemoTrainer1!' }) });
  check('a demo account cannot enrol 2FA and lock the next visitor out', () => assert.equal(enrol.status, 403));
  const remove = await visitor.request('/api/me/account', { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE PTRAINER ACCOUNT', password: 'DemoTrainer1!' }) });
  check('a demo account cannot be deleted', () => assert.equal(remove.status, 403));
  const support = await visitor.request('/api/contact', { method: 'POST', body: JSON.stringify({ subject: 'Testing', message: 'Sent from the demo account.' }) });
  check('a demo account cannot send support mail', () => assert.equal(support.status, 403));

  const forgot = await visitor.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'trainer@ptrainer.local', ...(await visitor.solved('reset')) }) });
  check('a reset on a shared demo credential is accepted and does nothing', () => {
    assert.equal(forgot.status, 202);
    assert.equal(forgot.data.demoResetToken, undefined, 'no usable reset token for a demo account');
  });

  // Concurrency: separate visitors must not be handed the same client account.
  const seen = new Set();
  for (let index = 0; index < 5; index += 1) {
    const guest = await new Actor().start();
    const opened = await guest.request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'client' }) });
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assert.equal(opened.data.user.role, 'TRAINEE');
    seen.add(opened.data.user.email);
    const own = await guest.request('/api/dashboard');
    assert.equal(own.status, 200);
  }
  check('five concurrent client demos get five different accounts', () => assert.equal(seen.size, 5, [...seen].join(', ')));

  const role = await visitor.request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'admin' }) });
  check('the demo route will not invent a role', () => assert.equal(role.status, 422));
}

console.log('\n5. A demo visitor cannot read a real account, and vice versa');
{
  const realOwner = await new Actor().start();
  const real = await realOwner.register('TRAINEE', 'private');
  const demoGuest = await new Actor().start();
  await demoGuest.request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'trainer' }) });
  const peek = await demoGuest.request(`/api/progress-entries?traineeId=${real.user.id}`);
  check("the demo trainer cannot read a real trainee's progress", () => assert.ok([403, 404].includes(peek.status), `got ${peek.status}`));
  const notes = await demoGuest.request(`/api/trainer-notes?traineeId=${real.user.id}`);
  check("nor their trainer notes", () => assert.ok([403, 404].includes(notes.status), `got ${notes.status}`));
}

console.log('\n6. A reset is limited to demo data');
{
  const operator = await new Actor().start();
  const real = await operator.register('TRAINEE', 'survivor');
  const before = await operator.request('/api/me');
  assert.equal(before.status, 200);

  const guest = await new Actor().start();
  const reset = await guest.request('/api/demo/reset', { method: 'POST', body: '{}' });
  check('the reset runs and reports what it removed', () => {
    assert.equal(reset.status, 200);
    assert.equal(reset.data.reset, true);
    assert.ok(reset.data.accounts >= 6, 'it found the demo accounts');
  });

  const after = await operator.request('/api/me');
  check('the real account is untouched and still signed in', () => {
    assert.equal(after.status, 200);
    assert.equal(after.data.user.email, real.email);
  });

  const guestAfter = await new Actor().start();
  const reopened = await guestAfter.request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'trainer' }) });
  const rebuilt = await guestAfter.request('/api/dashboard');
  check('and the demo is rebuilt, not emptied', () => {
    assert.equal(reopened.status, 200);
    assert.ok(rebuilt.data.activeClients >= 5);
    assert.ok(rebuilt.data.clients.every(client => client.assignedCount > 0), 'programs came back');
  });
}

console.log(`\nAll ${passed} auth-hardening assertions passed.\n`);
