'use strict';

/**
 * Section 06: AI Provider Swap — Validation Tests
 *
 * Verifies that all three file migrations are complete:
 *   - No direct Anthropic references remain outside ai-client.js
 *   - DEEPSEEK_API_KEY is registered in REQUIRED_N8N_ENV_VARS
 *   - ai-client.js contains usage documentation
 *   - Cost logging format is correct for all providers
 */

const path = require('path');
const fs = require('fs');

const CODE_DIR = path.resolve(__dirname, '../../n8n/code/insiderbuying');

function readCode(filename) {
  return fs.readFileSync(path.join(CODE_DIR, filename), 'utf8');
}

// ─── Grep check ──────────────────────────────────────────────────────────────

describe('no direct Anthropic references outside ai-client.js', () => {
  const MIGRATED_FILES = ['generate-article.js', 'score-alert.js', 'analyze-alert.js'];
  const BANNED_PATTERNS = [
    'api.anthropic.com',
    'claude-haiku',
    'claude-3',
    'x-api-key',
    'anthropic-version',
  ];

  for (const file of MIGRATED_FILES) {
    for (const pattern of BANNED_PATTERNS) {
      test(`${file} has no "${pattern}"`, () => {
        const src = readCode(file);
        expect(src).not.toContain(pattern);
      });
    }
  }
});

// ─── Provider imports ─────────────────────────────────────────────────────────

describe('migrated files import from ai-client', () => {
  test('generate-article.js imports createClaudeClient', () => {
    const src = readCode('generate-article.js');
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createClaudeClient');
  });

  test('score-alert.js imports createDeepSeekClient', () => {
    const src = readCode('score-alert.js');
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createDeepSeekClient');
  });

  test('analyze-alert.js imports createDeepSeekClient', () => {
    const src = readCode('analyze-alert.js');
    expect(src).toContain("require('./ai-client')");
    expect(src).toContain('createDeepSeekClient');
  });
});

// ─── Environment variable registration ───────────────────────────────────────

describe('environment variable registration', () => {
  const { REQUIRED_N8N_ENV_VARS } = require('../../n8n/code/insiderbuying/e2e-monitoring');

  test('DEEPSEEK_API_KEY is in REQUIRED_N8N_ENV_VARS', () => {
    expect(REQUIRED_N8N_ENV_VARS).toContain('DEEPSEEK_API_KEY');
  });

  test('ANTHROPIC_API_KEY is in REQUIRED_N8N_ENV_VARS', () => {
    expect(REQUIRED_N8N_ENV_VARS).toContain('ANTHROPIC_API_KEY');
  });
});

// ─── Documentation ────────────────────────────────────────────────────────────

describe('ai-client.js documentation', () => {
  const src = readCode('ai-client.js');

  test('contains createClaudeClient factory mention', () => {
    expect(src).toContain('createClaudeClient');
  });

  test('contains createDeepSeekClient factory mention', () => {
    expect(src).toContain('createDeepSeekClient');
  });

  test('documents ANTHROPIC_API_KEY env var', () => {
    expect(src).toContain('ANTHROPIC_API_KEY');
  });

  test('documents DEEPSEEK_API_KEY env var', () => {
    expect(src).toContain('DEEPSEEK_API_KEY');
  });

  test('documents return shape (content, toolResult, usage)', () => {
    expect(src).toContain('content');
    expect(src).toContain('toolResult');
    expect(src).toContain('usage');
    expect(src).toContain('estimatedCost');
  });

  test('security note: logs never include prompts or API keys', () => {
    const lower = src.toLowerCase();
    expect(lower).toContain('never');
  });
});

// ─── Cost logging format ──────────────────────────────────────────────────────

describe('cost logging format', () => {
  jest.mock('../../n8n/code/insiderbuying/ai-client', () =>
    jest.requireActual('../../n8n/code/insiderbuying/ai-client')
  );

  const { createClaudeClient, createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');

  function makeOkFetch(body) {
    return jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  test('Claude client logs [ai-client] with provider name and cost', async () => {
    const fetchFn = makeOkFetch({
      content: [{ type: 'text', text: 'Hello from Claude' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const client = createClaudeClient(fetchFn, 'sk-ant-test');
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await client.complete('sys', 'user');
    const calls = spy.mock.calls.map(args => args.join(' '));
    const costLog = calls.find(c => c.includes('[ai-client]'));
    spy.mockRestore();
    expect(costLog).toBeDefined();
    expect(costLog).toContain('claude');
    expect(costLog).toContain('$');
  });

  test('DeepSeek client logs [ai-client] with provider name and cost', async () => {
    const fetchFn = makeOkFetch({
      choices: [{ message: { content: 'Hello from DeepSeek' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const client = createDeepSeekClient(fetchFn, 'sk-ds-test');
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await client.complete(null, 'user');
    const calls = spy.mock.calls.map(args => args.join(' '));
    const costLog = calls.find(c => c.includes('[ai-client]'));
    spy.mockRestore();
    expect(costLog).toBeDefined();
    expect(costLog).toContain('deepseek');
    expect(costLog).toContain('$');
  });

  test('cost log does not include prompt text or API keys', async () => {
    const SECRET_PROMPT = 'SUPER_SECRET_PROMPT_CONTENT_XYZ';
    const SECRET_KEY = 'sk-super-secret-key-abc123';
    const fetchFn = makeOkFetch({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const client = createDeepSeekClient(fetchFn, SECRET_KEY);
    const loggedLines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      loggedLines.push(args.join(' '));
    });
    await client.complete(null, SECRET_PROMPT);
    spy.mockRestore();
    for (const line of loggedLines) {
      expect(line).not.toContain(SECRET_PROMPT);
      expect(line).not.toContain(SECRET_KEY);
    }
  });
});
