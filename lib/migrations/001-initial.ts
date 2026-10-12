// Version 1: all financial values use TEXT decimal strings.
export const INITIAL_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL,realized TEXT NOT NULL DEFAULT '0',net_deposits TEXT NOT NULL DEFAULT '10000',epoch INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS balances(user_id TEXT NOT NULL REFERENCES users(id),asset TEXT NOT NULL,available TEXT NOT NULL DEFAULT '0',reserved TEXT NOT NULL DEFAULT '0',cost_basis TEXT NOT NULL DEFAULT '0',PRIMARY KEY(user_id,asset));
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),symbol TEXT NOT NULL,side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),type TEXT NOT NULL CHECK(type IN ('MARKET','LIMIT')),quantity TEXT NOT NULL,limit_price TEXT,status TEXT NOT NULL CHECK(status IN ('OPEN','FILLED','CANCELED','REJECTED')),filled_quantity TEXT NOT NULL DEFAULT '0',execution_price TEXT,fee TEXT NOT NULL DEFAULT '0',fee_currency TEXT NOT NULL DEFAULT 'USDT',fee_rate TEXT NOT NULL,reserved TEXT NOT NULL DEFAULT '0',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,reason TEXT,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),price TEXT NOT NULL,quantity TEXT NOT NULL,fee TEXT NOT NULL,fee_currency TEXT NOT NULL,realized_pnl TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),asset TEXT NOT NULL,available_delta TEXT NOT NULL,reserved_delta TEXT NOT NULL,kind TEXT NOT NULL,order_id TEXT REFERENCES orders(id),created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_no_update BEFORE UPDATE ON executions BEGIN SELECT RAISE(ABORT,'Executions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS executions_no_delete BEFORE DELETE ON executions BEGIN SELECT RAISE(ABORT,'Executions are immutable'); END;
    CREATE TABLE IF NOT EXISTS market_state(symbol TEXT PRIMARY KEY,price TEXT NOT NULL,last_tick INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS candles(symbol TEXT NOT NULL,time INTEGER NOT NULL,open TEXT NOT NULL,high TEXT NOT NULL,low TEXT NOT NULL,close TEXT NOT NULL,volume TEXT NOT NULL,PRIMARY KEY(symbol,time));
    CREATE TABLE IF NOT EXISTS market_trades(id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,price TEXT NOT NULL,quantity TEXT NOT NULL,side TEXT NOT NULL,time INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS equity_snapshots(user_id TEXT NOT NULL REFERENCES users(id),epoch INTEGER NOT NULL,time INTEGER NOT NULL,equity TEXT NOT NULL,PRIMARY KEY(user_id,epoch,time));
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_open ON orders(status,symbol);
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,created_at);
    CREATE INDEX IF NOT EXISTS trades_symbol ON market_trades(symbol,time);

`;
