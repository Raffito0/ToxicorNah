'use strict';

const {
  makeFetch,
  makeRouter,
  makeFetchSeq,
  makeNoSleep,
  expectFetchCalledTimes,
  BASE_ENV,
} = require('./helpers');

// ---------------------------------------------------------------------------
// makeFetch
// ---------------------------------------------------------------------------
describe('makeFetch', () => {
  test('returns correct default shape (ok=true, status=200)', async () => {
    const fn = makeFetch({ hello: 'world' });
    const res = await fn('https://example.com');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  test('makeFetch(body, false, 422) — ok===false, status===422', async () => {
    const fn = makeFetch({ error: 'bad' }, false, 422);
    const res = await fn('https://example.com');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
  });

  test('json() resolves to body', async () => {
    const body = { foo: 'bar', count: 42 };
    const fn = makeFetch(body);
    const res = await fn('https://example.com');
    expect(await res.json()).toEqual(body);
  });

  test('text() resolves to JSON.stringify(body)', async () => {
    const body = { x: 1 };
    const fn = makeFetch(body);
    const res = await fn('https://example.com');
    expect(await res.text()).toBe(JSON.stringify(body));
  });

  test('headers.get(any-key) returns null', async () => {
    const fn = makeFetch({});
    const res = await fn('https://example.com');
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.headers.get('x-custom')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeRouter
// ---------------------------------------------------------------------------
describe('makeRouter', () => {
  const scoreBody = { score: 9 };
  const userBody = { data: [{ id: 'u1' }] };

  test('returns matching route for anthropic.com URL', async () => {
    const router = makeRouter({ 'anthropic.com': scoreBody, 'supabase.co': userBody });
    const res = await router('https://api.anthropic.com/v1/messages');
    expect(await res.json()).toEqual(scoreBody);
  });

  test('returns matching route for supabase.co URL', async () => {
    const router = makeRouter({ 'anthropic.com': scoreBody, 'supabase.co': userBody });
    const res = await router('https://test.supabase.co/rest/v1/users');
    expect(await res.json()).toEqual(userBody);
  });

  test('throws for unmatched URL with descriptive message', () => {
    const router = makeRouter({ 'anthropic.com': scoreBody });
    expect(() => router('https://unknown-host.example.com/api')).toThrow(
      /makeRouter: no route matched URL.*unknown-host.*Known routes: anthropic.com/
    );
  });

  test('result is a jest.fn() — tracks calls', async () => {
    const router = makeRouter({ 'anthropic.com': scoreBody });
    await router('https://api.anthropic.com/v1/messages');
    await router('https://api.anthropic.com/v1/messages');
    expect(router.mock.calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// makeFetchSeq
// ---------------------------------------------------------------------------
describe('makeFetchSeq', () => {
  test('first call resolves to first body', async () => {
    const fn = makeFetchSeq({ step: 1 }, { step: 2 });
    const res = await fn();
    expect(await res.json()).toEqual({ step: 1 });
  });

  test('second call resolves to second body', async () => {
    const fn = makeFetchSeq({ step: 1 }, { step: 2 });
    await fn();
    const res = await fn();
    expect(await res.json()).toEqual({ step: 2 });
  });

  test('extra call throws Unexpected extra fetch call', async () => {
    const fn = makeFetchSeq({ only: true });
    await fn();
    await expect(fn()).rejects.toThrow('Unexpected extra fetch call');
  });
});

// ---------------------------------------------------------------------------
// expectFetchCalledTimes
// ---------------------------------------------------------------------------
describe('expectFetchCalledTimes', () => {
  test('passes when mock called exactly N times', () => {
    const mock = jest.fn();
    mock(); mock(); mock();
    expect(() => expectFetchCalledTimes(mock, 3)).not.toThrow();
  });

  test('throws descriptive error when count does not match', () => {
    const mock = jest.fn();
    mock();
    expect(() => expectFetchCalledTimes(mock, 3, 'scoreStep')).toThrow(
      /\[scoreStep\].*expected fetchFn to be called 3 times but was called 1 time\(s\)/
    );
  });
});

// ---------------------------------------------------------------------------
// BASE_ENV
// ---------------------------------------------------------------------------
describe('BASE_ENV', () => {
  test('is frozen — mutating a key throws TypeError', () => {
    expect(() => { BASE_ENV.ANTHROPIC_API_KEY = 'hacked'; }).toThrow(TypeError);
  });

  test('contains all required environment variable keys', () => {
    const required = [
      'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY',
      'RESEND_API_KEY', 'ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY',
      'BEEHIIV_API_KEY', 'BEEHIIV_PUBLICATION_ID',
      'NOCODB_BASE_URL', 'NOCODB_API_TOKEN',
      'X_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
      'FAL_API_KEY', 'DOMAIN_SETUP_DATE',
    ];
    for (const key of required) {
      expect(BASE_ENV).toHaveProperty(key);
      expect(typeof BASE_ENV[key]).toBe('string');
      expect(BASE_ENV[key].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// makeNoSleep
// ---------------------------------------------------------------------------
describe('makeNoSleep', () => {
  test('returns a Promise', () => {
    const noSleep = makeNoSleep();
    expect(noSleep()).toBeInstanceOf(Promise);
  });

  test('resolves without error', async () => {
    const noSleep = makeNoSleep();
    await expect(noSleep()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture shape tests
// ---------------------------------------------------------------------------
describe('fixtures', () => {
  const edgar = require('./fixtures/edgar-rss-response.json');
  const score = require('./fixtures/claude-score-response.json');
  const analysis = require('./fixtures/claude-analysis-response.json');
  const outline = require('./fixtures/claude-article-outline.json');

  test('edgar-rss-response.json has required fields', () => {
    expect(edgar).toHaveProperty('ticker');
    expect(edgar).toHaveProperty('company_name');
    expect(edgar).toHaveProperty('insider_name');
    expect(edgar).toHaveProperty('insider_title');
    expect(edgar).toHaveProperty('transaction_type');
    expect(edgar).toHaveProperty('shares');
    expect(edgar).toHaveProperty('price_per_share');
    expect(edgar).toHaveProperty('total_value');
    expect(edgar).toHaveProperty('filing_date');
    expect(edgar).toHaveProperty('cik');
  });

  test('claude-score-response.json has Anthropic envelope with parseable score', () => {
    expect(typeof score.id).toBe('string');
    expect(typeof score.model).toBe('string');
    expect(typeof score.usage.input_tokens).toBe('number');
    expect(typeof score.usage.output_tokens).toBe('number');
    const parsed = JSON.parse(score.content[0].text);
    expect(typeof parsed.score).toBe('number');
    expect(typeof parsed.reasoning).toBe('string');
  });

  test('claude-analysis-response.json has Anthropic envelope with 150+ words and keywords', () => {
    expect(typeof analysis.id).toBe('string');
    expect(typeof analysis.model).toBe('string');
    expect(typeof analysis.usage.input_tokens).toBe('number');
    expect(typeof analysis.usage.output_tokens).toBe('number');
    const text = analysis.content[0].text;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(150);
    expect(text).toMatch(/bought|purchased/i);
    expect(text).toMatch(/last time|previous|track record/i);
    expect(text).toMatch(/earnings|watch|catalyst/i);
  });

  test('claude-article-outline.json has tool_use content with non-null input', () => {
    expect(outline.content[0].type).toBe('tool_use');
    expect(outline.content[0].input).not.toBeNull();
    expect(typeof outline.content[0].input).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// setup.js environment (global fetch trap + fake timers)
// ---------------------------------------------------------------------------
describe('setup.js environment', () => {
  test('global.fetch throws Unexpected real fetch error', () => {
    expect(() => global.fetch('https://example.com')).toThrow(
      'Unexpected real fetch — use opts.fetchFn'
    );
  });

  test('Date.now() equals 2026-03-01T12:00:00Z epoch', () => {
    const expected = new Date('2026-03-01T12:00:00Z').getTime();
    expect(Date.now()).toBe(expected);
  });

  test('fake timers are active', () => {
    // jest.getRealSystemTime would differ from Date.now() if fake timers are active
    // We verify by checking Date.now() is our fixed value (2026-03-01), not real time
    const now = Date.now();
    const expected = new Date('2026-03-01T12:00:00Z').getTime();
    expect(now).toBe(expected);
  });
});
