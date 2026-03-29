diff --git a/insiderbuying-site/n8n/code/insiderbuying/finnhub-client.js b/insiderbuying-site/n8n/code/insiderbuying/finnhub-client.js
new file mode 100644
index 0000000..419924f
--- /dev/null
+++ b/insiderbuying-site/n8n/code/insiderbuying/finnhub-client.js
@@ -0,0 +1,117 @@
+'use strict';
+
+// In-memory TTL cache for Finnhub quotes.
+// Key: ticker (uppercase), value: { data, expiresAt }
+// Lazy cleanup: expired entries are deleted on the next read.
+// Exported with _ prefix as a test utility only — not part of the public API.
+const _quoteCache = new Map();
+
+// ─── Timezone / Market Hours ──────────────────────────────────────────────────
+
+function getEtParts(nowMs) {
+  const parts = new Intl.DateTimeFormat('en-US', {
+    timeZone: 'America/New_York',
+    weekday: 'short',
+    hour: 'numeric',
+    minute: 'numeric',
+    hour12: false,
+  }).formatToParts(new Date(nowMs));
+
+  const get = (type) => {
+    const part = parts.find((p) => p.type === type);
+    return part ? part.value : null;
+  };
+
+  const weekday = get('weekday'); // 'Mon', 'Tue', ..., 'Sun'
+  const hour = parseInt(get('hour'), 10);
+  const minute = parseInt(get('minute'), 10);
+
+  return { weekday, hour, minute };
+}
+
+const WEEKEND_DAYS = new Set(['Sat', 'Sun']);
+
+function isMarketOpen(nowMs) {
+  const { weekday, hour, minute } = getEtParts(nowMs);
+  if (WEEKEND_DAYS.has(weekday)) return false;
+  const totalMinutes = hour * 60 + minute;
+  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
+}
+
+function getCacheTtlMs(nowMs) {
+  return isMarketOpen(nowMs) ? 60_000 : 14_400_000;
+}
+
+// ─── getQuote() ───────────────────────────────────────────────────────────────
+
+async function getQuote(ticker, fetchFn, env, nowFn) {
+  if (typeof nowFn !== 'function') nowFn = () => Date.now();
+  const key = String(ticker).toUpperCase();
+  const now = nowFn();
+
+  // Cache check (lazy TTL cleanup)
+  const cached = _quoteCache.get(key);
+  if (cached) {
+    if (cached.expiresAt > now) return cached.data;
+    _quoteCache.delete(key);
+  }
+
+  // Fetch from Finnhub
+  const url = `https://finnhub.io/api/v1/quote?symbol=${key}&token=${env.FINNHUB_API_KEY}`;
+  let resp;
+  try {
+    resp = await fetchFn(url);
+  } catch (err) {
+    console.warn(`[finnhub-client] getQuote fetch error for ${key}: ${err.message}`);
+    return null;
+  }
+
+  if (resp.status !== 200) {
+    console.warn(`[finnhub-client] getQuote HTTP ${resp.status} for ${key}`);
+    return null;
+  }
+
+  const body = await resp.json();
+  const data = { c: body.c, dp: body.dp, h: body.h, l: body.l, o: body.o, pc: body.pc };
+  _quoteCache.set(key, { data, expiresAt: now + getCacheTtlMs(now) });
+  return data;
+}
+
+// ─── getNextEarningsDate() ────────────────────────────────────────────────────
+
+async function getNextEarningsDate(ticker, fetchFn, env, nowFn) {
+  if (typeof nowFn !== 'function') nowFn = () => Date.now();
+  const key = String(ticker).toUpperCase();
+  const now = nowFn();
+
+  const url =
+    `${env.NOCODB_API_URL}/api/v1/db/data/noco/${env.NOCODB_PROJECT_ID}` +
+    `/${env.NOCODB_EARNINGS_TABLE_ID}` +
+    `?where=(ticker,eq,${key})&sort=earnings_date&limit=1`;
+
+  let resp;
+  try {
+    resp = await fetchFn(url, { headers: { 'xc-token': env.NOCODB_API_TOKEN } });
+  } catch (err) {
+    console.warn(`[finnhub-client] getNextEarningsDate fetch error for ${key}: ${err.message}`);
+    return null;
+  }
+
+  const body = await resp.json();
+  const list = (body && body.list) || [];
+  if (list.length === 0) return null;
+
+  const earningsDate = list[0].earnings_date;
+  if (!earningsDate) return null;
+
+  // Return null if more than 90 days from now
+  const earningsMs = new Date(earningsDate).getTime();
+  const diffDays = (earningsMs - now) / (1000 * 60 * 60 * 24);
+  if (diffDays > 90) return null;
+
+  return earningsDate;
+}
+
+// ─── Exports ──────────────────────────────────────────────────────────────────
+
+module.exports = { getQuote, getNextEarningsDate, _quoteCache };
diff --git a/insiderbuying-site/tests/insiderbuying/finnhub-client.test.js b/insiderbuying-site/tests/insiderbuying/finnhub-client.test.js
new file mode 100644
index 0000000..8454363
--- /dev/null
+++ b/insiderbuying-site/tests/insiderbuying/finnhub-client.test.js
@@ -0,0 +1,216 @@
+'use strict';
+
+// _quoteCache is exported with underscore prefix as a test utility.
+// It is not part of the public API — used here only to clear state between tests.
+const { getQuote, getNextEarningsDate, _quoteCache } =
+  require('../../n8n/code/insiderbuying/finnhub-client');
+
+// ─── Fixtures ────────────────────────────────────────────────────────────────
+
+const MOCK_QUOTE = { c: 45.20, dp: 1.5, h: 46.00, l: 44.50, o: 44.80, pc: 44.54 };
+
+const MOCK_ENV = {
+  FINNHUB_API_KEY: 'test-finnhub-key',
+  NOCODB_API_URL: 'https://nocodb.example.com',
+  NOCODB_API_TOKEN: 'test-nocodb-token',
+  NOCODB_PROJECT_ID: 'proj_test',
+  NOCODB_EARNINGS_TABLE_ID: 'tbl_earnings_test',
+};
+
+// Time constants (all EST = UTC-5)
+// 2026-01-06 (Tuesday) 14:00 ET = 19:00 UTC
+const TUESDAY_OPEN_UTC = Date.UTC(2026, 0, 6, 19, 0, 0);
+// 2026-01-06 (Tuesday) 17:00 ET = 22:00 UTC
+const TUESDAY_CLOSED_UTC = Date.UTC(2026, 0, 6, 22, 0, 0);
+// 2026-01-10 (Saturday) 12:00 ET = 17:00 UTC
+const SATURDAY_UTC = Date.UTC(2026, 0, 10, 17, 0, 0);
+// 2026-03-08 (Sunday, DST spring-forward day) 07:30 UTC = ~02:30 EST / 03:30 EDT
+const DST_SPRING_UTC = Date.UTC(2026, 2, 8, 7, 30, 0);
+// Reference date for earnings tests: 2026-03-29 12:00 UTC
+const REF_DATE_UTC = Date.UTC(2026, 2, 29, 12, 0, 0);
+
+// ─── Helpers ─────────────────────────────────────────────────────────────────
+
+function makeQuoteFetch(status = 200, body = MOCK_QUOTE) {
+  return jest.fn().mockResolvedValue({
+    status,
+    json: async () => body,
+  });
+}
+
+function makeNocoFetch(earningsDate) {
+  const list = earningsDate
+    ? [{ ticker: 'TEST', earnings_date: earningsDate, confirmed: true }]
+    : [];
+  return jest.fn().mockResolvedValue({
+    status: 200,
+    json: async () => ({ list }),
+  });
+}
+
+// ─── getQuote() ───────────────────────────────────────────────────────────────
+
+describe('getQuote()', () => {
+  beforeEach(() => _quoteCache.clear());
+
+  test('returns correct {c, dp, h, l, o, pc} fields from Finnhub response', async () => {
+    const fetchFn = makeQuoteFetch();
+    const result = await getQuote('AAPL', fetchFn, MOCK_ENV);
+    expect(result).toEqual(MOCK_QUOTE);
+  });
+
+  test('cache hit: two calls within TTL → fetchFn called exactly once', async () => {
+    let now = TUESDAY_OPEN_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('AAPL', fetchFn, MOCK_ENV, () => now);
+    now += 30_000; // 30s later — within 60s market-open TTL
+    await getQuote('AAPL', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+  });
+
+  test('cache miss after TTL: stale entry gone, fetchFn called on second call', async () => {
+    let now = TUESDAY_OPEN_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('AAPL', fetchFn, MOCK_ENV, () => now);
+    now += 61_000; // past 60s market-open TTL
+    await getQuote('AAPL', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(2);
+  });
+
+  test('HTTP 429 → returns null, logs warning', async () => {
+    const fetchFn = makeQuoteFetch(429, {});
+    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+    const result = await getQuote('AAPL', fetchFn, MOCK_ENV);
+    expect(result).toBeNull();
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+
+  test('HTTP 500 → returns null, logs warning', async () => {
+    const fetchFn = makeQuoteFetch(500, {});
+    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+    const result = await getQuote('AAPL', fetchFn, MOCK_ENV);
+    expect(result).toBeNull();
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+
+  test('network error (fetchFn throws) → returns null, logs warning', async () => {
+    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
+    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+    const result = await getQuote('AAPL', fetchFn, MOCK_ENV);
+    expect(result).toBeNull();
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+});
+
+// ─── Market hours / TTL ───────────────────────────────────────────────────────
+
+describe('market hours / TTL', () => {
+  beforeEach(() => _quoteCache.clear());
+
+  test('market open weekday (14:00 ET Tuesday) → 60-second TTL', async () => {
+    let now = TUESDAY_OPEN_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('TTL1', fetchFn, MOCK_ENV, () => now);
+    now += 30_000; // 30s — cache hit
+    await getQuote('TTL1', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+    now += 31_000; // total 61s — cache miss
+    await getQuote('TTL1', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(2);
+  });
+
+  test('market closed after hours (17:00 ET Tuesday) → 4-hour TTL', async () => {
+    let now = TUESDAY_CLOSED_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('TTL2', fetchFn, MOCK_ENV, () => now);
+    now += 2 * 3_600_000; // 2h — cache hit
+    await getQuote('TTL2', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+    now += 2 * 3_600_000 + 1000; // total 4h+1s — cache miss
+    await getQuote('TTL2', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(2);
+  });
+
+  test('weekend (Saturday 12:00 ET) → 4-hour TTL, cache hit at 2h', async () => {
+    let now = SATURDAY_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('TTL3', fetchFn, MOCK_ENV, () => now);
+    now += 2 * 3_600_000; // 2h — still within 4h TTL
+    await getQuote('TTL3', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+  });
+
+  test('DST spring-forward boundary (2026-03-08 07:30 UTC) → no throw, returns boolean from isMarketOpen', async () => {
+    const fetchFn = makeQuoteFetch();
+    let threw = false;
+    try {
+      await getQuote('DST', fetchFn, MOCK_ENV, () => DST_SPRING_UTC);
+    } catch {
+      threw = true;
+    }
+    expect(threw).toBe(false);
+    // Call succeeded (DST is handled by Intl.DateTimeFormat, not our code)
+  });
+});
+
+// ─── getNextEarningsDate() ────────────────────────────────────────────────────
+
+describe('getNextEarningsDate()', () => {
+  test('returns earnings_date when within 90 days of reference date', async () => {
+    // 2026-04-25 is 27 days from REF_DATE (2026-03-29) → within 90 days
+    const fetchFn = makeNocoFetch('2026-04-25');
+    const result = await getNextEarningsDate('AAPL', fetchFn, MOCK_ENV, () => REF_DATE_UTC);
+    expect(result).toBe('2026-04-25');
+  });
+
+  test('returns null when earnings date is more than 90 days away', async () => {
+    // 2027-01-15 is ~292 days from REF_DATE
+    const fetchFn = makeNocoFetch('2027-01-15');
+    const result = await getNextEarningsDate('AAPL', fetchFn, MOCK_ENV, () => REF_DATE_UTC);
+    expect(result).toBeNull();
+  });
+
+  test('returns null when NocoDB result is empty', async () => {
+    const fetchFn = makeNocoFetch(null);
+    const result = await getNextEarningsDate('AAPL', fetchFn, MOCK_ENV, () => REF_DATE_UTC);
+    expect(result).toBeNull();
+  });
+
+  test('returns null and logs warning when NocoDB throws', async () => {
+    const fetchFn = jest.fn().mockRejectedValue(new Error('NocoDB connection failed'));
+    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+    const result = await getNextEarningsDate('AAPL', fetchFn, MOCK_ENV, () => REF_DATE_UTC);
+    expect(result).toBeNull();
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+});
+
+// ─── Cache cleanup (lazy TTL) ─────────────────────────────────────────────────
+
+describe('cache cleanup (lazy TTL)', () => {
+  beforeEach(() => _quoteCache.clear());
+
+  test('expired entry deleted on read, fetchFn called again', async () => {
+    let now = TUESDAY_OPEN_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('CLEAN1', fetchFn, MOCK_ENV, () => now);
+    expect(_quoteCache.has('CLEAN1')).toBe(true);
+    now += 61_000; // TTL expired
+    await getQuote('CLEAN1', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(2);
+  });
+
+  test('fresh entry retained, fetchFn not called again', async () => {
+    let now = TUESDAY_OPEN_UTC;
+    const fetchFn = makeQuoteFetch();
+    await getQuote('CLEAN2', fetchFn, MOCK_ENV, () => now);
+    now += 30_000; // still within TTL
+    await getQuote('CLEAN2', fetchFn, MOCK_ENV, () => now);
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+    expect(_quoteCache.has('CLEAN2')).toBe(true);
+  });
+});
