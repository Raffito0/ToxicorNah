'use strict';

const {
  AIClient,
  createClaudeClient,
  createDeepSeekClient,
} = require('../../n8n/code/insiderbuying/ai-client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(response, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
}

const CLAUDE_TEXT_RESP = {
  content: [{ type: 'text', text: 'Response text here' }],
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};

const CLAUDE_TOOL_RESP = {
  content: [
    { type: 'text', text: 'I will extract the article.' },
    {
      type: 'tool_use',
      id: 'toolu_abc123',
      name: 'extract_article',
      input: { title: 'Test Title', body: 'Test body content' },
    },
  ],
  usage: { input_tokens: 200, output_tokens: 150 },
};

const DS_TEXT_RESP = {
  choices: [{ message: { content: 'DeepSeek response text' } }],
  usage: { prompt_tokens: 200, completion_tokens: 80, prompt_cache_hit_tokens: 0 },
};

const MOCK_SLEEP = jest.fn().mockResolvedValue();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ai-client', () => {
  beforeEach(() => MOCK_SLEEP.mockClear());

  // ─────────────────────────────────────────────────────────────────────────
  describe('Claude', () => {
    // ── 1. Text completion ────────────────────────────────────────────────
    describe('text completion', () => {
      test('sends POST to https://api.anthropic.com/v1/messages with correct headers', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'sk-ant-key', { _sleep: MOCK_SLEEP });
        await client.complete('sys', 'user');

        const [url, opts] = fetchFn.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(opts.method).toBe('POST');
        const headers = opts.headers;
        expect(headers['x-api-key']).toBe('sk-ant-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        expect(headers['content-type']).toBe('application/json');
      });

      test('system prompt in separate top-level field, user prompt in messages array', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'sk-ant-key', { _sleep: MOCK_SLEEP });
        await client.complete('My system prompt', 'My user prompt');

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.system).toBe('My system prompt');
        expect(body.messages).toEqual([{ role: 'user', content: 'My user prompt' }]);
        expect(body.messages).not.toContainEqual(expect.objectContaining({ role: 'system' }));
      });

      test('parses content[0].text into result.content', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.content).toBe('Response text here');
      });

      test('maps input_tokens → inputTokens, output_tokens → outputTokens', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.usage.inputTokens).toBe(100);
        expect(result.usage.outputTokens).toBe(50);
      });

      test('returns cached: false when no cache tokens present', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.cached).toBe(false);
      });
    });

    // ── 2. Prompt caching ─────────────────────────────────────────────────
    describe('prompt caching', () => {
      test('completeWithCache() includes cache_control: {type: "ephemeral"} in body', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await client.completeWithCache('s', 'u');

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.cache_control).toEqual({ type: 'ephemeral' });
      });

      test('complete() does NOT include cache_control', async () => {
        const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await client.complete('s', 'u');

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.cache_control).toBeUndefined();
      });

      test('cache hit: cached=true, cacheReadTokens populated', async () => {
        const resp = {
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000 },
        };
        const fetchFn = makeFetch(resp);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.cached).toBe(true);
        expect(result.usage.cacheReadTokens).toBe(2000);
      });

      test('cost calculation uses cache pricing', async () => {
        const resp = {
          content: [{ type: 'text', text: 'hi' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 2000,
            cache_creation_input_tokens: 500,
          },
        };
        const fetchFn = makeFetch(resp);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');

        const expected =
          (100 * 3 / 1e6) +
          (50 * 15 / 1e6) +
          (2000 * 0.30 / 1e6) +
          (500 * 3.75 / 1e6);
        expect(result.estimatedCost).toBeCloseTo(expected, 7);
      });
    });

    // ── 3. Tool Use ───────────────────────────────────────────────────────
    describe('Tool Use', () => {
      const tools = [{ name: 'extract_article', description: 'extract', input_schema: { type: 'object' } }];
      const toolChoice = { type: 'tool', name: 'extract_article' };

      test('includes tools and tool_choice in request body', async () => {
        const fetchFn = makeFetch(CLAUDE_TOOL_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await client.completeToolUse('s', 'u', tools, toolChoice);

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.tools).toEqual(tools);
        expect(body.tool_choice).toEqual(toolChoice);
      });

      test('extracts tool_use block into result.toolResult', async () => {
        const fetchFn = makeFetch(CLAUDE_TOOL_RESP);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.completeToolUse('s', 'u', tools, toolChoice);
        expect(result.toolResult).toEqual({ title: 'Test Title', body: 'Test body content' });
      });

      test('opts.cache: true adds cache_control; without opts.cache it is absent', async () => {
        const fetchFn1 = makeFetch(CLAUDE_TOOL_RESP);
        const client1 = createClaudeClient(fetchFn1, 'key', { _sleep: MOCK_SLEEP });
        await client1.completeToolUse('s', 'u', tools, toolChoice, { cache: true });
        const bodyWith = JSON.parse(fetchFn1.mock.calls[0][1].body);
        expect(bodyWith.cache_control).toEqual({ type: 'ephemeral' });

        const fetchFn2 = makeFetch(CLAUDE_TOOL_RESP);
        const client2 = createClaudeClient(fetchFn2, 'key', { _sleep: MOCK_SLEEP });
        await client2.completeToolUse('s', 'u', tools, toolChoice);
        const bodyWithout = JSON.parse(fetchFn2.mock.calls[0][1].body);
        expect(bodyWithout.cache_control).toBeUndefined();
      });

      test('text blocks before tool_use block still extract correctly', async () => {
        const resp = {
          content: [
            { type: 'text', text: 'thinking...' },
            { type: 'text', text: 'more thinking...' },
            { type: 'tool_use', id: 'x', name: 'fn', input: { key: 'val' } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
        const fetchFn = makeFetch(resp);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.completeToolUse('s', 'u', tools, toolChoice);
        expect(result.toolResult).toEqual({ key: 'val' });
      });

      test('no tool_use block (safety refusal) throws descriptive error with text content', async () => {
        const refusal = {
          content: [{ type: 'text', text: 'I cannot help with that request.' }],
          usage: { input_tokens: 50, output_tokens: 20 },
        };
        const fetchFn = makeFetch(refusal);
        const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await expect(client.completeToolUse('s', 'u', tools, toolChoice)).rejects.toThrow(
          /I cannot help with that request/,
        );
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('DeepSeek', () => {
    // ── 4. Text completion ────────────────────────────────────────────────
    describe('text completion', () => {
      test('sends POST to https://api.deepseek.com/chat/completions with Bearer header', async () => {
        const fetchFn = makeFetch(DS_TEXT_RESP);
        const client = createDeepSeekClient(fetchFn, 'sk-ds-key', { _sleep: MOCK_SLEEP });
        await client.complete('sys', 'user');

        const [url, opts] = fetchFn.mock.calls[0];
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect(opts.headers['Authorization']).toBe('Bearer sk-ds-key');
        expect(opts.headers['Content-Type']).toBe('application/json');
      });

      test('system prompt in messages array, no top-level system field', async () => {
        const fetchFn = makeFetch(DS_TEXT_RESP);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await client.complete('My sys', 'My user');

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.system).toBeUndefined();
        expect(body.messages[0]).toEqual({ role: 'system', content: 'My sys' });
        expect(body.messages[1]).toEqual({ role: 'user', content: 'My user' });
      });

      test('parses choices[0].message.content into result.content', async () => {
        const fetchFn = makeFetch(DS_TEXT_RESP);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.content).toBe('DeepSeek response text');
      });

      test('maps prompt_tokens → inputTokens, completion_tokens → outputTokens', async () => {
        const fetchFn = makeFetch(DS_TEXT_RESP);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.usage.inputTokens).toBe(200);
        expect(result.usage.outputTokens).toBe(80);
      });

      test('maps prompt_cache_hit_tokens → cacheReadTokens', async () => {
        const resp = {
          choices: [{ message: { content: 'hi' } }],
          usage: { prompt_tokens: 200, completion_tokens: 80, prompt_cache_hit_tokens: 150 },
        };
        const fetchFn = makeFetch(resp);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.usage.cacheReadTokens).toBe(150);
      });
    });

    // ── 5. JSON safety ────────────────────────────────────────────────────
    describe('JSON safety', () => {
      test('markdown-fenced JSON returned as-is (no stripping)', async () => {
        const fenced = '```json\n{"score":7}\n```';
        const resp = {
          choices: [{ message: { content: fenced } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
        const fetchFn = makeFetch(resp);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        const result = await client.complete('s', 'u');
        expect(result.content).toBe(fenced);
      });

      test('response_format option passed through to request body', async () => {
        const fetchFn = makeFetch(DS_TEXT_RESP);
        const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
        await client.complete('s', 'u', { response_format: { type: 'json_object' } });

        const body = JSON.parse(fetchFn.mock.calls[0][1].body);
        expect(body.response_format).toEqual({ type: 'json_object' });
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('retry logic', () => {
    test('429 triggers retry: fetchFn called twice, second call succeeds', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLAUDE_TEXT_RESP });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Response text here');
    });

    test('Claude 529 triggers retry', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 529, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLAUDE_TEXT_RESP });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    test('DeepSeek 503 triggers retry', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => DS_TEXT_RESP });
      const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    test('401 does NOT retry: throws immediately after 1 call', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await expect(client.complete('s', 'u')).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('400 does NOT retry: throws immediately after 1 call', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await expect(client.complete('s', 'u')).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('Claude max retries exceeded: 3 total attempts (2 retries), then throws', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await expect(client.complete('s', 'u')).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    test('DeepSeek max retries: 4 total attempts (3 retries), then throws', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
      const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await expect(client.complete('s', 'u')).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    test('DeepSeek succeeds on 4th call (3 retries) while Claude would fail', async () => {
      // DeepSeek: 429, 429, 429, 200 → success (4 calls)
      const dsFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => DS_TEXT_RESP });
      const dsClient = createDeepSeekClient(dsFetch, 'key', { _sleep: MOCK_SLEEP });
      const result = await dsClient.complete('s', 'u');
      expect(dsFetch).toHaveBeenCalledTimes(4);
      expect(result.content).toBe('DeepSeek response text');

      // Claude: 429, 429, 429, 200 → fails after 3 calls (2 retries)
      const claudeFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLAUDE_TEXT_RESP });
      const claudeClient = createClaudeClient(claudeFetch, 'key', { _sleep: MOCK_SLEEP });
      await expect(claudeClient.complete('s', 'u')).rejects.toThrow();
      expect(claudeFetch).toHaveBeenCalledTimes(3);
    });

    test('retry delays are applied (sleep called on retry) and include jitter', async () => {
      const sleepCalls = [];
      const trackingSleep = jest.fn().mockImplementation((ms) => {
        sleepCalls.push(ms);
        return Promise.resolve();
      });
      const fetchFn = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLAUDE_TEXT_RESP });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: trackingSleep });
      await client.complete('s', 'u');

      expect(sleepCalls).toHaveLength(2); // sleep called before retry 1 and retry 2
      // Each delay should be within [baseDelay, maxDelay * 2] range
      for (const delay of sleepCalls) {
        expect(delay).toBeGreaterThanOrEqual(500); // baseDelay
        expect(delay).toBeLessThanOrEqual(20000);  // maxDelay * 2 (with max jitter)
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('network errors', () => {
    test('network error (thrown) triggers retry: success on 2nd call', async () => {
      const fetchFn = jest.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => CLAUDE_TEXT_RESP });
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Response text here');
    });

    test('network error after max retries surfaces original error, not TypeError', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await expect(client.complete('s', 'u')).rejects.toThrow('ETIMEDOUT');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('cost logging', () => {
    let consoleSpy;
    beforeEach(() => { consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => consoleSpy.mockRestore());

    test('log format contains provider, model, token counts, and cost', async () => {
      const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');

      const logOutput = consoleSpy.mock.calls.find(
        (args) => String(args[0]).includes('[ai-client]'),
      )?.[0] || '';
      expect(logOutput).toContain('claude');
      expect(logOutput).toContain('sonnet');
      expect(logOutput).toContain('in:');
      expect(logOutput).toContain('out:');
      expect(logOutput).toContain('$');
    });

    test('Claude pricing: 1000 input + 500 output = $0.0105', async () => {
      const resp = {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1000, output_tokens: 500 },
      };
      const fetchFn = makeFetch(resp);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(result.estimatedCost).toBeCloseTo(0.0105, 6);
    });

    test('DeepSeek pricing: 1000 input + 500 output = $0.00082', async () => {
      const resp = {
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      };
      const fetchFn = makeFetch(resp);
      const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(result.estimatedCost).toBeCloseTo(0.00082, 7);
    });

    test('cache tokens appear in log as cache:Xr indicator', async () => {
      const resp = {
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 0,
        },
      };
      const fetchFn = makeFetch(resp);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');

      const logOutput = consoleSpy.mock.calls.find(
        (args) => String(args[0]).includes('[ai-client]'),
      )?.[0] || '';
      expect(logOutput).toContain('2000');
    });

    test('security: log does not contain API key, prompts, or response content', async () => {
      const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
      const client = createClaudeClient(fetchFn, 'super-secret-key-xyz', { _sleep: MOCK_SLEEP });
      await client.complete('my secret system prompt', 'my secret user prompt');

      const allLogs = consoleSpy.mock.calls.map((args) => String(args[0])).join(' ');
      expect(allLogs).not.toContain('super-secret-key-xyz');
      expect(allLogs).not.toContain('my secret system prompt');
      expect(allLogs).not.toContain('my secret user prompt');
      expect(allLogs).not.toContain('Response text here');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('factory functions', () => {
    test('createClaudeClient defaults: temperature=0.7, model starts with claude', async () => {
      const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.7);
      expect(body.model).toMatch(/^claude/);
    });

    test('createDeepSeekClient defaults: temperature=0.3, model=deepseek-chat', async () => {
      const fetchFn = makeFetch(DS_TEXT_RESP);
      const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u');

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.3);
      expect(body.model).toBe('deepseek-chat');
    });

    test('per-call opts override factory defaults', async () => {
      const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete('s', 'u', { temperature: 0.2, max_tokens: 1024 });

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.2);
      expect(body.max_tokens).toBe(1024);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    test('missing usage fields default to 0', async () => {
      const resp = {
        content: [{ type: 'text', text: 'hi' }],
        usage: {},
      };
      const fetchFn = makeFetch(resp);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.cacheReadTokens).toBe(0);
      expect(result.usage.cacheWriteTokens).toBe(0);
    });

    test('empty content array in Claude response returns empty string, no crash', async () => {
      const resp = { content: [], usage: {} };
      const fetchFn = makeFetch(resp);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      const result = await client.complete('s', 'u');
      expect(result.content).toBe('');
    });

    test('null system prompt: Claude omits system field', async () => {
      const fetchFn = makeFetch(CLAUDE_TEXT_RESP);
      const client = createClaudeClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete(null, 'user');

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.system).toBeUndefined();
    });

    test('null system prompt: DeepSeek omits system message', async () => {
      const fetchFn = makeFetch(DS_TEXT_RESP);
      const client = createDeepSeekClient(fetchFn, 'key', { _sleep: MOCK_SLEEP });
      await client.complete(null, 'user');

      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      const systemMessages = body.messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(0);
    });
  });
});
