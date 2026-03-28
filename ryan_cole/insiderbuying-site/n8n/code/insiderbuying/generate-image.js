/**
 * W12 — Featured Image Generation (n8n Code Node)
 *
 * Generates hero image (Nano Banana Pro) and OG card (screenshot server),
 * uploads both to Cloudflare R2, updates NocoDB article record.
 *
 * Called by W2 via webhook with { article_id }.
 * MUST respond only when last node finishes (W2 waits for completion).
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERDICT_COLORS = {
  BUY: '#22C55E',
  SELL: '#EF4444',
  CAUTION: '#F59E0B',
  WAIT: '#3B82F6',
  NO_TRADE: '#6B7280',
};

// Pre-generated fallback hero images on R2 (one per verdict color)
const FALLBACK_HERO_URLS = {
  BUY: 'earlyinsider/images/fallback_hero_buy.png',
  SELL: 'earlyinsider/images/fallback_hero_sell.png',
  CAUTION: 'earlyinsider/images/fallback_hero_caution.png',
  WAIT: 'earlyinsider/images/fallback_hero_wait.png',
  NO_TRADE: 'earlyinsider/images/fallback_hero_no_trade.png',
};

const SCREENSHOT_SERVER = 'http://host.docker.internal:3456';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function getVerdictColor(verdict) {
  return VERDICT_COLORS[verdict] || VERDICT_COLORS.NO_TRADE;
}

function buildR2Key(slug, imageType) {
  return `earlyinsider/images/${slug}_${imageType}.png`;
}

// ---------------------------------------------------------------------------
// Hero Image Prompt
// ---------------------------------------------------------------------------

function buildHeroPrompt({ ticker, company_name, verdict_type }) {
  const sentiment = (verdict_type || 'CAUTION').toLowerCase();
  return `Professional financial data visualization for ${ticker} ${company_name}, showing ${sentiment} sentiment. Navy blue background (#002A5E), clean modern style, stock chart elements, no text overlay. 1200x630.`;
}

// ---------------------------------------------------------------------------
// OG Card HTML Template
// ---------------------------------------------------------------------------

function buildOgCardHtml(article) {
  const title = escapeHtml(article.title);
  const ticker = escapeHtml(article.ticker);
  const verdict = escapeHtml(article.verdict_type);
  const verdictColor = getVerdictColor(article.verdict_type);
  const takeaway = escapeHtml(
    Array.isArray(article.key_takeaways) ? article.key_takeaways[0] : ''
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1200, height=630">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Space+Mono:wght@700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: #002A5E;
    font-family: 'Montserrat', sans-serif;
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 48px 56px;
    overflow: hidden;
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; opacity: 0.9; }
  .verdict-badge {
    background: ${verdictColor};
    color: white;
    font-size: 18px;
    font-weight: 700;
    padding: 8px 20px;
    border-radius: 6px;
    letter-spacing: 1px;
  }
  .middle { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
  .ticker {
    font-family: 'Space Mono', monospace;
    font-size: 72px;
    font-weight: 700;
    letter-spacing: 4px;
    opacity: 0.15;
    position: absolute;
    right: 56px;
    top: 50%;
    transform: translateY(-50%);
  }
  .title {
    font-size: 42px;
    font-weight: 700;
    line-height: 1.15;
    max-width: 900px;
  }
  .takeaway {
    font-size: 18px;
    font-weight: 600;
    opacity: 0.75;
    max-width: 800px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; }
  .url { font-size: 16px; opacity: 0.5; letter-spacing: 1px; }
</style>
</head>
<body>
  <div class="top">
    <div class="logo">EarlyInsider</div>
    <div class="verdict-badge">${verdict}</div>
  </div>
  <div class="ticker">${ticker}</div>
  <div class="middle">
    <div class="title">${title}</div>
    <div class="takeaway">${takeaway}</div>
  </div>
  <div class="bottom">
    <div class="url">earlyinsider.com</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// R2 Upload (AWS Sig V4 — same pattern as Toxic or Nah content library)
// ---------------------------------------------------------------------------

function buildR2SignedRequest(key, body, env) {
  const crypto = require('crypto');

  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${key}`;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');
  const dateDay = dateStr.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const scope = `${dateDay}/${region}/${service}/aws4_request`;

  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

  const canonicalHeaders = [
    `content-type:image/png`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateStr}`,
  ].join('\n');

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT', `/${key}`, '',
    canonicalHeaders, '',
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateStr,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  function hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  const kDate = hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, dateDay);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
      'Host': host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': dateStr,
      'Authorization': authorization,
    },
    body,
  };
}

async function uploadToR2(key, imageBuffer, opts = {}) {
  const { fetchFn, env } = opts;
  if (!fetchFn || !env?.R2_ACCOUNT_ID) return null;

  const req = buildR2SignedRequest(key, imageBuffer, env);
  const res = await fetchFn(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  if (!res.ok) return null;
  return `${env.R2_PUBLIC_URL}/${key}`;
}

// ---------------------------------------------------------------------------
// fal.ai Flux — Hero Image
// ---------------------------------------------------------------------------

async function generateHeroImage(prompt, opts = {}) {
  const { fetchFn, falKey } = opts;
  if (!fetchFn || !falKey) return null;

  try {
    // fal.ai queue API: submit -> poll -> get result
    const submitRes = await fetchFn('https://queue.fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_size: { width: 1200, height: 630 },
        num_images: 1,
      }),
    });

    if (!submitRes.ok) return null;
    const submitData = await submitRes.json();

    // Direct result (sync mode)
    if (submitData?.images?.[0]?.url) {
      return { url: submitData.images[0].url, binary: null };
    }

    // Async mode: poll request_id
    const requestId = submitData?.request_id;
    if (!requestId) return null;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetchFn(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/status`, {
        headers: { 'Authorization': `Key ${falKey}` },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();

      if (pollData?.status === 'COMPLETED') {
        // Fetch result
        const resultRes = await fetchFn(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}`, {
          headers: { 'Authorization': `Key ${falKey}` },
        });
        if (!resultRes.ok) return null;
        const resultData = await resultRes.json();
        const url = resultData?.images?.[0]?.url;
        return url ? { url, binary: null } : null;
      }
      if (pollData?.status === 'FAILED') return null;
    }

    return null; // timeout
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Screenshot Server — OG Card
// ---------------------------------------------------------------------------

async function generateOgCard(html, opts = {}) {
  const { fetchFn, screenshotUrl } = opts;
  const serverUrl = screenshotUrl || SCREENSHOT_SERVER;
  if (!fetchFn) return null;

  // Retry once on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(`${serverUrl}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          viewport: { width: 1200, height: 630 },
          format: 'png',
        }),
      });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return Buffer.from(buffer);
      }
    } catch {
      // retry
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main Orchestrator (for n8n Code node)
// ---------------------------------------------------------------------------

async function generateImages(input, helpers) {
  const { article_id } = input;
  const fetchFn = helpers?.fetchFn;
  const env = helpers?.env || {};

  const nocodbOpts = {
    fetchFn,
    baseUrl: env.NOCODB_BASE_URL,
    token: env.NOCODB_API_TOKEN,
  };

  // Step 1: Fetch article
  const articleRes = await fetchFn(`${nocodbOpts.baseUrl}/Articles/${article_id}`, {
    headers: { 'xc-token': nocodbOpts.token },
  });
  if (!articleRes.ok) {
    return { success: false, error: 'Article not found' };
  }
  const article = await articleRes.json();

  let heroUrl = null;
  let ogUrl = null;

  // Step 2: Generate hero image
  const heroPrompt = buildHeroPrompt({
    ticker: article.ticker,
    company_name: article.company_name,
    verdict_type: article.verdict_type,
  });

  const heroResult = await generateHeroImage(heroPrompt, {
    fetchFn,
    falKey: env.FAL_KEY,
  });

  if (heroResult?.url) {
    // Download and upload to R2
    try {
      const imgRes = await fetchFn(heroResult.url);
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const heroKey = buildR2Key(article.slug, 'hero');
        heroUrl = await uploadToR2(heroKey, buffer, { fetchFn, env });
      }
    } catch {
      // fallback below
    }
  }

  // Fallback to generic verdict hero
  if (!heroUrl) {
    const fallbackKey = FALLBACK_HERO_URLS[article.verdict_type] || FALLBACK_HERO_URLS.CAUTION;
    heroUrl = `${env.R2_PUBLIC_URL}/${fallbackKey}`;
  }

  // Step 3: Generate OG card
  const ogHtml = buildOgCardHtml({
    title: article.title_text || article.title,
    ticker: article.ticker,
    verdict_type: article.verdict_type,
    key_takeaways: article.key_takeaways
      ? (typeof article.key_takeaways === 'string' ? JSON.parse(article.key_takeaways) : article.key_takeaways)
      : [],
    company_name: article.company_name,
  });

  const ogBuffer = await generateOgCard(ogHtml, {
    fetchFn,
    screenshotUrl: env.SCREENSHOT_SERVER_URL || SCREENSHOT_SERVER,
  });

  if (ogBuffer) {
    const ogKey = buildR2Key(article.slug, 'og');
    ogUrl = await uploadToR2(ogKey, ogBuffer, { fetchFn, env });
  }

  // Step 5: Update NocoDB
  // PATCH article with image URLs
  await fetchFn(`${nocodbOpts.baseUrl}/Articles/${article_id}`, {
    method: 'PATCH',
    headers: { 'xc-token': nocodbOpts.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hero_image_url: heroUrl,
      og_image_url: ogUrl,
    }),
  });

  // POST to Published_Images
  if (heroUrl) {
    await fetchFn(`${nocodbOpts.baseUrl}/Published_Images`, {
      method: 'POST',
      headers: { 'xc-token': nocodbOpts.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id,
        image_type: 'hero',
        r2_url: heroUrl,
        prompt_used: heroPrompt,
      }),
    });
  }

  if (ogUrl) {
    await fetchFn(`${nocodbOpts.baseUrl}/Published_Images`, {
      method: 'POST',
      headers: { 'xc-token': nocodbOpts.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        article_id,
        image_type: 'og',
        r2_url: ogUrl,
        prompt_used: null,
      }),
    });
  }

  return {
    success: true,
    article_id,
    hero_image_url: heroUrl,
    og_image_url: ogUrl,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Pure functions (tested)
  buildHeroPrompt,
  buildOgCardHtml,
  getVerdictColor,
  buildR2Key,
  escapeHtml,

  // Orchestration
  generateHeroImage,
  generateOgCard,
  uploadToR2,
  generateImages,
  buildR2SignedRequest,

  // Constants
  VERDICT_COLORS,
  FALLBACK_HERO_URLS,
  SCREENSHOT_SERVER,
};
