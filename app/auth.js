// The signed-out screen: sign in, create an account, the second factor, password
// reset, and the demo buttons. Split out of app.js under CLAUDE.md §3 - extract a
// module when you next have reason to touch the domain - because all of this grew
// at once and app.js was already the largest file in the repository.
//
// A classic script, like its neighbours, loaded after app.js and before
// messages.js (which calls initialize() last). It uses the globals app.js
// declares: $, $$, api, state, setBusy, showApp, showAuth, showToast.

// ---------------------------------------------------------------------------
// Bot protection, from the browser's side.
// ---------------------------------------------------------------------------
// The server hands out a nonce and a difficulty; the answer is a number whose
// SHA-256 digest, prefixed by that nonce, starts with that many zero bits. There
// is nothing for a person to solve here and nothing to click: this is the whole
// reason the check is a proof-of-work rather than a puzzle. Everything is judged
// on the server - bot-protection.mjs is the only judge - so nothing here is a
// security control, it is only the work.
const CHALLENGE_ATTEMPT_CEILING = 8_000_000;

async function solveProofOfWork(purpose, onSlow) {
  const issued = await api('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose }) });
  // crypto.subtle exists only in a secure context. Over https or on localhost it
  // is there; on a plain-http LAN address it is not, and saying so beats a button
  // that silently never finishes.
  if (!globalThis.crypto?.subtle) throw Object.assign(new Error('This browser check needs a secure connection (https). Open Ptrainer over https and try again.'), { code: 'CHALLENGE_UNAVAILABLE' });
  const encoder = new TextEncoder();
  const started = performance.now();
  let warned = false;
  for (let candidate = 0; candidate < CHALLENGE_ATTEMPT_CEILING; candidate += 1) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${issued.nonce}:${candidate}`)));
    let bits = 0;
    for (const byte of digest) { if (byte === 0) { bits += 8; continue; } bits += Math.clz32(byte) - 24; break; }
    if (bits >= issued.difficulty) return { challengeNonce: issued.nonce, challengeSolution: String(candidate) };
    // Yield often enough that the page stays responsive, and only mention the
    // check if it is slow enough for somebody to notice it.
    if (candidate % 256 === 255) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!warned && performance.now() - started > 400) { warned = true; onSlow?.(); }
    }
  }
  throw Object.assign(new Error('The browser check did not finish. Please try again.'), { code: 'CHALLENGE_UNAVAILABLE' });
}

// Sign-in carries no challenge until the server asks for one, which it does with
// 428 after repeated failures; registration and reset always carry one, so those
// solve up front rather than spending a round trip learning they must.
async function postGuarded(path, payload, purpose, onSlow) {
  const send = extra => api(path, { method: 'POST', body: JSON.stringify({ ...payload, ...extra }) });
  if (purpose !== 'login') return send(await solveProofOfWork(purpose, onSlow));
  try { return await send({}); }
  catch (error) {
    if (error.code !== 'CHALLENGE_REQUIRED') throw error;
    return send(await solveProofOfWork(purpose, onSlow));
  }
}

// ---------------------------------------------------------------------------
// Form plumbing: one submission at a time, errors that a screen reader reaches.
// ---------------------------------------------------------------------------
const inFlight = new WeakSet();

// The disabled button is the visible guard; this is the one that holds when a
// keyboard sends submit twice before the first handler has disabled anything.
async function submitOnce(form, run) {
  if (inFlight.has(form)) return;
  inFlight.add(form);
  try { await run(); } finally { inFlight.delete(form); }
}

function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid="true"]').forEach(field => field.removeAttribute('aria-invalid'));
}

// The message goes in the form's single role="alert" region, which is announced
// on change; aria-invalid marks the field itself so a screen reader says the
// field is wrong when it is reached, and focus moves there so a keyboard user
// does not have to hunt for it. Colour is never the only signal - see design.md.
function showFormError(form, errorNode, message, fieldName) {
  clearFieldErrors(form);
  errorNode.textContent = message;
  const field = fieldName && form.elements[fieldName];
  if (field && typeof field.focus === 'function') { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

// Which field an error code points at, so the message lands next to the cause
// instead of only at the foot of the form.
const ERROR_FIELDS = {
  NAME_INVALID: 'name', EMAIL_INVALID: 'email', PASSWORD_WEAK: 'password', ROLE_INVALID: 'role',
  PRIVACY_CONSENT_REQUIRED: 'privacyAccepted', CREDENTIALS_INVALID: 'password',
  RESET_TOKEN_INVALID: 'token', TWO_FACTOR_INVALID: 'code', VERIFICATION_TOKEN_REQUIRED: 'token'
};

// ---------------------------------------------------------------------------
// Show/hide password.
// ---------------------------------------------------------------------------
// One delegated listener, so a new password field only needs the markup. The
// button reports state through aria-pressed rather than by its label alone.
document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-reveal]');
  if (!toggle) return;
  const field = document.getElementById(toggle.dataset.reveal);
  if (!field) return;
  const shown = field.type === 'text';
  field.type = shown ? 'password' : 'text';
  toggle.setAttribute('aria-pressed', String(!shown));
  toggle.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
  toggle.textContent = shown ? 'Show' : 'Hide';
  // Keep the caret where it was rather than sending it to the start.
  const at = field.value.length;
  field.focus();
  try { field.setSelectionRange(at, at); } catch { /* not all inputs support it */ }
});

// ---------------------------------------------------------------------------
// Panels.
// ---------------------------------------------------------------------------
const AUTH_PANELS = { login: '#loginForm', register: '#registerForm', forgot: '#forgotPasswordForm', twoFactor: '#twoFactorForm' };

function showAuthPanel(panel) {
  for (const [name, selector] of Object.entries(AUTH_PANELS)) $(selector).hidden = name !== panel;
  $$('[data-auth-tab]').forEach(item => item.classList.toggle('active', item.dataset.authTab === panel));
  // The tabs are a choice between signing in and signing up. On the reset and
  // second-factor screens there is no choice to offer, and leaving them visible
  // invites somebody to click away mid-flow and lose what they were doing.
  $('.auth-tabs').hidden = panel === 'forgot' || panel === 'twoFactor';
  $('.auth-intro').hidden = panel === 'twoFactor';
  const heading = $(`${AUTH_PANELS[panel]} h2`);
  if (heading && panel !== 'login') heading.focus?.();
}

$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
  showAuthPanel(button.dataset.authTab);
  // Carry a typed address across, so switching to sign up after "that address is
  // already taken" does not mean typing it again.
  const from = button.dataset.authTab === 'register' ? '#loginForm' : '#registerForm';
  const to = button.dataset.authTab === 'register' ? '#registerForm' : '#loginForm';
  const typed = $(`${from} [name="email"]`)?.value;
  const target = $(`${to} [name="email"]`);
  if (typed && target && !target.value) target.value = typed;
}));

$('#forgotPasswordButton').addEventListener('click', () => {
  const email = new FormData($('#loginForm')).get('email');
  showAuthPanel('forgot');
  if (email) $('#forgotPasswordForm [name="email"]').value = email;
});
$('#backToLoginButton').addEventListener('click', () => showAuthPanel('login'));
$('#twoFactorCancel').addEventListener('click', () => {
  // Abandoning the second step must not leave a half-finished sign-in lying
  // around in the page, or the next attempt reuses a ticket the server has
  // already timed out and the error makes no sense.
  pendingSignIn = null;
  $('#twoFactorForm').reset();
  showAuthPanel('login');
});

// ---------------------------------------------------------------------------
// Sign in.
// ---------------------------------------------------------------------------
let pendingSignIn = null;

$('#loginForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    const errorNode = $('#loginError');
    errorNode.textContent = '';
    clearFieldErrors(form);
    setBusy(button, true, 'Signing in…');
    try {
      const result = await postGuarded('/api/auth/login', { email: fields.get('email'), password: fields.get('password') }, 'login', () => setBusy(button, true, 'Checking browser…'));
      if (result.twoFactorRequired) {
        pendingSignIn = { ticket: result.ticket, recoveryAvailable: result.recoveryAvailable };
        // The ticket stands in for the password from here on, so the password
        // does not stay sitting in a hidden field while the code is entered.
        form.elements.password.value = '';
        $('#twoFactorRecoveryToggle').hidden = !result.recoveryAvailable;
        useRecoveryCode(false);
        showAuthPanel('twoFactor');
        $('#twoFactorForm [name="code"]').focus();
        return;
      }
      state.csrfToken = result.csrfToken;
      await showApp(result.user);
      form.reset();
    } catch (error) {
      showFormError(form, errorNode, error.message, ERROR_FIELDS[error.code]);
      // The address is safe to keep and tedious to retype; the password is the
      // part that was wrong, so it is cleared and focused.
      if (error.code === 'CREDENTIALS_INVALID') form.elements.password.value = '';
    } finally { setBusy(button, false); }
  });
});

// ---------------------------------------------------------------------------
// The second factor.
// ---------------------------------------------------------------------------
function useRecoveryCode(on) {
  $('#twoFactorCodeField').hidden = on;
  $('#twoFactorRecoveryField').hidden = !on;
  $('#twoFactorForm').dataset.mode = on ? 'recovery' : 'code';
  $('#twoFactorRecoveryToggle').textContent = on ? 'Use a code from my authenticator app' : 'I cannot use my authenticator app';
  const field = on ? '#twoFactorForm [name="recoveryCode"]' : '#twoFactorForm [name="code"]';
  $(field).focus();
}
$('#twoFactorRecoveryToggle').addEventListener('click', () => useRecoveryCode($('#twoFactorForm').dataset.mode !== 'recovery'));

$('#twoFactorForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const errorNode = $('#twoFactorError');
    errorNode.textContent = '';
    clearFieldErrors(form);
    if (!pendingSignIn) { showAuthPanel('login'); $('#loginError').textContent = 'That sign-in timed out. Please enter your password again.'; return; }
    const recovery = form.dataset.mode === 'recovery';
    const fields = new FormData(form);
    setBusy(button, true, 'Checking…');
    try {
      const payload = recovery ? { ticket: pendingSignIn.ticket, recoveryCode: fields.get('recoveryCode') } : { ticket: pendingSignIn.ticket, code: fields.get('code') };
      const result = await api('/api/auth/2fa', { method: 'POST', body: JSON.stringify(payload) });
      state.csrfToken = result.csrfToken;
      pendingSignIn = null;
      form.reset();
      // The sign-in form behind this one still held the address; without this
      // the next sign-in on this device typed onto it.
      $('#loginForm').reset();
      await showApp(result.user);
      if (result.recoveryCodeUsed) showToast(`Signed in with a recovery code. ${result.recoveryCodesRemaining} left - make new ones in Settings.`, 8000);
    } catch (error) {
      // An expired ticket is a dead end unless it sends you back to the password
      // field, so it does, with the reason.
      if (error.code === 'TWO_FACTOR_EXPIRED') {
        pendingSignIn = null;
        form.reset();
        showAuthPanel('login');
        $('#loginError').textContent = error.message;
        return;
      }
      showFormError(form, errorNode, error.message, recovery ? 'recoveryCode' : 'code');
      form.elements[recovery ? 'recoveryCode' : 'code'].value = '';
    } finally { setBusy(button, false); }
  });
});

// ---------------------------------------------------------------------------
// Create an account.
// ---------------------------------------------------------------------------
// Live feedback on the password rules, so the requirement is met before the form
// is submitted rather than explained after it is refused.
const PASSWORD_RULES = [
  { label: '10 characters', test: value => value.length >= 10 },
  { label: 'lower and upper case', test: value => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { label: 'a number', test: value => /\d/.test(value) },
  { label: 'a symbol', test: value => /[^A-Za-z0-9]/.test(value) }
];
const registerPassword = $('#registerForm [name="password"]');
registerPassword.addEventListener('input', () => {
  const value = registerPassword.value;
  const missing = PASSWORD_RULES.filter(rule => !rule.test(value));
  const hint = $('#registerPasswordHint');
  if (!value) { hint.textContent = '10+ characters with upper and lower case, a number, and a symbol.'; hint.dataset.state = ''; return; }
  hint.dataset.state = missing.length ? 'short' : 'ok';
  hint.textContent = missing.length ? `Still needs ${missing.map(rule => rule.label).join(', ')}.` : 'That will do.';
});

$('#registerForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    const errorNode = $('#registerError');
    errorNode.textContent = '';
    clearFieldErrors(form);
    setBusy(button, true, 'Creating account…');
    try {
      const result = await postGuarded('/api/auth/register', {
        name: fields.get('name'), email: fields.get('email'), password: fields.get('password'),
        role: fields.get('role'), privacyAccepted: fields.get('privacyAccepted') === 'on',
        privacyNoticeVersion: fields.get('privacyNoticeVersion')
      }, 'register', () => setBusy(button, true, 'Checking browser…'));
      // A 202 means the server will not say whether that address already has an
      // account - see the anti-enumeration note in server.mjs. There is no
      // session to move into, so the screen has to end somewhere sensible rather
      // than appearing to hang.
      if (result.pending) {
        form.reset();
        showAuthPanel('login');
        $('#loginError').textContent = result.message || 'Check your email to continue.';
        $('#loginForm [name="email"]').value = fields.get('email');
        return;
      }
      state.csrfToken = result.csrfToken;
      await showApp(result.user);
      form.reset();
      $('#registerPasswordHint').textContent = '10+ characters with upper and lower case, a number, and a symbol.';
      $('#registerPasswordHint').dataset.state = '';
      showToast(verificationMessage(result.emailVerification, `Your account is ready. Check ${result.user.email} for a confirmation link.`), 6000);
    } catch (error) {
      showFormError(form, errorNode, error.message, ERROR_FIELDS[error.code]);
    } finally { setBusy(button, false); }
  });
});

// ---------------------------------------------------------------------------
// Password reset.
// ---------------------------------------------------------------------------
$('#requestResetButton').addEventListener('click', async event => {
  const button = event.currentTarget;
  const form = $('#forgotPasswordForm');
  const email = new FormData(form).get('email');
  const errorNode = $('#resetError');
  errorNode.textContent = '';
  if (!email) { showFormError(form, errorNode, 'Enter the address on your account first.', 'email'); return; }
  setBusy(button, true, 'Creating…');
  try {
    const result = await postGuarded('/api/auth/forgot-password', { email }, 'reset', () => setBusy(button, true, 'Checking browser…'));
    if (result.demoResetToken) {
      const tokenInput = form.querySelector('[name="token"]');
      tokenInput.value = result.demoResetToken;
      tokenInput.classList.add('reset-code-ready');
      errorNode.textContent = 'Local development code created and filled in below.';
    } else errorNode.textContent = result.message;
  } catch (error) { showFormError(form, errorNode, error.message, ERROR_FIELDS[error.code]); }
  finally { setBusy(button, false); }
});

$('#forgotPasswordForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    const errorNode = $('#resetError');
    errorNode.textContent = '';
    clearFieldErrors(form);
    setBusy(button, true, 'Updating…');
    try {
      const result = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: fields.get('token'), password: fields.get('password') }) });
      state.csrfToken = result.csrfToken;
      form.reset();
      showAuthPanel('login');
      showToast('Password updated. Sign in with your new password.');
    } catch (error) { showFormError(form, errorNode, error.message, ERROR_FIELDS[error.code]); }
    finally { setBusy(button, false); }
  });
});

// ---------------------------------------------------------------------------
// The demo buttons.
// ---------------------------------------------------------------------------
// No credentials here. app.js used to hold both demo passwords as literals, which
// served the credentials of a live account to every visitor; the button now names
// a role and the server picks the account. See /api/auth/demo in server.mjs.
$$('[data-demo]').forEach(button => button.addEventListener('click', async () => {
  const role = button.dataset.demo;
  setBusy(button, true, 'Opening…');
  $('#loginError').textContent = '';
  try {
    const result = await api('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role }) });
    state.csrfToken = result.csrfToken;
    await showApp(result.user);
  } catch (error) { $('#loginError').textContent = error.message; }
  finally { setBusy(button, false); }
}));

// ---------------------------------------------------------------------------
// Two-factor authentication in Settings.
// ---------------------------------------------------------------------------
async function loadTwoFactorPanel() {
  const status = $('#twoFactorStatus');
  const setupBlock = $('#twoFactorSetup');
  try {
    const result = await api('/api/me/2fa');
    setupBlock.hidden = true;
    $('#twoFactorCodes').hidden = true;
    $('#twoFactorEnable').hidden = result.enabled;
    $('#twoFactorDisable').hidden = !result.enabled;
    $('#twoFactorRegenerate').hidden = !result.enabled;
    status.textContent = result.enabled
      ? `On. ${result.recoveryCodesRemaining} recovery ${result.recoveryCodesRemaining === 1 ? 'code' : 'codes'} unused.`
      : result.enrolling ? 'Not finished. Start again to get a new secret.' : 'Off. Your password is the only thing protecting this account.';
    status.dataset.state = result.enabled ? 'on' : 'off';
  } catch (error) { status.textContent = error.message; }
}

// The secret is shown once, at enrolment, and never again - so it is rendered
// here rather than stored anywhere the page can read it back.
$('#twoFactorEnable').addEventListener('click', () => {
  $('#twoFactorSetup').hidden = false;
  $('#twoFactorEnable').hidden = true;
  $('#twoFactorSetupError').textContent = '';
  $('#twoFactorSecretBlock').hidden = true;
  $('#twoFactorConfirmBlock').hidden = true;
  $('#twoFactorSetupForm').reset();
  $('#twoFactorSetupForm [name="password"]').focus();
});

$('#twoFactorSetupForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const errorNode = form.querySelector('.form-error');
    errorNode.textContent = '';
    setBusy(button, true, 'Checking…');
    try {
      const result = await api('/api/me/2fa/setup', { method: 'POST', body: JSON.stringify({ password: new FormData(form).get('password') }) });
      // Grouped in fours because this gets typed by hand into a phone.
      $('#twoFactorSecret').textContent = result.secret.replace(/(.{4})/g, '$1 ').trim();
      $('#twoFactorLink').href = result.otpauthUri;
      $('#twoFactorSecretBlock').hidden = false;
      $('#twoFactorConfirmBlock').hidden = false;
      form.reset();
      $('#twoFactorConfirmForm [name="code"]').focus();
    } catch (error) { showFormError(form, errorNode, error.message, 'password'); }
    finally { setBusy(button, false); }
  });
});

$('#twoFactorConfirmForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  submitOnce(form, async () => {
    const button = form.querySelector('[type="submit"]');
    const errorNode = form.querySelector('.form-error');
    errorNode.textContent = '';
    setBusy(button, true, 'Turning on…');
    try {
      const result = await api('/api/me/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: new FormData(form).get('code') }) });
      form.reset();
      $('#twoFactorSetup').hidden = true;
      renderRecoveryCodes(result.recoveryCodes, 'Two-factor authentication is on. Save these recovery codes somewhere safe - they are shown once.');
      await loadTwoFactorPanel();
      $('#twoFactorCodes').hidden = false;
    } catch (error) { showFormError(form, errorNode, error.message, 'code'); }
    finally { setBusy(button, false); }
  });
});

function renderRecoveryCodes(codes, message) {
  $('#twoFactorCodesNote').textContent = message;
  $('#twoFactorCodesList').innerHTML = codes.map(code => `<li>${escapeText(code)}</li>`).join('');
  $('#twoFactorCodes').hidden = false;
}
$('#twoFactorCodesCopy').addEventListener('click', async () => {
  const codes = [...$('#twoFactorCodesList').querySelectorAll('li')].map(item => item.textContent).join('\n');
  try { await navigator.clipboard.writeText(codes); showToast('Recovery codes copied'); }
  catch { showToast('Copy failed - select the codes and copy them by hand'); }
});

// Both of these are privilege changes, so both ask for the password and a live
// second factor. A recovery code is accepted in place of an app code because
// "my phone is gone" is exactly when somebody needs to turn this off.
for (const [buttonId, formId, path, verb] of [['twoFactorDisable', 'twoFactorDisableForm', '/api/me/2fa/disable', 'Turning off…'], ['twoFactorRegenerate', 'twoFactorRegenerateForm', '/api/me/2fa/recovery-codes', 'Creating…']]) {
  $(`#${buttonId}`).addEventListener('click', () => {
    const form = $(`#${formId}`);
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('[name="password"]').focus();
  });
  $(`#${formId}`).addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitOnce(form, async () => {
      const button = form.querySelector('[type="submit"]');
      const errorNode = form.querySelector('.form-error');
      errorNode.textContent = '';
      const fields = new FormData(form);
      const entered = String(fields.get('code') || '').trim();
      // One field takes either kind of code; which one it is, is decided by shape
      // rather than by asking somebody to classify their own code.
      const isAppCode = /^\d{6}$/.test(entered.replace(/\s/g, ''));
      setBusy(button, true, verb);
      try {
        const result = await api(path, { method: 'POST', body: JSON.stringify({ password: fields.get('password'), ...(isAppCode ? { code: entered } : { recoveryCode: entered }) }) });
        form.reset();
        form.hidden = true;
        if (result.recoveryCodes) renderRecoveryCodes(result.recoveryCodes, 'New recovery codes. The previous set no longer works.');
        else $('#twoFactorCodes').hidden = true;
        await loadTwoFactorPanel();
      } catch (error) { showFormError(form, errorNode, error.message, error.code === 'CREDENTIALS_INVALID' ? 'password' : 'code'); }
      finally { setBusy(button, false); }
    });
  });
}

// Leaving the demo. A plain sign-out, but named for what it means here, so
// nobody has to work out that "sign out" is how you get your own account back.
$('#demoBannerExit').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
  finally {
    state.csrfToken = '';
    const session = await api('/api/session');
    state.csrfToken = session.csrfToken;
    showAuth();
    showAuthPanel('login');
  }
});
