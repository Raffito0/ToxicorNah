'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { claude, deepseek } = require('../code/insiderbuying/ai-client.js');

// Fast no-op sleep for tests
const noSleep = () => Promise.resolve();

function makeClaudeResponse(text) {
  return {
    content: [{ type: 'text', text: text }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function makeDeepSeekResponse(text) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

function mockFetch(status, bodyFn) {
  return async () => ({
    ok: status === 200,
    status: status,
    json: async () => bodyFn(),
    headers: { get: () => null },
  });
}

// ---------------------------------------------------------------------------
// claude() - happy path and API key
// ---------------------------------------------------------------------------
describe('claude() - happy path', () => {
  it('returns text from Anthropic-shaped response', async () => {
    const fetchFn = mockFetch(200, () => makeClaudeResponse('hello world'));
    const result = await claude('test prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(result, 'hello world');
  });

  it('reads API key from helpers.anthropicApiKey', async () => {
    let capturedHeaders;
    const fetchFn = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', {}, { fetchFn, anthropicApiKey: 'my-special-key', _sleep: noSleep });
    assert.equal(capturedHeaders['x-api-key'], 'my-special-key');
  });

  it('forwards opts.maxTokens to request body', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', { maxTokens: 150 }, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.max_tokens, 150);
  });

  it('uses default maxTokens 300 when omitted', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.max_tokens, 300);
  });

  it('sends to correct Anthropic endpoint', async () => {
    let capturedUrl;
    const fetchFn = async (url, opts) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
  });

  it('uses claude-haiku-20240307 model', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.model, 'claude-haiku-20240307');
  });

  it('includes systemPrompt in request body when provided', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeClaudeResponse('ok'), headers: { get: () => null } };
    };
    await claude('prompt', { systemPrompt: 'be helpful' }, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.system, 'be helpful');
  });
});

// ---------------------------------------------------------------------------
// claude() - retry behavior
// ---------------------------------------------------------------------------
describe('claude() - retry behavior', () => {
  it('retries on 429 and succeeds on second call', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, json: async () => ({}), headers: { get: () => null } };
      }
      return { ok: true, status: 200, json: async () => makeClaudeResponse('retried'), headers: { get: () => null } };
    };
    const result = await claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep });
    assert.equal(result, 'retried');
    assert.equal(callCount, 2);
  });

  it('throws after 3 failures (HTTP 500)', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
    };
    await assert.rejects(
      () => claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(callCount, 3);
        return true;
      }
    );
  });

  it('error does not contain API key or helpers object', async () => {
    const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({}), headers: { get: () => null } });
    await assert.rejects(
      () => claude('prompt', {}, { fetchFn, anthropicApiKey: 'SECRET-API-KEY-99', _sleep: noSleep }),
      (err) => {
        assert.ok(!err.message.includes('SECRET-API-KEY-99'));
        return true;
      }
    );
  });

  it('throws immediately on 401 (not retried)', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } };
    };
    await assert.rejects(
      () => claude('prompt', {}, { fetchFn, anthropicApiKey: 'k', _sleep: noSleep }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(callCount, 1);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// deepseek() - happy path
// ---------------------------------------------------------------------------
describe('deepseek() - happy path', () => {
  it('returns text from DeepSeek response', async () => {
    const fetchFn = mockFetch(200, () => makeDeepSeekResponse('ds response'));
    const result = await deepseek('test prompt', {}, { fetchFn, deepseekApiKey: 'ds-key', _sleep: noSleep });
    assert.equal(result, 'ds response');
  });

  it('retries on 503 and succeeds on second call', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } };
      return { ok: true, status: 200, json: async () => makeDeepSeekResponse('recovered'), headers: { get: () => null } };
    };
    const result = await deepseek('p', {}, { fetchFn, deepseekApiKey: 'k', _sleep: noSleep });
    assert.equal(result, 'recovered');
  });

  it('uses correct DeepSeek endpoint', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => makeDeepSeekResponse('ok'), headers: { get: () => null } };
    };
    await deepseek('p', {}, { fetchFn, deepseekApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedUrl, 'https://api.deepseek.com/chat/completions');
  });

  it('uses deepseek-chat model name', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeDeepSeekResponse('ok'), headers: { get: () => null } };
    };
    await deepseek('p', {}, { fetchFn, deepseekApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.model, 'deepseek-chat');
  });
});

// ---------------------------------------------------------------------------
// deepseek() - maxTokens
// ---------------------------------------------------------------------------
describe('deepseek() - maxTokens', () => {
  it('forwards opts.maxTokens to request body', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeDeepSeekResponse('ok'), headers: { get: () => null } };
    };
    await deepseek('p', { maxTokens: 400 }, { fetchFn, deepseekApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.max_tokens, 400);
  });

  it('uses default maxTokens 400 when omitted', async () => {
    let capturedBody;
    const fetchFn = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => makeDeepSeekResponse('ok'), headers: { get: () => null } };
    };
    await deepseek('p', {}, { fetchFn, deepseekApiKey: 'k', _sleep: noSleep });
    assert.equal(capturedBody.max_tokens, 400);
  });
});
