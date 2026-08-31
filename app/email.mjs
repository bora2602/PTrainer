// One transport for every message Ptrainer sends, so swapping providers is a
// configuration change rather than a code change.
//
// `log` is the default and writes the whole message, link included, to the
// process log. That is what makes local development and CI work without an
// external account, and it is exactly why the server refuses to start in
// production with this transport selected: a verification link in a log file is
// not delivery, and treating it as delivery would silently strand real users.
//
// `http` posts JSON to a provider endpoint. It is deliberately shaped like the
// common transactional-mail APIs (Resend, Postmark, Mailgun's JSON mode) so a
// deployment can point it at one with URL, token, and from-address alone.
const TIMEOUT_MS = 8000;

export const emailTransport = () => String(process.env.EMAIL_TRANSPORT || 'log').toLowerCase();

export function emailConfigProblem() {
  if (emailTransport() !== 'http') return null;
  if (!String(process.env.EMAIL_HTTP_URL || '').startsWith('https://')) return 'EMAIL_HTTP_URL must be an https endpoint.';
  if (String(process.env.EMAIL_HTTP_TOKEN || '').length < 8) return 'EMAIL_HTTP_TOKEN is missing.';
  if (!String(process.env.EMAIL_FROM || '').includes('@')) return 'EMAIL_FROM must be a sending address.';
  return null;
}

// Never throws. Mail is a non-critical dependency: a registration, invitation or
// reset must still complete when the provider is down, so the caller gets a
// result to report rather than an exception to handle.
export async function sendEmail({ to, subject, text }, log = () => {}) {
  const transport = emailTransport();
  if (transport === 'log') {
    log('info', 'email_logged', { to, subject });
    console.log(`\n--- email (${transport} transport) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end email ---\n`);
    return { delivered: true, transport };
  }
  try {
    const response = await fetch(String(process.env.EMAIL_HTTP_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EMAIL_HTTP_TOKEN}`
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) {
      // The body can echo the recipient and the message, so only the status is
      // recorded here.
      log('warn', 'email_send_failed', { subject, status: response.status });
      return { delivered: false, transport };
    }
    log('info', 'email_sent', { subject, status: response.status });
    return { delivered: true, transport };
  } catch (error) {
    log('warn', 'email_send_failed', { subject, errorName: error.name });
    return { delivered: false, transport };
  }
}

export const verificationEmail = (name, link) => ({
  subject: 'Confirm your Ptrainer email address',
  text: `Hi ${name},\n\nConfirm this address to finish setting up your Ptrainer account:\n\n${link}\n\nThe link expires in 24 hours. If you did not create an account, ignore this message.\n`
});

export const resetEmail = (name, link) => ({
  subject: 'Reset your Ptrainer password',
  text: `Hi ${name},\n\nReset your Ptrainer password here:\n\n${link}\n\nThe link expires in 15 minutes. If you did not ask for this, ignore this message and your password stays as it is.\n`
});

export const invitationEmail = (trainerName, link, note) => ({
  subject: `${trainerName} invited you to Ptrainer`,
  text: `${trainerName} would like to coach you on Ptrainer.\n${note ? `\nTheir note: ${note}\n` : ''}\nAccept the invitation here:\n\n${link}\n\nThe invitation expires in 7 days.\n`
});
