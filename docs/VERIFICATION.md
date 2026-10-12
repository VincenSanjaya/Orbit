# ORBIT live upgrade verification

Verified **12 October 2026** using Node 22.23.3, Next.js 16.4.0, SQLite, Vitest 4.1.11, and Playwright with Google Chrome. The final browser workflows ran against the optimized **production** server.

| Check                        | Actual result                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                   | Passed                                                                                                                    |
| ESLint                       | Passed, zero warnings                                                                                                     |
| Engine and transport tests   | **28 passed**, including all original engine invariants                                                                   |
| Production build             | Passed, no warnings                                                                                                       |
| Production browser workflows | **9 passed**                                                                                                              |
| Responsive layout            | No page overflow at 1440, 1024, 375, or 320px                                                                             |
| Browser errors               | No errors in the successful acceptance/responsive checks; manual production HYPE console clean                            |
| Dependency audit             | Zero vulnerabilities, including development tooling                                                                       |
| Verified market registry     | All 16 configured symbols confirmed as active Binance Spot pairs                                                          |
| Genuine HYPE probe           | Passed: exchangeInfo, real REST history, depth, trades, and advancing streamed candle                                     |
| New-account policy           | Actual registration starts at zero; faucet funds explicitly                                                               |
| Requested existing account   | Available **349 USDT**, reserved **0**, opening allocation **349**, mode **live**                                         |
| Migration preservation       | **51/51 original ledger rows** unchanged; **9/9 original executions** unchanged; **11/11 legacy orders** tagged simulated |
| Subscription cleanup         | Old development reload streams expired; final active leases returned to one browser subscription                          |

## Genuine provider probe

`npm run verify:live` completed at **2026-10-12 09:03:10 UTC** (16:03:10 Asia/Jakarta):

```json
{
  "provider": "Binance market-data-only Spot",
  "registeredMarkets": 16,
  "allLiveQuotesValid": true,
  "hypeStatus": "TRADING",
  "tickSize": "0.01000000",
  "lotSize": "0.00100000",
  "restHistoryBars": 240,
  "serverHistoryBars": 240,
  "depthLevels": 20,
  "recentTrades": 20,
  "liveCandleUpdated": true,
  "feedStatus": "LIVE"
}
```

A direct HYPE stream capture also showed a 16-second quiet-period gap between genuine candle events; the browser probe allows 60 seconds for a sourced event rather than inventing chart movement.

This probe queries Binance directly for HYPE exchangeInfo/history and the running ORBIT server for persisted data and streamed updates. It does not substitute synthetic prices when live data is unavailable.

## Engine and transport proof

Tests cover decimal fees, market buys/sells, sufficient-funds checks, precision/notional validation, limit reservation/cancellation, crossed buy/sell limits, duplicate requests and duplicate fills, ledger/execution immutability and reconciliation, authentication/ownership, basis/P&L, resets, independent competing SQLite writers, and coherent simulated candles.

New tests cover zero-start signup and idempotent operator adjustment; fresh HYPE-backed live paper pricing/slippage; limits paused on disconnect/stale data and filled once after a fresh crossing; invalid/future/halted quotes; unavailable held-asset valuation; source isolation; canceled live orders; live candle/depth ordering; and exact equity reconciliation when fractional cost basis rounds to eight decimals.

Transport tests use actual local WebSocket servers to exercise subscription/unsubscription, ping/pong, disconnect/reconnect, silence timeout, and clean stop. Browser transport tests prove one-source retry, stale-message rejection, stop/resume behavior, and jittered delay; REST tests prove request coalescing, cooldown/Retry-After handling, and rejection of non-market-data endpoints.

## Production browser proof

The full account workflow registers with zero equity, adds virtual capital, buys/sells BTC in simulated mode, verifies exact fees and realized P&L, reserves/cancels a limit, checks equity reconciliation, inspects history/filters, refreshes, resets to zero, logs out/logs in, and retains prior orders.

A separate genuine live workflow buys and sells HYPE against validated Binance snapshots, verifies actual fee/source/time records, places/cancels a live limit, checks real historical bootstrap and advancing live candles, switches timeframe, opens PEPE with appropriate precision, and persists a HYPE watchlist entry across reload. Mobile authenticated ETH trading and account routes run at 320px.

Provider-unavailability testing blocks both REST-to-ORBIT bootstrap and the SSE stream. The UI keeps Live mode, displays an interruption, and does not silently populate simulated prices. The production console and requested responsive sizes were checked.

## Limits of this verification

This is local functional verification, not a load test, independent security audit, or a guarantee of Binance availability or continuous matching. Live pending crossing is deterministic in engine tests; the genuine external-feed browser test verifies market fills and a reserved/canceled live limit without waiting for unpredictable external price movements. Public access/limits may change. Matching operates only while the backend/feed is healthy. All accounts and fills remain paper trading.

Engine tests use a separate database. Browser tests create unique test accounts in the app database. The operator adjustment affects only the explicitly requested cash-only account, retains immutable history, and is idempotent. A pre-upgrade backup remains at `data/orbit-before-live.sqlite`.
