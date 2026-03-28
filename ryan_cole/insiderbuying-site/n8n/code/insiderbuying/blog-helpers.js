/**
 * Blog Integration Helpers
 *
 * Shared utilities for /api/articles, /api/articles/[slug], /api/revalidate
 * and /blog page components. Input validation, query building, frontend helpers.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_VERDICT_TYPES = ['BUY', 'SELL', 'CAUTION', 'WAIT', 'NO_TRADE'];
const VALID_BLOGS = ['insiderbuying', 'deepstockanalysis', 'dividenddeep'];
const PAGE_SIZE = 12;

const LIST_FIELDS = [
  'id', 'title_text', 'slug', 'hero_image_url', 'verdict_type', 'ticker',
  'meta_description', 'published_at', 'word_count', 'key_takeaways',
  'sector', 'company_name', 'author_name',
].join(',');

const NOCODB_INJECTION_PATTERN = /[~()]/;

// ---------------------------------------------------------------------------
// Input Sanitization
// ---------------------------------------------------------------------------

function sanitizeTickerParam(ticker) {
  if (!ticker || typeof ticker !== 'string') return null;
  const clean = ticker.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
  return clean.length > 0 ? clean : null;
}

function sanitizeSectorParam(sector) {
  if (!sector || typeof sector !== 'string') return null;
  const clean = sector.replace(/[^A-Za-z0-9 &\-]/g, '').slice(0, 50);
  return clean.length > 0 ? clean : null;
}

function sanitizeSlugParam(slug) {
  if (!slug || typeof slug !== 'string') return '';
  return slug.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 200);
}

function validateVerdictType(verdict) {
  if (!verdict || !VALID_VERDICT_TYPES.includes(verdict)) return null;
  return verdict;
}

function validateBlog(blog) {
  if (!blog || !VALID_BLOGS.includes(blog)) return 'insiderbuying';
  return blog;
}

function hasNocoDBInjection(value) {
  if (!value || typeof value !== 'string') return false;
  return NOCODB_INJECTION_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Query Building
// ---------------------------------------------------------------------------

function buildArticleListQuery(params) {
  const blog = validateBlog(params.blog);
  const page = Math.max(1, parseInt(params.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let where = `(blog,eq,${blog})~and(status,eq,published)`;

  if (params.verdict_type) {
    const vt = validateVerdictType(params.verdict_type);
    if (vt) where += `~and(verdict_type,eq,${vt})`;
  }

  if (params.sector) {
    const s = sanitizeSectorParam(params.sector);
    if (s && !hasNocoDBInjection(s)) where += `~and(sector,eq,${s})`;
  }

  if (params.ticker) {
    const t = sanitizeTickerParam(params.ticker);
    if (t && !hasNocoDBInjection(t)) where += `~and(ticker,like,${t})`;
  }

  return `?where=${encodeURIComponent(where)}&sort=-published_at&limit=${PAGE_SIZE}&offset=${offset}&fields=${LIST_FIELDS}`;
}

function buildArticleDetailQuery(slug) {
  const cleanSlug = sanitizeSlugParam(slug);
  const where = `(slug,eq,${cleanSlug})~and(status,eq,published)`;
  return `?where=${encodeURIComponent(where)}&limit=1`;
}

// ---------------------------------------------------------------------------
// Frontend Helpers
// ---------------------------------------------------------------------------

function parseRelatedArticles(jsonString) {
  if (!jsonString || jsonString === 'null') return [];
  try {
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function computeReadingTime(wordCount) {
  return Math.max(1, Math.ceil((wordCount || 0) / 200));
}

function extractH2Headings(bodyHtml) {
  if (!bodyHtml) return [];
  const matches = bodyHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
  return matches.map((m) => m.replace(/<[^>]+>/g, '').trim());
}

// Verdict badge color mapping (shared between API routes and components)
const VERDICT_COLORS = {
  BUY: { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
  SELL: { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
  CAUTION: { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
  WAIT: { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
  NO_TRADE: { bg: '#f3f4f6', text: '#374151', border: '#6b7280' },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Sanitization
  sanitizeTickerParam,
  sanitizeSectorParam,
  sanitizeSlugParam,
  validateVerdictType,
  validateBlog,
  hasNocoDBInjection,

  // Query building
  buildArticleListQuery,
  buildArticleDetailQuery,

  // Frontend helpers
  parseRelatedArticles,
  computeReadingTime,
  extractH2Headings,

  // Constants
  VALID_VERDICT_TYPES,
  VALID_BLOGS,
  PAGE_SIZE,
  LIST_FIELDS,
  VERDICT_COLORS,
};
