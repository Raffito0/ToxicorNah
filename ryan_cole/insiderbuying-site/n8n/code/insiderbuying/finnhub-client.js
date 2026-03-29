'use strict';

// In-memory TTL cache for Finnhub quotes.
// Key: ticker (uppercase), value: { data, expiresAt }
// Lazy cleanup: expired entries are deleted on the next read.
const _quoteCache = new Map();

// ─── Timezone / Market Hours ──────────────────────────────────────────────────

function getEtParts(nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));

  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : null;
  };

  const weekday = get('weekday'); // 'Mon', 'Tue', ..., 'Sun'
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  return { weekday, hour, minute };
}

const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

function isMarketOpen(nowMs) {
  const { weekday, hour, minute } = getEtParts(nowMs);
  if (WEEKEND_DAYS.has(weekday)) return false;
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}

function getCacheTtlMs(nowMs) {
  return isMarketOpen(nowMs) ? 60_000 : 14_400_000;
}

// ─── getQuote() ───────────────────────────────────────────────────────────────

async function getQuote(ticker, fetchFn, env, nowFn) {
  if (typeof nowFn !== 'function') nowFn = () => Date.now();
  const key = String(ticker).toUpperCase();
  const now = nowFn();

  // Cache check (lazy TTL cleanup)
  const cached = _quoteCache.get(key);
  if (cached) {
    if (cached.expiresAt > now) return cached.data;
    _quoteCache.delete(key);
  }

  // Fetch from Finnhub
  const url = `https://finnhub.io/api/v1/quote?symbol=${key}&token=${env.FINNHUB_API_KEY}`;
  let resp;
  try {
    resp = await fetchFn(url);
  } catch (err) {
    console.warn(`[finnhub-client] getQuote fetch error for ${key}: ${err.message}`);
    return null;
  }

  if (resp.status !== 200) {
    console.warn(`[finnhub-client] getQuote HTTP ${resp.status} for ${key}`);
    return null;
  }

  const body = await resp.json();
  const data = { c: body.c, dp: body.dp, h: body.h, l: body.l, o: body.o, pc: body.pc };
  _quoteCache.set(key, { data, expiresAt: now + getCacheTtlMs(now) });
  return data;
}

// ─── getNextEarningsDate() ────────────────────────────────────────────────────

async function getNextEarningsDate(ticker, fetchFn, env, nowFn) {
  if (typeof nowFn !== 'function') nowFn = () => Date.now();
  const key = String(ticker).toUpperCase();
  const now = nowFn();

  const todayIso = new Date(now).toISOString().slice(0, 10); // "YYYY-MM-DD"
  const url =
    `${env.NOCODB_API_URL}/api/v1/db/data/noco/${env.NOCODB_PROJECT_ID}` +
    `/${env.NOCODB_EARNINGS_TABLE_ID}` +
    `?where=(ticker,eq,${key})~and(earnings_date,gte,${todayIso})&sort=earnings_date&limit=1`;

  let resp;
  try {
    resp = await fetchFn(url, { headers: { 'xc-token': env.NOCODB_API_TOKEN } });
  } catch (err) {
    console.warn(`[finnhub-client] getNextEarningsDate fetch error for ${key}: ${err.message}`);
    return null;
  }

  if (resp.status !== 200) {
    console.warn(`[finnhub-client] getNextEarningsDate HTTP ${resp.status} for ${key}`);
    return null;
  }

  const body = await resp.json();
  const list = (body && body.list) || [];
  if (list.length === 0) return null;

  const earningsDate = list[0].earnings_date;
  if (!earningsDate) return null;

  // Return null for past dates or dates more than 90 days out
  const earningsMs = new Date(earningsDate).getTime();
  const diffDays = (earningsMs - now) / (1000 * 60 * 60 * 24);
  if (diffDays < 0 || diffDays > 90) return null;

  return earningsDate;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { getQuote, getNextEarningsDate };

// Test-only escape hatch — never import _quoteCache in production code.
if (process.env.NODE_ENV === 'test') {
  module.exports._quoteCache = _quoteCache;
}
