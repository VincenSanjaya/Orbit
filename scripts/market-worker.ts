import { LiveMarketWorker } from '../lib/live/worker';
const worker = new LiveMarketWorker();
worker.start();
console.log(
  'ORBIT market worker: shared Binance WebSocket + simulated market + authoritative matcher.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    worker.stop();
    process.exit(0);
  });
