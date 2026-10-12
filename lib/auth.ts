import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from './db';
import { ASSETS } from './shared';
import { AppError } from './money';
import { changeBalance } from './wallet';
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(72, 'Use at most 72 characters.')
    .refine((v) => Buffer.byteLength(v) <= 72, 'Password must fit within 72 UTF-8 bytes.'),
});
export type User = {
  id: string;
  email: string;
  name: string;
  created_at: number;
  password_hash: string;
  realized: string;
  net_deposits: string;
  epoch: number;
  market_mode: 'live' | 'simulated';
  opening_funds: string;
};
export async function register(input: unknown) {
  const parsed = credentials.extend({ name: z.string().trim().min(2).max(50) }).parse(input);
  const passwordHash = await hash(parsed.password, 12);
  return db()
    .transaction(() => {
      if (db().prepare('SELECT id FROM users WHERE email=?').get(parsed.email))
        throw new AppError('An account with this email already exists.', 409);
      const id = randomUUID();
      db()
        .prepare(
          "INSERT INTO users(id,email,name,password_hash,created_at,net_deposits,opening_funds) VALUES(?,?,?,?,?,'0','0')",
        )
        .run(id, parsed.email, parsed.name, passwordHash, Date.now());
      for (const asset of ['USDT', ...ASSETS.map((a) => a.symbol)])
        db().prepare('INSERT INTO balances(user_id,asset) VALUES(?,?)').run(id, asset);
      changeBalance(id, 'USDT', '0', '0', 'ACCOUNT_OPENED');
      return { id, name: parsed.name, email: parsed.email };
    })
    .immediate();
}
export async function login(input: unknown) {
  const parsed = credentials.parse(input);
  const user = db().prepare('SELECT * FROM users WHERE email=?').get(parsed.email) as
    User | undefined;
  const valid = await compare(
    parsed.password,
    user?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.3WHdFuNmSW/QeS2wDB7pmHi.S/tBbXm',
  );
  if (!user || !valid) throw new AppError('Email or password is incorrect.', 401);
  return { id: user.id, name: user.name, email: user.email };
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function createSession(userId: string) {
  const token = randomBytes(32).toString('hex'),
    expires = Date.now() + 7 * 86400000;
  db().prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db().prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), userId, expires);
  return { token, expires };
}
export function sessionUser(token?: string): User | null {
  if (!token) return null;
  return (
    (db()
      .prepare(
        'SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(digest(token), Date.now()) as User) || null
  );
}
export function logout(token?: string) {
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
}
export function rateLimit(key: string, max = 15, window = 60000) {
  db()
    .transaction(() => {
      const row = db().prepare('SELECT * FROM rate_limits WHERE key=?').get(key) as
        { count: number; expires_at: number } | undefined;
      if (!row || row.expires_at < Date.now())
        db()
          .prepare('INSERT OR REPLACE INTO rate_limits VALUES(?,?,?)')
          .run(key, 1, Date.now() + window);
      else {
        if (row.count >= max) throw new AppError('Too many requests. Try again in a minute.', 429);
        db().prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').run(key);
      }
    })
    .immediate();
}
