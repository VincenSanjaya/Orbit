import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  command = process.argv[2] || 'dev';
const next = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), command, ...process.argv.slice(3)],
  { stdio: 'inherit', env: process.env },
);
const worker = spawn(
  process.execPath,
  ['--import', 'tsx', '--env-file-if-exists=.env', 'scripts/market-worker.ts'],
  { stdio: 'inherit', env: process.env },
);
let stopping = false;
const stop = (code: number) => {
  if (stopping) return;
  stopping = true;
  next.kill('SIGTERM');
  worker.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000).unref();
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
next.on('exit', (code) => stop(code || 0));
worker.on('exit', (code) => stop(code || 0));
