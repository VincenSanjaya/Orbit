import Database from 'better-sqlite3';
import { ASSETS } from './shared';
import { LIVE_SCHEMA } from './migrations/002-live-market';
import { INITIAL_SCHEMA } from './migrations/001-initial';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const globals = globalThis as unknown as { orbitDb?: Database.Database };
export function db() {
  if (globals.orbitDb) return globals.orbitDb;
  const path = process.env.DATABASE_PATH || './data/orbit.sqlite';
  if (path !== ':memory:')
    mkdirSync(dirname(resolve(/* turbopackIgnore: true */ path)), { recursive: true });
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database
    .transaction(() => {
      database.exec(
        'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
      );
      if (!database.prepare('SELECT version FROM migrations WHERE version=1').get()) {
        database.exec(INITIAL_SCHEMA);
        database.prepare('INSERT INTO migrations VALUES(1,?)').run(Date.now());
      }
      if (!database.prepare('SELECT version FROM migrations WHERE version=2').get()) {
        database.exec(LIVE_SCHEMA);
        database.prepare('INSERT INTO migrations VALUES(2,?)').run(Date.now());
      }
      // Add balances for newly configured instruments without rewriting existing holdings.
      for (const asset of ASSETS)
        database
          .prepare('INSERT OR IGNORE INTO balances(user_id,asset) SELECT id,? FROM users')
          .run(asset.symbol);
    })
    .immediate();

  globals.orbitDb = database;
  return database;
}
