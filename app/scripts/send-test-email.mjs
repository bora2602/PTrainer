// Sends one message through the configured transport, so "is mail working?"
// has an answer before a real person signs up and waits on a confirmation link
// that never arrives.
//
//   pnpm run email:test you@example.com
//
// Reads the repository's .env the same way `pnpm start` does. Inside Docker,
// run it in the app container instead: docker compose exec app node scripts/send-test-email.mjs you@example.com
import { sendEmail, emailTransport, emailConfigProblem } from '../email.mjs';

const to = String(process.argv[2] || '').trim();
if (!to.includes('@')) {
  console.error('Usage: pnpm run email:test you@example.com');
  process.exit(2);
}

const transport = emailTransport();
if (transport === 'log') {
  console.error([
    'EMAIL_TRANSPORT is "log", so nothing is sent: links are only printed to the server log.',
    'To send real mail through Resend, set these in .env at the repository root:',
    '  EMAIL_TRANSPORT=http',
    '  EMAIL_HTTP_URL=https://api.resend.com/emails',
    '  EMAIL_HTTP_TOKEN=re_...            (Resend dashboard > API Keys)',
    '  EMAIL_FROM=Ptrainer <no-reply@your-verified-domain>'
  ].join('\n'));
  process.exit(1);
}

const problem = emailConfigProblem();
if (problem) {
  console.error(`Email configuration is incomplete: ${problem}`);
  process.exit(1);
}

const origin = String(process.env.APP_ORIGIN || '');
const result = await sendEmail({
  to,
  subject: 'Ptrainer test email',
  text: `This is a test message from Ptrainer.\n\nIf you can read this, account email is working: confirmation links, password resets and invitations will be delivered.\n${origin ? `\nLinks in real emails will point at ${origin}\n` : ''}`
}, () => {}, { debug: true });

if (result.delivered) {
  console.log(`Sent to ${to} via ${process.env.EMAIL_HTTP_URL}. Check the inbox (and the spam folder).`);
  if (!origin || /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin)) {
    console.warn('Note: APP_ORIGIN is not a public address, so links inside real emails will only open on this machine.');
  }
  process.exit(0);
}

// The provider's own words are the fastest route to a fix, so they are shown
// here - this script runs by hand, not inside the server's logs.
const hints = {
  401: 'The API key was rejected. Check EMAIL_HTTP_TOKEN.',
  403: 'The provider refused the sender. With Resend this usually means the domain in EMAIL_FROM is not verified yet, or you are on the test sender and can only mail your own account address.',
  422: 'The provider rejected the message fields. Check that EMAIL_FROM looks like "Name <address@verified-domain>".',
  429: 'The provider is rate limiting this key. Wait a minute and try again.'
};
console.error(`Not delivered${result.status ? ` (HTTP ${result.status})` : ''}.`);
if (hints[result.status]) console.error(hints[result.status]);
if (result.detail) console.error(`Provider said: ${result.detail}`);
process.exit(1);
