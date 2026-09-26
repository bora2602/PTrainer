// The sign-in page's contract between auth.js and index.html.
//
// auth.js reaches into the document by id. A renamed or deleted element does not
// throw at load - it throws when somebody presses the button, which on the
// sign-in screen means the page is simply broken for everyone and no server-side
// check notices. This asserts statically that every element auth.js addresses
// exists, that every password-reveal button points at a real input, and that the
// fields each form reads are actually in that form.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../app/auth.js', import.meta.url), 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const classes = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
const failures = [];
const ok = [];

// ---- Every $('#id') and $('.class') in auth.js resolves. -------------------
for (const [, selector] of js.matchAll(/\$\('(#[A-Za-z0-9_-]+)'\)/g)) {
  if (!ids.has(selector.slice(1))) failures.push(`auth.js addresses ${selector}, which is not in index.html`);
}
for (const [, selector] of js.matchAll(/\$\('(\.[A-Za-z0-9_-]+)'\)/g)) {
  if (!classes.has(selector.slice(1))) failures.push(`auth.js addresses ${selector}, which is not in index.html`);
}
// Template-built selectors: $(`${AUTH_PANELS[panel]} h2`) and friends resolve
// through this table, so the table's own values are checked.
for (const [, selector] of js.matchAll(/(?:login|register|forgot|twoFactor):\s*'(#[A-Za-z0-9_-]+)'/g)) {
  if (!ids.has(selector.slice(1))) failures.push(`the panel table names ${selector}, which is not in index.html`);
}
ok.push('every element auth.js addresses by id or class exists');

// ---- Every reveal button points at an input that exists. ------------------
const reveals = [...html.matchAll(/data-reveal="([^"]+)"/g)].map(match => match[1]);
assert.ok(reveals.length >= 5, `expected reveal buttons on every password field, found ${reveals.length}`);
for (const target of reveals) {
  if (!ids.has(target)) failures.push(`a reveal button points at #${target}, which does not exist`);
  // The pair has to be a password input, or "show" has nothing to show.
  const field = html.match(new RegExp(`<input[^>]*id="${target}"[^>]*>`));
  if (!field) failures.push(`#${target} is not an input`);
  else if (!/type="password"/.test(field[0])) failures.push(`#${target} is not a password field`);
}
ok.push(`all ${reveals.length} password fields have a working reveal button`);

// ---- Every password field is reachable by a password manager. -------------
// autocomplete is what tells a manager whether this is a sign-in, a sign-up or a
// change; without it, saved credentials do not offer themselves.
for (const target of reveals) {
  const field = html.match(new RegExp(`<input[^>]*id="${target}"[^>]*>`))?.[0] || '';
  if (!/autocomplete="(current-password|new-password)"/.test(field)) failures.push(`#${target} has no current-password/new-password autocomplete hint`);
}
// And the address fields, likewise.
for (const id of ['loginEmail', 'registerEmail', 'resetEmail']) {
  const field = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || '';
  if (!/autocomplete="email"/.test(field)) failures.push(`#${id} has no email autocomplete hint`);
  if (!/type="email"/.test(field)) failures.push(`#${id} is not type=email, so a phone shows the wrong keyboard`);
}
ok.push('password and email fields carry autocomplete hints a manager understands');

// ---- Every label points at a field that exists. --------------------------
for (const [, target] of html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)) {
  if (!ids.has(target)) failures.push(`a label points at #${target}, which does not exist`);
}
ok.push('every label names a field that exists');

// ---- The fields each form reads are in that form. ------------------------
// A FormData read of a field that moved returns null, and the request goes out
// with a missing value rather than failing loudly.
const formOf = name => {
  const match = html.match(new RegExp(`<form[^>]*id="${name}"[\\s\\S]*?</form>`));
  assert.ok(match, `form #${name} is missing from index.html`);
  return match[0];
};
const READS = {
  loginForm: ['email', 'password'],
  registerForm: ['name', 'email', 'password', 'role', 'privacyAccepted', 'privacyNoticeVersion'],
  forgotPasswordForm: ['email', 'token', 'password'],
  twoFactorForm: ['code', 'recoveryCode'],
  twoFactorSetupForm: ['password'],
  twoFactorConfirmForm: ['code'],
  twoFactorDisableForm: ['password', 'code'],
  twoFactorRegenerateForm: ['password', 'code']
};
for (const [form, fields] of Object.entries(READS)) {
  const markup = formOf(form);
  for (const field of fields) {
    if (!new RegExp(`name="${field}"`).test(markup)) failures.push(`#${form} has no field named "${field}", but auth.js reads one`);
  }
}
ok.push('every field the scripts read exists in the form they read it from');

// ---- Each form has one alert region for its errors. ----------------------
for (const form of Object.keys(READS)) {
  const markup = formOf(form);
  if (!/role="alert"/.test(markup)) failures.push(`#${form} has no role="alert" region, so its errors are never announced`);
}
ok.push('every form has a live region for its errors');

// ---- The demo buttons ask for roles the server accepts. -----------------
const roles = [...html.matchAll(/data-demo="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(roles.sort(), ['client', 'trainer'], `demo buttons must offer exactly trainer and client, found ${roles}`);
ok.push('the demo buttons offer exactly the two roles /api/auth/demo accepts');

// ---- No credential is left in anything the browser downloads. -----------
// This is the regression that mattered most: both demo passwords used to be
// literals in app.js, so the credentials of a live account were served to every
// visitor and sat in every page cache.
for (const file of ['app.js', 'auth.js', 'workouts.js', 'messages.js', 'index.html']) {
  const text = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8');
  for (const secret of ['DemoTrainer1!', 'DemoTrainee1!']) {
    if (text.includes(secret)) failures.push(`${file} contains the demo password ${secret} and is served to every visitor`);
  }
}
ok.push('no demo password appears in any file the browser downloads');

// ---- auth.js is actually served and loaded in the right order. ----------
const serverSource = await readFile(new URL('../app/server.mjs', import.meta.url), 'utf8');
assert.match(serverSource, /PUBLIC_FILES[^;]*'auth\.js'/, 'auth.js must be in PUBLIC_FILES or the sign-in page has no script');
const order = ['app.js', 'auth.js', 'messages.js'].map(file => html.indexOf(`src="${file}`));
assert.ok(order.every(position => position > 0), 'app.js, auth.js and messages.js must all be loaded');
assert.ok(order[0] < order[1], 'auth.js must load after app.js, whose globals it uses');
assert.ok(order[1] < order[2], 'auth.js must load before messages.js, which calls initialize()');
ok.push('auth.js is served and loads between app.js and messages.js');

if (failures.length) {
  console.error('\nThe sign-in page contract is broken:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  process.exit(1);
}
for (const line of ok) console.log(`  ok  ${line}`);
console.log(`\nThe sign-in page contract holds (${ok.length} groups checked).\n`);
