/**
 * W13 — Cross-Linking Workflow (n8n Code Node)
 *
 * Finds related articles, injects bidirectional inline links via cheerio,
 * populates related_articles JSON field. Called by W2 after W12 completes.
 *
 * MUST respond only when last node finishes (W2 waits for completion).
 */

'use strict';

// Try standard path first (local dev), then n8n persistent volume path
let cheerio;
try {
  cheerio = require('cheerio');
} catch {
  cheerio = require('/home/node/.n8n/node_modules/cheerio');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTBOUND_LINKS = 3;
const MAX_INBOUND_LINKS_PER_ARTICLE = 1;
const MAX_RELATED_DISPLAY = 4; // Max articles in the related_articles JSON
const RECENCY_DAYS = 90;
const MIN_ANCHOR_WORDS = 3;
const MAX_ANCHOR_WORDS = 8;

// Sections where links must NOT be injected
const RESTRICTED_SELECTORS = ['h2', 'h3', '.key-takeaways', '.verdict', '[class*="verdict"]', '[class*="takeaway"]'];

// ---------------------------------------------------------------------------
// Related Articles Ranking
// ---------------------------------------------------------------------------

function rankRelatedArticles(candidates, newArticle) {
  if (!candidates || candidates.length === 0) return [];

  // Filter: same blog, exclude self, published within 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENCY_DAYS);

  const filtered = candidates.filter((c) => {
    if (c.id === newArticle.id) return false;
    if (c.blog !== newArticle.blog) return false;
    if (c.published_at && new Date(c.published_at) < cutoff) return false;
    return true;
  });

  // Sort: same ticker first, then same sector, then by date
  filtered.sort((a, b) => {
    const aTickerMatch = a.ticker === newArticle.ticker ? 1 : 0;
    const bTickerMatch = b.ticker === newArticle.ticker ? 1 : 0;
    if (bTickerMatch !== aTickerMatch) return bTickerMatch - aTickerMatch;

    const aSectorMatch = a.sector === newArticle.sector ? 1 : 0;
    const bSectorMatch = b.sector === newArticle.sector ? 1 : 0;
    if (bSectorMatch !== aSectorMatch) return bSectorMatch - aSectorMatch;

    return new Date(b.published_at || 0) - new Date(a.published_at || 0);
  });

  return filtered.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Generate Match Phrases from Article
// ---------------------------------------------------------------------------

function generateMatchPhrases(article) {
  const phrases = [];
  const title = article.title_text || article.title || '';
  const keyword = article.primary_keyword || '';

  // Title fragments (3-8 words from title)
  const titleWords = title.split(/\s+/);
  for (let len = MIN_ANCHOR_WORDS; len <= Math.min(MAX_ANCHOR_WORDS, titleWords.length); len++) {
    for (let start = 0; start <= titleWords.length - len; start++) {
      phrases.push(titleWords.slice(start, start + len).join(' '));
    }
  }

  // Primary keyword if 3-8 words
  if (keyword) {
    const kwWords = keyword.split(/\s+/);
    if (kwWords.length >= MIN_ANCHOR_WORDS && kwWords.length <= MAX_ANCHOR_WORDS) {
      phrases.push(keyword);
    }
  }

  // Ticker + company mentions
  if (article.ticker && article.company_name) {
    phrases.push(`${article.company_name}'s`);
  }

  return [...new Set(phrases)]; // dedup
}

// ---------------------------------------------------------------------------
// Cheerio-based Link Injection
// ---------------------------------------------------------------------------

function injectLinks(html, targets, maxLinks) {
  const $ = cheerio.load(html, { decodeEntities: false });
  let linksAdded = 0;
  const linkedSlugs = new Set();

  // Collect already-linked slugs for idempotency
  $('a[href^="/blog/"]').each(function () {
    const href = $(this).attr('href');
    const slug = href.replace('/blog/', '');
    linkedSlugs.add(slug);
  });

  for (const target of targets) {
    if (linksAdded >= maxLinks) break;
    if (linkedSlugs.has(target.slug)) continue; // already linked

    let injected = false;

    // Walk text nodes in <p> elements only (skip restricted sections)
    $('p').each(function () {
      if (injected || linksAdded >= maxLinks) return;

      const $p = $(this);

      // Skip restricted sections
      if ($p.hasClass('verdict') || $p.hasClass('key-takeaways')) return;
      if ($p.closest('h2, h3, .key-takeaways, .verdict, [class*="verdict"], [class*="takeaway"]').length > 0) return;

      // Skip if inside an <a> tag
      if ($p.closest('a').length > 0) return;

      const pHtml = $p.html();
      if (!pHtml) return;

      for (const phrase of target.matchPhrases) {
        if (injected) break;

        // Validate anchor text word count
        const wordCount = phrase.split(/\s+/).length;
        if (wordCount < MIN_ANCHOR_WORDS || wordCount > MAX_ANCHOR_WORDS) continue;

        // Check if phrase exists in text (not inside existing tags)
        const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?<![<"][^>]*)\\b(${escapedPhrase})\\b(?![^<]*>)`, 'i');

        // Simpler approach: check plain text contains phrase, then do careful replacement
        const plainText = $p.text();
        if (!plainText.toLowerCase().includes(phrase.toLowerCase())) continue;

        // Make sure we're not inside an existing <a> tag
        // Use a negative lookbehind for <a and positive lookahead for no closing </a> before next tag
        const linkTag = `<a href="/blog/${target.slug}">${phrase}</a>`;

        // Only replace first occurrence, and only if not already inside an anchor
        const newHtml = replaceFirstInTextNode(pHtml, phrase, linkTag);
        if (newHtml !== pHtml) {
          $p.html(newHtml);
          linksAdded++;
          linkedSlugs.add(target.slug);
          injected = true;
        }
      }
    });
  }

  return { html: $.html(), linksAdded };
}

/**
 * Replace first occurrence of `phrase` in HTML string, but ONLY when
 * the phrase appears in a text node (not inside an existing tag attribute
 * or anchor tag content).
 */
function replaceFirstInTextNode(html, phrase, replacement) {
  // Split HTML into segments: tags and text
  const parts = html.split(/(<[^>]+>)/);
  let insideAnchor = 0;
  let replaced = false;

  for (let i = 0; i < parts.length; i++) {
    if (replaced) break;

    const part = parts[i];

    // Track anchor depth
    if (part.match(/^<a[\s>]/i)) insideAnchor++;
    if (part.match(/^<\/a>/i)) insideAnchor = Math.max(0, insideAnchor - 1);

    // Skip tag parts
    if (part.startsWith('<')) continue;

    // Skip if inside anchor
    if (insideAnchor > 0) continue;

    // Try to replace in this text node
    const idx = part.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx !== -1) {
      const original = part.substring(idx, idx + phrase.length);
      parts[i] = part.substring(0, idx) + replacement.replace(phrase, original) + part.substring(idx + phrase.length);
      replaced = true;
    }
  }

  return replaced ? parts.join('') : html;
}

// ---------------------------------------------------------------------------
// Build Related Articles JSON
// ---------------------------------------------------------------------------

function buildRelatedArticlesJson(articles) {
  if (!articles || articles.length === 0) return [];

  return articles.slice(0, MAX_RELATED_DISPLAY).map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title_text || a.title || '',
    verdict_type: a.verdict_type || '',
    meta_description: a.meta_description || '',
  }));
}

// ---------------------------------------------------------------------------
// Main Orchestrator (for n8n Code node)
// ---------------------------------------------------------------------------

async function crossLink(input, helpers) {
  const { article_id } = input;
  const fetchFn = helpers?.fetchFn;
  const env = helpers?.env || {};

  const baseUrl = env.NOCODB_BASE_URL;
  const token = env.NOCODB_API_TOKEN;
  const headers = { 'xc-token': token };

  // Step 1: Fetch new article
  const articleRes = await fetchFn(`${baseUrl}/Articles/${article_id}`, { headers });
  if (!articleRes.ok) {
    return { success: false, error: 'Article not found' };
  }
  const article = await articleRes.json();

  // Step 2: Find related articles
  const queryUrl = `${baseUrl}/Articles?where=(status,eq,published)~and(blog,eq,${article.blog})~and(id,ne,${article_id})&sort=-published_at&limit=20`;
  const relatedRes = await fetchFn(queryUrl, { headers });
  const allCandidates = relatedRes.ok ? (await relatedRes.json()).list || [] : [];

  const ranked = rankRelatedArticles(allCandidates, article);

  if (ranked.length === 0) {
    // No related articles — update with empty array and return
    await fetchFn(`${baseUrl}/Articles/${article_id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ related_articles: '[]' }),
    });
    return { success: true, article_id, related_count: 0, outbound_links_added: 0, inbound_links_added: 0 };
  }

  // Step 3: Generate match phrases and inject forward links (new -> related)
  const targets = ranked.map((r) => ({
    slug: r.slug,
    matchPhrases: generateMatchPhrases(r),
  }));

  const forwardResult = injectLinks(article.body_html || '', targets, MAX_OUTBOUND_LINKS);

  // Step 3b: Inject backward links (related -> new article)
  const newArticleTarget = {
    slug: article.slug,
    matchPhrases: generateMatchPhrases(article),
  };

  let inboundLinksAdded = 0;
  const modifiedRelated = [];

  for (const related of ranked) {
    if (!related.body_html) continue;
    const backResult = injectLinks(related.body_html, [newArticleTarget], MAX_INBOUND_LINKS_PER_ARTICLE);
    if (backResult.linksAdded > 0) {
      modifiedRelated.push({ id: related.id, body_html: backResult.html });
      inboundLinksAdded += backResult.linksAdded;
    }
  }

  // Step 4: Build related articles JSON
  const relatedJson = buildRelatedArticlesJson(ranked);

  // Step 5: Write updates
  // PATCH new article
  await fetchFn(`${baseUrl}/Articles/${article_id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body_html: forwardResult.html,
      related_articles: JSON.stringify(relatedJson),
    }),
  });

  // PATCH modified related articles (backward links)
  for (const mod of modifiedRelated) {
    await fetchFn(`${baseUrl}/Articles/${mod.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_html: mod.body_html }),
    });
  }

  return {
    success: true,
    article_id,
    related_count: ranked.length,
    outbound_links_added: forwardResult.linksAdded,
    inbound_links_added: inboundLinksAdded,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Pure functions (tested)
  rankRelatedArticles,
  injectLinks,
  buildRelatedArticlesJson,
  generateMatchPhrases,
  replaceFirstInTextNode,

  // Orchestration
  crossLink,

  // Constants
  MAX_OUTBOUND_LINKS,
  MAX_INBOUND_LINKS_PER_ARTICLE,
  MAX_RELATED_DISPLAY,
  RECENCY_DAYS,
  MIN_ANCHOR_WORDS,
  MAX_ANCHOR_WORDS,
};
