'use strict';

// ---------------------------------------------------------------------------
// Mock ai-client BEFORE requiring analyze-alert
// ---------------------------------------------------------------------------
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createOpusClient: jest.fn(),
  createDeepSeekClient: jest.fn(),
}));

const { createOpusClient, createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');

const {
  buildAnalysisPrompt,
  validateAnalysis,
  analyze,
  getWordTarget,
  runAnalyzeAlert,
} = require('../../n8n/code/insiderbuying/analyze-alert');

// ─── helpers ────────────────────────────────────────────────────────────────

const DEEPSEEK_KEY = 'test-deepseek';
const KIEAI_KEY = 'test-kieai';

// NOTE: GOOD_ANALYSIS is ~42 words and has no score arg in legacy tests.
// Rule 1 (word count) is skipped when score is undefined/null.
// Do NOT use this fixture with a score arg — it would fail Rule 1.
// Use makeAnalysis() from the S06 describe block for score-aware tests.
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
    kieaiApiKey: KIEAI_KEY,
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

  test('imports createOpusClient from ai-client (for score >= 9 routing)', () => {
    expect(src).toContain('createOpusClient');
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

  // ── Provider / split routing ──────────────────────────────────────────────

  test('analyze() score < 9 routes to createDeepSeekClient', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createDeepSeekClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 8 };
    await analyze(filing, helpers);

    expect(createDeepSeekClient).toHaveBeenCalledWith(helpers.fetchFn, DEEPSEEK_KEY);
    expect(createOpusClient).not.toHaveBeenCalled();
  });

  test('analyze() score >= 9 routes to createOpusClient', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createOpusClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 9 };
    await analyze(filing, helpers);

    expect(createOpusClient).toHaveBeenCalledWith(helpers.fetchFn, KIEAI_KEY);
    expect(createDeepSeekClient).not.toHaveBeenCalled();
  });

  test('analyze() score 10 routes to createOpusClient', async () => {
    const mockClient = makeMockClient(GOOD_ANALYSIS);
    createOpusClient.mockReturnValue(mockClient);
    const helpers = makeHelpers();
    const filing = { ...SAMPLE_FILING, significance_score: 10 };
    await analyze(filing, helpers);

    expect(createOpusClient).toHaveBeenCalled();
    expect(createDeepSeekClient).not.toHaveBeenCalled();
  });

  test('analyze() calls createDeepSeekClient with fetchFn and deepSeekApiKey (score 7)', async () => {
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

  test('validateAnalysis accepts text with dollar amount and cautionary language', () => {
    expect(validateAnalysis(GOOD_ANALYSIS).valid).toBe(true);
  });

  test('validateAnalysis rejects text with no dollar amount', () => {
    expect(validateAnalysis('Short.').valid).toBe(false);
  });

  test('validateAnalysis rejects text with no dollar amount (long single block)', () => {
    const single = 'A'.repeat(100);
    expect(validateAnalysis(single).valid).toBe(false);
  });

  test('validateAnalysis rejects null/undefined', () => {
    expect(validateAnalysis(null).valid).toBe(false);
    expect(validateAnalysis(undefined).valid).toBe(false);
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

    test('finalScore < 9 routes to createDeepSeekClient', async () => {
      const mockClient = makeMockClient(GOOD_ANALYSIS);
      createDeepSeekClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 8 };
      await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-ds', KIEAI_API_KEY: 'test-kieai' },
      });
      expect(createDeepSeekClient).toHaveBeenCalled();
      expect(createOpusClient).not.toHaveBeenCalled();
    });

    test('finalScore >= 9 routes to createOpusClient', async () => {
      const mockClient = makeMockClient(GOOD_ANALYSIS);
      createOpusClient.mockReturnValue(mockClient);
      const alert = { ...SAMPLE_ALERT_S05, finalScore: 9 };
      await runAnalyzeAlert(alert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-ds', KIEAI_API_KEY: 'test-kieai' },
      });
      expect(createOpusClient).toHaveBeenCalled();
      expect(createDeepSeekClient).not.toHaveBeenCalled();
    });
  });
});

// ─── Analysis Validation (Section 06) ────────────────────────────────────────

describe('Analysis Validation (Section 06)', () => {
  // Helper: build analysis text with controlled word count and features
  function makeAnalysis(wordCount, options = {}) {
    const { dollar = true, cautionary = true, banned = null, pct = false } = options;
    const parts = [];
    if (dollar) parts.push('$45.20 was the price per share.');
    if (cautionary) parts.push('However, risk factors should be considered.');
    if (banned) parts.push(`This trade is ${banned}.`);
    if (pct) parts.push('Represents 15% of current holdings.');
    const prefix = parts.length > 0 ? parts.join(' ') + ' ' : '';
    const prefixWords = prefix.split(/\s+/).filter(Boolean).length;
    const fillCount = Math.max(0, wordCount - prefixWords);
    return prefix + Array(fillCount).fill('word').join(' ');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Rule 1 — Word count ────────────────────────────────────────────────────
  // score=7: target=200, max=275, min=Math.floor(200*0.70)=140

  describe('Rule 1 — word count', () => {
    test('150 words, score=7 → valid (within range)', () => {
      const text = makeAnalysis(150);
      expect(validateAnalysis(text, 7).valid).toBe(true);
    });

    test('139 words, score=7 → invalid, error contains "too short"', () => {
      const text = makeAnalysis(139);
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('too short'))).toBe(true);
    });

    test('276 words, score=7 → invalid, error contains "too long"', () => {
      const text = makeAnalysis(276);
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('too long'))).toBe(true);
    });

    test('140 words, score=7 → valid (exactly at floor boundary, inclusive)', () => {
      const text = makeAnalysis(140);
      expect(validateAnalysis(text, 7).valid).toBe(true);
    });

    test('275 words, score=7 → valid (exactly at max, inclusive)', () => {
      const text = makeAnalysis(275);
      expect(validateAnalysis(text, 7).valid).toBe(true);
    });

    test('276 words, score=7 → invalid (max + 1)', () => {
      const text = makeAnalysis(276);
      expect(validateAnalysis(text, 7).valid).toBe(false);
    });

    test('Rule 1 skipped when score is undefined — short text with dollar+cautionary passes', () => {
      const text = makeAnalysis(10);
      const result = validateAnalysis(text, undefined);
      const hasWordCountError = result.errors.some(e =>
        e.toLowerCase().includes('too short') || e.toLowerCase().includes('too long')
      );
      expect(hasWordCountError).toBe(false);
    });
  });

  // ── Rule 2 — Banned phrases ───────────────────────────────────────────────

  describe('Rule 2 — banned phrases', () => {
    test('"guaranteed" in text → invalid, error names the phrase', () => {
      const text = makeAnalysis(150, { banned: 'guaranteed' });
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('guaranteed'))).toBe(true);
    });

    test('"will moon" in text → invalid', () => {
      const text = makeAnalysis(150, { banned: 'will moon' });
      expect(validateAnalysis(text, 7).valid).toBe(false);
    });

    test('"to the moon" in text → invalid', () => {
      const text = makeAnalysis(150, { banned: 'to the moon' });
      expect(validateAnalysis(text, 7).valid).toBe(false);
    });

    test('"GUARANTEED" uppercase → invalid (case-insensitive check)', () => {
      const text = makeAnalysis(150) + ' GUARANTEED returns ahead.';
      expect(validateAnalysis(text, 7).valid).toBe(false);
    });

    test('"guaranteed" as substring of phrase → fails (substring match, documented behavior)', () => {
      const text = makeAnalysis(150) + ' guaranteed-return strategy.';
      expect(validateAnalysis(text, 7).valid).toBe(false);
    });

    test('no banned phrases → Rule 2 passes', () => {
      const text = makeAnalysis(150);
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e => e.toLowerCase().includes('banned'))).toBe(false);
    });
  });

  // ── Rule 3 — Dollar amount present ────────────────────────────────────────

  describe('Rule 3 — dollar amount', () => {
    test('"$45.20" in text → Rule 3 passes', () => {
      const text = makeAnalysis(150, { dollar: true });
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e => e.toLowerCase().includes('dollar') || e.toLowerCase().includes('amount'))).toBe(false);
    });

    test('"$1,200" in text → passes', () => {
      const text = makeAnalysis(150, { dollar: false }) + ' priced at $1,200 per share.';
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e => e.toLowerCase().includes('dollar') || e.toLowerCase().includes('amount'))).toBe(false);
    });

    test('no "$" character → Rule 3 fails', () => {
      const text = makeAnalysis(150, { dollar: false });
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.toLowerCase().includes('dollar') || e.toLowerCase().includes('amount') || e.includes('$')
      )).toBe(true);
    });

    test('"$" not followed by digit (e.g. "the $ amount") → Rule 3 fails', () => {
      const text = makeAnalysis(150, { dollar: false }) + ' the $ amount was high.';
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e =>
        e.toLowerCase().includes('dollar') || e.toLowerCase().includes('amount') || e.includes('$')
      )).toBe(true);
    });
  });

  // ── Rule 4 — Percentage present (conditional) ─────────────────────────────

  describe('Rule 4 — percentage (conditional)', () => {
    test('percentageDataAvailable=true, text contains "15%" → Rule 4 passes', () => {
      const text = makeAnalysis(150, { pct: true });
      const result = validateAnalysis(text, 7, 'A', true);
      expect(result.errors.some(e => e.toLowerCase().includes('percent'))).toBe(false);
    });

    test('percentageDataAvailable=true, no "%" → fails with percentage error', () => {
      const text = makeAnalysis(150, { pct: false });
      const result = validateAnalysis(text, 7, 'A', true);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('percent'))).toBe(true);
    });

    test('percentageDataAvailable=false → Rule 4 skipped entirely', () => {
      const text = makeAnalysis(150, { pct: false });
      const result = validateAnalysis(text, 7, 'A', false);
      expect(result.errors.some(e => e.toLowerCase().includes('percent'))).toBe(false);
    });

    test('percentageDataAvailable=false, no "%" → still passes Rule 4 (rule was skipped)', () => {
      const text = makeAnalysis(150, { pct: false });
      const result = validateAnalysis(text, 7, 'A', false);
      expect(result.errors.filter(e => e.toLowerCase().includes('percent'))).toHaveLength(0);
    });
  });

  // ── Rule 5 — Cautionary language ─────────────────────────────────────────

  describe('Rule 5 — cautionary language', () => {
    test('"however" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' However this is notable.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('"could" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' The stock could decline.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('"routine" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' This may be routine selling.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('"caution" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' Investors should exercise caution.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('"consider" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' Investors should consider context.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('"risk" → passes', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' Risk factors apply here.';
      expect(validateAnalysis(text, 7).errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });

    test('no cautionary words → Rule 5 fails', () => {
      const text = makeAnalysis(150, { cautionary: false });
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(true);
    });

    test('"recover" does not trigger Rule 5 (documented: no cautionary word is a substring)', () => {
      // "recover" does not contain however/risk/caution/could/routine/consider
      const text = makeAnalysis(150, { cautionary: false }) + ' The stock may recover soon.';
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(true);
    });

    test('"precautionary" passes Rule 5 (documented: "caution" is a substring of "precautionary")', () => {
      const text = makeAnalysis(150, { cautionary: false }) + ' Take a precautionary approach.';
      const result = validateAnalysis(text, 7);
      expect(result.errors.some(e => e.toLowerCase().includes('cautionary'))).toBe(false);
    });
  });

  // ── All rules together ────────────────────────────────────────────────────

  describe('all rules together', () => {
    test('failing Rules 1 and 3 simultaneously → both errors present', () => {
      const text = makeAnalysis(139, { dollar: false });
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('too short'))).toBe(true);
      expect(result.errors.some(e =>
        e.toLowerCase().includes('dollar') || e.toLowerCase().includes('amount') || e.includes('$')
      )).toBe(true);
    });

    test('text passing all applicable rules → { valid: true, errors: [] }', () => {
      const text = makeAnalysis(150);
      const result = validateAnalysis(text, 7);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // ── Retry flow integration ────────────────────────────────────────────────

  describe('retry flow integration', () => {
    const SAMPLE_ALERT_S06 = {
      ticker: 'MSFT',
      insiderName: 'Satya Nadella',
      canonicalRole: 'CEO',
      insiderCategory: 'C-Suite',
      sharesTraded: 5000,
      pricePerShare: 420.00,
      transactionValue: 2100000,
      transactionDate: '2026-03-15',
      finalScore: 7,
      direction: 'A',
      sharesOwnedAfter: null,
    };

    test('first attempt passes → attemptCount=1', async () => {
      const goodText = makeAnalysis(150);
      const mockClient = makeMockClient(goodText);
      createDeepSeekClient.mockReturnValue(mockClient);

      const result = await runAnalyzeAlert(SAMPLE_ALERT_S06, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      expect(result.attemptCount).toBe(1);
      expect(result.analysisText).toBe(goodText);
    });

    test('first response fails validation → second call made, prompt contains error list', async () => {
      const badText = makeAnalysis(50, { dollar: false, cautionary: false });
      const goodText = makeAnalysis(150);
      const mockClient = { complete: jest.fn() };
      mockClient.complete
        .mockResolvedValueOnce({ content: badText, usage: {}, cached: false, estimatedCost: 0 })
        .mockResolvedValueOnce({ content: goodText, usage: {}, cached: false, estimatedCost: 0 });
      createDeepSeekClient.mockReturnValue(mockClient);

      await runAnalyzeAlert(SAMPLE_ALERT_S06, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      expect(mockClient.complete).toHaveBeenCalledTimes(2);
      const secondCallPrompt = mockClient.complete.mock.calls[1][1];
      expect(secondCallPrompt).toContain('Previous attempt failed validation');
    });

    test('second attempt passes → returns second response with attemptCount=2', async () => {
      const badText = makeAnalysis(50, { dollar: false, cautionary: false });
      const goodText = makeAnalysis(150);
      const mockClient = { complete: jest.fn() };
      mockClient.complete
        .mockResolvedValueOnce({ content: badText, usage: {}, cached: false, estimatedCost: 0 })
        .mockResolvedValueOnce({ content: goodText, usage: {}, cached: false, estimatedCost: 0 });
      createDeepSeekClient.mockReturnValue(mockClient);

      const result = await runAnalyzeAlert(SAMPLE_ALERT_S06, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      expect(result.analysisText).toBe(goodText);
      expect(result.attemptCount).toBe(2);
    });

    test('both attempts fail → fallback template returned, only 2 complete() calls made', async () => {
      const badText = makeAnalysis(50, { dollar: false, cautionary: false });
      const mockClient = makeMockClient(badText);
      createDeepSeekClient.mockReturnValue(mockClient);

      const result = await runAnalyzeAlert(SAMPLE_ALERT_S06, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      expect(mockClient.complete).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result.analysisText).toContain('Satya Nadella');
    });

    test('fallback template contains insiderName, "bought", share count, price, and score', async () => {
      const badText = makeAnalysis(50, { dollar: false, cautionary: false });
      const mockClient = makeMockClient(badText);
      createDeepSeekClient.mockReturnValue(mockClient);

      const result = await runAnalyzeAlert(SAMPLE_ALERT_S06, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      const t = result.analysisText;
      expect(t).toContain('Satya Nadella');
      expect(t).toContain('bought');
      expect(t).toContain('5000');
      expect(t).toContain('420');
      expect(t).toContain('7/10');
    });

    test('fallback uses "sold" for direction=D', async () => {
      const badText = makeAnalysis(50, { dollar: false, cautionary: false });
      const mockClient = makeMockClient(badText);
      createDeepSeekClient.mockReturnValue(mockClient);

      const sellAlert = { ...SAMPLE_ALERT_S06, direction: 'D' };
      const result = await runAnalyzeAlert(sellAlert, {
        fetchFn: jest.fn(),
        sleep: () => Promise.resolve(),
        env: { DEEPSEEK_API_KEY: 'test-key' },
      });

      expect(result.analysisText).toContain('sold');
    });
  });
});
