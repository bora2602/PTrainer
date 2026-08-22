// Container entrypoint. Works out the address people will actually use before
// starting the server, because the server rejects state-changing requests whose
// Origin does not match APP_ORIGIN — so a wrong value here shows up as every
// sign-in failing while pages still load.
//
// An explicit APP_ORIGIN always wins. Otherwise the tunnel is asked for the
// hostname Cloudflare assigned it. A hostname on its own is not enough:
// cloudflared prints one immediately and keeps it even when every connection
// attempt afterwards fails, so the address can look fine here and resolve to
// nothing for a visitor. The readiness endpoint is what decides. When no tunnel
// is carrying traffic we fall back to the local address, which always works on
// this machine, rather than advertising a public address that does not.
import { spawn } from 'node:child_process';

const METRICS = (process.env.TUNNEL_METRICS_URL || 'http://tunnel:2000').replace(/\/+$/, '');
const LOCAL = `http://127.0.0.1:${process.env.PORT || 4173}`;
// Compose passes this through as an empty string when it is unset, so an
// empty value has to mean "default", not Number('') === 0.
const WAIT_RAW = String(process.env.TUNNEL_WAIT_MS ?? '').trim();
const WAIT_MS = WAIT_RAW === '' || !Number.isFinite(Number(WAIT_RAW)) ? 60000 : Number(WAIT_RAW);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ask(path) {
  try {
    const response = await fetch(`${METRICS}${path}`, { signal: AbortSignal.timeout(3000) });
    // /ready answers 503 with a usable body while connections are still down.
    return await response.json();
  } catch {
    return null;
  }
}

// Resolves to { hostname, connections, answered }. `answered` separates "no
// cloudflared here at all" from "cloudflared is up but not connected", because
// those two need different advice.
async function probeTunnel(budgetMs) {
  const deadline = Date.now() + budgetMs;
  let best = { hostname: null, connections: 0, answered: false };
  let reported = false;
  while (Date.now() < deadline) {
    const [ready, quick] = await Promise.all([ask('/ready'), ask('/quicktunnel')]);
    if (ready || quick) {
      best = {
        hostname: quick?.hostname || best.hostname,
        connections: Number(ready?.readyConnections || 0),
        answered: true
      };
      if (best.connections > 0) return best;
    }
    if (!reported) {
      console.log('Waiting for the Cloudflare tunnel to connect...');
      reported = true;
    }
    await sleep(2000);
  }
  return best;
}

function banner(lines) {
  const width = Math.max(...lines.map(line => line.length)) + 2;
  const edge = '='.repeat(width);
  console.log(`\n${edge}\n${lines.map(line => ` ${line}`).join('\n')}\n${edge}\n`);
}

const explicit = String(process.env.APP_ORIGIN || '').trim();

// Only a quick tunnel is worth waiting on, because only a quick tunnel is where
// the address comes from. With APP_ORIGIN set the probe is just a health read
// for the banner, so it gets a short budget rather than holding the server down
// for a minute every time the tunnel is having a bad day.
const probeBudget = explicit ? Math.min(WAIT_MS, 5000) : WAIT_MS;
const tunnel = probeBudget > 0
  ? await probeTunnel(probeBudget)
  : { hostname: null, connections: 0, answered: false };
const tunnelUp = tunnel.connections > 0;

let origin = explicit;
let source = 'APP_ORIGIN';

if (!origin) {
  if (tunnelUp && tunnel.hostname) {
    origin = `https://${tunnel.hostname}`;
    source = 'Cloudflare quick tunnel';
  } else {
    origin = LOCAL;
    source = 'fallback';
  }
}

// Keep local access working alongside whatever public address is in use. The
// local address is the one thing that is always reachable, so it is never the
// address that gets dropped.
const allowed = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
allowed.add(LOCAL);
allowed.delete(origin);

process.env.APP_ORIGIN = origin;
process.env.ALLOWED_ORIGINS = [...allowed].join(',');

// Demo accounts exist outside production and their passwords are published in
// this repository, so anyone who has the address could sign in as them.
const publiclyReachable = source !== 'fallback' && origin.startsWith('https://') && tunnelUp;
const demoAccountsLive = process.env.NODE_ENV !== 'production';

// A named tunnel serves a hostname you configured in Cloudflare rather than one
// it reports back, so an explicit origin with no live connection is the same
// outage as a quick tunnel that never connected.
const publicAddressBroken = explicit ? !tunnelUp && tunnel.answered : source === 'fallback' && tunnel.answered;

// A named tunnel serves a hostname you configured in Cloudflare, so recreating
// the connector keeps the address; a quick tunnel is issued a new one. The two
// need different advice, and only one of them is worth still calling shareable.
const quickMode = !explicit;
const publicName = explicit || (tunnel.hostname ? `https://${tunnel.hostname}` : 'the public address');

const whyBroken = publicAddressBroken
  ? ['',
     'The tunnel container is running but has no connection to Cloudflare,',
     `so ${publicName} will not answer for anyone.`,
     '',
     ...(quickMode
       ? ['Usually a quick tunnel that has been up long enough for Cloudflare to',
          'stop serving its hostname: cloudflared keeps retrying the name it was',
          'given instead of asking for a new one. Recreating the container gets a',
          'fresh address, which is also a new address to hand out:']
       : ['Recreating the connector is the first thing to try. A named tunnel keeps',
          'its hostname, so the address you have handed out does not change:']),
     '',
     '  docker compose up -d --force-recreate tunnel',
     '',
     ...(quickMode ? [] : ['If it stays down, the token or the public hostname route is the suspect.']),
     'Logs: docker compose logs tunnel',
     'Either way this machine keeps working at the local address above.']
  : [];

banner(
  source === 'fallback'
    ? ['Ptrainer is running on this machine.', '', `  ${LOCAL}`, '',
       ...(WAIT_MS <= 0
         ? ['Local only: the tunnel was skipped, so this address is the only way in.']
         : tunnel.answered
           ? ['No public address: the tunnel is not carrying traffic.', ...whyBroken.slice(1)]
           : ['No public tunnel answered, so nobody outside this machine can reach it.',
              'Check: docker compose logs tunnel'])]
    : [
        // Only an address that is actually carrying traffic gets called shareable.
        ...(publicAddressBroken
          ? ['Ptrainer is running, but its public address is not reachable:']
          : ['Ptrainer is ready. Share this address:']),
        '', `  ${origin}`, '',
        `Origin source: ${source}`,
        `Local address: ${LOCAL}`,
        ...whyBroken,
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
