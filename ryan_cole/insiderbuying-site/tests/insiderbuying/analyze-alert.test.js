'use strict';

// ---------------------------------------------------------------------------
// Mock ai-client BEFORE requiring analyze-alert
// ---------------------------------------------------------------------------
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createDeepSeekClient: jest.fn(),
}));

const { createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');

const {
  buildAnalysisPrompt,
  validateAnalysis,
  analyze,
  getWordTarget,
  runAnalyzeAlert,
} = require('../../n8n/code/insiderbuying/analyze-alert');

// ─── helpers ────────────────────────────────────────────────────────────────

const DEEPSEEK_KEY = 'test-deepseek';

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

function makeMockClient(content, throws = null) {
  const complete = throws
    ? jest.fn().mockRejectedValue(throws)
    : jest.fn().mockResolvedValue({
        content: content != null ? content : GOOD_ANALYSIS,
        usage: { inputTokens: 500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cached: false,
        estimatedCost: 0.0005,
      });
  return { complete };
}

function makeHelpers(overrides = {}) {
  return {
    deepSeekApiKey: DEEPSEEK_KEY,
    fetchFn: jest.fn(),
    ...overrides,
  };
}

// ─── source code checks ─────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const src = fs.readFileSync(
  path.resolve(__dirname, '../../n8n/code/insiderbuying/analyze-alert.js'),
  'utf8',
);

describe('source code checks', () => {
  test('no anthropic.com URL in source', () => {
    expect(src).not.toContain('anthropic.com');
  });

  test('no claude-sonnet model string in source', () => {
    expect(src).not.toContain('claude-sonnet');
  });

  test('no x-api-key header in source', () => {
    expect(src).not.toContain('x-api-key');
  });

  test('imports createDeepSeekClient from ai-client', () => {
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createDeepSeekClient');
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('analyze-alert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Score gate ──────────────────────────────────────────────────────────

  test('analyze() returns null when score < 4 (no API call)', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 3 };
    const result = await analyze(filing, helpers);

    expect(result).toBeNull();
    expect(mockClient.complete).not.toHaveBeenCalled();
    expect(createDeepSeekClient).not.toHaveBeenCalled();
  });

  test('analyze() returns null when score is 0', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 0 };
    const result = await analyze(filing, helpers);

    expect(result).toBeNull();
    expect(mockClient.complete).not.toHaveBeenCalled();
    expect(createDeepSeekClient).not.toHaveBeenCalled();
  });

  test('analyze() IS called when score >= 4', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 4 };
    const result = await analyze(filing, helpers);

    expect(mockClient.complete).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  test('analyze() IS called when score is exactly 4', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 4 };
    await analyze(filing, helpers);

    expect(mockClient.complete).toHaveBeenCalledTimes(1);
  });

  // ── Provider ─────────────────────────────────────────────────────────────

  test('analyze() calls createDeepSeekClient with fetchFn and deepSeekApiKey', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    await analyze(SAMPLE_FILING, helpers);

    expect(createDeepSeekClient).toHaveBeenCalledWith(helpers.fetchFn, DEEPSEEK_KEY);
  });

  test('analyze() calls client.complete with null system prompt and full prompt', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    await analyze(SAMPLE_FILING, helpers);

    expect(mockClient.complete).toHaveBeenCalledWith(null, expect.any(String));
  });

  test('analyze() returns result.content directly (prose, no JSON parsing)', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(result).toBe(GOOD_ANALYSIS);
  });

  // ── Validation & retry ─────────────────────────────────────────────────

  test('response with < 50 characters triggers one retry', async () => {
    const mockClient = { complete: jest.fn() };
    mockClient.complete
      .mockResolvedValueOnce({ content: 'Too short.', usage: {}, cached: false, estimatedCost: 0 })
      .mockResolvedValueOnce({ content: GOOD_ANALYSIS, usage: {}, cached: false, estimatedCost: 0 });
    createDeepSeekClient.mockReturnValue(mockClient);

    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(mockClient.complete).toHaveBeenCalledTimes(2);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  test('response with only 1 paragraph triggers one retry', async () => {
    const singleParagraph = 'This is a single paragraph without any breaks and it is long enough to pass the character check but has no paragraph separation at all.';
    const mockClient = { complete: jest.fn() };
    mockClient.complete
      .mockResolvedValueOnce({ content: singleParagraph, usage: {}, cached: false, estimatedCost: 0 })
      .mockResolvedValueOnce({ content: GOOD_ANALYSIS, usage: {}, cached: false, estimatedCost: 0 });
    createDeepSeekClient.mockReturnValue(mockClient);

    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(mockClient.complete).toHaveBeenCalledTimes(2);
    expect(result).toBe(GOOD_ANALYSIS);
  });

  test('after failed retry, ai_analysis = null (no throw)', async () => {
    const bad = 'Bad.';
    const mockClient = makeMockClient(bad);
    createDeepSeekClient.mockReturnValue(mockClient);

    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(mockClient.complete).toHaveBeenCalledTimes(2);
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

  test('AI client error returns null (no throw)', async () => {
    const mockClient = makeMockClient(null, new Error('DeepSeek API error'));
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(result).toBeNull();
  });

  test('network error returns null (no throw)', async () => {
    const mockClient = makeMockClient(null, new Error('ECONNRESET'));
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const result = await analyze(SAMPLE_FILING, helpers);

    expect(result).toBeNull();
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

// ─── Structured Analysis (Section 05) ────────────────────────────────────────

describe('Structured Analysis (Section 05)', () => {
  const SAMPLE_ALERT_S05 = {
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    insiderName: 'Jensen Huang',
    canonicalRole: 'Chief Executive Officer',
    insiderCategory: 'C-Suite',
    sharesTraded: 10000,
    pricePerShare: 490.00,
    transactionValue: 4900000,
    transactionDate: '2026-03-15',
    finalScore: 8,
    direction: 'A',
    sharesOwnedAfter: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getWordTarget ──────────────────────────────────────────────────────────

  describe('getWordTarget', () => {
    test('score 9 → { target: 225, max: 300 }', () => {
      expect(getWordTarget(9)).toEqual({ target: 225, max: 300 });
    });

    test('score 8 → { target: 225, max: 300 } (lower boundary)', () => {
      expect(getWordTarget(8)).toEqual({ target: 225, max: 300 });
    });

    test('score 7 → { target: 200, max: 275 }', () => {
      expect(getWordTarget(7)).toEqual({ target: 200, max: 275 });
    });

    test('score 6 → { target: 200, max: 275 } (lower boundary)', () => {
      expect(getWordTarget(6)).toEqual({ target: 200, max: 275 });
    });

    test('score 5 → { target: 125, max: 175 }', () => {
      expect(getWordTarget(5)).toEqual({ target: 125, max: 175 });
    });

    test('score 4 → { target: 125, max: 175 } (lower boundary)', () => {
      expect(getWordTarget(4)).toEqual({ target: 125, max: 175 });
    });

    test('score 2 → { target: 100, max: 150 }', () => {
      expect(getWordTarget(2)).toEqual({ target: 100, max: 150 });
    });

    test('undefined score → default { target: 100, max: 150 }', () => {
      expect(getWordTarget(undefined)).toEqual({ target: 100, max: 150 });
    });

    test('null score → default { target: 100, max: 150 }', () => {
      expect(getWordTarget(null)).toEqual({ target: 100, max: 150 });
    });
  });

  // ── direction-aware prompt ─────────────────────────────────────────────────

  describe('direction-aware prompt', () => {
    test('direction A → prompt contains BUY label and "bought" verb', () => {
      const alert = { ...SAMPLE_ALERT_S05, direction: 'A' };
      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
      expect(prompt).toContain('BUY');
      expect(prompt).toContain('bought');
    });

    test('direction A → prompt does not contain sell ambiguity framing', () => {
      const alert = { ...SAMPLE_ALERT_S05, direction: 'A' };
      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
      expect(prompt).not.toContain('tax plan or bearish signal');
    });

    test('missing direction field defaults to BUY framing', () => {
      const { direction: _omitted, ...alertNoDir } = SAMPLE_ALERT_S05;
      const prompt = buildAnalysisPrompt(alertNoDir, {}, getWordTarget(8));
      expect(prompt).toContain('BUY');
      expect(prompt).toContain('bought');
    });

    test('direction D → prompt contains SELL label and "sold" verb', () => {
      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
      expect(prompt).toContain('SELL');
      expect(prompt).toContain('sold');
    });

    test('direction D → sell prompt includes "tax plan or bearish signal"', () => {
      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
      expect(prompt).toContain('tax plan or bearish signal');
    });

    test('direction D → prompt does not contain buy conviction framing', () => {
      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
      expect(prompt).not.toContain('conviction behind this buy');
    });
  });

  // ── data injection ─────────────────────────────────────────────────────────

  describe('data injection', () => {
    test('current price injected into prompt when Finnhub quote is available', () => {
      const marketData = { currentPrice: 52.30, pctChangeToday: 3.1 };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).toContain('52.3');
      expect(prompt).toContain('3.1');
    });

    test('price fields omitted from prompt when currentPrice is null', () => {
      const marketData = { currentPrice: null, pctChangeToday: null };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).not.toContain('Current price');
    });

    test('portfolio pct injected when portfolioPct is provided', () => {
      const marketData = { portfolioPct: 12.4 };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).toContain('12.4');
      expect(prompt).toContain('current holdings');
    });

    test('portfolio pct omitted when portfolioPct is null', () => {
      const marketData = { portfolioPct: null };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).not.toContain('current holdings');
    });

    test('"Earnings in X days" present when daysToEarnings is within range', () => {
      const marketData = { daysToEarnings: 42 };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).toContain('42');
      expect(prompt).toContain('Earnings in');
    });

    test('earnings sentence omitted when daysToEarnings is null', () => {
      const marketData = { daysToEarnings: null };
      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
      expect(prompt).not.toContain('Earnings in');
    });
  });

  // ── runAnalyzeAlert integration ────────────────────────────────────────────

  describe('runAnalyzeAlert', () => {
    test('returns null when finalScore < 4', async () => {
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 3 };
      const result = await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: {},
      });
      expect(result).toBeNull();
    });

    test('returns object with required keys when score >= 4', async () => {
      const mockClient = makeMockClient(GOOD_ANALYSIS);
      createDeepSeekClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7 };
      const result = await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('analysisText');
      expect(result).toHaveProperty('wordTarget');
      expect(result).toHaveProperty('percentageDataAvailable');
      expect(result).toHaveProperty('attemptCount');
    });

    test('percentageDataAvailable is false when Finnhub data and sharesOwnedAfter are absent', async () => {
      const mockClient = makeMockClient(GOOD_ANALYSIS);
      createDeepSeekClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7, sharesOwnedAfter: null };
      const result = await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });
      expect(result.percentageDataAvailable).toBe(false);
    });

    test('percentageDataAvailable is true when sharesOwnedAfter is provided', async () => {
      const mockClient = makeMockClient(GOOD_ANALYSIS);
      createDeepSeekClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7, sharesOwnedAfter: 200000 };
      const result = await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });
      expect(result.percentageDataAvailable).toBe(true);
    });

    test('DeepSeek error returns null without throwing', async () => {
      const mockClient = makeMockClient(null, new Error('DeepSeek timeout'));
      createDeepSeekClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7 };
      const result = await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });
      expect(result).toBeNull();
    });
  });
});
