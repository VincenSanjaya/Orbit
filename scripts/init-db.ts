import { initializeMarket } from '../lib/market';
import { db } from '../lib/db';
initializeMarket();
console.log(
  'ORBIT database initialized with eight simulated markets. No demo credentials are seeded.',
);
db().close();
