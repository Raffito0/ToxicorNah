'use strict';

const {
  buildAnalysisPrompt,
  validateAnalysis,
  analyze,
} = require('../../n8n/code/insiderbuying/analyze-alert');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFetch(responseText, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({
      content: [{ type: 'text', text: responseText }],
    }),
  });
}

const noSleep = jest.fn().mockResolvedValue(undefined);
const ANTHROPIC_KEY = 'test-anthropic';

const GOOD_ANALYSIS = [
  'This is the first paragraph of the analysis discussing the trade signal.',
  'The insider purchased 50,000 shares at $12.50 per share for a total of $625,000.',
  '',
  'The second paragraph covers historical context and risk factors in detail.',
  'This trade is notable because of the size relative to the insider\'s typical activity.',
].join('\n');

const SAMPLE_FILING = {
  ticker: 'AAPL',
  company_name: 'Apple Inc.',
  insider_name: 'Timothy D. Cook',
  insider_title: 'Chief Executive Officer',
  insider_category: 'C-Suite',
  transaction_shares: 50000,
  price_per_share: 150.25,
  total_value: 7512500,
  transaction_date: '2026-03-15',
  significance_score: 7,
  score_reasoning: 'Large C-Suite purchase with strong track record',
  is_cluster_buy: false,
  cluster_size: 0,
  track_record: {
    past_buy_count: 5,
    hit_rate: 0.8,
    avg_gain_30d: 0.12,
  },
  dedup_key: 'AAPL-TimothyDCook-2026-03-15-50000',
};

function makeHelpers(overrides = {}) {
  return {
    anthropicApiKey: ANTHROPIC_KEY,
    fetchFn: makeFetch(GOOD_ANALYSIS),
    _sleep: noSleep,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('analyze-alert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Score gate ──────────────────────────────────────────────────────────

  test('analyze() returns null when score < 4 (no API call)', async () => {
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 3 };
    const result = await analyze(filing, helpers);

    expect(result).toBeNull();
    expect(helpers.fetchFn).not.toHaveBeenCalled();
  });

  test('analyze() returns null when score is 0', async () => {
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 0 };
    const result = await analyze(filing, helpers);

    expect(result).toBeNull();
    expect(helpers.fetchFn).not.toHaveBeenCalled();
  });

  test('analyze() IS called when score >= 4', async () => {
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 4 };
    const result = await analyze(filing, helpers);

    expect(helpers.fetchFn).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  test('analyze() IS called when score is exactly 4', async () => {
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 4 };
    await analyze(filing, helpers);

    expect(helpers.fetchFn).toHaveBeenCalledTimes(1);
  });

  // ── Model ───────────────────────────────────────────────────────────────

  test('analyze() uses model claude-sonnet-4-6', async () => {
    const helpers = makeHelpers();
    await analyze(SAMPLE_FILING, helpers);

    const callArgs = helpers.fetchFn.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  // ── Validation & retry ─────────────────────────────────────────────────

  test('response with < 50 characters triggers one retry', async () => {
    const shortResponse = 'Too short.';
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: shortResponse }] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: GOOD_ANALYSIS }] }),
      });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  test('response with only 1 paragraph triggers one retry', async () => {
    const singleParagraph = 'This is a single paragraph without any breaks and it is long enough to pass the character check but has no paragraph separation at all.';
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: singleParagraph }] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: GOOD_ANALYSIS }] }),
      });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  test('after failed retry, ai_analysis = null (no throw)', async () => {
    const bad = 'Bad.';
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: bad }] }),
    });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  // ── Prompt quality ─────────────────────────────────────────────────────

  test('prompt forbids generic phrases like "insiders have information"', () => {
    const prompt = buildAnalysisPrompt(SAMPLE_FILING);
    expect(prompt.toLowerCase()).toContain('do not use generic phrases');
  });

  test('prompt includes actual numbers (shares, price, total_value)', () => {
    const prompt = buildAnalysisPrompt(SAMPLE_FILING);
    expect(prompt).toContain('50000');
    expect(prompt).toContain('150.25');
    expect(prompt).toContain('7512500');
  });

  test('prompt includes insider name and role', () => {
    const prompt = buildAnalysisPrompt(SAMPLE_FILING);
    expect(prompt).toContain('Timothy D. Cook');
    expect(prompt).toContain('Chief Executive Officer');
  });

  test('prompt includes track record when available', () => {
    const prompt = buildAnalysisPrompt(SAMPLE_FILING);
    expect(prompt).toContain('5');   // past_buy_count
    expect(prompt).toContain('80%'); // hit_rate formatted
  });

  test('prompt handles null track record gracefully', () => {
    const filing = { ...SAMPLE_FILING, track_record: null };
    const prompt = buildAnalysisPrompt(filing);
    expect(prompt).toContain('no track record');
  });

  test('prompt includes cluster info when present', () => {
    const filing = { ...SAMPLE_FILING, is_cluster_buy: true, cluster_size: 4 };
    const prompt = buildAnalysisPrompt(filing);
    expect(prompt).toContain('cluster');
    expect(prompt).toContain('4');
  });

  // ── Error handling ─────────────────────────────────────────────────────

  test('network error returns null (no throw)', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(result).toBeNull();
  });

  test('429 rate limit waits 5s and retries once', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: GOOD_ANALYSIS }] }),
      });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(helpers._sleep).toHaveBeenCalledWith(5000);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  test('429 twice returns null', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({}),
    });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  test('500/503 retries once after 2s delay', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: GOOD_ANALYSIS }] }),
      });

    const helpers = makeHelpers({ fetchFn });
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(helpers._sleep).toHaveBeenCalledWith(2000);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  // ── validateAnalysis unit tests ────────────────────────────────────────

  test('validateAnalysis accepts 2+ paragraphs > 50 chars', () => {
    expect(validateAnalysis(GOOD_ANALYSIS)).toBe(true);
  });

  test('validateAnalysis rejects < 50 chars', () => {
    expect(validateAnalysis('Short.')).toBe(false);
  });

  test('validateAnalysis rejects single paragraph', () => {
    const single = 'A'.repeat(100);
    expect(validateAnalysis(single)).toBe(false);
  });

  test('validateAnalysis rejects null/undefined', () => {
    expect(validateAnalysis(null)).toBe(false);
    expect(validateAnalysis(undefined)).toBe(false);
  });
});
