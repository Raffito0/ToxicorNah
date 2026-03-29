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
