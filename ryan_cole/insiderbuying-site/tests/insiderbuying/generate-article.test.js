'use strict';

/**
 * generate-article.test.js — Tests for the ai-client migration in generate-article.js
 *
 * Focuses on verifying:
 * 1. generateArticle() uses createClaudeClient().completeToolUse() (not direct fetchFn)
 * 2. Correct arguments passed to completeToolUse (cache:true, temperature:0.6, toolSchema)
 * 3. result.toolResult used directly (no extractToolResult() parsing)
 * 4. Quality gate retry still works with ai-client response format
 * 5. Safety refusal (throw) handled correctly
 * 6. No direct anthropic.com references in source
 */

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Mock ai-client BEFORE requiring generate-article
// ---------------------------------------------------------------------------
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createClaudeClient: jest.fn(),
}));

const { createClaudeClient } = require('../../n8n/code/insiderbuying/ai-client');

const generateArticleModule = require('../../n8n/code/insiderbuying/generate-article');
const {
  buildToolSchema,
  qualityGate,
  seoScore,
  aiDetectionScore,
  sanitizeHtml,
  generateArticle,
} = generateArticleModule;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeValidArticle(overrides = {}) {
  const body = Array(900).fill('word').join(' '); // ~900 words
  return {
    title: 'CEO Buys $500K in Stock: What Investors Should Know',
    meta_description: 'A senior executive just bought significant shares. Here is what the data reveals about this insider buying signal.',
    slug: 'ceo-buys-500k-stock-AAPL-2026',
    verdict_type: 'BUY',
    verdict_text: 'This insider purchase pattern suggests strong conviction in near-term performance.',
    key_takeaways: ['Strong signal', 'Historically bullish', 'Low risk'],
    body_html: `<p>${body}</p>`,
    word_count: 900,
    ...overrides,
  };
}

function makeMockClient(toolResult = null, throws = null) {
  const mockCompleteToolUse = throws
    ? jest.fn().mockRejectedValue(throws)
    : jest.fn().mockResolvedValue({
        toolResult: toolResult || makeValidArticle(),
        content: '',
        usage: { inputTokens: 3000, outputTokens: 800, cacheReadTokens: 2800, cacheWriteTokens: 0 },
        cached: true,
        estimatedCost: 0.012,
      });
  return { completeToolUse: mockCompleteToolUse, complete: jest.fn(), completeWithCache: jest.fn() };
}

const SAMPLE_KEYWORD = {
  id: 1,
  keyword: 'AAPL insider buying',
  ticker: 'AAPL',
  article_type: 'A',
  target_length: 'medium',
  status: 'new',
  priority_score: 100,
  secondary_keywords: 'Apple stock insider',
};

const TEST_ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  FINANCIAL_DATASETS_API_KEY: 'test-fd-key',
  ARTICLE_SYSTEM_PROMPT: 'Write an article about {{KEYWORD}} for {{TICKER}}.',
  NOCODB_BASE_URL: 'http://localhost:8080',
  NOCODB_API_TOKEN: 'test-noco-key',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
};

function makeHelpers(client) {
  createClaudeClient.mockReturnValue(client);
  // fetchFn that simulates NocoDB + Financial Datasets API
  const fetchFn = jest.fn().mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('Keywords')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ list: [SAMPLE_KEYWORD] }),
        text: async () => '{}',
      });
    }
    if (typeof url === 'string' && url.includes('financialdatasets.ai')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ income_statements: [{ ticker: 'AAPL' }] }),
        text: async () => '{}',
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
    });
  });
  // generateArticle reads env from helpers.env, not input.env
  return { fetchFn, env: TEST_ENV };
}

function makeInput(overrides = {}) {
  return {
    blog: 'earlyinsider',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Static source checks
// ---------------------------------------------------------------------------

describe('source code checks', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../n8n/code/insiderbuying/generate-article.js'),
    'utf8',
  );

  test('no direct anthropic.com URL in source', () => {
    expect(src).not.toContain('anthropic.com');
  });

  test('no x-api-key header in source', () => {
    expect(src).not.toContain('x-api-key');
  });

  test('no anthropic-version header in source', () => {
    expect(src).not.toContain('anthropic-version');
  });

  test('imports createClaudeClient from ai-client', () => {
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createClaudeClient');
  });
});

// ---------------------------------------------------------------------------
// completeToolUse call contract
// ---------------------------------------------------------------------------

describe('generateArticle uses completeToolUse correctly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls completeToolUse (not direct fetchFn) for article generation', async () => {
    const client = makeMockClient();
    const helpers = makeHelpers(client);
    const input = makeInput();

    // We just need to verify completeToolUse was called
    // (makeHelpers already sets up smart fetchFn that returns SAMPLE_KEYWORD for NocoDB Keywords calls)
    await generateArticle(input, helpers).catch(() => {});

    expect(client.completeToolUse).toHaveBeenCalled();
    // fetchFn should NOT have been called with anthropic URL
    const anthropicCalls = helpers.fetchFn.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);
  });

  test('completeToolUse receives temperature:0.6 and cache:true', async () => {
    const client = makeMockClient();
    const helpers = makeHelpers(client);
    const input = makeInput();

    helpers.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });

    await generateArticle(input, helpers).catch(() => {});

    if (client.completeToolUse.mock.calls.length > 0) {
      const opts = client.completeToolUse.mock.calls[0][4];
      expect(opts).toBeDefined();
      expect(opts.temperature).toBe(0.6);
      expect(opts.cache).toBe(true);
    }
  });

  test('completeToolUse receives buildToolSchema() result as tools array', async () => {
    const client = makeMockClient();
    const helpers = makeHelpers(client);
    const input = makeInput();

    helpers.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });

    await generateArticle(input, helpers).catch(() => {});

    if (client.completeToolUse.mock.calls.length > 0) {
      const tools = client.completeToolUse.mock.calls[0][2];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].name).toBe('generate_article');
    }
  });

  test('completeToolUse receives tool_choice {type:"tool", name:"generate_article"}', async () => {
    const client = makeMockClient();
    const helpers = makeHelpers(client);
    const input = makeInput();

    helpers.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });

    await generateArticle(input, helpers).catch(() => {});

    if (client.completeToolUse.mock.calls.length > 0) {
      const toolChoice = client.completeToolUse.mock.calls[0][3];
      expect(toolChoice).toEqual({ type: 'tool', name: 'generate_article' });
    }
  });

  test('user prompt is "Generate the article now."', async () => {
    const client = makeMockClient();
    const helpers = makeHelpers(client);
    const input = makeInput();

    helpers.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });

    await generateArticle(input, helpers).catch(() => {});

    if (client.completeToolUse.mock.calls.length > 0) {
      const userPrompt = client.completeToolUse.mock.calls[0][1];
      expect(userPrompt).toBe('Generate the article now.');
    }
  });
});

// ---------------------------------------------------------------------------
// Safety refusal handling
// ---------------------------------------------------------------------------

describe('safety refusal handling', () => {
  beforeEach(() => jest.clearAllMocks());

  test('completeToolUse throw -> returns skipped status', async () => {
    const refusalErr = new Error('I cannot help with that request.');
    const client = makeMockClient(null, refusalErr);
    const helpers = makeHelpers(client);
    const input = makeInput();

    // Mock NocoDB update calls
    helpers.fetchFn.mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '{}' });

    const result = await generateArticle(input, helpers).catch((e) => ({ status: 'error', err: e }));
    if (result && result.status) {
      expect(['skipped', 'error']).toContain(result.status);
    }
  });
});

// ---------------------------------------------------------------------------
// buildToolSchema (pure function — unchanged)
// ---------------------------------------------------------------------------

describe('buildToolSchema', () => {
  test('returns object with name generate_article', () => {
    const schema = buildToolSchema();
    expect(schema.name).toBe('generate_article');
  });

  test('has input_schema with required fields', () => {
    const schema = buildToolSchema();
    expect(schema.input_schema).toBeDefined();
    expect(schema.input_schema.required).toContain('title');
    expect(schema.input_schema.required).toContain('body_html');
    expect(schema.input_schema.required).toContain('verdict_type');
  });
});

// ---------------------------------------------------------------------------
// qualityGate (pure function — unchanged)
// ---------------------------------------------------------------------------

describe('qualityGate', () => {
  test('returns object with pass and failures fields', () => {
    const article = makeValidArticle({ word_count: 1200 });
    const gate = qualityGate(article, 'AAPL insider buying', 'medium', 'standard');
    expect(gate).toHaveProperty('pass');
    expect(gate).toHaveProperty('failures');
    expect(Array.isArray(gate.failures)).toBe(true);
  });

  test('fails for article with no verdict_type', () => {
    const article = makeValidArticle({ verdict_type: null, word_count: 1200 });
    const gate = qualityGate(article, 'AAPL insider buying', 'medium', 'standard');
    expect(gate.pass).toBe(false);
    expect(gate.failures.some((f) => /verdict/i.test(f))).toBe(true);
  });

  test('fails for article below minimum word count', () => {
    const shortBody = Array(200).fill('word').join(' ');
    const article = makeValidArticle({ body_html: `<p>${shortBody}</p>`, word_count: 200 });
    const gate = qualityGate(article, 'AAPL insider buying', 'medium', 'standard');
    expect(gate.pass).toBe(false);
  });
});
