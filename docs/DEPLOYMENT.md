# Vercel web + persistent backend

The same GitHub repository builds both deployments. The backend runs the API,
SQLite database and market worker together on a single persistent host. Vercel
serves the web and proxies `/api/*` to that backend. No database migration or
second trading engine is introduced.

## Backend (Render Blueprint)

`render.yaml` is ready for review. It provisions one paid Starter Node service
with a 1 GB persistent disk. Check current [Render pricing](https://render.com/pricing)
before applying it. Free services do not support the required persistent disk.
Connect GitHub and choose this repository as a Blueprint; do not separately
create a worker because `npm start` already supervises it beside Next.js.

Set `APP_ORIGIN` to the exact public web origin, e.g. `https://orbit.example.com`
(no trailing slash). Only that origin may submit browser mutations. Keep
`ORBIT_BACKEND_URL` unset on the backend. The Blueprint sets
`DATABASE_PATH=/var/data/orbit.sqlite`, Node 22.23.3 and `COOKIE_SECURE=true`.

The first deployment creates an empty database; new accounts start at zero.
Existing local accounts, including the owner's 349 USDT wallet, are **not**
inside GitHub. Preserve them by taking a consistent SQLite backup and privately
restoring it to the disk before opening the service to users. Stop the backend
before replacing its database, preserve ownership, and keep a separate backup.
Never commit a database, `.env`, account data, sessions or password hashes.
Restart and check the owner wallet and order history through the web afterward.

The disk permits one instance. Matching pauses during restarts, deploys or feed
outages and resumes for currently eligible limits after a fresh quote returns.
No retroactive fills are made for price crossings missed while offline. Confirm
the backend region can reach Binance public data before going live.

## Vercel web

Import `VincenSanjaya/Orbit`, branch `main`, framework Next.js, build command
`npm run build`, Node 22. Set `ORBIT_BACKEND_URL` to the backend's HTTPS origin
(e.g. `https://your-backend.onrender.com`) in the build environment, then deploy.
The config fails early on Vercel if this value is missing. Changing it requires
a rebuild. Production and preview web deployments need an explicitly allowed
`APP_ORIGIN` on their corresponding backend; do not enable arbitrary origins.

Rewrites run before local API routes, forwarding paths and query parameters.
The browser uses its own origin for API requests and session cookies; no client
database credentials or cross-domain cookie settings are required. `Cache-Control:
no-store` protects account responses. External proxy/SSE disconnects are recovered
by the existing feed reconnect and lease logic; the backend remains authoritative.

After linking the providers to GitHub, pushes can trigger automatic deployments.
Account connection, backend provisioning and any paid plan selection are still
required; a GitHub push alone does not create a live backend.

## Verify after deployment

Check register/login/logout, account refresh, wallet USD/IDR conversion,
HYPE market data and candles, paper buys/sells, pending limits and cancellation.
Restart the backend and verify balances, orders and ledger survive. Inspect
LIVE/STALE behavior during a feed interruption. Check `/api/session` returns JSON
through the Vercel origin and that unrelated browser origins receive HTTP 403
for mutations. Monitor the worker and make private database backups.

## Rollback

Unset `ORBIT_BACKEND_URL` and rebuild to restore a single persistent-host deployment.
Keep that backend's database disk. A previous compatible commit may be redeployed
against the preserved database; this change does not alter its schema. Vercel
alone cannot host this application's current SQLite database or persistent worker.

## Local verification (2026-10-12)

Typecheck, lint and 45 unit tests passed. Both backend and proxy production builds
passed. Five Playwright workflows passed against an isolated backend on port 3300
and web proxy on port 3400, covering browser registration and cookies, funding,
paper HYPE fills, refresh persistence, rejected cross-origin mutations, Binance
candle bootstrap and SSE, sourced FX, wallet conversion, and missing valuations.
These are local production checks; a public cloud deployment and its provider
network path still need verification after hosting accounts are connected.

To repeat against isolated deployments:

```sh
E2E_BASE_URL=http://127.0.0.1:3400 E2E_BACKEND_ORIGIN=http://127.0.0.1:3300 \
  npm run test:e2e -- e2e/deployment.spec.ts e2e/wallet.spec.ts
```

References: [Vercel and local SQLite](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel),
[external rewrites](https://vercel.com/docs/routing/rewrites),
[Render disks](https://render.com/docs/disks),
[Blueprint reference](https://render.com/docs/blueprint-spec).
