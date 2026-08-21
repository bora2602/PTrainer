import { Buffer } from '../buffer.mjs';
import { sha256 } from '../sha256.mjs';

// scrypt has no WebCrypto equivalent, so the browser build derives password
// hashes with PBKDF2-SHA256 instead. Hashes are created and verified entirely
// inside this browser profile and never travel anywhere, so the substitution
// stays self-consistent — but a database seeded by the Node server is not
// password-compatible with the browser build.
const PBKDF2_ITERATIONS = 100000;

export function randomBytes(size) {
  const bytes = new Buffer(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash: ${algorithm}`);
  const chunks = [];
  return {
    update(data) { chunks.push(typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)); return this; },
    digest(encoding) {
      const digest = Buffer.from(sha256(Buffer.concat(chunks)));
      return encoding ? digest.toString(encoding) : digest;
    }
  };
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new Error('Input buffers must have the same byte length');
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export function scrypt(password, salt, keylen, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const passwordBytes = typeof password === 'string' ? Buffer.from(password) : Buffer.from(password);
  const saltBytes = typeof salt === 'string' ? Buffer.from(salt) : Buffer.from(salt);
  crypto.subtle
    .importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits'])
    .then(key => crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      key,
      keylen * 8
    ))
    .then(bits => done(null, Buffer.from(bits)))
    .catch(error => done(error));
}

export default { randomBytes, createHash, timingSafeEqual, scrypt };
