# Vercel web with a local ngrok backend

The laptop runs Next.js APIs, SQLite and the market worker. Vercel serves the web
and forwards API requests to the HTTPS ngrok endpoint. The existing local database
is used, so account data and the owner's adjusted wallet do not need migration.

## First connection

1. Use Node 22 (`nvm use`). Start ORBIT with `npm run dev` on port 3000.
2. If ngrok is not configured, sign in to ngrok and run
   `ngrok config add-authtoken YOUR_TOKEN` locally. Never commit or share that token.
3. In another terminal, run `ngrok http http://127.0.0.1:3000`. Keep both processes open.
4. Copy the actual HTTPS forwarding URL from ngrok. In Vercel, import the repository,
   set `ORBIT_BACKEND_URL` to that HTTPS origin (no path), then deploy. Use Node 22
   and the default Next.js build command (`npm run build`).
5. Once Vercel assigns the public web domain, set `APP_ORIGIN` in your local `.env`
   to that exact web origin (no trailing slash) and `COOKIE_SECURE=true`. Leave
   `ORBIT_BACKEND_URL` unset locally. Restart ORBIT; keep ngrok forwarding to port 3000.
6. Open the Vercel web domain and check login, HYPE quotes, wallet and paper orders.

The repository's API proxy adds `ngrok-skip-browser-warning` on outbound ngrok
requests, including SSE streams. Without it, the ngrok free-tier browser warning
can replace API JSON and streaming responses. No browser extension is needed.

## Later sessions

Run ORBIT and ngrok again. The HTTPS URL reported by the agent must match
`ORBIT_BACKEND_URL` in Vercel. If the URL changes, update the Vercel variable and
redeploy; rewrites are generated at build time. Prefer the account's assigned
development domain when available. To request a specific domain your ngrok
account permits, use `ngrok http http://127.0.0.1:3000 --url https://YOUR_DOMAIN`.

For serving regular sessions with a production build, run `npm run build` once
after code changes, then `npm start` instead of `npm run dev`. This still runs both
the web/API and worker. Keep the same database path and backups. The GitHub-linked
Vercel deployment does not start your laptop's processes.

Laptop shutdown, sleep, lost internet or stopped processes make the backend
unavailable. Balances remain on disk, orders cannot execute, and matching resumes
only against fresh quotes when the backend returns. No missed crossing is filled
retroactively. Vercel's static web may remain reachable during this downtime.

This setup stays subject to ngrok's free-plan traffic quotas. ORBIT polls account
state and renews stream leases while visible, so check usage during long sessions.
The ngrok inspector also records requests locally; do not publish its port 4040.
When returning to direct HTTP localhost use, restore `COOKIE_SECURE=false` and
remove the Vercel `APP_ORIGIN` restriction, then restart.

References: [ngrok free plan and warning header](https://ngrok.com/docs/pricing-limits/free-plan-limits),
[ngrok agent CLI](https://ngrok.com/docs/agent/cli).

## Verification (2026-10-12)

Typecheck, lint and a production build passed. One Playwright browser workflow
passed against the production web proxy and a real ngrok tunnel to the local
backend: JSON session responses, 16 market rows, two native EventSource messages
and rejection of unrelated-origin mutations. Vercel's public domain and browser
login from that domain still require `APP_ORIGIN` setup after its first deployment.
