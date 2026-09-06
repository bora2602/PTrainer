// Scheduled cleanup for records that should not live forever.
//
// Two different things happen here, and the difference matters.
//
// Spent credentials - used or expired password-reset and email-verification
// tokens - are deleted outright. They are secrets with no evidential value once
// consumed, so keeping them is pure risk.
//
// Invitations past their expiry are only *marked* EXPIRED. That is a state
// correction, not a deletion: an invitation that can no longer be accepted was
// still silently blocking the trainer from re-inviting that address.
//
// Calendar feed tokens are deliberately absent from this sweep. They are not
// spent credentials: a subscribed calendar is meant to keep working for as long
// as somebody wants it to, and a revoked one is kept so the person can still see
// in Settings that the old link was retired. They go only when the owner
// replaces them, revokes them, or deletes their account.
//
// Audit events are the one thing this module will not remove by default.
// Retention periods for audit records are named in the privacy launch checklist
// as requiring legal sign-off, so AUDIT_RETENTION_DAYS defaults to 0, meaning
// keep everything. Set it deliberately, once somebody has approved a number.
const HOUR_MS = 60 * 60 * 1000;

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

export async function runRetentionSweep(query, log = () => {}) {
  const tokenDays = positiveInt(process.env.TOKEN_RETENTION_DAYS, 7);
  const auditDays = positiveInt(process.env.AUDIT_RETENTION_DAYS, 0);
  const sessionHours = positiveInt(process.env.SESSION_RETENTION_HOURS, 24);
  const summary = { expiredInvitations: 0, resetTokens: 0, verificationTokens: 0, staleSessions: 0, auditEvents: 0 };
  try {
    const invitations = await query(
      "UPDATE invitations SET status='EXPIRED' WHERE status='PENDING' AND expires_at < now() RETURNING id");
    summary.expiredInvitations = invitations.rowCount;

    const resets = await query(
      `DELETE FROM password_reset_tokens WHERE (used_at IS NOT NULL OR expires_at < now())
         AND created_at < now() - ($1 || ' days')::interval RETURNING token_hash`, [String(tokenDays)]);
    summary.resetTokens = resets.rowCount;

    const verifications = await query(
      `DELETE FROM email_verification_tokens WHERE (used_at IS NOT NULL OR expires_at < now())
         AND created_at < now() - ($1 || ' days')::interval RETURNING token_hash`, [String(tokenDays)]);
    summary.verificationTokens = verifications.rowCount;

    // A session row outlives its cookie only as dead weight.
    const staleSessions = await query(
      `DELETE FROM sessions WHERE last_seen < now() - ($1 || ' hours')::interval RETURNING sid`,
      [String(sessionHours)]);
    summary.staleSessions = staleSessions.rowCount;

    if (auditDays > 0) {
      const events = await query(
        `DELETE FROM audit_events WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`,
        [String(auditDays)]);
      summary.auditEvents = events.rowCount;
    }
    if (Object.values(summary).some(count => count > 0)) log('info', 'retention_sweep', summary);
    return summary;
  } catch (error) {
    // Cleanup is maintenance, not a request path. A failure is worth reporting
    // but must never take the application down.
    log('warn', 'retention_sweep_failed', { message: error.message });
    return summary;
  }
}

// Returns a stop function. The timer is unref'd so a sweep pending in the
// background never holds the process open during shutdown.
export function startRetentionSweeps(query, log = () => {}) {
  const intervalHours = positiveInt(process.env.RETENTION_INTERVAL_HOURS, 6);
  runRetentionSweep(query, log);
  if (intervalHours === 0) return () => {};
  const timer = setInterval(() => runRetentionSweep(query, log), intervalHours * HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
