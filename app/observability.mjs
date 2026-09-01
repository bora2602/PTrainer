// Error reporting to somewhere a person will actually look.
//
// The application already emits structured JSON to stdout, which is the right
// primary record. The gap this closes is that nothing was watching it: an
// unhandled exception at 3am sat in a container log until somebody went looking.
//
// Deliberately provider-agnostic. It posts the same event the log line carries
// to a URL you configure, so it works with any collector that accepts JSON, and
// switching provider is a configuration change. Default is off.
//
// What it will not do: send request bodies, message text, nutrition values,
// passwords or tokens. The events it forwards carry a request id, a route label
// with identifiers already collapsed, a status, a duration and an error name.
// That is enough to know something is wrong and to find it in the real log,
// which is the job. A crash reporter that exfiltrates health data to a third
// party would be a worse problem than the crash.
const TIMEOUT_MS = 5000;
const MAX_PER_MINUTE = 60;

let windowStartedAt = 0;
let sentInWindow = 0;
let suppressed = 0;

export const errorReportingEnabled = () =>
  String(process.env.ERROR_WEBHOOK_URL || '').startsWith('https://');

export function errorReportingProblem() {
  const url = String(process.env.ERROR_WEBHOOK_URL || '');
  if (!url) return null;
  if (!url.startsWith('https://')) return 'ERROR_WEBHOOK_URL must be an https endpoint.';
  return null;
}

// A burst of identical failures must not turn one outage into two.
function withinBudget() {
  const now = Date.now();
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    sentInWindow = 0;
    const dropped = suppressed;
    suppressed = 0;
    return { allowed: true, dropped };
  }
  if (sentInWindow >= MAX_PER_MINUTE) { suppressed += 1; return { allowed: false, dropped: 0 }; }
  sentInWindow += 1;
  return { allowed: true, dropped: 0 };
}

// Never throws and never blocks the response: reporting a problem must not be
// able to cause one.
export function reportError(event, fields = {}) {
  if (!errorReportingEnabled()) return false;
  const budget = withinBudget();
  if (!budget.allowed) return false;
  const payload = {
    service: 'ptrainer',
    environment: process.env.NODE_ENV || 'development',
    event,
    ...fields,
    ...(budget.dropped ? { suppressedSinceLastReport: budget.dropped } : {}),
    reportedAt: new Date().toISOString()
  };
  fetch(String(process.env.ERROR_WEBHOOK_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ERROR_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.ERROR_WEBHOOK_TOKEN}` } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }).catch(() => {
    // If the collector is unreachable there is nowhere left to report that to.
    // The stdout log still has the original event, which is the point of it
    // being the primary record.
  });
  return true;
}

// The events worth waking somebody for, matching the runbook's table.
const ALERTABLE = new Set([
  'request_error', 'email_send_failed', 'audit_write_failed',
  'retention_sweep_failed', 'food_lookup_failed'
]);

export const shouldReport = (level, event) => level === 'error' || ALERTABLE.has(event);
