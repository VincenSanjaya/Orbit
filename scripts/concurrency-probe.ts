import { submitOrder } from '../lib/trading';
const [userId, key, quantity] = process.argv.slice(2);
const order = submitOrder(userId, {
  symbol: 'BTC',
  side: 'BUY',
  type: 'MARKET',
  quantity,
  idempotencyKey: key,
});
console.log(JSON.stringify({ id: order.id, status: order.status }));
