'use strict';

jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
  uploadToR2: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/logos/nvidia.com_123.png'),
}));

const { uploadToR2 } = require('../../n8n/code/insiderbuying/render-pdf');
const { getCompanyLogo, prefetchLogos } = require('../../n8n/code/insiderbuying/identity-assets');

const PNG_BUFFER = Buffer.alloc(100);
const LARGE_BUFFER = Buffer.alloc(600 * 1024); // > 500KB

const ENV = {
  NOCODB_API_URL: 'http://nocodb.test',
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_LOGO_TABLE_ID: 'tbl_logos_test',
  SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456',
};

function makeHelpers(fetchMocks) {
  const fetchFn = jest.fn();
  let idx = 0;
  fetchMocks.forEach(m => {
    if (typeof m === 'function') {
      fetchFn.mockImplementationOnce(m);
    } else {
      fetchFn.mockResolvedValueOnce(m);
    }
  });
  return { fetchFn, env: ENV, _sleep: jest.fn() };
}

function nocoCacheMiss() {
  return { ok: true, json: async () => ({ list: [] }) };
}

function nocoCacheHit(domain, logo_url, ttl_seconds = 2592000) {
  const fetched_at = new Date(Date.now() - 1000).toISOString(); // 1 second ago
  return {
    ok: true,
    json: async () => ({ list: [{ Id: 42, domain, logo_url, source: 'brandfetch', fetched_at, ttl_seconds }] }),
  };
}

function nocoCacheExpired(domain, logo_url) {
  const fetched_at = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
  return {
    ok: true,
    json: async () => ({ list: [{ Id: 42, domain, logo_url, source: 'brandfetch', fetched_at, ttl_seconds: 2592000 }] }),
  };
}

function brandfetchHit(contentType = 'image/png', bufferSize = 100) {
  const buf = Buffer.alloc(bufferSize);
  return {
    status: 200,
    headers: { get: (h) => h === 'content-type' ? contentType : (h === 'content-length' ? String(bufferSize) : null) },
    buffer: async () => buf,
  };
}

function brandfetch404() {
  return { status: 404, headers: { get: () => null }, buffer: async () => Buffer.alloc(0) };
}

function nocoDone() {
  return { ok: true, json: async () => ({ Id: 99 }) };
}

function screenshotResponse() {
  return {
    ok: true,
    headers: { get: () => 'image/png' },
    buffer: async () => PNG_BUFFER,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  uploadToR2.mockResolvedValue('https://pub.r2.dev/earlyinsider/logos/nvidia.com_123.png');
});

// ─── Cache hit ────────────────────────────────────────────────────────────────

describe('getCompanyLogo — cache hit', () => {
  test('returns cached URL without calling Brandfetch', async () => {
    const helpers = makeHelpers([
      nocoCacheHit('nvidia.com', 'https://r2.dev/logos/nvidia.png'),
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toBe('https://r2.dev/logos/nvidia.png');
    expect(helpers.fetchFn).toHaveBeenCalledTimes(1); // only NocoDB GET
  });
});

// ─── Cache miss + Brandfetch hit ──────────────────────────────────────────────

describe('getCompanyLogo — Brandfetch PNG hit', () => {
  test('uploads PNG to R2, caches, returns R2 URL', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),                        // initial cache check
      brandfetchHit('image/png'),             // Brandfetch hit
      nocoCacheMiss(),                        // _cacheSet existence check
      nocoDone(),                             // NocoDB POST
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('r2');
    expect(uploadToR2).toHaveBeenCalled();
  });

  test('NocoDB POST called to cache logo', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),
      brandfetchHit('image/png'),
      nocoCacheMiss(),
      nocoDone(),
    ]);
    await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    // 4 calls: cache miss, brandfetch, cacheSet-miss, POST
    expect(helpers.fetchFn).toHaveBeenCalledTimes(4);
  });
});

// ─── Cache miss + Brandfetch SVG ──────────────────────────────────────────────

describe('getCompanyLogo — Brandfetch SVG', () => {
  test('rasterizes SVG via screenshot server then uploads PNG', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),
      brandfetchHit('image/svg+xml'),
      screenshotResponse(),
      nocoCacheMiss(),
      nocoDone(),
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('r2');
    expect(uploadToR2).toHaveBeenCalled();
    // Should have called screenshot server
    const calls = helpers.fetchFn.mock.calls.map(c => c[0]);
    expect(calls.some(u => u.includes('/screenshot'))).toBe(true);
  });
});

// ─── Brandfetch failures → UI Avatars ────────────────────────────────────────

describe('getCompanyLogo — Brandfetch fallback', () => {
  test('Brandfetch 404 → falls through to UI Avatars', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),
      brandfetch404(),
      nocoCacheMiss(),
      nocoDone(),
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('ui-avatars.com');
    expect(url).toContain('NVDA');
  });

  test('Brandfetch response > 500KB → falls through to UI Avatars', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),
      {
        status: 200,
        headers: { get: (h) => h === 'content-type' ? 'image/png' : (h === 'content-length' ? '600000' : null) },
        buffer: async () => LARGE_BUFFER,
      },
      nocoCacheMiss(),
      nocoDone(),
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('ui-avatars.com');
  });

  test('Brandfetch timeout → falls through to UI Avatars', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(),
      () => Promise.reject(new Error('AbortError: timeout')),
      nocoCacheMiss(),
      nocoDone(),
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('ui-avatars.com');
  });

  test('UI Avatars URL contains tickerAbbrev', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(), brandfetch404(), nocoCacheMiss(), nocoDone(),
    ]);
    const url = await getCompanyLogo('apple.com', 'AAPL', helpers);
    expect(url).toContain('AAPL');
  });

  test('UI Avatars result cached in NocoDB with source=ui_avatars', async () => {
    const helpers = makeHelpers([
      nocoCacheMiss(), brandfetch404(), nocoCacheMiss(), nocoDone(),
    ]);
    await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    const postCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'POST');
    const posted = JSON.parse(postCall[1].body);
    expect(posted.source).toBe('ui_avatars');
  });
});

// ─── Cache expiry + PATCH ─────────────────────────────────────────────────────

describe('getCompanyLogo — cache expiry', () => {
  test('expired cache re-fetches from Brandfetch', async () => {
    const helpers = makeHelpers([
      nocoCacheExpired('nvidia.com', 'https://old.url/logo.png'), // expired
      brandfetchHit('image/png'),
      nocoCacheHit('nvidia.com', 'https://old.url/logo.png'),    // row EXISTS in _cacheSet check
      nocoDone(),                                                  // PATCH
    ]);
    const url = await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    expect(url).toContain('r2');
  });

  test('NocoDB PATCH called when row already exists', async () => {
    const helpers = makeHelpers([
      nocoCacheExpired('nvidia.com', 'https://old.url/logo.png'),
      brandfetchHit('image/png'),
      nocoCacheHit('nvidia.com', 'https://old.url/logo.png'),
      nocoDone(),
    ]);
    await getCompanyLogo('nvidia.com', 'NVDA', helpers);
    const patchCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'PATCH');
    expect(patchCall).toBeDefined();
    const postCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'POST');
    expect(postCall).toBeUndefined(); // PATCH not POST
  });
});

// ─── prefetchLogos ────────────────────────────────────────────────────────────

// URL-routing mock: NocoDB → miss, Brandfetch → image/png
function makeSmartFetch(opts = {}) {
  const { cachedDomains = [], branchfetchFail = false } = opts;
  const brandfetchTracker = [];
  const fetchFn = jest.fn().mockImplementation((url, options) => {
    if (typeof url === 'string' && url.includes('brandfetch')) {
      brandfetchTracker.push(url);
      if (branchfetchFail) return Promise.resolve(brandfetch404());
      return Promise.resolve(brandfetchHit('image/png'));
    }
    // NocoDB batch query (contains ~or)
    if (url.includes('~or') || url.includes('records?where')) {
      const matchedDomains = cachedDomains.filter(d => url.includes(d));
      const list = matchedDomains.map((d, i) => ({
        Id: i + 1, domain: d, logo_url: `https://r2/logos/${d}.png`,
        fetched_at: new Date().toISOString(), ttl_seconds: 2592000,
      }));
      return Promise.resolve({ ok: true, json: async () => ({ list }) });
    }
    // NocoDB other (single record lookup for _cacheGet/_cacheSet)
    return Promise.resolve({ ok: true, json: async () => ({ list: [] }) });
  });
  return { fetchFn, brandfetchTracker };
}

describe('prefetchLogos', () => {
  test('deduplicates input array (2x nvidia.com → 1 Brandfetch call)', async () => {
    const { fetchFn, brandfetchTracker } = makeSmartFetch();
    const helpers = { fetchFn, env: ENV, _sleep: jest.fn() };
    await prefetchLogos(['nvidia.com', 'nvidia.com'], helpers);
    expect(brandfetchTracker).toHaveLength(1);
  });

  test('skips already-cached domains', async () => {
    const { fetchFn, brandfetchTracker } = makeSmartFetch({ cachedDomains: ['nvidia.com'] });
    const helpers = { fetchFn, env: ENV, _sleep: jest.fn() };
    await prefetchLogos(['nvidia.com'], helpers);
    expect(brandfetchTracker).toHaveLength(0);
  });

  test('fetches missing domains', async () => {
    const { fetchFn, brandfetchTracker } = makeSmartFetch();
    const helpers = { fetchFn, env: ENV, _sleep: jest.fn() };
    await prefetchLogos(['apple.com'], helpers);
    expect(brandfetchTracker).toHaveLength(1);
  });

  test('limits concurrency to 3 (4 domains → all 4 eventually fetched)', async () => {
    const { fetchFn, brandfetchTracker } = makeSmartFetch();
    const helpers = { fetchFn, env: ENV, _sleep: jest.fn() };
    await prefetchLogos(['a.com', 'b.com', 'c.com', 'd.com'], helpers);
    expect(brandfetchTracker).toHaveLength(4);
  });
});
