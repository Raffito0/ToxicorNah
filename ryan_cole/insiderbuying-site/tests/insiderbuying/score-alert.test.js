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
