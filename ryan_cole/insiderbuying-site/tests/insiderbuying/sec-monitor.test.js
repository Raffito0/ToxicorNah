'use strict';

const {
  buildEdgarUrl,
  parseEdgarResponse,
  buildDedupKey,
  passesDedup,
  classifyInsider,
  fetchDedupKeys,
  loadCikTickerMap,
  enrichFiling,
  detectCluster,
  readMonitorState,
  writeMonitorState,
} = require('../../n8n/code/insiderbuying/sec-monitor');

const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');

// ─── Shared mock factory ──────────────────────────────────────────────────────

function makeFetch(response) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

function makeFetchSeq(...calls) {
  const fn = jest.fn();
  calls.forEach(({ response, ok = true, status = 200 }) => {
    fn.mockResolvedValueOnce({
      ok,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    });
  });
  return fn;
}

function makeFailFetch(statusCode) {
  return jest.fn().mockRejectedValue(
    Object.assign(new Error(`HTTP ${statusCode}`), { statusCode }),
  );
}

const noSleep = jest.fn().mockResolvedValue(undefined);

const BASE_ENV = {
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_BASE_URL: 'http://localhost:8080',
  NOCODB_PROJECT_ID: 'proj123',
  FINANCIAL_DATASETS_API_KEY: 'fd-key',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
};

function makeNocoDB(fetchFn) {
  return new NocoDB(BASE_ENV.NOCODB_BASE_URL, BASE_ENV.NOCODB_API_TOKEN, BASE_ENV.NOCODB_PROJECT_ID, fetchFn);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('section-03: sec-monitor.js', () => {

  // ── 3.0 Pre-load: fetchDedupKeys ──────────────────────────────────────────
  describe('fetchDedupKeys()', () => {
    test('returns a Set of strings, not an array', async () => {
      const fetchFn = makeFetch({
        list: [
          { Id: 1, dedup_key: 'AAPL_Tim_Cook_2026-03-25_10000' },
          { Id: 2, dedup_key: 'MSFT_Brad_Smith_2026-03-24_5000' },
        ],
        pageInfo: { isLastPage: true },
      });
      const nocodb = makeNocoDB(fetchFn);
      const result = await fetchDedupKeys({ nocodb });
      expect(result).toBeInstanceOf(Set);
      expect([...result]).toEqual(
        expect.arrayContaining(['AAPL_Tim_Cook_2026-03-25_10000', 'MSFT_Brad_Smith_2026-03-24_5000']),
      );
    });

    test('returns empty Set when NocoDB returns no records', async () => {
      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
      const nocodb = makeNocoDB(fetchFn);
      const result = await fetchDedupKeys({ nocodb });
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test('filters out null and undefined dedup_key values', async () => {
      const fetchFn = makeFetch({
        list: [
          { Id: 1, dedup_key: 'AAPL_Cook_2026-03-25_100' },
          { Id: 2 },
          { Id: 3, dedup_key: null },
          { Id: 4, dedup_key: undefined },
        ],
        pageInfo: { isLastPage: true },
      });
      const nocodb = makeNocoDB(fetchFn);
      const result = await fetchDedupKeys({ nocodb });
      expect(result.size).toBe(1);
    });

    test('sends xc-token header to NocoDB', async () => {
      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
      const nocodb = makeNocoDB(fetchFn);
      await fetchDedupKeys({ nocodb });
      const [, opts] = fetchFn.mock.calls[0];
      expect(opts.headers['xc-token']).toBe('test-token');
    });

    test('paginates until pageInfo.isLastPage is true', async () => {
      const fetchFn = makeFetchSeq(
        { response: { list: [{ Id: 1, dedup_key: 'KEY_A' }], pageInfo: { isLastPage: false } } },
        { response: { list: [{ Id: 2, dedup_key: 'KEY_B' }], pageInfo: { isLastPage: true } } },
      );
      const nocodb = makeNocoDB(fetchFn);
      const result = await fetchDedupKeys({ nocodb });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.has('KEY_A')).toBe(true);
      expect(result.has('KEY_B')).toBe(true);
    });

    test('second page call passes incremented offset', async () => {
      const fetchFn = makeFetchSeq(
        { response: { list: [{ Id: 1, dedup_key: 'KEY_A' }], pageInfo: { isLastPage: false } } },
        { response: { list: [{ Id: 2, dedup_key: 'KEY_B' }], pageInfo: { isLastPage: true } } },
      );
      const nocodb = makeNocoDB(fetchFn);
      await fetchDedupKeys({ nocodb });
      const secondUrl = fetchFn.mock.calls[1][0];
      expect(secondUrl).toContain('offset=');
    });

    test('treats missing pageInfo as last page — does not loop infinitely', async () => {
      const fetchFn = makeFetch({ list: [{ Id: 1, dedup_key: 'KEY_A' }] }); // no pageInfo key
      const nocodb = makeNocoDB(fetchFn);
      const result = await fetchDedupKeys({ nocodb });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.has('KEY_A')).toBe(true);
    });

    test('uses NocoDB filter syntax (filing_date,gt,...) not Airtable formula', async () => {
      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
      const nocodb = makeNocoDB(fetchFn);
      await fetchDedupKeys({ nocodb });
      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain('filing_date');
      expect(url).toContain('gt');
      expect(url).not.toContain('IS_AFTER');
      expect(url).not.toContain('airtable.com');
    });
  });

  // ── 3.0 Monitor_State read/write ─────────────────────────────────────────
  describe('readMonitorState()', () => {
    test('calls nocodb.list("Monitor_State") with eq filter and returns record', async () => {
      const fetchFn = makeFetch({
        list: [{ Id: 7, name: 'market', last_check_timestamp: '2024-01-15T00:00:00Z' }],
        pageInfo: { isLastPage: true },
      });
      const nocodb = makeNocoDB(fetchFn);
      const record = await readMonitorState('market', { nocodb });
      expect(record).not.toBeNull();
      expect(record.Id).toBe(7);
      expect(record.last_check_timestamp).toBe('2024-01-15T00:00:00Z');
      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain('Monitor_State');
      expect(url).toContain('market');
      expect(url).toContain('eq');
      expect(url).not.toContain('filterByFormula');
    });

    test('returns null when Monitor_State record not found', async () => {
      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
      const nocodb = makeNocoDB(fetchFn);
      const record = await readMonitorState('market', { nocodb });
      expect(record).toBeNull();
    });
  });

  describe('writeMonitorState()', () => {
    test('calls nocodb.update("Monitor_State", id, { last_check_timestamp })', async () => {
      const fetchFn = makeFetch({ Id: 7 });
      const nocodb = makeNocoDB(fetchFn);
      await writeMonitorState(7, '2024-01-20T00:00:00Z', { nocodb });
      const [url, opts] = fetchFn.mock.calls[0];
      expect(url).toContain('Monitor_State');
      expect(url).toContain('/7');
      expect(opts.method).toBe('PATCH');
      const body = JSON.parse(opts.body);
      expect(body.last_check_timestamp).toBe('2024-01-20T00:00:00Z');
      expect(body.fields).toBeUndefined();
    });
  });

  // ── 3.0 Pre-load: loadCikTickerMap ────────────────────────────────────────
  describe('loadCikTickerMap()', () => {
    const SEC_DATA = {
      '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' },
      '2': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA Corp' },
    };

    test('returns a Map of paddedCik -> ticker', async () => {
      const fetchFn = makeFetch(SEC_DATA);
      const result = await loadCikTickerMap({ fetchFn });
      expect(result).toBeInstanceOf(Map);
      expect(result.get('0000320193')).toBe('AAPL');
      expect(result.get('0000789019')).toBe('MSFT');
    });

    test('zero-pads CIK to 10 digits (320193 -> "0000320193")', async () => {
      const fetchFn = makeFetch(SEC_DATA);
      const result = await loadCikTickerMap({ fetchFn });
      expect(result.has('0000320193')).toBe(true);
      expect(result.has('320193')).toBe(false);
    });

    test('handles 7-digit CIK correctly (1045810 -> "0001045810")', async () => {
      const fetchFn = makeFetch(SEC_DATA);
      const result = await loadCikTickerMap({ fetchFn });
      expect(result.get('0001045810')).toBe('NVDA');
    });

    test('handles missing/malformed entries without crashing', async () => {
      const fetchFn = makeFetch({
        '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        '1': { ticker: 'BAD' },           // missing cik_str
        '2': { cik_str: null, ticker: 'X' }, // null cik_str
        '3': null,                          // null entry
      });
      await expect(loadCikTickerMap({ fetchFn })).resolves.toBeInstanceOf(Map);
    });

    test('sends SEC User-Agent header', async () => {
      const fetchFn = makeFetch(SEC_DATA);
      await loadCikTickerMap({ fetchFn });
      const [, opts] = fetchFn.mock.calls[0];
      expect(opts.headers['User-Agent']).toBe('EarlyInsider.com (alerts@earlyinsider.com)');
    });
  });

  // ── 3.1 EDGAR URL Tests ───────────────────────────────────────────────────
  describe('buildEdgarUrl()', () => {
    test('includes startdt and enddt params', () => {
      const url = buildEdgarUrl('2026-03-20', '2026-03-27');
      expect(url).toContain('startdt=2026-03-20');
      expect(url).toContain('enddt=2026-03-27');
    });

    test('includes count=40', () => {
      const url = buildEdgarUrl('2026-03-20', '2026-03-27');
      expect(url).toContain('count=40');
    });

    test('includes sort=file_date:desc', () => {
      const url = buildEdgarUrl('2026-03-20', '2026-03-27');
      expect(url).toContain('sort=file_date');
      expect(url).toContain('desc');
    });

    test('does NOT include q=* (overbroad query guard)', () => {
      const url = buildEdgarUrl('2026-03-20', '2026-03-27');
      expect(url).not.toMatch(/q=\*/);
      expect(url).not.toMatch(/q=%2A/);
    });

    test('includes "form 4" as narrow query', () => {
      const url = buildEdgarUrl('2026-03-20', '2026-03-27');
      // URLSearchParams encodes spaces as '+'; replace back before checking
      const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
      expect(decoded.toLowerCase()).toContain('form 4');
    });
  });

  // ── 3.1 EDGAR Parse Tests ─────────────────────────────────────────────────
  describe('parseEdgarResponse()', () => {
    test('extracts entity_name, file_date, accession_number from hits.hits', () => {
      const response = {
        hits: {
          hits: [
            {
              _id: '0000320193-26-000042',
              _source: {
                entity_name: 'Apple Inc.',
                file_date: '2026-03-27T14:23:11.000Z',
              },
            },
          ],
        },
      };
      const results = parseEdgarResponse(response);
      expect(results).toHaveLength(1);
      expect(results[0].entity_name).toBe('Apple Inc.');
      expect(results[0].file_date).toBe('2026-03-27T14:23:11.000Z');
      expect(results[0].accession_number).toBe('0000320193-26-000042');
    });

    test('returns empty array when hits.hits is empty', () => {
      const result = parseEdgarResponse({ hits: { hits: [] } });
      expect(result).toEqual([]);
    });

    test('returns empty array when response is malformed', () => {
      expect(parseEdgarResponse(null)).toEqual([]);
      expect(parseEdgarResponse({})).toEqual([]);
      expect(parseEdgarResponse({ hits: {} })).toEqual([]);
    });

    test('extracts CIK as first segment of accession number', () => {
      const response = {
        hits: {
          hits: [
            {
              _id: '0000320193-26-000042',
              _source: { entity_name: 'Apple', file_date: '2026-03-27T14:00:00.000Z' },
            },
          ],
        },
      };
      const results = parseEdgarResponse(response);
      expect(results[0].cik).toBe('0000320193');
    });
  });

  // ── 3.2 Enrichment Tests ──────────────────────────────────────────────────
  describe('enrichFiling()', () => {
    const FD_RESPONSE = {
      insider_trades: [
        {
          name: 'Tim Cook',
          title: 'Chief Executive Officer',
          is_board_director: false,
          transaction_date: '2026-03-25',
          transaction_shares: 10000,
          transaction_price_per_share: 225.50,
          transaction_value: 2255000,
          transaction_type: 'P - Purchase',
          filing_date: '2026-03-27',
        },
      ],
    };

    test('calls correct endpoint with ticker and filing_date_gte params', async () => {
      const fetchFn = makeFetch(FD_RESPONSE);
      await enrichFiling('AAPL', '2026-03-27', { apiKey: 'key', fetchFn, _sleep: noSleep });
      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain('ticker=AAPL');
      expect(url).toContain('filing_date_gte=2026-03-27');
    });

    test('sends X-API-KEY header', async () => {
      const fetchFn = makeFetch(FD_RESPONSE);
      await enrichFiling('AAPL', '2026-03-27', { apiKey: 'myFDKey', fetchFn, _sleep: noSleep });
      const [, opts] = fetchFn.mock.calls[0];
      expect(opts.headers['X-API-KEY']).toBe('myFDKey');
    });

    test('extracts all required fields from response', async () => {
      const fetchFn = makeFetch(FD_RESPONSE);
      const result = await enrichFiling('AAPL', '2026-03-27', { apiKey: 'key', fetchFn, _sleep: noSleep });
      expect(result).toMatchObject({
        name: 'Tim Cook',
        title: 'Chief Executive Officer',
        is_board_director: false,
        transaction_date: '2026-03-25',
        transaction_shares: 10000,
        transaction_price_per_share: 225.50,
        transaction_value: 2255000,
        transaction_type: 'P - Purchase',
        filing_date: '2026-03-27',
      });
    });

    test('retries up to 3 times on 429 status', async () => {
      const err429 = Object.assign(new Error('HTTP 429'), { statusCode: 429 });
      const fetchFn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockRejectedValueOnce(err429)
        .mockRejectedValueOnce(err429);
      const result = await enrichFiling('AAPL', '2026-03-27', {
        apiKey: 'key', fetchFn, _sleep: noSleep,
      });
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(result).toBeNull();
    });

    test('retries up to 3 times on 500 status', async () => {
      const err500 = Object.assign(new Error('HTTP 500'), { statusCode: 500 });
      const fetchFn = jest.fn()
        .mockRejectedValueOnce(err500)
        .mockRejectedValueOnce(err500)
        .mockRejectedValueOnce(err500);
      const result = await enrichFiling('AAPL', '2026-03-27', {
        apiKey: 'key', fetchFn, _sleep: noSleep,
      });
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(result).toBeNull();
    });

    test('returns null (not throws) after 3 failed retries', async () => {
      const err = Object.assign(new Error('HTTP 500'), { statusCode: 500 });
      const fetchFn = jest.fn().mockRejectedValue(err);
      await expect(
        enrichFiling('AAPL', '2026-03-27', { apiKey: 'key', fetchFn, _sleep: noSleep }),
      ).resolves.toBeNull();
    });

    test('returns null when insider_trades array is empty (NOT a failure)', async () => {
      const fetchFn = makeFetch({ insider_trades: [] });
      const onFailure = jest.fn();
      const result = await enrichFiling('UNKNOWN', '2026-03-27', {
        apiKey: 'key', fetchFn, _sleep: noSleep, onFailure,
      });
      expect(result).toBeNull();
      expect(onFailure).not.toHaveBeenCalled(); // empty = not a failure
    });

    test('calls onFailure only on real API failure (3 retries exhausted)', async () => {
      const err = Object.assign(new Error('HTTP 500'), { statusCode: 500 });
      const fetchFn = jest.fn().mockRejectedValue(err);
      const onFailure = jest.fn();
      await enrichFiling('AAPL', '2026-03-27', { apiKey: 'key', fetchFn, _sleep: noSleep, onFailure });
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    test('does NOT call onFailure when success on retry', async () => {
      const err = Object.assign(new Error('HTTP 429'), { statusCode: 429 });
      const fetchFn = jest.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ ok: true, json: async () => FD_RESPONSE });
      const onFailure = jest.fn();
      const result = await enrichFiling('AAPL', '2026-03-27', {
        apiKey: 'key', fetchFn, _sleep: noSleep, onFailure,
      });
      expect(result).not.toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    });

    test('applies 100ms delay via _sleep before the retry loop (not inside it)', async () => {
      const fetchFn = makeFetch(FD_RESPONSE);
      const _sleep = jest.fn().mockResolvedValue(undefined);
      await enrichFiling('AAPL', '2026-03-27', { apiKey: 'key', fetchFn, _sleep });
      // First call must be 100ms (the pre-loop rate-limit delay)
      expect(_sleep).toHaveBeenNthCalledWith(1, 100);
    });
  });

  // ── 3.3 Dedup Tests ───────────────────────────────────────────────────────
  describe('buildDedupKey()', () => {
    test('returns ticker_name_date_shares format', () => {
      const key = buildDedupKey('AAPL', 'Tim Cook', '2026-03-25', 10000);
      expect(key).toBe('AAPL_Tim_Cook_2026-03-25_10000');
    });

    test('replaces spaces in insider name with underscores', () => {
      const key = buildDedupKey('MSFT', 'Brad Smith Jones', '2026-03-24', 5000);
      expect(key).toBe('MSFT_Brad_Smith_Jones_2026-03-24_5000');
    });

    test('handles single-word names', () => {
      const key = buildDedupKey('TSLA', 'Musk', '2026-03-01', 500);
      expect(key).toBe('TSLA_Musk_2026-03-01_500');
    });
  });

  describe('passesDedup()', () => {
    test('returns false for key already in Set', () => {
      const s = new Set(['AAPL_Cook_2026-03-25_10000']);
      expect(passesDedup('AAPL_Cook_2026-03-25_10000', s)).toBe(false);
    });

    test('returns true for key not in Set', () => {
      const s = new Set();
      expect(passesDedup('AAPL_Cook_2026-03-25_10000', s)).toBe(true);
    });

    test('adds key to Set when passing (prevents same-run duplicates)', () => {
      const s = new Set();
      passesDedup('AAPL_Cook_2026-03-25_10000', s);
      expect(s.has('AAPL_Cook_2026-03-25_10000')).toBe(true);
    });

    test('second call with same key returns false (duplicate blocked)', () => {
      const s = new Set();
      passesDedup('AAPL_Cook_2026-03-25_10000', s);
      expect(passesDedup('AAPL_Cook_2026-03-25_10000', s)).toBe(false);
    });
  });

  // ── 3.4 Filter Tests ─────────────────────────────────────────────────────
  describe('filterBuysOnly()', () => {
    // Test via isBuyTransaction helper
    const { isBuyTransaction } = require('../../n8n/code/insiderbuying/sec-monitor');

    test('P - Purchase passes filter', () => {
      expect(isBuyTransaction('P - Purchase')).toBe(true);
    });

    test('S - Sale is filtered out', () => {
      expect(isBuyTransaction('S - Sale')).toBe(false);
    });

    test('A - Grant is filtered out', () => {
      expect(isBuyTransaction('A - Grant')).toBe(false);
    });

    test('D - Disposition is filtered out', () => {
      expect(isBuyTransaction('D - Disposition')).toBe(false);
    });

    test('null transaction_type is filtered out', () => {
      expect(isBuyTransaction(null)).toBe(false);
    });

    test('undefined transaction_type is filtered out', () => {
      expect(isBuyTransaction(undefined)).toBe(false);
    });
  });

  // ── 3.5 Classification Tests ──────────────────────────────────────────────
  describe('classifyInsider()', () => {
    test('Chief Executive Officer -> C-Suite', () => {
      expect(classifyInsider('Chief Executive Officer', false)).toBe('C-Suite');
    });

    test('CFO -> C-Suite', () => {
      expect(classifyInsider('CFO', false)).toBe('C-Suite');
    });

    test('CEO -> C-Suite', () => {
      expect(classifyInsider('CEO', false)).toBe('C-Suite');
    });

    test('Board Director -> Board', () => {
      expect(classifyInsider('Board Director', false)).toBe('Board');
    });

    test('Executive Vice President -> VP (not C-Suite despite "president")', () => {
      expect(classifyInsider('Executive Vice President', false)).toBe('VP');
    });

    test('Corporate Secretary -> Officer', () => {
      expect(classifyInsider('Corporate Secretary', false)).toBe('Officer');
    });

    test('10% Owner -> 10% Owner', () => {
      expect(classifyInsider('10% Owner', false)).toBe('10% Owner');
    });

    test('is_board_director=true overrides ambiguous/unrecognized title to Board', () => {
      expect(classifyInsider('Special Advisor', true)).toBe('Board');
    });

    test('is_board_director=true does NOT override C-Suite', () => {
      expect(classifyInsider('Chief Executive Officer', true)).toBe('C-Suite');
    });

    test('is_board_director=true does NOT override VP (unambiguous explicit match)', () => {
      expect(classifyInsider('Executive Vice President', true)).toBe('VP');
    });

    test('unrecognized title defaults to Officer (no crash)', () => {
      expect(classifyInsider('Quantum Facilitator', false)).toBe('Officer');
    });

    test('classification is case-insensitive (ceo -> C-Suite)', () => {
      expect(classifyInsider('ceo', false)).toBe('C-Suite');
    });

    test('empty title defaults to Officer', () => {
      expect(classifyInsider('', false)).toBe('Officer');
    });

    test('null title defaults to Officer', () => {
      expect(classifyInsider(null, false)).toBe('Officer');
    });
  });

  // ── 3.6 Cluster Detection Tests ───────────────────────────────────────────
  describe('detectCluster()', () => {
    const SUPA_URL = 'https://abc.supabase.co';
    const SUPA_KEY = 'service_role_key';

    test('no prior buys -> not a cluster, cluster_id null', async () => {
      const fetchFn = makeFetch([]);  // empty array = no prior buys
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      expect(result.isClusterBuy).toBe(false);
      expect(result.clusterId).toBeNull();
    });

    test('1 prior buy of same ticker by different insider -> cluster detected', async () => {
      // First call: SELECT returns 1 row with no cluster_id
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 'rec1', insider_name: 'Jony Ive', cluster_id: null, is_cluster_buy: false }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],  // PATCH response
        });
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      expect(result.isClusterBuy).toBe(true);
      expect(result.clusterId).toBeTruthy();
    });

    test('existing rows with cluster_id -> uses that cluster_id, not new UUID', async () => {
      const existingClusterId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: 'rec1', insider_name: 'Jony Ive', cluster_id: existingClusterId, is_cluster_buy: true },
          ],
        })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      expect(result.clusterId).toBe(existingClusterId);
    });

    test('cluster detection excludes current insider_name (no self-cluster)', async () => {
      const fetchFn = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain('neq.');
      expect(url).toContain('Tim');
    });

    test('cluster detection uses 7-day lookback window', async () => {
      const fetchFn = makeFetch([]);
      await detectCluster('AAPL', '2026-03-27', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      const [url] = fetchFn.mock.calls[0];
      expect(url).toContain('gte.');
    });

    test('cluster_size = prior matching insiders + 1', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: 'rec1', insider_name: 'Jony Ive', cluster_id: null },
            { id: 'rec2', insider_name: 'Phil Schiller', cluster_id: null },
          ],
        })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn,
      });
      expect(result.clusterSize).toBe(3); // 2 prior + 1 current
    });

    test('Supabase requests use service_role key in apikey header', async () => {
      const fetchFn = makeFetch([]);
      await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: 'MY_SERVICE_KEY', fetchFn,
      });
      const [, opts] = fetchFn.mock.calls[0];
      expect(opts.headers['apikey']).toBe('MY_SERVICE_KEY');
    });

    test('detects same-run cluster via sameRunFilings (Supabase empty)', async () => {
      // Supabase returns empty (filing A not written yet), but sameRunFilings has it
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => [] })    // SELECT -> empty
        .mockResolvedValueOnce({ ok: true, json: async () => [] });   // PATCH (no-op, rowsToUpdate=[])
      const filingA = { ticker: 'AAPL', insider_name: 'Jony Ive', transaction_date: '2026-03-25', cluster_id: null, is_cluster_buy: false };
      const sameRunFilings = [filingA];
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn, sameRunFilings,
      });
      expect(result.isClusterBuy).toBe(true);
      expect(result.clusterId).toBeTruthy();
    });

    test('retroactively updates sameRunFilings entries on cluster detection', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValue({ ok: true, json: async () => [] });
      const filingA = { ticker: 'AAPL', insider_name: 'Jony Ive', transaction_date: '2026-03-25', cluster_id: null, is_cluster_buy: false };
      const sameRunFilings = [filingA];
      const result = await detectCluster('AAPL', '2026-03-25', 'Tim Cook', {
        supabaseUrl: SUPA_URL, serviceKey: SUPA_KEY, fetchFn, sameRunFilings,
      });
      // filingA should be retroactively updated with the cluster_id
      expect(filingA.cluster_id).toBe(result.clusterId);
      expect(filingA.is_cluster_buy).toBe(true);
    });
  });
});
