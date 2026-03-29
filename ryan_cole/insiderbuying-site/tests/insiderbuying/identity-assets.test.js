'use strict';

jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
  uploadToR2: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/logos/nvidia.com_123.png'),
}));

const { uploadToR2 } = require('../../n8n/code/insiderbuying/render-pdf');
const { getCompanyLogo, prefetchLogos, getInsiderPhoto, normalizeInsiderName } = require('../../n8n/code/insiderbuying/identity-assets');

const PNG_BUFFER = Buffer.alloc(100);
const LARGE_BUFFER = Buffer.alloc(600 * 1024); // > 500KB

const ENV = {
  NOCODB_API_URL: 'http://nocodb.test',
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_LOGO_TABLE_ID: 'tbl_logos_test',
  NOCODB_PHOTOS_TABLE_ID: 'tbl_photos_test',
  SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456',
  GOOGLE_KG_API_KEY: 'test-kg-key',
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

// ─── normalizeInsiderName ─────────────────────────────────────────────────────

describe('normalizeInsiderName', () => {
  test('strips Dr. prefix and Jr. suffix', () => {
    expect(normalizeInsiderName('Dr. Jensen Huang Jr.')).toBe('jensen huang');
  });

  test('strips Mr. prefix and III suffix', () => {
    expect(normalizeInsiderName('Mr. John Smith III')).toBe('john smith');
  });

  test('plain name passes through lowercased', () => {
    expect(normalizeInsiderName('Elon Musk')).toBe('elon musk');
  });

  test('preserves hyphen and apostrophe in name', () => {
    expect(normalizeInsiderName("mary-jane o'connor")).toBe("mary-jane o'connor");
  });

  test('normalizes unicode accented characters via NFKD', () => {
    expect(normalizeInsiderName('José García')).toBe('jose garcia');
  });

  test('empty string returns empty string', () => {
    expect(normalizeInsiderName('')).toBe('');
  });

  test('null returns empty string', () => {
    expect(normalizeInsiderName(null)).toBe('');
  });

  test('undefined returns empty string', () => {
    expect(normalizeInsiderName(undefined)).toBe('');
  });
});

// ─── getInsiderPhoto — helper factories ──────────────────────────────────────

function photosCacheMiss() {
  return { ok: true, json: async () => ({ list: [] }) };
}

function photosCacheHit(name_normalized, photo_url, ttl_seconds = 2592000) {
  const fetched_at = new Date(Date.now() - 1000).toISOString();
  return {
    ok: true,
    json: async () => ({ list: [{ Id: 55, name_normalized, photo_url, source: 'wikidata', fetched_at, ttl_seconds }] }),
  };
}

function wikidataHit(imageUrl = 'https://commons.wikimedia.org/wiki/Special:FilePath/JensenHuang.jpg') {
  return {
    ok: true,
    json: async () => ({
      results: { bindings: [{ image: { value: imageUrl } }] },
    }),
  };
}

function wikidataNoResult() {
  return {
    ok: true,
    json: async () => ({ results: { bindings: [] } }),
  };
}

function headOk() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
  };
}

function head403() {
  return {
    ok: false,
    status: 403,
    headers: { get: () => null },
  };
}

function kgHit(imageUrl = 'https://kg.example.com/jensen_huang.jpg') {
  return {
    ok: true,
    json: async () => ({
      itemListElement: [{ result: { image: { contentUrl: imageUrl } } }],
    }),
  };
}

function kgNoResult() {
  return {
    ok: true,
    json: async () => ({ itemListElement: [] }),
  };
}

// ─── getInsiderPhoto — cache hit ──────────────────────────────────────────────

describe('getInsiderPhoto — cache hit', () => {
  test('returns cached URL without calling Wikidata', async () => {
    const helpers = makeHelpers([
      photosCacheHit('jensen huang', 'https://r2.dev/photos/jensen-huang.jpg'),
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toBe('https://r2.dev/photos/jensen-huang.jpg');
    expect(helpers.fetchFn).toHaveBeenCalledTimes(1); // only NocoDB GET
  });
});

// ─── getInsiderPhoto — Wikidata hit ───────────────────────────────────────────

describe('getInsiderPhoto — Wikidata hit', () => {
  test('Wikidata SPARQL returns image → verifies via HEAD → caches with source wikidata', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),   // initial cache check
      wikidataHit(),       // Wikidata SPARQL
      headOk(),            // HEAD verify
      photosCacheMiss(),   // _cacheSet existence check
      nocoDone(),          // NocoDB POST
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('commons.wikimedia.org');
    // Find the NocoDB POST (not the Wikidata SPARQL POST)
    const postCall = helpers.fetchFn.mock.calls.find(
      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
    );
    const posted = JSON.parse(postCall[1].body);
    expect(posted.source).toBe('wikidata');
  });

  test('Wikidata SPARQL request includes descriptive User-Agent header', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataHit(),
      headOk(),
      photosCacheMiss(),
      nocoDone(),
    ]);
    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    const wikidataCall = helpers.fetchFn.mock.calls.find(c => c[0].includes('wikidata.org'));
    expect(wikidataCall).toBeDefined();
    const headers = wikidataCall[1] && wikidataCall[1].headers;
    expect(headers['User-Agent'] || headers['user-agent']).toMatch(/EarlyInsiderBot/);
  });

  test('Wikidata HEAD request uses redirect: follow', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataHit(),
      headOk(),
      photosCacheMiss(),
      nocoDone(),
    ]);
    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    // Find the HEAD call (not the SPARQL POST)
    const headCall = helpers.fetchFn.mock.calls.find(
      c => c[1] && c[1].method === 'HEAD'
    );
    expect(headCall).toBeDefined();
    expect(headCall[1].redirect).toBe('follow');
  });
});

// ─── getInsiderPhoto — Wikidata miss → Google KG ─────────────────────────────

describe('getInsiderPhoto — Wikidata miss → Google KG', () => {
  test('Wikidata SPARQL no image → falls to Google KG', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataNoResult(),  // Wikidata: no results
      kgHit(),             // Google KG hit
      headOk(),            // HEAD verify
      photosCacheMiss(),   // _cacheSet existence check
      nocoDone(),          // NocoDB POST
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('kg.example.com');
    // Find the NocoDB POST (not the Wikidata SPARQL POST)
    const postCall = helpers.fetchFn.mock.calls.find(
      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
    );
    const posted = JSON.parse(postCall[1].body);
    expect(posted.source).toBe('google_kg');
  });

  test('Wikidata timeout → falls to Google KG', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      () => Promise.reject(new Error('AbortError: timeout')), // Wikidata timeout
      kgHit(),
      headOk(),
      photosCacheMiss(),
      nocoDone(),
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('kg.example.com');
  });
});

// ─── getInsiderPhoto — Google KG failures → UI Avatars ────────────────────────

describe('getInsiderPhoto — Google KG failures → UI Avatars', () => {
  test('Google KG image URL returns 403 → falls to UI Avatars', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataNoResult(),  // Wikidata: no results
      kgHit(),             // Google KG returns URL
      head403(),           // HEAD returns 403 — blocked image
      photosCacheMiss(),   // _cacheSet existence check (UI Avatars)
      nocoDone(),          // NocoDB POST
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('ui-avatars.com');
  });

  test('Google KG timeout → falls to UI Avatars', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataNoResult(),
      () => Promise.reject(new Error('AbortError: timeout')), // KG timeout
      photosCacheMiss(),
      nocoDone(),
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('ui-avatars.com');
  });
});

// ─── getInsiderPhoto — UI Avatars fallback ────────────────────────────────────

describe('getInsiderPhoto — UI Avatars fallback', () => {
  test('UI Avatars URL includes firstName+lastName from normalized name', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataNoResult(),
      kgNoResult(),
      photosCacheMiss(),
      nocoDone(),
    ]);
    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    expect(url).toContain('ui-avatars.com');
    // normalized "jensen huang" → firstName=jensen, lastName=huang
    expect(url).toContain('jensen');
    expect(url).toContain('huang');
  });

  test('UI Avatars result cached with source ui_avatars', async () => {
    const helpers = makeHelpers([
      photosCacheMiss(),
      wikidataNoResult(),
      kgNoResult(),
      photosCacheMiss(),
      nocoDone(),
    ]);
    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
    // Find the NocoDB POST (not the Wikidata SPARQL POST)
    const postCall = helpers.fetchFn.mock.calls.find(
      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
    );
    const posted = JSON.parse(postCall[1].body);
    expect(posted.source).toBe('ui_avatars');
  });
});
