'use strict';

const { uploadToR2 } = require('./render-pdf');

const BRANDFETCH_BASE = 'https://cdn.brandfetch.io';
const SIZE_LIMIT = 500 * 1024; // 500KB
const TTL_SECONDS = 2592000;   // 30 days

// ─── Internal NocoDB helpers ──────────────────────────────────────────────────

async function _nocoGet(url, token, fetchFn) {
  const res = await fetchFn(url, { headers: { 'xc-token': token } });
  if (!res.ok) throw new Error(`NocoDB GET failed: ${res.status}`);
  return res.json();
}

/**
 * Check NocoDB cache with TTL validation.
 * Returns the record if found and within TTL, otherwise null.
 */
async function _cacheGet(tableId, keyField, keyValue, helpers) {
  const url = `${helpers.env.NOCODB_API_URL}/api/v2/tables/${tableId}/records?where=(${keyField},eq,${encodeURIComponent(keyValue)})&limit=1`;
  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
  const record = body.list && body.list[0];
  if (!record) return null;
  const fetchedAt = new Date(record.fetched_at).getTime();
  const ttlMs = (record.ttl_seconds || 0) * 1000;
  if (fetchedAt + ttlMs > Date.now()) return record;
  return null; // expired
}

/**
 * Upsert a row in NocoDB (PATCH if exists, POST if not).
 * Existence check ignores TTL — just looks for row presence.
 */
async function _cacheSet(tableId, keyField, keyValue, data, helpers) {
  const url = `${helpers.env.NOCODB_API_URL}/api/v2/tables/${tableId}/records?where=(${keyField},eq,${encodeURIComponent(keyValue)})&limit=1`;
  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
  const existing = body.list && body.list[0];
  const token = helpers.env.NOCODB_API_TOKEN;
  const baseUrl = helpers.env.NOCODB_API_URL;

  if (existing) {
    await helpers.fetchFn(`${baseUrl}/api/v2/tables/${tableId}/records/${existing.Id}`, {
      method: 'PATCH',
      headers: { 'xc-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } else {
    await helpers.fetchFn(`${baseUrl}/api/v2/tables/${tableId}/records`, {
      method: 'POST',
      headers: { 'xc-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
}

// ─── SVG rasterization via screenshot server ──────────────────────────────────

async function _rasterizeSvg(svgBuffer, helpers) {
  const b64 = svgBuffer.toString('base64');
  // CSP blocks outbound network requests from the SVG data URI
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>*{margin:0;padding:0;}</style></head><body><img src="data:image/svg+xml;base64,${b64}" width="200" height="200"></body></html>`;
  const base = (helpers.env && helpers.env.SCREENSHOT_SERVER_URL) || 'http://host.docker.internal:3456';
  const res = await helpers.fetchFn(`${base}/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, viewport: { width: 200, height: 200 }, format: 'png' }),
  });
  if (!res.ok) throw new Error(`Screenshot rasterize error: ${res.status}`);
  return res.buffer();
}

// ─── getCompanyLogo ───────────────────────────────────────────────────────────

/**
 * Resolve a company logo URL with NocoDB caching.
 * 2-tier cascade: Brandfetch CDN → UI Avatars fallback.
 * Always returns a URL string.
 */
async function getCompanyLogo(domain, tickerAbbrev, helpers) {
  const tableId = helpers.env.NOCODB_LOGO_TABLE_ID;

  // Step 1: Check cache
  const cached = await _cacheGet(tableId, 'domain', domain, helpers);
  if (cached) return cached.logo_url;

  // Step 2: Try Brandfetch
  let logoUrl = null;
  try {
    const brandfetchUrl = `${BRANDFETCH_BASE}/${domain}/w/200/h/200`;
    const res = await helpers.fetchFn(brandfetchUrl);

    if (res.status === 200) {
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) throw new Error(`Non-image content-type: ${ct}`);

      // Size check via content-length header first
      const clHeader = res.headers.get('content-length');
      if (clHeader && Number(clHeader) > SIZE_LIMIT) throw new Error(`Logo too large: ${clHeader} bytes`);

      const rawBuffer = await res.buffer();
      if (rawBuffer.length > SIZE_LIMIT) throw new Error(`Logo buffer too large: ${rawBuffer.length} bytes`);

      let pngBuffer;
      let uploadMime;
      if (ct.startsWith('image/svg+xml')) {
        pngBuffer = await _rasterizeSvg(rawBuffer, helpers);
        uploadMime = 'image/png';
      } else {
        pngBuffer = rawBuffer;
        uploadMime = ct.split(';')[0].trim(); // e.g. 'image/jpeg' or 'image/png'
      }

      const safeDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
      const ext = uploadMime === 'image/png' ? 'png' : uploadMime === 'image/jpeg' ? 'jpg' : 'img';
      const key = `earlyinsider/logos/${safeDomain}_${Date.now()}.${ext}`;
      logoUrl = await uploadToR2(pngBuffer, key, uploadMime);
    } else {
      throw new Error(`Brandfetch ${res.status}`);
    }
  } catch (err) {
    console.warn(`[identity-assets] Brandfetch failed for ${domain}: ${err.message}`);
    logoUrl = null;
  }

  // Step 3: UI Avatars fallback
  if (!logoUrl) {
    logoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(tickerAbbrev)}&background=1A2238&color=4A9EFF&size=200&bold=true`;
    try {
      await _cacheSet(tableId, 'domain', domain, {
        domain,
        logo_url: logoUrl,
        source: 'ui_avatars',
        fetched_at: new Date().toISOString(),
        ttl_seconds: TTL_SECONDS,
      }, helpers);
    } catch (err) {
      console.warn(`[identity-assets] cache write failed for ${domain}: ${err.message}`);
    }
    return logoUrl;
  }

  // Cache successful Brandfetch result
  try {
    await _cacheSet(tableId, 'domain', domain, {
      domain,
      logo_url: logoUrl,
      source: 'brandfetch',
      fetched_at: new Date().toISOString(),
      ttl_seconds: TTL_SECONDS,
    }, helpers);
  } catch (err) {
    console.warn(`[identity-assets] cache write failed for ${domain}: ${err.message}`);
  }

  return logoUrl;
}

// ─── prefetchLogos ────────────────────────────────────────────────────────────

/**
 * Prefetch and cache logos for multiple domains.
 * Deduplicates input, skips cached domains, fetches missing in chunks of 3.
 */
async function prefetchLogos(domains, helpers) {
  if (!domains || domains.length === 0) return;

  // 1. Deduplicate
  const unique = [...new Set(domains)];

  // 2. Batch cache check
  const tableId = helpers.env.NOCODB_LOGO_TABLE_ID;
  const whereClause = unique.map(d => `(domain,eq,${encodeURIComponent(d)})`).join('~or');
  const batchUrl = `${helpers.env.NOCODB_API_URL}/api/v2/tables/${tableId}/records?where=${whereClause}&limit=${unique.length}`;
  const body = await _nocoGet(batchUrl, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
  const cachedDomains = new Set((body.list || []).map(r => r.domain));

  // 3. Find missing
  const missing = unique.filter(d => !cachedDomains.has(d));

  // 4. Fetch missing in chunks of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(domain => {
      const abbrev = domain.split('.')[0].toUpperCase();
      return getCompanyLogo(domain, abbrev, helpers).catch(err =>
        console.warn(`[identity-assets] prefetch failed for ${domain}: ${err.message}`)
      );
    }));
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getCompanyLogo,
  prefetchLogos,
  // getInsiderPhoto added in Section 07
};
