// The RFC vectors are the whole point of this file. A TOTP implementation that
// is self-consistent but disagrees with the RFC produces codes no authenticator
// app will match, and the failure only shows up when a real phone is involved.
// These vectors are the contract with Google Authenticator, 1Password, Aegis and
// every other app, so they are asserted rather than trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, hotpCode, totpCode, verifyTotp, generateSecret, generateRecoveryCodes, normalizeRecoveryCode, otpauthUri, stepFor } from './totp.mjs';

// RFC 4226 and RFC 6238 both use the ASCII seed "12345678901234567890".
const SEED = Buffer.from('12345678901234567890');
const SECRET = base32Encode(SEED);

test('base32 round-trips and matches the known encoding of the RFC seed', () => {
  assert.equal(SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(SECRET), SEED);
  // Retyped by hand: lowercase, spaced, padded.
  assert.deepEqual(base32Decode('gezd gnbv gy3t qojq gezdgnbvgy3tqojq'), SEED);
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ===='), SEED);
  assert.throws(() => base32Decode('GEZD!NBV'), /BASE32_INVALID/);
});

test('HOTP matches every RFC 4226 Appendix D vector', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotpCode(SEED, counter), code, `counter ${counter}`));
});

test('TOTP matches every RFC 6238 Appendix B vector', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [seconds, code] of vectors) {
    assert.equal(totpCode(SECRET, seconds * 1000, { digits: 8 }), code, `t=${seconds}`);
  }
});

test('a 64-bit counter does not wrap where a 32-bit one would', () => {
  // 20000000000s is step 666666666, but the bug this guards is a counter written
  // with a bitwise op, which truncates above 2^31 and silently returns a wrong
  // code decades from now rather than throwing.
  assert.equal(stepFor(20000000000 * 1000), 666666666);
  assert.equal(totpCode(SECRET, 20000000000 * 1000, { digits: 8 }), '65353130');
});

test('verification accepts the current code and one step of clock drift', () => {
  const now = 1700000000000;
  assert.equal(verifyTotp(SECRET, totpCode(SECRET, now), { timestampMs: now }).ok, true);
  assert.equal(verifyTotp(SECRET, totpCode(SECRET, now - 30000), { timestampMs: now }).ok, true, 'one step behind');
  assert.equal(verifyTotp(SECRET, totpCode(SECRET, now + 30000), { timestampMs: now }).ok, true, 'one step ahead');
  assert.equal(verifyTotp(SECRET, totpCode(SECRET, now - 90000), { timestampMs: now }).ok, false, 'three steps behind is refused');
});

test('a code cannot be replayed inside its own window', () => {
  const now = 1700000000000;
  const first = verifyTotp(SECRET, totpCode(SECRET, now), { timestampMs: now });
  assert.equal(first.ok, true);
  const replay = verifyTotp(SECRET, totpCode(SECRET, now), { timestampMs: now, afterStep: first.step });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'REPLAY');
});

test('malformed tokens are refused before any comparison', () => {
  for (const bad of ['', null, undefined, '12345', '1234567', 'abcdef', '12 34 56']) {
    assert.equal(verifyTotp(SECRET, bad).ok, false, String(bad));
  }
  // Spaces inside an otherwise correct code are stripped, because phones show
  // them grouped as "123 456".
  const now = 1700000000000;
  const code = totpCode(SECRET, now);
  assert.equal(verifyTotp(SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { timestampMs: now }).ok, true);
});

test('generated secrets are 20 bytes and distinct', () => {
  const secrets = new Set(Array.from({ length: 50 }, generateSecret));
  assert.equal(secrets.size, 50);
  for (const secret of secrets) assert.equal(base32Decode(secret).length, 20);
});

test('recovery codes are distinct, grouped, and normalize for comparison', () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
  // The characters people misread are absent by construction.
  for (const code of codes) assert.equal(/[ILOU01]/.test(code), false, code);
  assert.equal(normalizeRecoveryCode(' abcde-fghij '), 'ABCDEFGHIJ');
});

test('the otpauth uri carries what an authenticator needs', () => {
  const uri = otpauthUri({ secret: SECRET, account: 'maya@ptrainer.local' });
  assert.match(uri, /^otpauth:\/\/totp\/Ptrainer:maya%40ptrainer\.local\?/);
  const params = new URL(uri.replace('otpauth://', 'https://')).searchParams;
  assert.equal(params.get('secret'), SECRET);
  assert.equal(params.get('issuer'), 'Ptrainer');
  assert.equal(params.get('digits'), '6');
  assert.equal(params.get('period'), '30');
});
