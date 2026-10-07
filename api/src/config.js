import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const rootDir = path.join(__dirname, '../..');
loadEnvFile(path.join(__dirname, '../.env'));
loadEnvFile(path.join(rootDir, '.env'));

function intEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolvePath(p, fallback) {
  if (!p) return fallback;
  return path.isAbsolute(p) ? p : path.join(rootDir, p);
}

export const config = {
  port: intEnv('PORT', 4000),
  dbPath: resolvePath(process.env.DB_PATH, path.join(__dirname, '../data/hashbets.json')),
  barkdUrl: (process.env.BARKD_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  barkdToken: process.env.BARKD_TOKEN || '',
  minBetSats: intEnv('MIN_BET_SATS', 100),
  maxBetSats: intEnv('MAX_BET_SATS', 2000),
  minOffset: intEnv('MIN_OFFSET', 3),
  maxOffset: intEnv('MAX_OFFSET', 8),
  mempoolApi: (process.env.MEMPOOL_API || 'https://mempool.space/api').replace(/\/$/, ''),
  settlementIntervalMs: intEnv('SETTLEMENT_INTERVAL_MS', 15000),
  paymentPollIntervalMs: intEnv('PAYMENT_POLL_INTERVAL_MS', 3000),
  publicDir: path.join(rootDir, 'web/public'),
  rootDir,
};

export const HEX_DIGITS = '0123456789abcdef';
