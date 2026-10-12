# ORBIT Exchange

**Find your edge. Make your move.**

ORBIT is a cryptocurrency paper trading app with genuine Binance Spot data, a premium charcoal-and-lime terminal, persistent accounts, and a server-authoritative wallet and execution engine. **Binance Live is the default market mode. New accounts start at zero USDT.**

A “Live market account” uses live market data. All balances and fills remain virtual: ORBIT never places Binance orders, takes custody, or transfers real cryptocurrency.

## Run locally

Use **Node 22 LTS, version 22.13 or newer**, or Node 24 LTS. `.nvmrc` selects Node 22. No exchange API key or database service is needed.

```sh
nvm use
npm ci
cp .env.example .env       # fresh installations; preserve an existing .env
npm run db:init
npm run dev
```

Open **http://localhost:3000** and register. The account starts at **0 USDT**; the wallet faucet adds **1,000 virtual USDT**, at most once per minute.

`npm run dev` and `npm start` supervise both Next.js and the market worker. The worker owns the upstream WebSocket, advances the separately labeled simulator, and matches pending orders. It runs while the application process runs, even with no browser open.

```sh
npm run build
npm start
```

For an externally supervised deployment, you may run Next.js and `npm run market:worker` separately. A database leader lease prevents a second worker from opening a duplicate upstream connection. When switching Node major versions, reinstall dependencies or run `npm rebuild better-sqlite3`.

## Markets and interface

The configurable registry is **`config/markets.json`**. It includes:

BTC, ETH, SOL, BNB, **HYPE (Hyperliquid)**, XRP, ADA, DOGE, AVAX, LINK, SUI, AAVE, UNI, LTC, TRX, and PEPE, all quoted against USDT.

The registry supplies identity, styling, and **explicitly synthetic** offline defaults. Live availability, tick/lot rules, min/max bounds, and trading status come from Binance **`exchangeInfo`**, refreshed every five minutes. Instruments without verified active Spot support never receive a fabricated live quote or live paper fill. The registry drives selector/search, watchlists, wallet backfill, portfolio holdings, orders, and history. Edit it and restart/rebuild to change the configured instruments.

- Original responsive landing page with an actual terminal preview.
- Searchable market selection, persisted browser watchlists, factual 24h movers, and trending ranked by sourced quote volume.
- Live price, rolling 24h change/high/low/quote volume, genuine hourly-candle sparklines, recent trades, and top-20 market depth.
- TradingView candles and volume with pan/zoom, crosshair, expanded view, and 1m/5m/15m/1h/4h/1d timeframes.
- Dedicated `/trade/HYPE-USDT`; PEPE uses its verified eight-decimal price precision.
- Buy/sell tickets, market/limit orders, balance shortcuts, slippage/fee previews, confirmations, and feedback.
- Atomic settlement, reservations, cancellation, duplicate-request protection, and immutable ledger/execution records.
- Weighted acquisition basis, realized/unrealized P&L, allocation, and observed performance by market mode.
- Persistent histories with details and asset, side, status, and date filters.
- Zero-start registration, persistent sessions, virtual funding, and confirmed reset to the account’s opening balance.

Routes: `/`, `/markets`, `/trade/[symbol]-USDT`, `/portfolio`, `/orders`, `/history`, `/wallet`, `/login`, `/register`, and `/settings`.

## Providers and connection ownership

### Binance Live

Only public market-data endpoints are used:

```text
REST       https://data-api.binance.vision/api/v3
WebSocket  wss://data-stream.binance.vision:443/stream
REST reads exchangeInfo, ticker/24hr, klines, trades, depth
Streams    <pair>@ticker, <pair>@kline_1h
On demand  <pair>@trade, <pair>@depth20, <pair>@kline_<timeframe>
```

One worker holds a renewable 12-second database leader lease and opens one combined Binance WebSocket. All configured pairs have ticker/hourly-candle subscriptions, keeping listings, holdings, open orders, and sparklines sourced consistently. Browser-active pairs/timeframes add trade, partial-depth, and candle subscriptions. The browser has one centralized SSE connection to ORBIT, not its own Binance socket. Browsers renew their per-connection subscriptions every five seconds; subscriptions expire after 15 seconds without renewal. Hidden tabs close their stream and stop renewing. The worker unsubscribes expired active-pair streams while retaining the global price streams needed for matching.

REST bootstraps genuine history. Streamed klines update open candles when Binance publishes an event; quiet trading periods can leave a candle unchanged for longer than the nominal stream interval. ORBIT does not synthesize events to make the chart move. REST periodically repairs completed bars and reconnect gaps without overwriting newer open candles. Historical Binance candles, synthetic candles, and quotes live in separate tables. Partial-depth streams contain complete top-20 snapshots, avoiding the reconstruction requirements of diff-depth streams. Old depth sequence numbers are ignored.

Price snapshots are validated, stored as decimal strings, and ordered by Binance event timestamps. Older tickers cannot rewind a newer trade price. UI prices, live fill validation, limit triggers, and live portfolio values read the same persisted quote state. A database write lock protects ingestion and matching.

### Heartbeat, reconnect and limits

- Binance ping frames receive automatic payload-matching pongs through `ws`. A 35-second silent-connection watchdog terminates broken sockets.
- Upstream connections rotate before Binance’s 24-hour lifetime. Reconnect delay grows from one second to 30 seconds with ±25% jitter, without changing market mode.
- Subscription changes are batched and paced at no more than one control message per 350ms, below Binance’s five incoming-message-per-second allowance, including heartbeat headroom.
- REST calls coalesce/cache, serialize with 160ms spacing, and enforce a conservative local budget of 600 request-weight units per minute. Weights account for exchangeInfo, ticker, candles, depth, and recent trades. Binance’s returned usage headers are also checked; usage above 5,000 triggers a pause.
- HTTP 429/418 honors `Retry-After`; absent it, cooldowns are 60/300 seconds respectively. Requests time out after eight seconds. These are local safeguards, not a promise that provider/IP limits cannot be reached.
- Source, quote update time, and **LIVE / RECONNECTING / STALE / SIMULATED / UNAVAILABLE** states are visible. Separate depth timestamps flag stale depth.

Binance may restrict access by region or change availability/limits. **There is no silent provider fallback.** An outage pauses live execution; users may explicitly select Simulated mode.

### Simulated mode

The existing persisted, bounded stochastic provider remains available offline. It uses one consistent price process for simulated display, fills, and valuations; its depth and historical seed are clearly synthetic. New registry assets receive synthetic histories without overwriting the old eight markets. The initial seed covers seven days of minute candles, with aggregation across the supported timeframes.

Simulation advances at most once per three seconds under the same database lock. It pauses when both the application/worker and requests stop. Missing downtime ticks are not invented or replayed.

## Paper execution and fees

**No real orders are ever sent to Binance.** The public REST client restricts itself to an allowlist of market-data GET endpoints. A displayed quote or real depth snapshot does not guarantee executable liquidity at that price.

Live submissions are validated server-side against verified instrument rules and the latest authoritative snapshot. They require an active feed leader, a connected live feed, positive valid prices, and both source/receipt timestamps within **10 seconds** by default. Future-dated, stale, unavailable, halted, or unsupported quotes cannot fill. An unavailable held-asset quote makes equity/P&L unavailable (`—`), preserving quantities/basis instead of substituting simulated prices.

The documented virtual model fills in full, without liquidity/queue/partial-fill modeling:

```text
market buy price  = ceil_to_tick(latest_quote × (1 + slippage_bps / 10000))
market sell price = floor_to_tick(latest_quote × (1 - slippage_bps / 10000))
limit buy trigger = quote <= limit; modeled fill price is capped at limit
limit sell trigger= quote >= limit; modeled fill price is floored at limit
```

Default live slippage is **2 basis points (0.02%)**, configurable from 0–100 bps. Simulated execution retains zero slippage. Slippage, tick precision, and estimated fees are included in the ticket/percentage shortcuts before confirmation. The final server quote may change slightly before submission. Orders retain their actual execution price, source quote/time, market mode, slippage setting, fee, and immutable execution record.

Default example **maker fee = 0.10%**, **taker fee = 0.15%**. All virtual limits use the maker rate, including immediately marketable limits; all virtual market orders use the taker rate. These are paper rates, not Binance’s fee schedule or exchange maker/taker classification.

```text
notional = round8(quantity × execution_price)
fee      = round8(quantity × execution_price × rate)
buy      = USDT debited by notional + fee; full base quantity credited
sell     = base quantity debited; USDT credited by notional - fee
```

Limit buys reserve limit notional plus maker fee; limit sells reserve base quantity. Better-price buy fills release unused reserve. Cancellation releases reserves under the write lock; canceled orders cannot subsequently fill.

Live paper validation enforces verified price/quantity min/max, tick/lot steps, market-lot bounds where enabled, and notional bounds. The notional test uses this virtual model’s price, not Binance’s rolling weighted-average calculation. Exchange queue, percentage-price windows, iceberg/algorithmic order counts and other real-order rules are outside the virtual model. Simulated orders use registry tick/lot rules and a 5-USDT minimum. This is not a claim that an actual Binance order would be accepted or filled.

### Mode switching and downtime

Account mode is persisted server-side and controls portfolio valuation and new order submissions. The server rejects a submission if its confirmation mode differs from the account mode. A mode change starts a separate performance epoch; holdings and acquisition basis remain intact.

**Existing orders retain their original mode.** A simulated order cannot trigger against a Binance quote, and a live order cannot trigger against a generated price. Both can remain pending against their respective feeds while the worker runs; reserves are shared wallet funds. This remains true after refresh and restart.

During a live disconnect, stale period, or backend outage, pending live orders remain reserved and unfilled. Cancellation is still available. Once fresh quotes return, matching evaluates the current quote only. Missed historical crossings are never replayed; limits may remain unfilled even if the external market crossed them while ORBIT was offline. There is no 24/7 matching guarantee unless the backend is kept running and its feed is healthy.

## Accounting, funding and persistence

All financial arithmetic uses 40-digit Decimal calculations. Money, prices, quantities, fees, and cost basis persist as **TEXT decimals**, not SQLite REAL or JavaScript settlement floats. USDT accounting rounds half up to eight decimals.

```text
buy basis increase   = notional + acquisition fee
average cost         = remaining basis / total base held
removed basis        = round8(remaining basis × sold quantity / total base held)
realized P&L         = net sale proceeds - removed basis
unrealized P&L       = selected-source valuation - remaining basis
equity               = sum((available + reserved) × selected-source price)
```

Removed basis rounds once before both realized P&L and remaining basis are updated, preserving exact eight-decimal equity reconciliation. USDT is valued at one unit of paper equity; this is a simulator accounting assumption, not a claim that USDT is actual bank-held dollars. Funding changes net contributions, not trading P&L. Performance records observed minute equity while accounts are queried; it does not invent unattended returns.

New registrations start at zero. The faucet provides virtual practice capital. Reset cancels open orders, clears holdings/basis/P&L, records clearing/funding events, and restores **that account’s configured opening balance**: zero for new accounts, a retained opening allocation for existing/operator-adjusted accounts. Old order/execution/ledger history remains.

A local operator-only command can adjust a cash-only account while recording an immutable adjustment and preserving its login/history:

```sh
npm run account:balance -- user@example.com 349 unique-adjustment-id
```

The action ID makes retries idempotent. The command refuses to discard crypto holdings. There is no public admin/funding override API. Ordinary signup never receives a special allocation based only on a supplied email.

### Database/concurrency and authentication

SQLite enables WAL, full synchronous durability, foreign keys, and a five-second busy timeout. Settlement, balance checks, reservations, cancellation, resets, and mode changes use `BEGIN IMMEDIATE`. Conditional OPEN transitions and unique execution/order idempotency keys prevent double fills/spending. Immutable-row triggers protect ledger and executions.

Passwords use bcrypt cost 12 and a 72-byte limit. Sessions persist hashed random tokens for seven days with HttpOnly/SameSite cookies. APIs enforce authentication/ownership for every account action, JSON/body-size validation, request-origin checks, and database-backed rate limits. Set secure cookies and an exact app origin for HTTPS deployment. The auth limiter remains coarse and shared for this local app; public-scale deployment needs trusted per-client abuse controls.

## Architecture and migrations

```text
config/markets.json             Configurable asset identity and synthetic defaults
lib/live/rest.ts                Market-only REST, caching/weight/cooldown guards
lib/live/socket.ts              One upstream socket, heartbeat/reconnect/subscription control
lib/live/ingest.ts               Validated rules, ticker/trade/depth/candle persistence
lib/live/quotes.ts               Authoritative freshness/rule checks
lib/live/provider.ts             Shared snapshots and expiring client leases
lib/live/worker.ts               Leader ownership, bootstrap, subscriptions and matching
lib/client-feed.ts              One visibility-aware browser SSE transport
lib/market.ts                   Separate persisted simulator
lib/trading.ts                  Atomic fill/reservation/cancellation/mode/funding services
lib/portfolio.ts                Source-aware valuation, basis and P&L
lib/wallet.ts                   Balance updates and corresponding immutable journal entries
lib/migrations/                 Versioned, transactional SQL migrations
components/, app/               Premium UI and Node/App Router endpoints
scripts/                        App supervision, initialization, operator and live verification
tests/, e2e/                   Financial/transport regression and browser workflows
```

Migration 2 is additive: mode/source provenance, opening allocations, verified instruments, live price/candle/trade/depth tables, feed ownership/subscriptions, mode-specific performance, and idempotent operator actions. Existing orders are tagged **simulated**, old ledger/execution records are untouched, and expanded balances are backfilled without replacing existing holdings. Migration 1 and legacy performance tables are retained.

Before the upgrade, a consistent SQLite backup was saved locally as `data/orbit-before-live.sqlite`. Rollback requires stopping the app/worker and restoring a consistent pre-upgrade backup with the previous source version; restoring it would discard activity created after that backup. Do not copy a live SQLite file without its WAL; use the SQLite backup API. No rollback or destructive contraction is performed automatically.

## Environment

| Variable                 | Default                                | Purpose                                        |
| ------------------------ | -------------------------------------- | ---------------------------------------------- |
| `DATABASE_PATH`          | `./data/orbit.sqlite`                  | Writable persistent SQLite path                |
| `BINANCE_REST_URL`       | `https://data-api.binance.vision`      | Market-data-only REST base                     |
| `BINANCE_WS_URL`         | `wss://data-stream.binance.vision:443` | Market-data-only WebSocket base                |
| `PAPER_SLIPPAGE_BPS`     | `2`                                    | Live virtual slippage, 0–100 bps               |
| `MAX_QUOTE_AGE_MS`       | `10000`                                | Maximum valid source/receipt age, 1000–60000ms |
| `MAKER_FEE`, `TAKER_FEE` | `0.001`, `0.0015`                      | Example virtual fee rates                      |
| `COOKIE_SECURE`          | `false`                                | Set true for HTTPS                             |
| `APP_ORIGIN`             | unset                                  | Exact public origin, without trailing slash    |
| `PORT`                   | `3000`                                 | Server port                                    |
| `E2E_BASE_URL`           | `http://127.0.0.1:3000`                | Browser/live-probe target                      |

`.env`, databases, credentials, reports and runtime state are ignored by Git. No exchange secret exists. Next.js and the supervised worker load `.env`; initialization/operator commands use Node env-file support.

## Verification

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm audit
# Against a running app:
npm run test:e2e
npm run verify:live
```

Engine tests use a separate database and explicit funding fixtures; they do not change zero-start signup policy or the user’s app wallet. They cover existing fee/buy/sell/reserve/cancel/concurrency/immutability/ownership/reset paths plus live HYPE pricing/slippage, stale/future/invalid/halted quotes, mode isolation, live crossing, candle/depth sequencing, and fractional-basis reconciliation. Transport tests exercise real local sockets for subscriptions, unsubscribe, ping/pong, reconnect and heartbeat timeout, plus browser transport stop/retry and REST cooldown/coalescing.

Browser tests use installed Chrome and create uniquely named test accounts. They cover zero-start signup, funding, simulated persistence, fees/P&L, cancellation/reset/login, source failure without fallback, responsiveness at 1440/1024/375/320px, and actual Binance-backed HYPE buys/sells, candles/live updates, timeframe/PEPE switching, and persisted favorites. The genuine-live test requires Binance availability; an unavailable provider is reported as a failure rather than disguised as synthetic success. `verify:live` independently checks Binance HYPE exchangeInfo and REST candles, all configured live quotes, server depth/trades, and an advancing streamed candle timestamp.

See `docs/VERIFICATION.md` for the delivered results. For missing Chrome, run `npx playwright install chrome`. Traces/screenshots/reports remain ignored in `test-results/` and `playwright-report/`.

## Deployment and limitations

Deploy to a persistent **single Node host/container with local writable disk**, using the documented build/start commands, HTTPS reverse proxy, preserved Host header, `COOKIE_SECURE=true`, and `APP_ORIGIN`. Persist the data directory. The start command supervises the feed worker; use an external process supervisor for restarts and availability. SQLite WAL must not be shared across independent machines/network filesystems. Multi-host deployment needs a shared transactional database and revised feed leadership/stream distribution.

This release has virtual spot funds only, full fills only, no executable-liquidity/queue model, no real money/KYC/withdrawals, and no email verification/password recovery/MFA. Watchlists persist per browser. Histories have filters but no pagination/export. Portfolio performance is observed rather than fully unattended. Public data and regional availability are external dependencies; backend/feed downtime pauses matching. Additional providers and CSV export remain possible future work.

Primary references: [Binance market-data-only URLs](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md), [REST endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), [Spot filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md), [WebSocket streams and limits](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md), and [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts). Branding/layout are original; no paid template assets are copied.

## Wallet display currencies

The wallet's **Total assets** uses the server's portfolio equity: available plus reserved
USDT and all crypto holdings at validated prices. USD and IDR are display estimates using
1 USDT ≈ 1 USD; balances, order reservations, fees and the ledger remain in their original
assets. The currency selection is saved in local browser storage per account.

IDR uses the daily USD/IDR reference rate from [Frankfurter](https://frankfurter.dev/),
via `https://api.frankfurter.dev/v2/rate/USD/IDR` (no API key). `/api/exchange-rate`
validates the currency pair, positive rate and rate date, shares concurrent requests,
caches for one hour and waits one minute before retrying failed requests. A previously
validated rate may be served for up to seven days, visibly marked **Cached rate** when
refresh fails; older or unavailable rates show an unavailable value with a retry action.
The source and publication date appear beside IDR totals. This is a daily reference
conversion, not an executable USDT/IDR price. If portfolio valuation is incomplete,
neither currency displays a partial total.

