import { config } from './config.js';

/** Optional override for offline / mock demos: MOCK_TIP=900000 */
export async function getTipHeight() {
  if (process.env.MOCK_TIP) {
    const tip = Number(process.env.MOCK_TIP);
    if (Number.isFinite(tip)) return tip;
  }
  const res = await fetch(`${config.mempoolApi}/blocks/tip/height`);
  if (!res.ok) throw new Error(`mempool tip height failed: ${res.status}`);
  const text = await res.text();
  const height = Number(text.trim());
  if (!Number.isFinite(height)) throw new Error(`invalid tip height: ${text}`);
  return height;
}

export async function getBlockHash(height) {
  const res = await fetch(`${config.mempoolApi}/block-height/${height}`);
  if (!res.ok) throw new Error(`mempool block-height ${height} failed: ${res.status}`);
  const hash = (await res.text()).trim();
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error(`invalid block hash: ${hash}`);
  return hash.toLowerCase();
}

export function lastHexNibble(blockHash) {
  return blockHash.slice(-1).toLowerCase();
}
