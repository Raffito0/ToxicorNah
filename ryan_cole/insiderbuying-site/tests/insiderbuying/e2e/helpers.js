'use strict';

const edgarFixture = require('./fixtures/edgar-rss-response.json');
const scoreFixture = require('./fixtures/claude-score-response.json');
const analysisFixture = require('./fixtures/claude-analysis-response.json');

// ---------------------------------------------------------------------------
// makeFetch(body, ok = true, status = 200)
// ---------------------------------------------------------------------------
// Returns a jest.fn() that always resolves to a Response-like object.
function makeFetch(body, ok = true, status = 200) {
  const response = {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (_key) => null },
  };
  return jest.fn().mockResolvedValue(response);
}

// ---------------------------------------------------------------------------
// makeRouter(routes)
// ---------------------------------------------------------------------------
// routes: plain object mapping URL substring -> response body.
// Returns a jest.fn(url, opts) that returns makeFetch(routes[key]) for the
// first matching key, or throws if no key matches.
function makeRouter(routes) {
  const fn = jest.fn((url, _opts) => {
    const keys = Object.keys(routes);
    for (const key of keys) {
      if (String(url).includes(key)) {
        const body = routes[key];
        const response = {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: { get: (_k) => null },
        };
        return Promise.resolve(response);
      }
    }
    throw new Error(
      `makeRouter: no route matched URL "${url}". Known routes: ${keys.join(', ')}`
    );
  });
  return fn;
}

// ---------------------------------------------------------------------------
// makeFetchSeq(...bodies)
// ---------------------------------------------------------------------------
// Returns a jest.fn() that returns each body once in order.
// After all bodies are consumed, throws "Unexpected extra fetch call".
function makeFetchSeq(...bodies) {
  const fn = jest.fn().mockImplementation(() => {
    return Promise.reject(new Error('Unexpected extra fetch call — add another response to makeFetchSeq'));
  });
  for (const body of bodies) {
    const response = {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: { get: (_k) => null },
    };
    fn.mockResolvedValueOnce(response);
  }
  return fn;
}

// ---------------------------------------------------------------------------
// makeNoSleep
// ---------------------------------------------------------------------------
// Factory that returns a fresh jest.fn() resolving to undefined.
// Create one instance per test/beforeEach to prevent call-count accumulation
// across test files (module-level singletons are not cleared by clearMocks: true
// in the e2e project because they live outside Jest's mock registry).
function makeNoSleep() {
  return jest.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// expectFetchCalledTimes(mockFn, n, label = '')
// ---------------------------------------------------------------------------
// Assertion helper. Throws a descriptive error if call count !== n.
function expectFetchCalledTimes(mockFn, n, label = '') {
  const actual = mockFn.mock.calls.length;
  if (actual !== n) {
    const prefix = label ? `[${label}] ` : '';
    throw new Error(
      `${prefix}expected fetchFn to be called ${n} times but was called ${actual} time(s)`
    );
  }
}

// ---------------------------------------------------------------------------
// BASE_ENV
// ---------------------------------------------------------------------------
// Frozen object with all env vars required by any pipeline chain.
// DOMAIN_SETUP_DATE is 90 days before 2026-03-01 = 2025-12-02 (mature domain).
const BASE_ENV = Object.freeze({
  ANTHROPIC_API_KEY: 'test-anthropic-key-000',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_KEY: 'test-supabase-key-000',
  RESEND_API_KEY: 'test-resend-key-000',
  ONESIGNAL_APP_ID: 'test-onesignal-app-000',
  ONESIGNAL_REST_API_KEY: 'test-onesignal-key-000',
  BEEHIIV_API_KEY: 'test-beehiiv-key-000',
  BEEHIIV_PUBLICATION_ID: 'pub_test_000',
  NOCODB_BASE_URL: 'https://test-nocodb.example.com',
  NOCODB_API_KEY: 'test-nocodb-key-000',
  NOCODB_API_TOKEN: 'test-nocodb-token-000',
  NOCODB_PROJECT_ID: 'test-nocodb-project-000',
  NOCODB_API_URL: 'https://test-nocodb.example.com/api/v1',
  FINNHUB_API_KEY: 'test-finnhub-key-000',
  R2_ACCOUNT_ID: 'test-r2-account-000',
  R2_ACCESS_KEY_ID: 'test-r2-access-000',
  R2_SECRET_ACCESS_KEY: 'test-r2-secret-000',
  R2_PUBLIC_URL: 'https://test-r2.example.com',
  X_API_KEY: 'test-x-api-key-000',
  X_API_SECRET: 'test-x-api-secret-000',
  X_ACCESS_TOKEN: 'test-x-access-token-000',
  X_ACCESS_SECRET: 'test-x-access-secret-000',
  TELEGRAM_BOT_TOKEN: 'test-telegram-bot-000',
  TELEGRAM_CHAT_ID: '-100000000000',
  FAL_API_KEY: 'test-fal-key-000',
  DOMAIN_SETUP_DATE: '2025-12-02',
});

// ---------------------------------------------------------------------------
// Named mock response objects (pre-built with makeFetch)
// ---------------------------------------------------------------------------
const MOCK_EDGAR_RSS = makeFetch(edgarFixture);
const MOCK_SCORE_RESPONSE = makeFetch(scoreFixture);
const MOCK_ANALYSIS_RESPONSE = makeFetch(analysisFixture);
const MOCK_SUPABASE_EMPTY = makeFetch({ data: [], count: 0 });
const MOCK_SUPABASE_USERS = makeFetch({ data: [{ id: 'u1', email: 'test@example.com' }], count: 1 });
const MOCK_RESEND_OK = makeFetch({ id: 'resend-msg-id-001' });
const MOCK_ONESIGNAL_OK = makeFetch({ id: 'onesignal-notif-id-001', recipients: 1 });
const MOCK_AIRTABLE_RECORD = makeFetch({ id: 'rec_test_001', fields: {} });

module.exports = {
  makeFetch,
  makeRouter,
  makeFetchSeq,
  makeNoSleep,
  expectFetchCalledTimes,
  BASE_ENV,
  MOCK_EDGAR_RSS,
  MOCK_SCORE_RESPONSE,
  MOCK_ANALYSIS_RESPONSE,
  MOCK_SUPABASE_EMPTY,
  MOCK_SUPABASE_USERS,
  MOCK_RESEND_OK,
  MOCK_ONESIGNAL_OK,
  MOCK_AIRTABLE_RECORD,
};
