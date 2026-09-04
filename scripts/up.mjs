// Starts the stack and opens the app in your browser once it answers.
//
// `docker compose up` on its own cannot do this: compose runs the app inside a
// container, and a container has no way to reach the browser on your desktop.
// So this wrapper runs compose in the foreground exactly as you would by hand,
// watches the health endpoint from the host, and opens a tab the moment the
// app is actually ready to serve one.
//
//   node scripts/up.mjs                 build if needed, then start and open
//   node scripts/up.mjs --public        also publish through the Cloudflare tunnel
//   node scripts/up.mjs --no-open       start without opening a tab
//   node scripts/up.mjs --profile edge  any extra flags go through to compose
//
// Local-only is the default: the tunnel lives behind a compose profile, so
// nothing is published until --public asks for it. Read the warning in
// compose.yaml before you do, because development mode hands out
// password-reset tokens to anyone who asks.
//
// It opens the local address, not the Cloudflare one, and it does that whether
// or not the tunnel came up. Local is faster, needs no tunnel, and avoids the
// Safe Browsing warning that quick-tunnel hostnames collect — see
// docs/hosting-on-one-computer.md.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = process.env.PORT || '4173';
const URL_LOCAL = `http://127.0.0.1:${PORT}`;
const READY = `${URL_LOCAL}/readyz`;
const GIVE_UP_MS = Number(process.env.PTRAINER_OPEN_TIMEOUT_MS || 300000);

const argv = process.argv.slice(2);
const noOpen = argv.includes('--no-open') || process.env.PTRAINER_NO_OPEN === '1';
// --local is what this used to need and is now simply the default, so it stays
// accepted and does nothing rather than failing in somebody's muscle memory.
const wantsTunnel = argv.includes('--public') || argv.includes('--tunnel');
const passthrough = argv.filter(a => !['--no-open', '--local', '--public', '--tunnel'].includes(a));

// --build stays on unless you asked for your own build behaviour, so a first
// run and a run after code changes both work without thinking about it.
const composeArgs = ['compose', 'up', ...passthrough];
if (!passthrough.some(a => a === '--build' || a === '--no-build')) composeArgs.push('--build');

// Without the profile the tunnel container never starts, so nothing waits on it
// and a broken tunnel cannot hold up or rename the address you use here. Asking
// for it also restores the startup wait, because the app has to learn the
// hostname Cloudflare assigned before it will accept a sign-in through it.
const childEnv = { ...process.env };
if (wantsTunnel) {
  // --profile is a top-level compose flag, so it goes before the subcommand.
  composeArgs.splice(1, 0, '--profile', 'tunnel');
  if (!process.env.TUNNEL_WAIT_MS) childEnv.TUNNEL_WAIT_MS = '60000';
  console.log('Publishing through the Cloudflare tunnel: this address will be reachable by anyone.\n');
} else {
  console.log('Local only: nothing is published outside this machine.\n');
}

// A token without TUNNEL_RUN_ARGS is a half-finished named-tunnel setup: compose
// deliberately withholds the token in that state and runs a quick tunnel, so the
// address is random rather than the fixed one that was being aimed for. Silent
// either way, which is worth one line so it does not stay a mystery.
function tunnelConfigNote() {
  let env = '';
  try {
    env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return null;
  }
  const value = name => (env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] || '').trim();
  if (!value('TUNNEL_TOKEN') || value('TUNNEL_RUN_ARGS')) return null;
  return 'Note: TUNNEL_TOKEN is set in .env but TUNNEL_RUN_ARGS is empty, so the\n'
    + 'token is ignored and an account-free quick tunnel is used instead.\n'
    + 'Set TUNNEL_RUN_ARGS=run to use your named tunnel.\n';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

if (wantsTunnel) {
  const note = tunnelConfigNote();
  if (note) console.log(note);
}

const compose = spawn('docker', composeArgs, { stdio: 'inherit', env: childEnv });

compose.on('error', err => {
  console.error(
    err.code === 'ENOENT'
      ? '\nCould not run `docker`. Is Docker Desktop installed and on your PATH?'
      : `\nCould not start docker compose: ${err.message}`
  );
  process.exit(1);
});

let composeAlive = true;
let opening = false;          // true while the poller still has work to do
let pendingExit = null;

compose.on('exit', code => {
  composeAlive = false;
  // `up -d` returns as soon as the containers are started, which is usually
  // before the app answers. Let the poller finish rather than cutting it off.
  if (opening && (code ?? 0) === 0) { pendingExit = 0; return; }
  process.exit(code ?? 0);
});

// Ctrl+C should stop the stack, not orphan it. Compose has its own SIGINT
// handling, so forward and let it wind the containers down.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (composeAlive) compose.kill(signal); });
}

if (noOpen) {
  opening = false;
} else {
  opening = true;
  (async () => {
    const deadline = Date.now() + GIVE_UP_MS;
    let opened = false;
    while (Date.now() < deadline) {
      // Foreground compose that has exited means the stack is gone; detached
      // compose exits on purpose, and pendingExit marks that case.
      if (!composeAlive && pendingExit === null) break;
      try {
        const res = await fetch(READY, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          // The container prints its address banner on this same stream; give
          // it a beat so the two messages do not interleave.
          await sleep(400);
          const ok = openBrowser(URL_LOCAL);
          console.log(
            ok ? `\nOpened ${URL_LOCAL} in your browser.\n`
               : `\nCould not open a browser automatically. Go to ${URL_LOCAL}\n`
          );
          opened = true;
          break;
        }
      } catch {
        // not answering yet
      }
      await sleep(1000);
    }
    if (!opened && (composeAlive || pendingExit !== null)) {
      console.log(`\nThe app did not answer within ${Math.round(GIVE_UP_MS / 1000)}s, so no tab was opened.`);
      console.log(`Try ${URL_LOCAL} yourself, or check: docker compose logs app\n`);
    }
    opening = false;
    if (pendingExit !== null) process.exit(pendingExit);
  })();
}
