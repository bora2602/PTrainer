# Hosting Ptrainer from one computer

One machine runs the app and its database; everyone else connects over the
internet. A Cloudflare Tunnel makes that work without opening a port on your
router: `cloudflared` dials *out* to Cloudflare and reaches the app over the
private Docker network, so the app port stays bound to `127.0.0.1` and nothing
on this machine is exposed to the LAN or the internet directly.

```
  visitor's browser
        |  https
        v
  Cloudflare edge
        |  outbound tunnel, no inbound port
        v
  cloudflared  --->  app:4173  --->  postgres:5432
  ( this computer, all inside the compose network )
```

## Start it

```
docker compose up --build
```

That is everything: Postgres, the app, and the tunnel. The app asks the tunnel
what address Cloudflare assigned it, configures itself to accept that origin,
and prints it:

```
======================================================================
 Ptrainer is ready. Share this address:

   https://reported-address.trycloudflare.com

 Origin source: Cloudflare quick tunnel
 Local address: http://127.0.0.1:4173
======================================================================
```

The local address is always printed and always works. The public one is only
called shareable when the tunnel is actually carrying traffic — see
[When the tunnel stops working](#when-the-tunnel-stops-working).

To read it again later: `docker compose logs app | grep -A4 "address"`.

Stop with `docker compose down`. The database volume survives that;
`down -v` is what deletes it.

### When the tunnel stops working

A quick tunnel is disposable by design and has no uptime guarantee. Leave one
running long enough and Cloudflare stops serving its hostname, at which point
cloudflared keeps retrying the name it was already given rather than asking for
a new one. The logs fill with:

```
ERR Serve tunnel error error="control stream encountered a failure while serving"
INF Retrying connection in up to 1m4s
```

The address still appears in the startup banner and resolves for nobody.

Recreating the connector fixes it, and a quick tunnel comes back under a new
name — so whoever you gave the old address to needs the new one:

```
docker compose up -d --force-recreate tunnel
docker compose up -d --force-recreate app
```

Check whether the tunnel is genuinely up rather than trusting the hostname:

```
docker compose exec app node -e "fetch('http://tunnel:2000/ready').then(r=>r.text()).then(console.log)"
```

`readyConnections` above zero is the only thing that means connected. This is
the same check the app makes at startup before it calls an address shareable.

None of this touches the local address. If you only need the app on this
machine, skip the tunnel altogether:

```
node scripts/up.mjs --local
```

### A fixed address

Without a token this is an account-free quick tunnel, and **Cloudflare picks a
new random hostname every time the tunnel container restarts**. For an address
you can hand to people, create a named tunnel in **Zero Trust → Networks →
Tunnels**, add a public hostname routed to `http://app:4173`, then set in
`.env`:

```
TUNNEL_TOKEN=<the tunnel token>
TUNNEL_RUN_ARGS=run
APP_ORIGIN=https://ptrainer.your-domain.com
```

`APP_ORIGIN` must match what people type. The server rejects state-changing
requests whose `Origin` header does not match, so a mismatch shows up as every
sign-in failing with `ORIGIN_REJECTED` while pages still load.

To change app settings without making the tunnel reconnect (and, on a quick
tunnel, without losing the hostname):

```
docker compose up -d --no-deps --wait app
```

### Why the browser says "Dangerous" on a quick tunnel

Chrome will often flag `something-random.trycloudflare.com` as deceptive, with
a "Check your passwords" prompt after you sign in. This is not a certificate
problem — the certificate really is valid, and Chrome will tell you so if you
expand the warning. It is Google Safe Browsing judging the *hostname*.

Quick-tunnel hostnames are free, random, disposable, and shared by everyone
using the feature, including a steady supply of phishing kits. A sign-in form
on a throwaway subdomain is, from a reputation system's point of view,
indistinguishable from the real thing it is trying to catch. Worse, the
hostname changes every time the tunnel restarts, so it never gets the chance to
build any reputation of its own.

**The fix is a name you own.** Reputation attaches to a domain, and a domain
you control keeps its history across restarts:

1. Register a domain at any registrar — roughly $10–15/year. Skip the free
   TLDs; they are heavily abused and carry the same flagging problem you are
   trying to escape.
2. Add it to Cloudflare on the free plan and point your nameservers there.
3. **Zero Trust → Networks → Tunnels → Create a tunnel.** Add a public hostname
   such as `ptrainer.your-domain.com`, routed to `http://app:4173`.
4. Put the token and the matching origin in `.env`, as in the section above.

Do not chase a review or an exception for a quick-tunnel hostname. Even if one
were granted, the next restart hands you a different name and you start over.

## Before you give anyone the address

Set `NODE_ENV=production` in `.env`, along with a 32+ character `METRICS_TOKEN`
and real `PRIVACY_ORGANIZATION`, `PRIVACY_CONTACT_EMAIL`, and
`DATA_STORAGE_REGION` values. The app refuses to start if those are left as
placeholders.

This matters more than it looks. Outside production the app seeds the demo
accounts `trainer@ptrainer.local` and `trainee@ptrainer.local`, **and their
passwords are published in this repository** — anyone with the link could sign
in as them. Production startup suspends those accounts if they already exist,
which they will if you ever ran the stack locally first. The startup banner
warns you whenever a public address and demo accounts are live at the same time.

Still outstanding regardless of that setting:

- **Anyone who has the address can register an account.** Registration is open
  by design and rate-limited to 5 per hour per client address. A stranger cannot
  reach anyone else's data, but they can create an account on your server.
- **Password reset does not send email yet**, so a user who forgets their
  password cannot recover it without you.
- Work through the [privacy launch checklist](privacy-launch-checklist.md)
  before real client information goes in.

## Checking the data

`scripts/db.mjs` wraps the usual `psql` invocations:

```
node scripts/db.mjs             # row counts for every table
node scripts/db.mjs users       # accounts, roles, status
node scripts/db.mjs activity    # the 25 most recent audit events
node scripts/db.mjs sql "SELECT email, role FROM users WHERE role = 'TRAINER';"
node scripts/db.mjs psql        # interactive session
node scripts/db.mjs backup      # timestamped dump into backups/
```

The same thing by hand, if you prefer:

```
docker compose exec postgres psql -U ptrainer -d ptrainer
```

Data lives in the named volume `ptrainer_ptrainer_postgres_data` and survives
`docker compose down`, image rebuilds, and reboots. Nothing backs it up for
you — `node scripts/db.mjs backup` writes a dump you can copy somewhere safe.

## Checking that it is locked down

```
node work/security-smoke.mjs            # 34 behaviour and security checks
node work/endpoint-exposure-check.mjs   # every endpoint probed with no credentials
node work/cross-account-check.mjs       # one account reaching for another's records
```

The exposure check supplies valid CSRF tokens deliberately, so a rejection
proves the authentication check did the work rather than CSRF masking it. It
also confirms `/metrics` is refused for anything arriving through the tunnel.
The cross-account check needs to register two accounts; if registration is
rate-limited, `docker compose restart app` clears the in-memory buckets.

Point any of them at the public address with
`PTRAINER_BASE=https://your-address node work/endpoint-exposure-check.mjs`.

## Operating notes

- **The computer has to stay on and awake.** Disable sleep, and set Docker
  Desktop to start on login; the services are already `restart: unless-stopped`.
- **Restarting the app signs everyone out.** Sessions live in memory in
  `server.mjs`, and expire after an hour of inactivity regardless.
- **One replica only.** Sessions, rate limits, and idempotency state are
  in-process.  See [architecture decisions](architecture-decisions.md).
- **`TRUST_PROXY=true` is only safe while the app is unreachable directly.** It
  makes the server believe `CF-Connecting-IP` / `X-Forwarded-For`, which is what
  gives each visitor their own rate-limit bucket instead of everyone sharing
  one. If you ever publish the app port beyond localhost, turn it back off,
  because a direct client could then forge those headers.
