// Solving the bot-protection proof-of-work, for the checks in this folder.
//
// Registration and password reset always carry a challenge now (see
// app/bot-protection.mjs for why, and why sign-in does not). Every check that
// creates an account therefore has to behave like a browser, and this is the one
// place that knows how - twelve copies of a hashing loop would be twelve things
// to fix the next time the difficulty policy moves.
//
// This deliberately reimplements the client side rather than importing the
// server's own solveChallenge(): a check that borrowed the server's solver could
// pass while the wire format the browser actually uses was broken.
import { createHash } from 'node:crypto';

export function solveProofOfWork(nonce, difficulty) {
  for (let candidate = 0; candidate < 50_000_000; candidate += 1) {
    const digest = createHash('sha256').update(`${nonce}:${candidate}`).digest();
    let bits = 0;
    for (const byte of digest) { if (byte === 0) { bits += 8; continue; } bits += Math.clz32(byte) - 24; break; }
    if (bits >= difficulty) return String(candidate);
  }
  throw new Error('CHALLENGE_UNSOLVABLE');
}

// `request` is whichever bound request helper the calling check already has. The
// checks disagree about what they return - {status,data} in most, {response,data}
// in security-smoke - so the payload is found rather than assumed.
export async function challengeFields(request, purpose = 'register') {
  const result = await request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ purpose }) });
  const payload = result?.data ?? result;
  if (!payload?.nonce) throw new Error(`No challenge issued for ${purpose}: ${JSON.stringify(result)?.slice(0, 200)}`);
  return { challengeNonce: payload.nonce, challengeSolution: solveProofOfWork(payload.nonce, payload.difficulty) };
}
