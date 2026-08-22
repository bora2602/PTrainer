// Container entrypoint. Works out the address people will actually use before
// starting the server, because the server rejects state-changing requests whose
// Origin does not match APP_ORIGIN — so a wrong value here shows up as every
// sign-in failing while pages still load.
//
// An explicit APP_ORIGIN always wins. Otherwise the quick tunnel is asked for
// the random hostname Cloudflare just assigned it, and if no tunnel answers we
// fall back to localhost so the stack still comes up.
import { spawn } from 'node:child_process';

const METRICS = process.env.TUNNEL_METRICS_URL || 'http://tunnel:2000/quicktunnel';
const FALLBACK = `http://127.0.0.1:${process.env.PORT || 4173}`;
const WAIT_MS = Number(process.env.TUNNEL_WAIT_MS || 60000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function tunnelOrigin() {
  const deadline = Date.now() + WAIT_MS;
  let reported = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(METRICS, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const { hostname } = await response.json();
        if (hostname) return `https://${hostname}`;
      }
    } catch {
      if (!reported) { console.log('Waiting for the Cloudflare tunnel to report its address...'); reported = true; }
    }
    await sleep(2000);
  }
  return null;
}

function banner(lines) {
  const width = Math.max(...lines.map(line => line.length)) + 2;
  const edge = '='.repeat(width);
  console.log(`\n${edge}\n${lines.map(line => ` ${line}`).join('\n')}\n${edge}\n`);
}

const explicit = String(process.env.APP_ORIGIN || '').trim();
let origin = explicit;
let source = 'APP_ORIGIN';

if (!origin) {
  origin = await tunnelOrigin();
  source = origin ? 'Cloudflare quick tunnel' : 'fallback';
  if (!origin) origin = FALLBACK;
}

// Keep local access working alongside whatever public address is in use.
const allowed = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
allowed.add(FALLBACK);
allowed.delete(origin);

process.env.APP_ORIGIN = origin;
process.env.ALLOWED_ORIGINS = [...allowed].join(',');

// Demo accounts exist outside production and their passwords are published in
// this repository, so anyone who has the address could sign in as them.
const publiclyReachable = source !== 'fallback' && origin.startsWith('https://');
const demoAccountsLive = process.env.NODE_ENV !== 'production';

banner(
  source === 'fallback'
    ? ['Ptrainer is running, but no public tunnel answered.', '', `Local address: ${origin}`,
       'Nobody outside this machine can reach it yet.', 'Check: docker compose logs tunnel']
    : [
        'Ptrainer is ready. Share this address:', '', `  ${origin}`, '',
        `Origin source: ${source}`,
        ...(publiclyReachable && demoAccountsLive
          ? ['',
             'WARNING: this address is public and demo accounts are enabled.',
             'Their passwords are published in this repository, so anyone with',
             'the link can sign in as them and read the seeded client data.',
             'Set NODE_ENV=production in .env before sharing the address.']
          : [])
      ]
);

spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' })
  .on('exit', code => process.exit(code ?? 0));
