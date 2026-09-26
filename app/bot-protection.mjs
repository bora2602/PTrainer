// Unobtrusive bot protection: a server-issued, single-use proof-of-work.
//
// Why not a third-party captcha. design.md forbids loosening the CSP to a third
// party, because on a product handling personal health information that
// discloses every visitor's IP to someone else - a launch blocker under
// CLAUDE.md §6. A hosted captcha needs exactly that, plus an external account.
// So the challenge is computed here and verified here.
//
// What this actually buys, stated honestly. Three controls stack, and the
// proof-of-work is the *cheapest* of them, not the strongest:
//   1. Rate limiting is the hard ceiling - a bot cannot exceed it at any price.
//   2. A challenge is issued by us, single-use, short-lived, and bound to the
//      purpose it was asked for, so an attempt cannot be replayed or prepared
//      in bulk ahead of time.
//   3. The proof-of-work makes each attempt cost measurable CPU, which ends
//      naive scripted floods. A determined attacker with native code solves a
//      13-bit puzzle in microseconds; the claim here is not that this stops
//      them, it is that control 1 does.
// It is never a checkbox, and it is never evaluated in the browser: the browser
// only computes, and this file is the only judge.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BoundedMap } from './bounded-map.mjs';

// The browser solves with crypto.subtle.digest, which costs ~40us per call
// because of promise overhead rather than hashing. That sets the ceiling: 13
// bits is about 0.35s of real time on a phone, 16 bits about 2.8s, and anything
// beyond that is a visibly broken sign-in button. Escalation stops there and
// the rate limiter takes over.
export const DIFFICULTY_BASE = 13;
export const DIFFICULTY_CAP = 16;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_PURPOSES = new Set(['register', 'login', 'reset']);

export function countLeadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) { count += 8; continue; }
    // Math.clz32 counts within 32 bits; the byte sits in the low 8, so the
    // leading zeros of the byte itself are clz32 minus the 24 padding bits.
    count += Math.clz32(byte) - 24;
    break;
  }
  return count;
}

export const challengeDigest = (nonce, solution) => createHash('sha256').update(`${nonce}:${solution}`).digest();

export function meetsDifficulty(nonce, solution, difficulty) {
  if (typeof solution !== 'string' && typeof solution !== 'number') return false;
  const text = String(solution);
  // A solution is a short decimal counter. Bounding it keeps a caller from
  // handing us a megabyte to hash.
  if (!/^\d{1,20}$/.test(text)) return false;
  return countLeadingZeroBits(challengeDigest(nonce, text)) >= difficulty;
}

// Difficulty climbs with recent failures from the same source, so the ordinary
// visitor pays the base cost and somebody grinding pays more each time.
export function difficultyFor(failures = 0, { base = DIFFICULTY_BASE, cap = DIFFICULTY_CAP } = {}) {
  return Math.min(cap, base + Math.max(0, Math.floor(failures / 3)));
}

// Sign-in is the flow people run most and the one that must stay simple, so it
// carries no proof-of-work until something looks wrong. Registration and
// password reset always carry one: they are cheap for a person to do once and
// are what a bot actually wants to automate.
export function challengeRequired(purpose) { return purpose !== 'login'; }

// Sign-in escalates on two separate signals, because one alone gets it wrong.
//
// Counting only failures against *this account from this address* misses a bot
// spraying one password across a thousand addresses - that never reaches a
// second failure on any single account. Counting only failures *from this
// address* punishes everyone behind a shared NAT - an office, a university, a
// mobile carrier - for a stranger's typo, which is why the second threshold is
// much higher than the first rather than the same number.
export const LOGIN_ACCOUNT_FAILURES = 2;
export const LOGIN_SOURCE_FAILURES = 8;
export function loginNeedsChallenge({ accountFailures = 0, sourceFailures = 0 } = {}) {
  return accountFailures >= LOGIN_ACCOUNT_FAILURES || sourceFailures >= LOGIN_SOURCE_FAILURES;
}

export function createChallengeStore({ maxEntries = 20000, ttlMs = CHALLENGE_TTL_MS, now = Date.now } = {}) {
  const pending = new BoundedMap({ maxEntries, ttlMs });
  const failures = new BoundedMap({ maxEntries, ttlMs: 60 * 60 * 1000 });
  const failureKey = (purpose, source) => `${purpose}:${source}`;
  return {
    pending,
    recentFailures(purpose, source) { return failures.get(failureKey(purpose, source))?.length || 0; },
    recordFailure(purpose, source) {
      const key = failureKey(purpose, source), when = now();
      const recent = (failures.get(key) || []).filter(time => when - time < 60 * 60 * 1000);
      recent.push(when); failures.set(key, recent);
      return recent.length;
    },
    clearFailures(purpose, source) { failures.delete(failureKey(purpose, source)); },
    issue(purpose, source) {
      const difficulty = difficultyFor(this.recentFailures(purpose, source));
      const challenge = { nonce: randomBytes(16).toString('hex'), purpose, source, difficulty, issuedAt: now() };
      pending.set(challenge.nonce, challenge);
      return challenge;
    },
    // Single-use: the record is deleted before the answer is judged, so a
    // correct solution cannot be submitted twice and a wrong one costs the
    // attacker a fresh round trip.
    consume(nonce, solution, purpose, source) {
      const text = typeof nonce === 'string' ? nonce : '';
      const challenge = pending.get(text);
      if (!challenge) return { ok: false, reason: 'CHALLENGE_UNKNOWN' };
      pending.delete(text);
      if (now() - challenge.issuedAt > ttlMs) return { ok: false, reason: 'CHALLENGE_EXPIRED' };
      if (challenge.purpose !== purpose) return { ok: false, reason: 'CHALLENGE_PURPOSE' };
      // Bound to the address it was issued to, so a farm cannot have one host
      // solve challenges for the rest.
      const left = Buffer.from(String(challenge.source)), right = Buffer.from(String(source));
      if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: 'CHALLENGE_SOURCE' };
      if (!meetsDifficulty(challenge.nonce, solution, challenge.difficulty)) return { ok: false, reason: 'CHALLENGE_UNSOLVED' };
      return { ok: true, challenge };
    }
  };
}

// Used by the checks in work/ to behave like a browser. The server never solves
// a challenge in the request path.
export function solveChallenge(nonce, difficulty, maxIterations = 50_000_000) {
  for (let candidate = 0; candidate < maxIterations; candidate += 1) {
    if (countLeadingZeroBits(challengeDigest(nonce, String(candidate))) >= difficulty) return String(candidate);
  }
  throw new Error('CHALLENGE_UNSOLVABLE');
}
