import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { getBalance } from './barkd.js';
import {
  createBet,
  getBet,
  refreshBetPayment,
  potForBlock,
  settleBlock,
  runSettlementPass,
  pollPendingPayments,
  getTipHeight,
  issueRound2,
  signRound2,
  chainView,
} from './bets.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(config.publicDir, urlPath));
  if (!filePath.startsWith(config.publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        payments: 'barkd',
        offsets: [config.minOffset, config.maxOffset],
        betRangeSats: [config.minBetSats, config.maxBetSats],
        protocol: 'payout-class-settlement',
      });
    }

    if (req.method === 'GET' && pathname === '/tip') {
      const tip = await getTipHeight();
      return sendJson(res, 200, { tip });
    }

    if (req.method === 'GET' && pathname === '/chain') {
      return sendJson(res, 200, await chainView());
    }

    if (req.method === 'GET' && pathname === '/wallet') {
      return sendJson(res, 200, await getBalance());
    }

    const potMatch = pathname.match(/^\/pots\/(\d+)$/);
    if (req.method === 'GET' && potMatch) {
      const tip = await getTipHeight();
      const blockNumber = Number(potMatch[1]);
      const pot = potForBlock(blockNumber);
      pot.tip = tip;
      pot.bettingOpen = tip < blockNumber - 1;
      pot.round2Ready = tip >= blockNumber - 1;
      return sendJson(res, 200, pot);
    }

    if (req.method === 'POST' && pathname === '/bets') {
      const body = await readBody(req);
      const bet = await createBet(body);
      return sendJson(res, 201, bet);
    }

    const betMatch = pathname.match(/^\/bets\/([^/]+)$/);
    if (req.method === 'GET' && betMatch) {
      let bet = getBet(betMatch[1]);
      if (!bet) return sendJson(res, 404, { error: 'not found' });
      if (bet.status === 'PENDING_PAYMENT') bet = await refreshBetPayment(betMatch[1]);
      return sendJson(res, 200, bet);
    }

    const signMatch = pathname.match(/^\/bets\/([^/]+)\/sign-round2$/);
    if (req.method === 'POST' && signMatch) {
      const bet = signRound2(signMatch[1]);
      if (!bet) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, bet);
    }

    const round2Match = pathname.match(/^\/admin\/round2\/(\d+)$/);
    if (req.method === 'POST' && round2Match) {
      const blockNumber = Number(round2Match[1]);
      const issued = issueRound2(blockNumber);
      return sendJson(res, 200, issued);
    }

    const settleMatch = pathname.match(/^\/admin\/settle\/(\d+)$/);
    if (req.method === 'POST' && settleMatch) {
      const result = await settleBlock(Number(settleMatch[1]));
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/admin/run-settlement') {
      return sendJson(res, 200, await runSettlementPass());
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(res, status, { error: String(err.message || err) });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (
    pathname.startsWith('/health') ||
    pathname.startsWith('/tip') ||
    pathname.startsWith('/chain') ||
    pathname.startsWith('/wallet') ||
    pathname.startsWith('/pots') ||
    pathname.startsWith('/bets') ||
    pathname.startsWith('/admin')
  ) {
    return handleApi(req, res, pathname);
  }
  return serveStatic(req, res);
});

setInterval(() => {
  pollPendingPayments().catch(() => {});
}, config.paymentPollIntervalMs);

setInterval(() => {
  runSettlementPass().catch((err) => {
    console.error('settlement pass failed', err.message || err);
  });
}, config.settlementIntervalMs);

server.listen(config.port, () => {
  console.log(`HashBets on http://127.0.0.1:${config.port} (payments=barkd ${config.barkdUrl})`);
});
