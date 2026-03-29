'use strict';

// ---------------------------------------------------------------------------
// Mock ai-client BEFORE requiring score-alert
// ---------------------------------------------------------------------------
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createDeepSeekClient: jest.fn(),
}));

const { createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');

const {
  normalizeInsiderName,
  computeTrackRecord,
  buildHaikuPrompt,
  parseHaikuResponse,
  callHaiku,
  runScoreAlert,
  computeBaseScore,
  callDeepSeekForRefinement,
  detectSameDaySell,
} = require('../../n8n/code/insiderbuying/score-alert');

const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFetch(response, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
}

function makeFetchSeq(...calls) {
  const fn = jest.fn();
  calls.forEach(({ response, ok = true, status = 200 }) => {
    fn.mockResolvedValueOnce({ ok, status, json: async () => response });
  });
  return fn;
}

const noSleep = jest.fn().mockResolvedValue(undefined);

const NOCODB_BASE_URL = 'http://localhost:8080';
const NOCODB_TOKEN = 'test-token';
const NOCODB_PROJECT_ID = 'test-project-id';
const DEEPSEEK_KEY = 'test-deepseek';

function makeMockDeepSeekClient(content = null, throws = null) {
  const complete = throws
    ? jest.fn().mockRejectedValue(throws)
    : jest.fn().mockResolvedValue({
        content: content || '{"score": 8, "reasoning": "Large C-Suite purchase signals confidence."}',
        usage: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cached: false,
        estimatedCost: 0.0001,
      });
  return { complete };
}

function makeNocoDB(fetchFn) {
  return new NocoDB(NOCODB_BASE_URL, NOCODB_TOKEN, NOCODB_PROJECT_ID, fetchFn);
}

const SAMPLE_FILING = {
  ticker: 'AAPL',
  insider_name: 'Timothy D. Cook',
  insider_category: 'C-Suite',
  transaction_type: 'P - Purchase',
  transaction_shares: 10000,
  transaction_price_per_share: 150,
  total_value: 1500000,
  filing_date: '2024-01-15',
  transaction_date: '2024-01-12',
  is_cluster_buy: false,
  cluster_id: null,
  cluster_size: 1,
};

const HAIKU_JSON_RESPONSE = '{"score": 8, "reasoning": "Large C-Suite purchase signals confidence."}';

// ─── 3.1 normalizeInsiderName ───────────────────────────────────────────────────

describe('normalizeInsiderName', () => {
  test('strips middle initial and lowercases', () => {
    expect(normalizeInsiderName('John A. Smith')).toBe('john smith');
  });

  test('collapses John A. Smith and John Smith to same key', () => {
    expect(normalizeInsiderName('John A. Smith')).toBe(normalizeInsiderName('John Smith'));
  });

  test('strips multiple middle initials', () => {
    expect(normalizeInsiderName('Mary B. C. Jones')).toBe('mary jones');
  });

  test('handles suffixes Jr. and III', () => {
    // Suffixes stripped if they are short tokens at end
    const result = normalizeInsiderName('Robert E. Lee Jr.');
    expect(result).not.toContain('e.');
  });

  test('lowercases and trims', () => {
    expect(normalizeInsiderName('  JOHN SMITH  ')).toBe('john smith');
  });

  test('handles names without middle initial', () => {
    expect(normalizeInsiderName('Tim Cook')).toBe('tim cook');
  });
});

// ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────────

describe('computeTrackRecord', () => {
  test('returns zero-nulls when no NocoDB history', async () => {
    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
    const nocodb = makeNocoDB(fetchFn);
    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
  });

  test('returns past_buy_count matching NocoDB rows', async () => {
    const rows = [
      { Id: 1, ticker: 'AAPL', filing_date: '2023-06-01', total_value: 500000 },
      { Id: 2, ticker: 'AAPL', filing_date: '2023-09-01', total_value: 300000 },
    ];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
      // Yahoo calls fail gracefully
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const nocodb = makeNocoDB(fetchFn);

    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result.past_buy_count).toBe(2);
  });

  test('computes hit_rate: 2 of 3 buys gained >5% → 0.67', async () => {
    const rows = [
      { Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
      { Id: 2, ticker: 'AAPL', filing_date: '2023-04-01', total_value: 200000 },
      { Id: 3, ticker: 'AAPL', filing_date: '2023-07-01', total_value: 150000 },
    ];

    function makeYahoo(startPrice, endPrice) {
      const now = Date.now() / 1000;
      return {
        chart: {
          result: [{
            timestamp: [now, now + 86400 * 15, now + 86400 * 30],
            indicators: { quote: [{ close: [startPrice, null, endPrice] }] },
          }],
          error: null,
        },
      };
    }

    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 107) }) // +7% hit
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 103) }) // +3% miss
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 112) }); // +12% hit
    const nocodb = makeNocoDB(fetchFn);

    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result.past_buy_count).toBe(3);
    expect(result.hit_rate).toBeCloseTo(2 / 3, 2);
  });

  test('Yahoo Finance network error → returns null track record without throwing', async () => {
    const rows = [{ Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
      .mockRejectedValueOnce(new Error('network timeout'));
    const nocodb = makeNocoDB(fetchFn);

    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result).toEqual({ past_buy_count: 1, hit_rate: null, avg_gain_30d: null });
  });

  test('Yahoo Finance 429 → returns null without throwing', async () => {
    const rows = [{ Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    const nocodb = makeNocoDB(fetchFn);

    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result.hit_rate).toBeNull();
    expect(result.avg_gain_30d).toBeNull();
  });

  test('NocoDB failure → returns zero-nulls without throwing', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('connection refused'));
    const nocodb = makeNocoDB(fetchFn);
    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
  });

  test('NocoDB where clause uses lowercase name with ilike operator', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
    });
    const nocodb = makeNocoDB(fetchFn);
    await computeTrackRecord('John Smith', nocodb, { fetchFn });
    const url = fetchFn.mock.calls[0][0];
    const decoded = decodeURIComponent(url);
    // NocoDB where clause uses (field,ilike,%value%) syntax for case-insensitive matching
    expect(decoded).toContain('insider_name');
    expect(decoded).toContain('ilike');
    expect(decoded).toContain('john');
    expect(decoded).toContain('smith');
  });

  test('one Yahoo failure does not abort remaining filings in loop', async () => {
    const rows = [
      { Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
      { Id: 2, ticker: 'MSFT', filing_date: '2023-04-01', total_value: 200000 },
    ];

    function makeYahoo(startPrice, endPrice) {
      const now = Date.now() / 1000;
      return {
        chart: {
          result: [{
            timestamp: [now, now + 86400 * 30],
            indicators: { quote: [{ close: [startPrice, endPrice] }] },
          }],
          error: null,
        },
      };
    }

    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) }) // NocoDB
      .mockRejectedValueOnce(new Error('AAPL Yahoo timeout'))           // AAPL Yahoo fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 115) }); // MSFT succeeds
    const nocodb = makeNocoDB(fetchFn);

    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
    // past_buy_count=2, but only 1 valid return (MSFT +15%)
    expect(result.past_buy_count).toBe(2);
    expect(result.hit_rate).toBeCloseTo(1.0); // 1/1 valid return
    expect(result.avg_gain_30d).toBeCloseTo(0.15);
  });
});

// ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────────

describe('buildHaikuPrompt', () => {
  const trackRecord = { past_buy_count: 3, hit_rate: 0.67, avg_gain_30d: 0.12 };

  test('includes ticker in prompt', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('AAPL');
  });

  test('includes insider_category in prompt', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('C-Suite');
  });

  test('includes transaction_type in prompt', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('P - Purchase');
  });

  test('includes total_value in prompt', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('1500000');
  });

  test('includes is_cluster_buy in prompt', () => {
    const clusterFiling = { ...SAMPLE_FILING, is_cluster_buy: true, cluster_size: 3 };
    const p = buildHaikuPrompt(clusterFiling, trackRecord);
    expect(p.toLowerCase()).toContain('cluster');
  });

  test('includes track record fields in prompt', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('0.67');
    expect(p).toContain('0.12');
  });

  test('handles null track record fields gracefully', () => {
    const nullTrack = { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
    const p = buildHaikuPrompt(SAMPLE_FILING, nullTrack);
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(100);
  });

  test('requests JSON output with score and reasoning fields', () => {
    const p = buildHaikuPrompt(SAMPLE_FILING, trackRecord);
    expect(p).toContain('score');
    expect(p).toContain('reasoning');
  });
});

// ─── 3.2 parseHaikuResponse ─────────────────────────────────────────────────────

describe('parseHaikuResponse', () => {
  test('parses clean JSON response', () => {
    const result = parseHaikuResponse('{"score": 7, "reasoning": "Strong C-Suite signal."}');
    expect(result).toEqual({ score: 7, reasoning: 'Strong C-Suite signal.' });
  });

  test('parses markdown-fenced JSON', () => {
    const raw = '```json\n{"score": 8, "reasoning": "Cluster buy detected."}\n```';
    const result = parseHaikuResponse(raw);
    expect(result.score).toBe(8);
    expect(result.reasoning).toContain('Cluster');
  });

  test('handles smart quotes in JSON string', () => {
    const raw = '{\u201cscore\u201d: 6, \u201creasoning\u201d: \u201cModerate signal.\u201d}';
    const result = parseHaikuResponse(raw);
    expect(result.score).toBe(6);
  });

  test('throws if score field is missing', () => {
    expect(() => parseHaikuResponse('{"reasoning": "no score here"}')).toThrow();
  });

  test('throws if reasoning is empty string', () => {
    expect(() => parseHaikuResponse('{"score": 5, "reasoning": ""}')).toThrow();
  });

  test('throws on completely invalid JSON', () => {
    expect(() => parseHaikuResponse('not json at all')).toThrow();
  });
});

// ─── 3.2 score clamping / rounding ──────────────────────────────────────────────

describe('score clamping and rounding', () => {
  test('score 11 is clamped to 10', () => {
    const result = parseHaikuResponse('{"score": 11, "reasoning": "Very high."}');
    expect(result.score).toBe(10);
  });

  test('score 0 is clamped to 1', () => {
    const result = parseHaikuResponse('{"score": 0, "reasoning": "Very low."}');
    expect(result.score).toBe(1);
  });

  test('float 7.5 rounds to 8', () => {
    const result = parseHaikuResponse('{"score": 7.5, "reasoning": "Mid-range."}');
    expect(result.score).toBe(8);
  });

  test('float 7.4 rounds to 7', () => {
    const result = parseHaikuResponse('{"score": 7.4, "reasoning": "Mid-range."}');
    expect(result.score).toBe(7);
  });
});

// ─── source code checks ─────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const srcPath = path.resolve(__dirname, '../../n8n/code/insiderbuying/score-alert.js');
const src = fs.readFileSync(srcPath, 'utf8');

describe('source code checks', () => {
  test('no anthropic.com URL in source', () => {
    expect(src).not.toContain('anthropic.com');
  });

  test('no claude-haiku model string in source', () => {
    expect(src).not.toContain('claude-haiku');
  });

  test('no x-api-key header in source', () => {
    expect(src).not.toContain('x-api-key');
  });

  test('imports createDeepSeekClient from ai-client', () => {
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createDeepSeekClient');
  });
});

// ─── 3.2 callHaiku ──────────────────────────────────────────────────────────────

describe('callHaiku', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls deepseekClient.complete with prompt and returns parsed score', async () => {
    const client = makeMockDeepSeekClient('{"score": 8, "reasoning": "Large C-Suite purchase."}');
    const result = await callHaiku('test prompt', client);
    expect(client.complete).toHaveBeenCalledWith(null, 'test prompt', { temperature: 0.3 });
    expect(result.score).toBe(8);
    expect(result.reasoning).toContain('C-Suite');
  });

  test('handles markdown-fenced JSON from DeepSeek', async () => {
    const fenced = '```json\n{"score": 7, "reasoning": "Solid signal."}\n```';
    const client = makeMockDeepSeekClient(fenced);
    const result = await callHaiku('prompt', client);
    expect(result.score).toBe(7);
    expect(result.reasoning).toContain('Solid');
  });

  test('returns HAIKU_DEFAULT on client error', async () => {
    const client = makeMockDeepSeekClient(null, new Error('API failure'));
    const result = await callHaiku('prompt', client);
    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
  });

  test('returns HAIKU_DEFAULT on network error', async () => {
    const client = makeMockDeepSeekClient(null, new Error('ECONNRESET'));
    const result = await callHaiku('prompt', client);
    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
  });

  test('returns HAIKU_DEFAULT on invalid JSON response', async () => {
    const client = makeMockDeepSeekClient('not valid json at all');
    const result = await callHaiku('prompt', client);
    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
  });

  test('complete() called exactly once per callHaiku() call (no internal retry loop)', async () => {
    const client = makeMockDeepSeekClient('{"score": 6, "reasoning": "Test."}');
    await callHaiku('prompt', client);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });
});

// ─── 3.3 runScoreAlert integration ──────────────────────────────────────────────

describe('runScoreAlert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRunHelpers(completeContent = '{"score": 7, "reasoning": "Good signal."}') {
    const nocodbFn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
    });
    const nocodb = makeNocoDB(nocodbFn);
    const mockClient = makeMockDeepSeekClient(completeContent);
    createDeepSeekClient.mockReturnValue(mockClient);
    return { nocodb, nocodbFn, mockClient };
  }

  test('calls createDeepSeekClient with fetchFn and deepseekApiKey', async () => {
    const { nocodb } = makeRunHelpers();
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
    await runScoreAlert([SAMPLE_FILING], { nocodb, fetchFn, deepseekApiKey: DEEPSEEK_KEY });
    expect(createDeepSeekClient).toHaveBeenCalledWith(fetchFn, DEEPSEEK_KEY);
  });

  test('returns scored filing with significance_score, score_reasoning, track_record', async () => {
    const { nocodb } = makeRunHelpers();
    const result = await runScoreAlert([SAMPLE_FILING], {
      nocodb,
      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
      deepseekApiKey: DEEPSEEK_KEY,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ticker: 'AAPL',
      significance_score: expect.any(Number),
      score_reasoning: expect.any(String),
      track_record: expect.objectContaining({ past_buy_count: expect.any(Number) }),
    });
  });

  test('processes multiple filings sequentially', async () => {
    const filing2 = { ...SAMPLE_FILING, ticker: 'MSFT', insider_name: 'Satya Nadella' };
    const { nocodb } = makeRunHelpers('{"score": 6, "reasoning": "Moderate."}');
    const results = await runScoreAlert([SAMPLE_FILING, filing2], {
      nocodb,
      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
      deepseekApiKey: DEEPSEEK_KEY,
    });
    expect(results).toHaveLength(2);
    expect(results[0].ticker).toBe('AAPL');
    expect(results[1].ticker).toBe('MSFT');
  });

  test('preserves all original filing fields in output', async () => {
    const { nocodb } = makeRunHelpers('{"score": 5, "reasoning": "Test."}');
    const results = await runScoreAlert([SAMPLE_FILING], {
      nocodb,
      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
      deepseekApiKey: DEEPSEEK_KEY,
    });
    expect(results[0].is_cluster_buy).toBe(false);
    expect(results[0].cluster_id).toBeNull();
    expect(results[0].transaction_type).toBe('P - Purchase');
  });

  test('handles empty filings array', async () => {
    const results = await runScoreAlert([], {
      nocodb: makeNocoDB(jest.fn()),
      fetchFn: jest.fn(),
      deepseekApiKey: DEEPSEEK_KEY,
    });
    expect(results).toEqual([]);
  });
});

// ─── computeBaseScore ────────────────────────────────────────────────────────

describe('computeBaseScore', () => {
  // Neutral base: unknown role (+0.5), null market cap (skip), no cluster, no track record
  const NEUTRAL = {
    transactionCode: 'P',
    canonicalRole: 'Unknown',
    marketCapUsd: null,
    clusterCount7Days: null,
    clusterCount14Days: null,
    historicalAvgReturn: null,
    historicalCount: null,
  };

  // ─ Early exit ─
  test('returns 0 for gift (G) transaction code', () => {
    expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'G' })).toBe(0);
  });

  test('returns 0 for tax withholding (F) transaction code', () => {
    expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'F' })).toBe(0);
  });

  test('sale (S) is not excluded — scores normally', () => {
    const score = computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'S' });
    expect(score).toBeGreaterThan(0);
  });

  // ─ Factor 1: Transaction Value ─
  describe('Factor 1 — Transaction Value', () => {
    test('>= $10M → adjustment +3.0 (base 5.0 + 3.0 + 0.5 unknown = 8.5)', () => {
      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 10_000_000 })).toBe(8.5);
    });

    test('$5M → adjustment +2.4 (5.0 + 2.4 + 0.5 = 7.9)', () => {
      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000 })).toBe(7.9);
    });

    test('$100K → adjustment +0.6 (5.0 + 0.6 + 0.5 = 6.1)', () => {
      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 100_000 })).toBe(6.1);
    });

    test('$50K (below threshold) → adjustment -1.0 (5.0 - 1.0 + 0.5 = 4.5)', () => {
      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 50_000 })).toBe(4.5);
    });
  });

  // ─ Factor 2: Insider Role ─
  // Isolate with $100K (+0.6), null market cap
  describe('Factor 2 — Insider Role', () => {
    const f1 = { ...NEUTRAL, transactionValue: 100_000 }; // 5.0 + 0.6 = 5.6 before F2

    test('CEO → adjustment +2.5 (5.6 + 2.5 = 8.1)', () => {
      expect(computeBaseScore({ ...f1, canonicalRole: 'CEO' })).toBe(8.1);
    });

    test('Director → adjustment +1.0 (5.6 + 1.0 = 6.6)', () => {
      expect(computeBaseScore({ ...f1, canonicalRole: 'Director' })).toBe(6.6);
    });

    test('unknown title → adjustment +0.5 default (5.6 + 0.5 = 6.1)', () => {
      expect(computeBaseScore({ ...f1, canonicalRole: 'VP of Snacks' })).toBe(6.1);
    });
  });

  // ─ Factor 3: Market Cap ─
  // Isolate with $100K (+0.6), Director (+1.0) → 5.0+0.6+1.0 = 6.6 before F3
  describe('Factor 3 — Market Cap', () => {
    const f1f2 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };

    test('small-cap $500M → adjustment +1.5 (6.6 + 1.5 = 8.1)', () => {
      expect(computeBaseScore({ ...f1f2, marketCapUsd: 500_000_000 })).toBe(8.1);
    });

    test('mega-cap $100B → adjustment +0.6 (6.6 + 0.6 = 7.2)', () => {
      expect(computeBaseScore({ ...f1f2, marketCapUsd: 100_000_000_000 })).toBe(7.2);
    });

    test('null marketCapUsd → factor skipped, no throw, no adjustment', () => {
      expect(() => computeBaseScore({ ...f1f2, marketCapUsd: null })).not.toThrow();
      expect(computeBaseScore({ ...f1f2, marketCapUsd: null })).toBe(6.6);
    });

    test('null marketCapUsd → emits console.warn', () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      computeBaseScore({ ...f1f2, marketCapUsd: null });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('marketCapUsd null'));
      spy.mockRestore();
    });
  });

  // ─ Factor 4: Cluster Signal ─
  // Isolate with $100K (+0.6), Director (+1.0), null market cap → base 6.6
  describe('Factor 4 — Cluster Signal', () => {
    const f1f2f3 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };

    test('clusterCount7Days >= 3 → adjustment +0.5 (6.6 + 0.5 = 7.1)', () => {
      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: 3 })).toBe(7.1);
    });

    test('clusterCount7Days = 2 → adjustment +0.3 (6.6 + 0.3 = 6.9)', () => {
      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: 2 })).toBe(6.9);
    });

    test('null 7-day, clusterCount14Days >= 3 → adjustment +0.2 (6.6 + 0.2 = 6.8)', () => {
      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: null, clusterCount14Days: 3 })).toBe(6.8);
    });

    test('both cluster counts null → no adjustment (6.6)', () => {
      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: null, clusterCount14Days: null })).toBe(6.6);
    });
  });

  // ─ Factor 5: Track Record ─
  // Isolate with $100K (+0.6), Director (+1.0), null market cap, no cluster → base 6.6
  describe('Factor 5 — Track Record', () => {
    const f1f2f3f4 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };

    test('avgReturn=25, count=4 → adjustment +0.5 (6.6 + 0.5 = 7.1)', () => {
      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 25, historicalCount: 4 })).toBe(7.1);
    });

    test('avgReturn=15, count=2 → adjustment +0.3 (6.6 + 0.3 = 6.9)', () => {
      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 15, historicalCount: 2 })).toBe(6.9);
    });

    test('avgReturn=15, count=1 → 0 bonus (below 2-trade minimum, stays at 6.6)', () => {
      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 15, historicalCount: 1 })).toBe(6.6);
    });

    test('null historicalAvgReturn → factor skipped, no throw (6.6)', () => {
      expect(() => computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: null })).not.toThrow();
      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: null })).toBe(6.6);
    });
  });

  // ─ Clamping and output format ─
  describe('Clamping and output format', () => {
    test('score exceeding 10 is clamped to 10', () => {
      // CEO+$10M+micro-cap+cluster3 = 5+3+2.5+1.5+0.5 = 12.5 → 10
      expect(computeBaseScore({
        transactionCode: 'P', transactionValue: 10_000_000, canonicalRole: 'CEO',
        marketCapUsd: 200_000_000, clusterCount7Days: 3,
        clusterCount14Days: null, historicalAvgReturn: null, historicalCount: null,
      })).toBe(10);
    });

    test('output has at most one decimal place', () => {
      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 500_000, canonicalRole: 'Director', marketCapUsd: null });
      expect(score.toString()).toMatch(/^\d+(\.\d)?$/);
    });

    test('output is always a number (never NaN, never null)', () => {
      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 100_000 });
      expect(typeof score).toBe('number');
      expect(isNaN(score)).toBe(false);
    });
  });

  // ─ Fixture filings ─
  describe('Fixture filings', () => {
    test('Fixture 1: CEO, $5M purchase, mid-cap, no cluster → >= 8', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
        marketCapUsd: 5_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(8);
    });

    test('Fixture 2: Director, $100K purchase, small-cap, no cluster → >= 5', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 100_000, canonicalRole: 'Director',
        marketCapUsd: 500_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(5);
    });

    test('Fixture 3: CFO, $1M purchase, large-cap, cluster 3 in 7 days → >= 7', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 1_000_000, canonicalRole: 'CFO',
        marketCapUsd: 50_000_000_000, clusterCount7Days: 3, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(7);
    });

    test('Fixture 4: CEO, $3M sale, small-cap → >= 7 (sells score same as buys)', () => {
      const score = computeBaseScore({
        transactionCode: 'S', transactionValue: 3_000_000, canonicalRole: 'CEO',
        marketCapUsd: 500_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(7);
    });

    test('Fixture 5: President, $500K, micro-cap, track record 25% over 3 trades → >= 8', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 500_000, canonicalRole: 'President',
        marketCapUsd: 100_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: 25, historicalCount: 3,
      });
      expect(score).toBeGreaterThanOrEqual(8);
    });

    test('Fixture 6: Unknown role, $100K, mega-cap → between 4 and 7', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 100_000, canonicalRole: 'Unknown Title',
        marketCapUsd: 500_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(4);
      expect(score).toBeLessThanOrEqual(7);
    });

    test('Fixture 7: CEO, $10M, micro-cap, cluster 3+ → 10 (capped at max)', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 10_000_000, canonicalRole: 'CEO',
        marketCapUsd: 100_000_000, clusterCount7Days: 3, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBe(10);
    });

    test('Fixture 8: Director, $50K, large-cap → small score (penalty dominates) <= 6', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 50_000, canonicalRole: 'Director',
        marketCapUsd: 50_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeLessThanOrEqual(6);
    });

    test('Fixture 9: CEO, $5M, all enriched null fields — does not throw', () => {
      expect(() => computeBaseScore({
        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      })).not.toThrow();
    });

    test('Fixture 9: CEO, $5M, null fields → lower than Fixture 1 (no market cap bonus)', () => {
      const withCap = computeBaseScore({
        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
        marketCapUsd: 5_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      const withoutCap = computeBaseScore({
        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(withoutCap).toBeLessThanOrEqual(withCap);
    });

    test('Fixture 10: all minimum values → between 1 and 5', () => {
      const score = computeBaseScore({
        transactionCode: 'P', transactionValue: 1_000, canonicalRole: 'Unknown Role',
        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
        historicalAvgReturn: null, historicalCount: null,
      });
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(5);
    });
  });

  // ─ Edge cases (guard fixes) ─
  describe('Edge cases', () => {
    test('null filing returns 1 without throwing', () => {
      expect(() => computeBaseScore(null)).not.toThrow();
      expect(computeBaseScore(null)).toBe(1);
    });

    test('undefined filing returns 1 without throwing', () => {
      expect(() => computeBaseScore(undefined)).not.toThrow();
      expect(computeBaseScore(undefined)).toBe(1);
    });

    test('negative transactionValue — Factor 1 skipped (no bonus, no penalty)', () => {
      // negative value = bad data, not a real purchase. Should not penalize.
      const score = computeBaseScore({ ...NEUTRAL, transactionValue: -500_000 });
      // Base 5.0 + unknown role 0.5 + null cap skipped = 5.5
      expect(score).toBe(5.5);
    });

    test('zero transactionValue — Factor 1 skipped (no bonus, no penalty)', () => {
      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 0 });
      expect(score).toBe(5.5);
    });
  });
});

// ─── callDeepSeekForRefinement ───────────────────────────────────────────────

describe('callDeepSeekForRefinement', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => sleep.mockClear());

  function makeClient(responses) {
    let i = 0;
    return {
      complete: jest.fn().mockImplementation(() => {
        const r = responses[i++];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve({ content: r });
      }),
    };
  }

  const BASE_FILING = {
    direction: 'A', is10b5Plan: false,
    ticker: 'NVDA', insider_name: 'Jensen Huang',
    transactionValue: 5_000_000,
  };

  // ─ Response parsing ─
  describe('response parsing', () => {
    test('adjustment +1 — applied correctly', async () => {
      const client = makeClient(['{"adjustment": 1, "reason": "first buy in years"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 7.0, { client, sleep });
      expect(result.ai_adjustment).toBe(1);
      expect(result.final_score).toBe(8.0);
      expect(result.base_score).toBe(7.0);
    });

    test('adjustment 0 — score unchanged', async () => {
      const client = makeClient(['{"adjustment": 0, "reason": "routine cluster trade"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 6.5, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
      expect(result.final_score).toBe(6.5);
    });

    test('adjustment -1 — applied correctly', async () => {
      const client = makeClient(['{"adjustment": -1, "reason": "heavy selling context"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(-1);
      expect(result.final_score).toBe(4.0);
    });

    test('JSON wrapped in markdown fences — stripped and parsed', async () => {
      const client = makeClient(['```json\n{"adjustment": 0, "reason": "ok"}\n```']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
    });

    test('out-of-range adjustment +2 — clamped to +1', async () => {
      const client = makeClient(['{"adjustment": 2, "reason": "very high"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(1);
      expect(result.final_score).toBe(6.0);
    });

    test('out-of-range adjustment -2 — clamped to -1', async () => {
      const client = makeClient(['{"adjustment": -2, "reason": "very low"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(-1);
      expect(result.final_score).toBe(4.0);
    });
  });

  // ─ Retry and fallback ─
  describe('retry and fallback', () => {
    test('invalid JSON on first call, valid on second — uses second result', async () => {
      const client = makeClient(['not-json', '{"adjustment": 1, "reason": "retry worked"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(1);
      expect(client.complete).toHaveBeenCalledTimes(2);
    });

    test('empty string on first call, valid on second — triggers retry', async () => {
      const client = makeClient(['', '{"adjustment": 0, "reason": "ok"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
      expect(client.complete).toHaveBeenCalledTimes(2);
    });

    test('both calls return invalid JSON — fallback (adjustment=0)', async () => {
      const client = makeClient(['bad', 'also-bad']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
      expect(result.final_score).toBe(5.0);
      expect(result.ai_reason).toMatch(/failed/i);
    });

    test('network error on first call, valid on second — recovers', async () => {
      const client = makeClient([new Error('network'), '{"adjustment": 1, "reason": "ok"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(1);
    });

    test('network error on both calls — fallback (adjustment=0)', async () => {
      const client = makeClient([new Error('network'), new Error('network again')]);
      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
      expect(result.final_score).toBe(5.0);
    });
  });

  // ─ 10b5-1 plan cap ─
  describe('10b5-1 plan handling', () => {
    test('is10b5Plan=true — DeepSeek never called', async () => {
      const client = makeClient([]);
      const filing = { ...BASE_FILING, is10b5Plan: true };
      await callDeepSeekForRefinement(filing, 7.0, { client, sleep });
      expect(client.complete).not.toHaveBeenCalled();
    });

    test('is10b5Plan=true, base_score=4 — untouched (under cap)', async () => {
      const client = makeClient([]);
      const filing = { ...BASE_FILING, is10b5Plan: true };
      const result = await callDeepSeekForRefinement(filing, 4.0, { client, sleep });
      expect(result.final_score).toBe(4.0);
    });

    test('is10b5Plan=true, base_score=5 — exactly at cap (untouched)', async () => {
      const filing = { ...BASE_FILING, is10b5Plan: true };
      const result = await callDeepSeekForRefinement(filing, 5.0, { client: makeClient([]), sleep });
      expect(result.final_score).toBe(5.0);
    });

    test('is10b5Plan=true, base_score=7 — capped to 5', async () => {
      const filing = { ...BASE_FILING, is10b5Plan: true };
      const result = await callDeepSeekForRefinement(filing, 7.0, { client: makeClient([]), sleep });
      expect(result.final_score).toBe(5.0);
      expect(result.ai_adjustment).toBe(0);
    });

    test('is10b5Plan=false, +1 at score 10 — clamped to 10', async () => {
      const client = makeClient(['{"adjustment": 1, "reason": "high"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 10.0, { client, sleep });
      expect(result.final_score).toBe(10);
    });
  });

  // ─ Output shape ─
  describe('output shape', () => {
    test('result always has base_score, ai_adjustment, ai_reason, final_score', async () => {
      const client = makeClient(['{"adjustment": 0, "reason": "ok"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
      expect(result).toHaveProperty('base_score');
      expect(result).toHaveProperty('ai_adjustment');
      expect(result).toHaveProperty('ai_reason');
      expect(result).toHaveProperty('final_score');
    });

    test('on success, ai_reason contains DeepSeek reason string', async () => {
      const client = makeClient(['{"adjustment": 1, "reason": "first buy in years"}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
      expect(result.ai_reason).toBe('first buy in years');
    });

    test('on fallback, ai_adjustment=0 and ai_reason is a non-empty explanation', async () => {
      const client = makeClient(['bad', 'also-bad']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
      expect(result.ai_adjustment).toBe(0);
      expect(result.ai_reason.length).toBeGreaterThan(0);
    });

    test('whitespace-only reason field — ai_reason substituted with default', async () => {
      const client = makeClient(['{"adjustment": 0, "reason": "   "}']);
      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
      expect(result.ai_reason).toBe('No reason provided');
    });
  });
});

// ─── detectSameDaySell ───────────────────────────────────────────────────────

describe('detectSameDaySell', () => {
  function makeNocoSell(sharesSold) {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        list: [{ transactionCode: 'S', transactionShares: sharesSold, insiderCik: 'cik001', transactionDate: '2024-01-15' }],
        pageInfo: { isLastPage: true },
      }),
    });
    return makeNocoDB(fn);
  }
  function makeNocoEmpty() {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
    });
    return makeNocoDB(fn);
  }

  const EXERCISE_FILING = {
    transactionCode: 'M', insiderCik: 'cik001',
    transactionDate: '2024-01-15', sharesExercised: 1000,
  };

  test('full exercise-and-sell (>=80% sold) returns 0', async () => {
    const nocodb = makeNocoSell(900); // 900 >= 800 = 80% of 1000
    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
    expect(result).toBe(0);
  });

  test('partial sell (30% sold) returns undefined (normal score)', async () => {
    const nocodb = makeNocoSell(300); // 300 < 800 = 80% of 1000
    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
    expect(result).toBeUndefined();
  });

  test('no same-day sell found returns undefined', async () => {
    const nocodb = makeNocoEmpty();
    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
    expect(result).toBeUndefined();
  });

  test('different insiderCik — no match returns undefined', async () => {
    const nocodb = makeNocoEmpty();
    const filing = { ...EXERCISE_FILING, insiderCik: 'differentCik' };
    const result = await detectSameDaySell(filing, { nocodb });
    expect(result).toBeUndefined();
  });

  test('NocoDB throws network error — logs WARN and returns undefined', async () => {
    const nocodb = { list: jest.fn().mockRejectedValue(new Error('network')) };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('missing nocodb dep — returns undefined without throwing', async () => {
    const result = await detectSameDaySell(EXERCISE_FILING, {});
    expect(result).toBeUndefined();
  });

  test('different transactionDate — no match returns undefined', async () => {
    const nocodb = makeNocoEmpty();
    const filing = { ...EXERCISE_FILING, transactionDate: '2024-02-01' };
    const result = await detectSameDaySell(filing, { nocodb });
    expect(result).toBeUndefined();
  });
});

// ─── runScoreAlert filtering chain (S03) ────────────────────────────────────

describe('runScoreAlert filtering chain', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeHelpers(adjustmentJson = '{"adjustment": 0, "reason": "ok"}') {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
    });
    const mockClient = {
      complete: jest.fn().mockResolvedValue({ content: adjustmentJson }),
    };
    createDeepSeekClient.mockReturnValue(mockClient);
    return { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
  }

  const SCORED_FILING = {
    ...SAMPLE_FILING,
    transactionCode: 'P', canonicalRole: 'CEO', marketCapUsd: 5_000_000_000,
    transactionValue: 1_000_000, insiderCik: 'cik001', direction: 'A',
    is10b5Plan: false,
  };

  test('G transaction — excluded from results (skipped)', async () => {
    const helpers = makeHelpers();
    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'G' }], helpers);
    expect(results).toHaveLength(0);
  });

  test('F transaction — excluded from results (skipped)', async () => {
    const helpers = makeHelpers();
    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'F' }], helpers);
    expect(results).toHaveLength(0);
  });

  test('S transaction (sale) — proceeds to scoring', async () => {
    const helpers = makeHelpers();
    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'S', direction: 'D' }], helpers);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('significance_score');
  });

  test('P transaction (purchase) — proceeds to scoring', async () => {
    const helpers = makeHelpers();
    const results = await runScoreAlert([SCORED_FILING], helpers);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('significance_score');
  });

  test('M transaction with full sell — excluded from results', async () => {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        list: [{ transactionCode: 'S', transactionShares: 900, insiderCik: 'cik001', transactionDate: '2024-01-12' }],
        pageInfo: { isLastPage: true },
      }),
    });
    createDeepSeekClient.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
    });
    const filing = { ...SCORED_FILING, transactionCode: 'M', sharesExercised: 1000, transactionDate: '2024-01-12' };
    const results = await runScoreAlert([filing], { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY });
    expect(results).toHaveLength(0);
  });

  test('scored result has base_score, ai_adjustment, final_score fields', async () => {
    const helpers = makeHelpers('{"adjustment": 1, "reason": "strong signal"}');
    const results = await runScoreAlert([SCORED_FILING], helpers);
    expect(results[0]).toHaveProperty('base_score');
    expect(results[0]).toHaveProperty('ai_adjustment');
    expect(results[0]).toHaveProperty('significance_score');
  });
});

// ─── structured score logging (S03) ─────────────────────────────────────────

describe('structured score logging', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeHelpers() {
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
    });
    createDeepSeekClient.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
    });
    return { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
  }

  const SCORED_FILING = {
    ...SAMPLE_FILING,
    transactionCode: 'P', canonicalRole: 'CEO', marketCapUsd: 5_000_000_000,
    transactionValue: 1_000_000, insiderCik: 'cik001', direction: 'A', is10b5Plan: false,
  };

  test('scored alert emits structured log with required fields', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const helpers = makeHelpers();
    await runScoreAlert([SCORED_FILING], helpers);
    // Find a JSON log with finalScore
    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
      try { const o = JSON.parse(s); return 'finalScore' in o; } catch { return false; }
    });
    expect(jsonCalls.length).toBeGreaterThan(0);
    const log = JSON.parse(jsonCalls[0]);
    expect(log).toHaveProperty('ticker');
    expect(log).toHaveProperty('transactionCode');
    expect(log).toHaveProperty('finalScore');
    expect(log).toHaveProperty('timestamp');
    logSpy.mockRestore();
  });

  test('skipped alert (G) emits log with skipReason', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const helpers = makeHelpers();
    await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'G' }], helpers);
    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
      try { const o = JSON.parse(s); return 'skipReason' in o; } catch { return false; }
    });
    expect(jsonCalls.length).toBeGreaterThan(0);
    const log = JSON.parse(jsonCalls[0]);
    expect(log.skipReason).toMatch(/gift/i);
    logSpy.mockRestore();
  });

  test('exercise-and-sell alert emits log with overrideReason and finalScore=0', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const fn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        list: [{ transactionCode: 'S', transactionShares: 900, insiderCik: 'cik001', transactionDate: '2024-01-15' }],
        pageInfo: { isLastPage: true },
      }),
    });
    createDeepSeekClient.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
    });
    const helpers = { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
    await runScoreAlert([{
      ...SCORED_FILING, transactionCode: 'M', sharesExercised: 1000,
      insiderCik: 'cik001', transactionDate: '2024-01-15',
    }], helpers);
    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
      try { const o = JSON.parse(s); return 'overrideReason' in o; } catch { return false; }
    });
    expect(jsonCalls.length).toBeGreaterThan(0);
    const log = JSON.parse(jsonCalls[0]);
    expect(log.overrideReason).toBe('exercise-and-sell');
    expect(log.finalScore).toBe(0);
    logSpy.mockRestore();
  });
});
