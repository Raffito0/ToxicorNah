/**
 * E2E Monitoring & Alerting Utilities
 *
 * Telegram alert formatting, cost estimation, keyword inventory checks,
 * environment validation. Used across all workflows for observability.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_N8N_ENV_VARS = [
  'NOCODB_BASE_URL',
  'NOCODB_API_TOKEN',
  'FINANCIAL_DATASETS_API_KEY',
  'ANTHROPIC_API_KEY',
  'KIE_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

const REQUIRED_NETLIFY_ENV_VARS = [
  'NOCODB_API_URL',
  'NOCODB_READONLY_TOKEN',
  'REVALIDATION_SECRET',
];

const CODE_FILES = [
  'dexter-research.js',
  'select-keyword.js',
  'generate-article.js',
  'generate-image.js',
  'cross-link.js',
  'blog-helpers.js',
];

const WORKFLOW_FILES = [
  'dexter-research.json',
  'w1-keyword-selection.json',
  'w2-article-generation.json',
  'w12-image-generation.json',
  'w13-cross-linking.json',
];

// Claude Sonnet 4.6 pricing (per million tokens)
const CLAUDE_INPUT_PRICE = 3.0;   // $3/M input
const CLAUDE_OUTPUT_PRICE = 15.0; // $15/M output
const FINANCIAL_API_CALL_COST = 0.01; // ~$0.01 per cache miss

const ARTICLES_PER_DAY = 3;
const LOW_INVENTORY_THRESHOLD = 7;

// ---------------------------------------------------------------------------
// Telegram Alert Formatting
// ---------------------------------------------------------------------------

function formatSuccessAlert({ title, ticker, verdict_type, word_count, slug, estimated_cost }) {
  return [
    'Article Published',
    `Title: ${title}`,
    `Ticker: ${ticker}`,
    `Verdict: ${verdict_type}`,
    `Word Count: ${word_count}`,
    `Quality Gate: PASS`,
    `URL: https://earlyinsider.com/blog/${slug}`,
    `Cost: ~$${(estimated_cost || 0).toFixed(2)}`,
  ].join('\n');
}

function formatFailureAlert({ keyword, error_type, failing_checks, retry_count }) {
  return [
    'Article Generation FAILED',
    `Keyword: ${keyword}`,
    `Error: ${error_type}`,
    `Quality Gate Failures: ${(failing_checks || []).join(', ')}`,
    `Retry Count: ${retry_count}/2`,
    `Action: ${retry_count >= 2 ? 'keyword marked as error' : 'will retry'}`,
  ].join('\n');
}

function formatKeywordAlert({ blog, count, top_keywords }) {
  return [
    'Keywords Generated',
    `Blog: ${blog}`,
    `Count: ${count} new keywords`,
    `Top 3: ${(top_keywords || []).slice(0, 3).join(', ')}`,
  ].join('\n');
}

function formatDexterFailureAlert({ ticker, failed_types, data_completeness }) {
  return [
    'Dexter Research FAILED',
    `Ticker: ${ticker}`,
    `Failed APIs: ${(failed_types || []).join(', ')}`,
    `Data Completeness: ${data_completeness}`,
    `Action: ${data_completeness < 0.5 ? 'keyword skipped' : 'partial data used'}`,
  ].join('\n');
}

function formatLowInventoryAlert({ blog, count }) {
  const daysRemaining = Math.floor(count / ARTICLES_PER_DAY);
  return [
    'LOW KEYWORD INVENTORY',
    `Blog: ${blog}`,
    `Remaining 'new' keywords: ${count}`,
    `Days of inventory: ~${daysRemaining}`,
    `Action: Run W1 or add keywords manually`,
  ].join('\n');
}

function formatIndexingAlert({ slug, success, status }) {
  return [
    `Google Indexing: ${success ? 'SUCCESS' : 'FAILED'}`,
    `URL: https://earlyinsider.com/blog/${slug}`,
    `Response: ${status}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Cost Estimation
// ---------------------------------------------------------------------------

function estimateArticleCost({ input_tokens, output_tokens, cache_misses } = {}) {
  if (!input_tokens && !output_tokens) return 0;

  const claudeCost =
    ((input_tokens || 0) / 1_000_000) * CLAUDE_INPUT_PRICE +
    ((output_tokens || 0) / 1_000_000) * CLAUDE_OUTPUT_PRICE;

  const apiCost = (cache_misses || 0) * FINANCIAL_API_CALL_COST;

  return Math.round((claudeCost + apiCost) * 1000) / 1000; // round to 3 decimals
}

// ---------------------------------------------------------------------------
// Keyword Inventory Check
// ---------------------------------------------------------------------------

function checkKeywordInventory(newKeywordCount, blog) {
  const daysRemaining = Math.floor(newKeywordCount / ARTICLES_PER_DAY);
  return {
    blog,
    count: newKeywordCount,
    daysRemaining,
    isLow: newKeywordCount < LOW_INVENTORY_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Environment Variable Validation
// ---------------------------------------------------------------------------

function validateEnvVars(env, requiredVars) {
  const missing = requiredVars.filter((v) => !env[v]);
  return {
    valid: missing.length === 0,
    missing,
    present: requiredVars.filter((v) => env[v]),
  };
}

// ---------------------------------------------------------------------------
// Telegram Send Helper (for n8n Code node)
// ---------------------------------------------------------------------------

async function sendTelegramAlert(message, opts = {}) {
  const { fetchFn, botToken, chatId } = opts;
  if (!fetchFn || !botToken || !chatId) return null;

  const res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  });

  return res.ok;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Alert formatting
  formatSuccessAlert,
  formatFailureAlert,
  formatKeywordAlert,
  formatDexterFailureAlert,
  formatLowInventoryAlert,
  formatIndexingAlert,

  // Cost
  estimateArticleCost,

  // Inventory
  checkKeywordInventory,

  // Validation
  validateEnvVars,

  // Telegram
  sendTelegramAlert,

  // Constants
  REQUIRED_N8N_ENV_VARS,
  REQUIRED_NETLIFY_ENV_VARS,
  CODE_FILES,
  WORKFLOW_FILES,
  ARTICLES_PER_DAY,
  LOW_INVENTORY_THRESHOLD,
};
