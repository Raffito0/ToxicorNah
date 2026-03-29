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

// ─── normalizeInsiderName ─────────────────────────────────────────────────────

/**
 * Normalize a full name for use as a NocoDB cache key.
 * Strips honorific prefixes (Dr., Mr., etc.) and generational suffixes (Jr., III, etc.).
 * @param {string|null|undefined} fullName
 * @returns {string}
 */
function normalizeInsiderName(fullName) {
  if (!fullName) return '';
  // NFKD normalization + strip combining characters (accents)
  let name = fullName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // Strip honorific prefixes
  name = name.replace(/^\s*(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '');
  // Strip generational suffixes (standalone tokens at end)
  name = name.replace(/\s+(Jr\.?|Sr\.?|III|IV|II|I)\s*$/i, '');
  return name.toLowerCase().trim();
}

// ─── Insider Photo helpers ────────────────────────────────────────────────────

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WIKIDATA_USER_AGENT = 'EarlyInsiderBot/1.0 (contact@earlyinsider.com)';

async function _tryWikidata(fullName, helpers) {
  // C1: escape SPARQL string literal to prevent injection
  const escaped = fullName.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  const sparql = `SELECT ?image WHERE { ?entity wdt:P31 wd:Q5 . ?entity rdfs:label "${escaped}"@en . ?entity wdt:P18 ?image . } LIMIT 1`;
  const res = await helpers.fetchFn(WIKIDATA_SPARQL_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': WIKIDATA_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `query=${encodeURIComponent(sparql)}`,
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL error: ${res.status}`);
  const data = await res.json();
  const imageValue = data.results && data.results.bindings && data.results.bindings[0] && data.results.bindings[0].image && data.results.bindings[0].image.value;
  if (!imageValue) return null;
  // I1: reject non-HTTPS URLs to prevent SSRF via crafted Wikidata P18 bindings
  if (!imageValue.startsWith('https://')) return null;

  const imageUrl = `${imageValue}?width=300`;
  const head = await helpers.fetchFn(imageUrl, { method: 'HEAD', redirect: 'follow' });
  if (!head.ok || !(head.headers.get('content-type') || '').startsWith('image/')) return null;
  return imageUrl;
}

async function _tryGoogleKG(fullName, title, helpers) {
  // I3: pass API key as header to avoid logging it in n8n execution history URLs
  const kgUrl = `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(fullName + ' ' + title)}&types=Person&limit=1`;
  const res = await helpers.fetchFn(kgUrl, { headers: { 'X-Goog-Api-Key': helpers.env.GOOGLE_KG_API_KEY } });
  if (!res.ok) throw new Error(`Google KG error: ${res.status}`);
  const data = await res.json();
  const imageUrl = data.itemListElement && data.itemListElement[0] && data.itemListElement[0].result && data.itemListElement[0].result.image && data.itemListElement[0].result.image.contentUrl;
  if (!imageUrl) return null;

  const head = await helpers.fetchFn(imageUrl, { method: 'HEAD', redirect: 'follow' });
  if (head.status === 403) throw new Error('KG image returned 403');
  if (!head.ok || !(head.headers.get('content-type') || '').startsWith('image/')) throw new Error('KG image verification failed');
  return imageUrl;
}

// ─── getInsiderPhoto ──────────────────────────────────────────────────────────

/**
 * Resolve an insider/executive photo URL with 3-tier cascade.
 * Wikidata SPARQL → Google Knowledge Graph → UI Avatars fallback.
 * Always returns a URL string.
 * @param {string} fullName - e.g. "Jensen Huang"
 * @param {string} title - e.g. "CEO"
 * @param {object} helpers - { fetchFn, env, _sleep }
 * @returns {Promise<string>}
 */
async function getInsiderPhoto(fullName, title, helpers) {
  const tableId = helpers.env.NOCODB_PHOTOS_TABLE_ID;
  const normalizedName = normalizeInsiderName(fullName);

  // Step 1: Check cache
  const cached = await _cacheGet(tableId, 'name_normalized', normalizedName, helpers);
  if (cached) return cached.photo_url;

  // Step 2: Wikidata
  // S2: raw fullName (not normalizedName) passed to external APIs — honorifics/diacritics improve match accuracy
  try {
    const url = await _tryWikidata(fullName, helpers);
    if (url) {
      try {
        await _cacheSet(tableId, 'name_normalized', normalizedName, {
          name_normalized: normalizedName,
          photo_url: url,
          source: 'wikidata',
          fetched_at: new Date().toISOString(),
          ttl_seconds: TTL_SECONDS,
        }, helpers);
      } catch (err) {
        console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
      }
      return url;
    }
  } catch (err) {
    console.warn(`[identity-assets] Wikidata failed for "${fullName}": ${err.message}`);
  }

  // Step 3: Google Knowledge Graph
  // S2: raw fullName used for matching accuracy (same reason as Wikidata above)
  try {
    const url = await _tryGoogleKG(fullName, title, helpers);
    if (url) {
      try {
        await _cacheSet(tableId, 'name_normalized', normalizedName, {
          name_normalized: normalizedName,
          photo_url: url,
          source: 'google_kg',
          fetched_at: new Date().toISOString(),
          ttl_seconds: TTL_SECONDS,
        }, helpers);
      } catch (err) {
        console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
      }
      return url;
    }
  } catch (err) {
    console.warn(`[identity-assets] Google KG failed for "${fullName}": ${err.message}`);
  }

  // Step 4: UI Avatars fallback
  const nameParts = normalizedName.split(' ');
  const firstName = nameParts[0] || 'U';
  const lastName = nameParts[1] || 'I';
  // S3: encode each name part separately; use literal '+' as space separator (not %2B)
  const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=0A1128&color=fff&size=128&bold=true&rounded=true`;
  try {
    await _cacheSet(tableId, 'name_normalized', normalizedName, {
      name_normalized: normalizedName,
      photo_url: uiAvatarsUrl,
      source: 'ui_avatars',
      fetched_at: new Date().toISOString(),
      ttl_seconds: TTL_SECONDS,
    }, helpers);
  } catch (err) {
    console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
  }
  return uiAvatarsUrl;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getCompanyLogo,
  prefetchLogos,
  getInsiderPhoto,
  normalizeInsiderName,
};
