// Authenticator-app codes (TOTP), RFC 6238 over RFC 4226.
//
// Why this is a local module rather than a dependency: CLAUDE.md §2 keeps this
// app at two runtime dependencies on purpose, and the actual cryptography here
// is HMAC-SHA1, which comes from node:crypto - a maintained implementation we
// are calling, not reimplementing. What is left is the part of the RFCs that is
// not cryptography at all: a counter written big-endian, the dynamic-truncation
// offset read from the last nibble, a modulo, and base32 for transporting the
// secret. Those are encodings. The RFC 6238 test vectors in totp.test.mjs are
// what prove this file agrees with every authenticator app.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// One step either side of now. A wider window is a longer replay surface, and a
// narrower one fails people whose phone clock drifts by a few seconds.
export const TOTP_WINDOW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

// Tolerant on input because people retype these by hand: spaces, lowercase and
// the '=' padding an authenticator may show are all accepted. Anything else is
// a typo and must fail loudly rather than decode to the wrong secret.
export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0, value = 0;
  const output = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('BASE32_INVALID');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

// 20 bytes is the SHA-1 block-matched length RFC 4226 recommends and what every
// authenticator app expects to be handed.
export function generateSecret() { return base32Encode(randomBytes(20)); }

export function hotpCode(secretBytes, counter, digits = TOTP_DIGITS) {
  const message = Buffer.alloc(8);
  // A JS bitwise op would truncate the counter to 32 bits, which breaks after
  // 2^31 steps; BigInt keeps the full 64-bit counter the RFC specifies.
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secretBytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepFor = (timestampMs, stepSeconds = TOTP_STEP_SECONDS) => Math.floor(timestampMs / 1000 / stepSeconds);

export function totpCode(secret, timestampMs = Date.now(), { digits = TOTP_DIGITS, stepSeconds = TOTP_STEP_SECONDS } = {}) {
  return hotpCode(base32Decode(secret), stepFor(timestampMs, stepSeconds), digits);
}

const sameCode = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

// Returns the step the code matched so the caller can store it. A code is only
// valid once: `afterStep` rejects anything at or below the last accepted step,
// so somebody reading a code over a shoulder cannot reuse it inside its window.
export function verifyTotp(secret, token, { timestampMs = Date.now(), window = TOTP_WINDOW, afterStep = -1, digits = TOTP_DIGITS, stepSeconds = TOTP_STEP_SECONDS } = {}) {
  const clean = String(token || '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return { ok: false, reason: 'FORMAT' };
  let secretBytes;
  try { secretBytes = base32Decode(secret); } catch { return { ok: false, reason: 'SECRET' }; }
  const current = stepFor(timestampMs, stepSeconds);
  for (let drift = -window; drift <= window; drift += 1) {
    const step = current + drift;
    if (step < 0) continue;
    if (!sameCode(clean, hotpCode(secretBytes, step, digits))) continue;
    if (step <= afterStep) return { ok: false, reason: 'REPLAY' };
    return { ok: true, step };
  }
  return { ok: false, reason: 'MISMATCH' };
}

// The string an authenticator app reads. Issuer is repeated in the label and the
// parameter because apps disagree about which one they display.
export function otpauthUri({ secret, account, issuer = 'Ptrainer' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// Recovery codes are the way back in when the phone is gone, so they are
// generated here with the same entropy source and stored only as digests.
export const RECOVERY_CODE_COUNT = 10;
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  // Crockford-style alphabet minus the characters people confuse when copying
  // a code off a printout: I, L, O, U, 0 and 1.
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from({ length: count }, () => {
    const raw = Array.from(randomBytes(10), byte => alphabet[byte % alphabet.length]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
export const normalizeRecoveryCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
