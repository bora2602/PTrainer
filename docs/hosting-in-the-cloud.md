# Hosting Ptrainer on a cloud VM

A virtual machine in a datacenter runs the whole stack — Caddy, the app, and
PostgreSQL — and stays up on its own. **Nothing runs on your computer.** You use
SSH to set it up, the same way you would use a web dashboard, and after that the
machine keeps running whether your laptop is on, off, or in another country.

```
  visitor's browser
        |  https
        v
  caddy :443  --->  app:4173  --->  postgres:5432
  ( a VM in Oracle's Toronto region, all inside the compose network )
```

This is the same `compose.yaml` as
[hosting from one computer](hosting-on-one-computer.md), with two differences:
the `edge` profile replaces the `tunnel` profile, because a server with a public
IP can terminate TLS itself; and the computer it runs on is rented rather than
yours.

## Why a VM and not a platform

The obvious choice would be a managed platform — push to a repository, let
somebody else patch the operating system. That was rejected for one reason:
**no free managed platform has a Canadian region.** Render offers Oregon, Ohio,
Virginia, Frankfurt and Singapore. Neon offers eight AWS regions and Canada is
not among them. Since this product stores weight, nutrition and coaching notes
for Canadian users, and `DATA_STORAGE_REGION` is rendered into the privacy
notice as a factual claim, the region is not a detail to shrug at.

Oracle Cloud's Always Free tier includes a Toronto region and an Arm instance
large enough to run the stack several times over, so the trade is: you accept
`apt upgrade` and your own backups, and in exchange the data stays in Canada
with no cold starts and a 200 GB disk instead of 0.5 GB.

Nothing here locks that in. The stack is a compose file and a `pg_dump`.

## The one irreversible step

**Choose Canada Southeast (Toronto) as your home region when you create the
Oracle account.** The home region is fixed at signup and cannot be changed
afterwards, and Always Free resources exist *only* in the home region —
anything created elsewhere is billed at the normal rate. Getting this wrong
means deleting the tenancy and starting over.

Everything else on this page is recoverable.

## Provisioning

**The instance.** Shape `VM.Standard.A1.Flex`, 2 OCPU and 12 GB — the whole
Always Free Arm allowance, and far more than this app needs. Ubuntu 24.04 for
Arm, with a 50–100 GB boot volume out of the 200 GB allowance. Save the SSH
private key when it is offered; it is not shown again.

Expect `Out of host capacity` on the Arm shape. Toronto runs out regularly.
Retry over hours or days rather than concluding it is unavailable.

**Reserve the public IP.** An ephemeral address changes when the instance stops
and starts, which silently breaks the DNS name and every bookmark your testers
have. The console offers this on the instance's VNIC.

**Open 80 and 443 in the VCN security list.** Ingress rules, source `0.0.0.0/0`,
protocol TCP, ports 80 and 443.

That is usually enough. Oracle's Ubuntu images also carry a host `iptables`
ruleset that rejects everything except SSH, which is the source of the
best-known Oracle Cloud complaint — but Docker publishes container ports through
its own chains, so the host `REJECT` rule frequently does not apply to them.
**Test before you fix anything.** If the site does not answer once Caddy is
running, and the security list is right, then add the host rules:

```
sudo iptables -L INPUT --line-numbers        # find the REJECT line
sudo iptables -I INPUT <n> -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT <n> -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

`<n>` must be **above** the REJECT line. Appended at the end they are dead
rules, which is why so many write-ups end with "it still doesn't work".

## A name and a certificate

Caddy gets a certificate automatically, but Let's Encrypt will not issue one for
a bare IP address, so the site needs a hostname. If you own a domain, point an
A record at the reserved IP and skip to the next section.

Without one, **DuckDNS** gives you a free permanent subdomain. Register
`something.duckdns.org`, point it at the reserved IP, and confirm it resolves
*before* starting Caddy — a failed challenge counts against Let's Encrypt's rate
limits, and they are per-name and unforgiving. [`app/Caddyfile`](../app/Caddyfile)
already reads `{$PTRAINER_DOMAIN:localhost}`, so this is one variable and no
plugin: an ordinary HTTP-01 challenge over port 80.

Not the Cloudflare quick tunnel that the single-computer setup uses. It hands
out a new random hostname every time the container restarts, which breaks both
`APP_ORIGIN` and your testers' bookmarks, and it attracts the browser warnings
described in [that document](hosting-on-one-computer.md#why-the-browser-says-dangerous-on-a-quick-tunnel).
A name you keep is the entire point.

## Installing and starting

```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu          # log out and back in
git clone https://github.com/bora2602/PTrainer.git && cd PTrainer
cp .env.example .env                    # then edit, see below
docker compose --profile edge up -d --build
```

The `edge` profile brings up Caddy, the app and PostgreSQL. The tunnel service
stays off — it is declared `required: false`, so nothing waits for it.
Migrations apply themselves at startup, so there is no release step.

Updating later:

```
git pull && docker compose --profile edge up -d --build
```

## What goes in `.env`

```
NODE_ENV=production
PTRAINER_DOMAIN=ptrainer.duckdns.org
APP_ORIGIN=https://ptrainer.duckdns.org
PTRAINER_DB_PASSWORD=<long random string>
METRICS_TOKEN=<32+ random characters>
PRIVACY_ORGANIZATION=<your registered name>
PRIVACY_CONTACT_EMAIL=<a real address you read>
DATA_STORAGE_REGION=Canada (Oracle Cloud Infrastructure, Toronto / ca-toronto-1)
EMAIL_TRANSPORT=http
EMAIL_HTTP_URL=https://api.resend.com/emails
EMAIL_HTTP_TOKEN=<provider api key>
EMAIL_FROM=<your sending address>
```

`TRUST_PROXY` already defaults to `true` and `TUNNEL_WAIT_MS` to `0` in
`compose.yaml`; both are correct behind Caddy with no tunnel. Leave
`ALLOWED_ORIGINS` empty unless a second hostname reaches the same server.

**`APP_ORIGIN` has a distinctive failure worth recognising on sight.** It is the
origin allow-list for state-changing requests, so a mismatch does not look like
a configuration error — pages load perfectly and every sign-in and every save
fails with `ORIGIN_REJECTED`. If you see that, this variable is wrong.

`DATA_STORAGE_REGION` is a factual claim shown to users in the privacy notice.
It happens to be true here. It must be corrected if the hosting ever moves.

## Why mail is configured even though invitations don't need it

Invitations do not depend on email. `POST /api/invitations` returns the invite
code in its response and the trainer UI shows it as
`Invite created · Code: <token>`; handing someone
`https://your-host/?invite=<code>` yourself works exactly as well as a message
would.

Mail is configured because **the app refuses to start in production without
it**. That guard is deliberate and [`app/email.mjs`](../app/email.mjs) explains
why: a verification link written to a log file is not delivery, and a deployment
that treats it as delivery strands real users silently. The transport wants a
provider that accepts `{from,to,subject,text}` JSON with a bearer token, which
Resend, Postmark and Mailgun's JSON mode all satisfy.

On a free provider tier without a verified domain, delivery is usually limited
to your own account address. That is survivable for a small pilot — sending
never throws, so a failed send is logged and the request completes — but it
means **a tester who forgets their password needs you to reset it**. Verifying a
domain later turns this on properly with no code change.

Do not be tempted to drop `NODE_ENV=production` to get past the startup check.
That also removes `Secure` from the session cookie, re-enables the demo accounts
whose passwords are published in this repository, and loosens registration rate
limiting from 5 per hour to 5000 — on a public address.

## Before you give anyone the address

Everything in
[Before you give anyone the address](hosting-on-one-computer.md#before-you-give-anyone-the-address)
applies here unchanged, in particular that registration is open to anyone with
the link and that the [privacy launch checklist](privacy-launch-checklist.md)
comes before real client information.

Then confirm it is actually locked down, against the deployed address rather
than a local one:

```
PTRAINER_BASE=https://ptrainer.duckdns.org node work/endpoint-exposure-check.mjs
PTRAINER_BASE=https://ptrainer.duckdns.org node work/cross-account-check.mjs
PTRAINER_BASE=https://ptrainer.duckdns.org node work/security-smoke.mjs
```

The first two are the ones that matter most here: nothing answers without
credentials, and no record is reachable by guessing an id.

## Backups

PostgreSQL lives in the named volume `ptrainer_ptrainer_postgres_data`, which
survives `docker compose down`, rebuilds and reboots. **`down -v` deletes it.**
Nothing backs it up for you.

```
node scripts/db.mjs backup       # timestamped dump into backups/
```

Worth a nightly cron entry, plus copying the dumps off the machine — a backup
that only exists on the disk it is protecting is not one. Oracle's Always Free
tier includes five block-volume backups for the disk as a whole.

Restore into a scratch database and check the row counts at least once. An
untested backup is a guess.

## Operating notes

- **Idle reclamation is real.** Oracle may reclaim an Always Free instance when
  its 95th-percentile CPU, network *and* memory all sit under 20% across seven
  days. A quiet pilot can trip it. It stops the instance rather than destroying
  it, so the volumes survive and you start it again. Upgrading the tenancy to
  Pay As You Go exempts you and keeps the Always Free resources free, at the
  cost of a card on file and the risk of straying past the free limits.
- **Do not run `docker compose down -v`.** It deletes the database volume and
  Caddy's `/data`, and the latter holds the certificates — re-issuing them
  repeatedly is how you hit a Let's Encrypt rate limit.
- **One replica.** Rate-limit buckets, the idempotency replay cache and the
  template/assignment mirrors are process-local. See
  [architecture decisions](architecture-decisions.md).
- **`TRUST_PROXY=true` is correct here and only here.** The app port is
  published to `127.0.0.1` only, so nothing but Caddy can reach it and nothing
  can forge `X-Forwarded-For`. If you ever publish port 4173 beyond localhost,
  turn it off.
- **Patch the machine.** `sudo apt update && sudo apt upgrade` on some cadence
  you will actually keep. This is the part a managed platform would have done
  for you, and the honest price of the region.
