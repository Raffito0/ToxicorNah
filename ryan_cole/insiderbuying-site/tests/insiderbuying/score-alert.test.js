'use strict';

const {
  normalizeInsiderName,
  computeTrackRecord,
  buildHaikuPrompt,
  parseHaikuResponse,
  callHaiku,
  runScoreAlert,
} = require('../../n8n/code/insiderbuying/score-alert');

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

const SUPABASE_URL = 'https://test.supabase.co';
const SUPABASE_KEY = 'test-key';
const ANTHROPIC_KEY = 'test-anthropic';

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

// ─── 3.1 normalizeInsiderName ───────────────────────────────────────────────

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

// ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────

describe('computeTrackRecord', () => {
  test('returns zero-nulls when no Supabase history', async () => {
    const fetchFn = makeFetch([]);
    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
  });

  test('returns past_buy_count matching Supabase rows', async () => {
    const rows = [
      { ticker: 'AAPL', filing_date: '2023-06-01', total_value: 500000 },
      { ticker: 'AAPL', filing_date: '2023-09-01', total_value: 300000 },
    ];
    // Supabase returns rows; Yahoo returns no useful data (empty) → skip price step
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
      // Yahoo calls fail gracefully
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result.past_buy_count).toBe(2);
  });

  test('computes hit_rate: 2 of 3 buys gained >5% → 0.67', async () => {
    const rows = [
      { ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
      { ticker: 'AAPL', filing_date: '2023-04-01', total_value: 200000 },
      { ticker: 'AAPL', filing_date: '2023-07-01', total_value: 150000 },
    ];

    // Build Yahoo response factory: price at filing_date=100, price at +30d varies
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 107) }) // +7% hit
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 103) }) // +3% miss
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 112) }); // +12% hit

    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result.past_buy_count).toBe(3);
    expect(result.hit_rate).toBeCloseTo(2 / 3, 2);
  });

  test('Yahoo Finance network error → returns null track record without throwing', async () => {
    const rows = [{ ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
      .mockRejectedValueOnce(new Error('network timeout'));

    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result).toEqual({ past_buy_count: 1, hit_rate: null, avg_gain_30d: null });
  });

  test('Yahoo Finance 429 → returns null without throwing', async () => {
    const rows = [{ ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });

    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result.hit_rate).toBeNull();
    expect(result.avg_gain_30d).toBeNull();
  });

  test('Supabase failure → returns zero-nulls without throwing', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('connection refused'));
    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
  });

  test('Supabase URL uses % wildcards for ilike (not * globs)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    const url = fetchFn.mock.calls[0][0];
    // URLSearchParams encodes % as %25, so %john%smith% appears as %25john%25smith%25 in the URL
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('%john%smith%');
    expect(url).not.toContain('*john*');
  });

  test('one Yahoo failure does not abort remaining filings in loop', async () => {
    const rows = [
      { ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
      { ticker: 'MSFT', filing_date: '2023-04-01', total_value: 200000 },
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows }) // Supabase
      .mockRejectedValueOnce(new Error('AAPL Yahoo timeout'))           // AAPL Yahoo fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 115) }); // MSFT succeeds

    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
    // past_buy_count=2, but only 1 valid return (MSFT +15%)
    expect(result.past_buy_count).toBe(2);
    expect(result.hit_rate).toBeCloseTo(1.0); // 1/1 valid return
    expect(result.avg_gain_30d).toBeCloseTo(0.15);
  });
});

// ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────

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

// ─── 3.2 parseHaikuResponse ─────────────────────────────────────────────────

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

// ─── 3.2 score clamping / rounding ──────────────────────────────────────────

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

// ─── 3.2 callHaiku ──────────────────────────────────────────────────────────

describe('callHaiku', () => {
  test('calls Anthropic messages endpoint with correct model', async () => {
    const fetchFn = makeFetch({
      content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }],
    });
    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toContain('anthropic.com');
    expect(JSON.parse(opts.body).model).toContain('haiku');
  });

  test('returns parsed score and reasoning on success', async () => {
    const fetchFn = makeFetch({
      content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }],
    });
    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
    expect(result.score).toBe(8);
    expect(result.reasoning).toContain('C-Suite');
  });

  test('retries on 429 and succeeds on 2nd attempt', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }] }),
      });
    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
    expect(result.score).toBe(8);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('defaults to score=5 after 2 retries exhausted', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('defaults to score=5 on network error after retries', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
  });
});

// ─── 3.3 runScoreAlert integration ──────────────────────────────────────────

describe('runScoreAlert', () => {
  test('returns scored filing with significance_score, score_reasoning, track_record', async () => {
    const supabaseFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const haikuResponse = {
      content: [{ type: 'text', text: '{"score": 7, "reasoning": "Good signal."}' }],
    };
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // Supabase history
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => haikuResponse.content[0] }) // won't happen
      .mockResolvedValue({ ok: true, status: 200, json: async () => haikuResponse }); // Haiku

    // Use separate fetchFn per service to simplify
    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const haikuFn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '{"score": 7, "reasoning": "Good signal."}' }] }),
    });

    const result = await runScoreAlert([SAMPLE_FILING], {
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      anthropicApiKey: ANTHROPIC_KEY,
      fetchFn: (url, opts) => {
        if (url.includes('supabase') || url.includes('insider_alerts') || url.includes('finance.yahoo')) {
          return supabaseFn(url, opts);
        }
        return haikuFn(url, opts);
      },
      _sleep: noSleep,
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
    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const haikuFn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '{"score": 6, "reasoning": "Moderate."}' }] }),
    });
    const fetchFn = (url) => {
      if (url.includes('supabase') || url.includes('finance.yahoo') || url.includes('insider_alerts')) {
        return supabaseFn(url);
      }
      return haikuFn(url);
    };

    const results = await runScoreAlert([SAMPLE_FILING, filing2], {
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      anthropicApiKey: ANTHROPIC_KEY,
      fetchFn,
      _sleep: noSleep,
    });

    expect(results).toHaveLength(2);
    expect(results[0].ticker).toBe('AAPL');
    expect(results[1].ticker).toBe('MSFT');
  });

  test('preserves all original filing fields in output', async () => {
    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const haikuFn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '{"score": 5, "reasoning": "Test."}' }] }),
    });
    const fetchFn = (url) => url.includes('anthropic') ? haikuFn(url) : supabaseFn(url);

    const results = await runScoreAlert([SAMPLE_FILING], {
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      anthropicApiKey: ANTHROPIC_KEY,
      fetchFn,
      _sleep: noSleep,
    });

    expect(results[0].is_cluster_buy).toBe(false);
    expect(results[0].cluster_id).toBeNull();
    expect(results[0].transaction_type).toBe('P - Purchase');
  });

  test('handles empty filings array', async () => {
    const results = await runScoreAlert([], {
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      anthropicApiKey: ANTHROPIC_KEY,
      fetchFn: jest.fn(),
      _sleep: noSleep,
    });
    expect(results).toEqual([]);
  });
});
