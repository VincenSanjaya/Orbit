// Additive migration: old orders retain their original simulated execution source.
export const LIVE_SCHEMA = `
ALTER TABLE users ADD COLUMN market_mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE users ADD COLUMN opening_funds TEXT NOT NULL DEFAULT '0';
UPDATE users SET opening_funds='10000';
ALTER TABLE orders ADD COLUMN mode TEXT NOT NULL DEFAULT 'simulated';
ALTER TABLE orders ADD COLUMN snapshot_price TEXT;
ALTER TABLE orders ADD COLUMN quote_time INTEGER;
ALTER TABLE orders ADD COLUMN slippage_bps TEXT NOT NULL DEFAULT '0';
CREATE TABLE instruments(symbol TEXT PRIMARY KEY,status TEXT NOT NULL,rules TEXT NOT NULL,verified_at INTEGER NOT NULL);
CREATE TABLE live_quotes(symbol TEXT PRIMARY KEY,price TEXT NOT NULL,event_time INTEGER NOT NULL,received_at INTEGER NOT NULL,stats TEXT NOT NULL);
CREATE TABLE live_candles(symbol TEXT NOT NULL,interval TEXT NOT NULL,time INTEGER NOT NULL,open TEXT NOT NULL,high TEXT NOT NULL,low TEXT NOT NULL,close TEXT NOT NULL,volume TEXT NOT NULL,event_time INTEGER NOT NULL,PRIMARY KEY(symbol,interval,time));
CREATE TABLE live_trades(symbol TEXT NOT NULL,trade_id TEXT NOT NULL,price TEXT NOT NULL,quantity TEXT NOT NULL,side TEXT NOT NULL,time INTEGER NOT NULL,PRIMARY KEY(symbol,trade_id));
CREATE INDEX live_trades_recent ON live_trades(symbol,time);
CREATE TABLE live_books(symbol TEXT PRIMARY KEY,last_update_id INTEGER NOT NULL,book TEXT NOT NULL,received_at INTEGER NOT NULL);
CREATE TABLE feed_state(mode TEXT PRIMARY KEY,status TEXT NOT NULL,error TEXT,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
INSERT INTO feed_state(mode,status,updated_at) VALUES('live','RECONNECTING',0);
CREATE TABLE market_subscriptions(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,interval TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE equity_history(user_id TEXT NOT NULL REFERENCES users(id),epoch INTEGER NOT NULL,mode TEXT NOT NULL,time INTEGER NOT NULL,equity TEXT NOT NULL,PRIMARY KEY(user_id,epoch,mode,time));
INSERT INTO equity_history SELECT user_id,epoch,'simulated',time,equity FROM equity_snapshots;
CREATE TABLE operator_actions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),amount TEXT NOT NULL,created_at INTEGER NOT NULL);
`;
