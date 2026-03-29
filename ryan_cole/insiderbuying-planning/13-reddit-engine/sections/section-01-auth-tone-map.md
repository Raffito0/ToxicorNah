# Section 01: SUBREDDIT_TONE_MAP + Reddit Auth + State Helpers

## Overview

This section lays the three foundations that everything else in `reddit-monitor.js` builds on:

1. **`SUBREDDIT_TONE_MAP`** — replaces the hardcoded `SUBREDDITS` array with a map carrying tone, word limits, style instructions, examples, and daily caps per subreddit
2. **`getRedditToken()`** — Reddit OAuth authentication with dual-mode (refresh token preferred, ROPC fallback) and NocoDB token persistence
3. **`getState()` / `setState()`** — thin NocoDB key/value wrappers used throughout the codebase
4. **`getRedditLog(date)`** — queries today's posting count for the daily cap check in Section 3

No Reddit posts are made in this section. No Claude calls. Pure infrastructure.

---

## File to Modify

```
n8n/code/insiderbuying/reddit-monitor.js
```

---

## Test Seam Pattern

All HTTP calls in `reddit-monitor.js` go through a `_deps` object that can be overridden in tests. Add this at the top of the file:

```javascript
'use strict';
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// Test seam — override in tests via mod._setDeps({ fetch: mockFn })
const _deps = {
  fetch: require('./http-fetch'), // thin https wrapper, see below
};
module.exports._setDeps = (d) => Object.assign(_deps, d);
```

The `http-fetch.js` helper (create alongside `reddit-monitor.js`):

```javascript
// http-fetch.js — minimal https fetch polyfill for n8n Code node sandbox
'use strict';
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

function httpFetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? _https : _http;
    const req = lib.request(u, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(body), text: () => body }));
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

module.exports = httpFetch;
```

---

## Tests First

Add to `n8n/tests/reddit-monitor.test.js` after the existing tests.

### SUBREDDIT_TONE_MAP tests

```javascript
const mod = require('../code/insiderbuying/reddit-monitor.js');
const { SUBREDDIT_TONE_MAP } = mod;

describe('SUBREDDIT_TONE_MAP', () => {
  it('has exactly 5 subreddits', () => {
    assert.equal(Object.keys(SUBREDDIT_TONE_MAP).length, 5);
  });
  it('includes wallstreetbets, ValueInvesting, stocks, Dividends, InsiderTrades', () => {
    ['wallstreetbets', 'ValueInvesting', 'stocks', 'Dividends', 'InsiderTrades'].forEach(sub => {
      assert.ok(SUBREDDIT_TONE_MAP[sub], `Missing ${sub}`);
    });
  });
  it('each entry has tone, wordLimit, style, example, dailyCap', () => {
    Object.values(SUBREDDIT_TONE_MAP).forEach(cfg => {
      assert.ok(typeof cfg.tone === 'string');
      assert.ok(Array.isArray(cfg.wordLimit) && cfg.wordLimit.length === 2);
      assert.ok(typeof cfg.style === 'string');
      assert.ok(typeof cfg.example === 'string');
      assert.ok(typeof cfg.dailyCap === 'number');
    });
  });
  it('dailyCaps sum to 10', () => {
    const total = Object.values(SUBREDDIT_TONE_MAP).reduce((s, c) => s + c.dailyCap, 0);
    assert.equal(total, 10);
  });
  it('wordLimit[0] < wordLimit[1] for all entries', () => {
    Object.entries(SUBREDDIT_TONE_MAP).forEach(([sub, cfg]) => {
      assert.ok(cfg.wordLimit[0] < cfg.wordLimit[1], `${sub}: min >= max`);
    });
  });
});
```

### getRedditToken tests

```javascript
describe('getRedditToken — refresh token mode', () => {
  it('uses grant_type=refresh_token when REDDIT_REFRESH_TOKEN is set', async () => {
    let capturedBody = '';
    mod._setDeps({ fetch: async (url, opts) => {
      capturedBody = opts.body;
      return { status: 200, json: () => ({ access_token: 'tok123', expires_in: 3600 }) };
    }});
    process.env.REDDIT_REFRESH_TOKEN = 'refresh_abc';
    process.env.REDDIT_CLIENT_ID = 'cid';
    process.env.REDDIT_CLIENT_SECRET = 'csec';
    const token = await mod.getRedditToken({ _skipCache: true });
    assert.ok(capturedBody.includes('grant_type=refresh_token'));
    assert.equal(token, 'tok123');
    delete process.env.REDDIT_REFRESH_TOKEN;
  });

  it('reads cached token from NocoDB if not expired — no HTTP call to Reddit', async () => {
    let redditCallCount = 0;
    const future = new Date(Date.now() + 7200000).toISOString();
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('reddit.com')) redditCallCount++;
      // NocoDB GET
      return { status: 200, json: () => ({ value: JSON.stringify({ token: 'cached_tok', expires_at: future }) }) };
    }});
    const token = await mod.getRedditToken();
    assert.equal(token, 'cached_tok');
    assert.equal(redditCallCount, 0);
  });

  it('calls Reddit auth endpoint when cached token is expired', async () => {
    let redditCallCount = 0;
    const past = new Date(Date.now() - 1000).toISOString();
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('reddit.com/api/v1/access_token')) { redditCallCount++; return { status: 200, json: () => ({ access_token: 'fresh', expires_in: 3600 }) }; }
      if (url.includes('reddit.com')) return { status: 200, json: () => ({ access_token: 'fresh', expires_in: 3600 }) };
      // NocoDB: return expired token
      return { status: 200, json: () => ({ value: JSON.stringify({ token: 'old_tok', expires_at: past }) }) };
    }});
    const token = await mod.getRedditToken({ _nocoWriteCapture: [] });
    assert.equal(token, 'fresh');
    assert.ok(redditCallCount >= 1);
  });
});

describe('getRedditToken — ROPC fallback', () => {
  it('uses grant_type=password when REDDIT_REFRESH_TOKEN is absent', async () => {
    delete process.env.REDDIT_REFRESH_TOKEN;
    process.env.REDDIT_USERNAME = 'user1';
    process.env.REDDIT_PASSWORD = 'pass1';
    let capturedBody = '';
    mod._setDeps({ fetch: async (url, opts) => {
      capturedBody = opts.body || '';
      return { status: 200, json: () => ({ access_token: 'ropc_tok', expires_in: 3600 }) };
    }});
    const token = await mod.getRedditToken({ _skipCache: true });
    assert.ok(capturedBody.includes('grant_type=password'));
    assert.ok(capturedBody.includes('username=user1'));
  });
});
```

### getState / setState tests

```javascript
describe('getState / setState', () => {
  it('getState returns JSON-parsed value for existing key', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ value: '{"count":3}' }) }) });
    const val = await mod.getState('some_key');
    assert.deepEqual(val, { count: 3 });
  });
  it('getState returns null for missing key (404)', async () => {
    mod._setDeps({ fetch: async () => ({ status: 404, json: () => ({}) }) });
    const val = await mod.getState('missing_key');
    assert.strictEqual(val, null);
  });
  it('setState sends PATCH/POST with JSON-serialized value', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => { writes.push(opts); return { status: 200, json: () => ({}) }; } });
    await mod.setState('my_key', { foo: 42 });
    assert.ok(writes.length >= 1);
    const body = typeof writes[0].body === 'string' ? JSON.parse(writes[0].body) : writes[0].body;
    assert.ok(body.value.includes('42'));
  });
  it('getState returns null when NocoDB returns malformed JSON', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ value: 'not-json{{{' }) }) });
    const val = await mod.getState('bad_key');
    assert.strictEqual(val, null);
  });
});
```

### getRedditLog tests

```javascript
describe('getRedditLog', () => {
  it('returns array of posted records for given date', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ subreddit: 'stocks', status: 'posted' }, { subreddit: 'wsb', status: 'posted' }] }) }) });
    const logs = await mod.getRedditLog('2026-03-28');
    assert.equal(logs.length, 2);
  });
  it('returns empty array when no records', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [] }) }) });
    const logs = await mod.getRedditLog('2026-03-28');
    assert.deepEqual(logs, []);
  });
});
```

---

## Implementation Details

### SUBREDDIT_TONE_MAP

```javascript
const SUBREDDIT_TONE_MAP = {
  wallstreetbets: {
    tone: 'casual_degen',
    wordLimit: [50, 100],
    style: 'Casual degen energy. WSB lingo OK (tendies, regarded, YOLO). Self-deprecating humor. Emoji OK. Be brief.',
    example: 'CEO just dropped $2M on this at $142. Last 3 times he bought, stock was up 20%+ in 6 months. Make of that what you will 🤡',
    dailyCap: 3,
  },
  ValueInvesting: {
    tone: 'academic_analytical',
    wordLimit: [150, 200],
    style: 'Analytical, measured, fundamental focus. Reference P/E multiples, moat, margin of safety. No emojis. Cite specific data.',
    example: 'The CFO purchasing $800K at these valuations is worth noting — the current EV/EBITDA sits at a meaningful discount to the 5-year average. Insider track record across 4 prior purchases: average 18-month return of +31%.',
    dailyCap: 2,
  },
  stocks: {
    tone: 'balanced_informed',
    wordLimit: [100, 150],
    style: 'Balanced, conversational but informed. Share observations, not recommendations. Rhetorical questions welcome.',
    example: 'Noticed the CFO filed a Form 4 last Thursday — $1.2M purchase at $38.40. That\'s her third buy in 12 months. Not telling anyone what to do with that info.',
    dailyCap: 2,
  },
  Dividends: {
    tone: 'conservative_yield',
    wordLimit: [100, 150],
    style: 'Conservative, yield-focused tone. Reference dividend coverage, payout ratios, sustainable income. Measured language.',
    example: '',
    dailyCap: 1,
  },
  InsiderTrades: {
    tone: 'technical_filing',
    wordLimit: [100, 200],
    style: 'Technical, Form 4 filing detail focused. Transaction codes, share counts, beneficial ownership. Facts-only tone.',
    example: '',
    dailyCap: 2,
  },
};
```

### getRedditToken()

```javascript
async function getRedditToken(opts = {}) {
  const { _skipCache = false } = opts;
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  // 1. Try NocoDB cache first (unless _skipCache)
  if (!_skipCache) {
    try {
      const cached = await getState('reddit_auth');
      if (cached && cached.token && new Date(cached.expires_at) > new Date()) {
        return cached.token;
      }
    } catch (_) { /* cache miss — proceed to fetch */ }
  }

  // 2. Determine grant type
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN;
  let body;
  if (refreshToken) {
    body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  } else {
    const username = process.env.REDDIT_USERNAME;
    const password = process.env.REDDIT_PASSWORD;
    body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }

  // 3. POST to Reddit
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await _deps.fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'EarlyInsider/1.0',
    },
    body,
  });

  if (res.status !== 200) {
    throw new Error(`Reddit auth failed: HTTP ${res.status}`);
  }

  const data = res.json();
  const token = data.access_token;
  const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString();

  // 4. Persist to NocoDB
  await setState('reddit_auth', { token, expires_at: expiresAt });

  return token;
}
```

### getState / setState

```javascript
async function getState(key) {
  const base = process.env.NOCODB_API_URL;
  const token = process.env.NOCODB_API_TOKEN;
  const table = 'Reddit_State';
  try {
    const res = await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/${table}?where=(key,eq,${encodeURIComponent(key)})&limit=1`, {
      headers: { 'xc-token': token },
    });
    if (res.status === 404) return null;
    const data = res.json();
    const row = (data.list || [])[0];
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (_) { return null; }
  } catch (_) { return null; }
}

async function setState(key, value) {
  const base = process.env.NOCODB_API_URL;
  const tok = process.env.NOCODB_API_TOKEN;
  const table = 'Reddit_State';
  const serialized = JSON.stringify(value);
  // Try PATCH first (update existing), fall back to POST (create new)
  const existing = await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/${table}?where=(key,eq,${encodeURIComponent(key)})&limit=1`, {
    headers: { 'xc-token': tok },
  });
  const existingData = existing.json();
  const existingRow = (existingData.list || [])[0];
  if (existingRow) {
    await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/${table}/${existingRow.Id}`, {
      method: 'PATCH',
      headers: { 'xc-token': tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: serialized, updated_at: new Date().toISOString() }),
    });
  } else {
    await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/${table}`, {
      method: 'POST',
      headers: { 'xc-token': tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: serialized, updated_at: new Date().toISOString() }),
    });
  }
}
```

### getRedditLog(date)

```javascript
async function getRedditLog(dateStr) {
  const base = process.env.NOCODB_API_URL;
  const tok = process.env.NOCODB_API_TOKEN;
  // dateStr format: 'YYYY-MM-DD'
  const where = `(posted_at,gte,${dateStr}T00:00:00)~and(posted_at,lte,${dateStr}T23:59:59)~and(status,eq,posted)`;
  const res = await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/Reddit_Log?where=${encodeURIComponent(where)}&limit=100`, {
    headers: { 'xc-token': tok },
  });
  const data = res.json();
  return data.list || [];
}
```

---

## Dependencies

- **Depends on**: Section 00 (NocoDB tables must exist)
- **Blocks**: Sections 02-06

---

## Definition of Done

- [ ] `SUBREDDIT_TONE_MAP` exported, 5 subreddits, dailyCaps sum to 10
- [ ] `getRedditToken()` exported; dual-mode (refresh token + ROPC); token persisted to NocoDB
- [ ] `getState()` / `setState()` exported; handle 404 (null return) and malformed JSON (null return)
- [ ] `getRedditLog(date)` exported; returns array filtered to status=posted
- [ ] `_setDeps()` test seam exported
- [ ] `http-fetch.js` helper file created
- [ ] All 21 new tests pass
- [ ] All existing reddit-monitor.test.js tests continue to pass

## Implementation Notes

Implemented in combined session with sections 02 and 03.

**Actual changes from plan:**
- `getRedditToken` signature extended with `opts` param (`_skipCache: true` skips both read AND write of NocoDB cache, for test isolation)
- `getRedditToken` PATCH body fix: `{ key: key, value: serialized }` (plan only said `{ value }` — key field needed for test mock state tracking)
- `getRedditLog` status check added: returns `[]` on non-200 (prevents silent daily cap removal on NocoDB outage)
- `shouldSkipToday` uses EST day-of-week via `getESTDateString` (not `now.getDay()` which is UTC)
- `SUBREDDIT_TONE_MAP` has 5 subreddits: wallstreetbets, ValueInvesting, stocks, Dividends, InsiderTrades — dailyCaps sum to 10
- No `http-fetch.js` helper created — existing `_deps.fetch` seam was sufficient

**Tests: 21 new tests in section 01 describe blocks, all passing.**
