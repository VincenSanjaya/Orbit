import Decimal from 'decimal.js';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: Decimal.Value) => new Decimal(value);
export const money = (value: Decimal.Value) => D(value).toDecimalPlaces(8).toFixed();
export const feeFor = (quantity: Decimal.Value, price: Decimal.Value, rate: Decimal.Value) =>
  money(D(quantity).mul(price).mul(rate));
export const MAKER = process.env.MAKER_FEE || '0.001';
export const TAKER = process.env.TAKER_FEE || '0.0015';
for (const rate of [MAKER, TAKER])
  if (!D(rate).isFinite() || D(rate).lt(0) || D(rate).gt('0.05'))
    throw new Error('Demo fees must be between 0 and 5%.');
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
