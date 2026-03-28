const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatSuccessAlert,
  formatFailureAlert,
  formatKeywordAlert,
  formatDexterFailureAlert,
  formatLowInventoryAlert,
  formatIndexingAlert,
  estimateArticleCost,
  checkKeywordInventory,
  validateEnvVars,
  REQUIRED_N8N_ENV_VARS,
  REQUIRED_NETLIFY_ENV_VARS,
  CODE_FILES,
  WORKFLOW_FILES,
} = require('../code/insiderbuying/e2e-monitoring.js');

// ---------------------------------------------------------------------------
// Telegram Alert Formatting
// ---------------------------------------------------------------------------
describe('formatSuccessAlert', () => {
  it('contains title, ticker, verdict, URL, cost', () => {
    const msg = formatSuccessAlert({
      title: 'NVDA Q1 Earnings Analysis',
      ticker: 'NVDA',
      verdict_type: 'CAUTION',
      word_count: 1350,
      slug: 'nvda-q1-earnings',
      estimated_cost: 0.06,
    });
    assert.ok(msg.includes('NVDA Q1 Earnings'));
    assert.ok(msg.includes('NVDA'));
    assert.ok(msg.includes('CAUTION'));
    assert.ok(msg.includes('nvda-q1-earnings'));
    assert.ok(msg.includes('0.06'));
  });
});

describe('formatFailureAlert', () => {
  it('contains keyword, error type, retry count', () => {
    const msg = formatFailureAlert({
      keyword: 'NVDA earnings',
      error_type: 'Quality gate failure',
      failing_checks: ['Title too short', 'Missing data table'],
      retry_count: 2,
    });
    assert.ok(msg.includes('NVDA earnings'));
    assert.ok(msg.includes('Quality gate'));
    assert.ok(msg.includes('2'));
  });
});

describe('formatKeywordAlert', () => {
  it('contains blog, count, top keywords', () => {
    const msg = formatKeywordAlert({
      blog: 'insiderbuying',
      count: 21,
      top_keywords: ['NVDA insider buying', 'AAPL form 4', 'MSFT insider selling'],
    });
    assert.ok(msg.includes('insiderbuying'));
    assert.ok(msg.includes('21'));
    assert.ok(msg.includes('NVDA insider buying'));
  });
});

describe('formatDexterFailureAlert', () => {
  it('contains ticker, failed APIs, completeness score', () => {
    const msg = formatDexterFailureAlert({
      ticker: 'AAPL',
      failed_types: ['insider_trades', 'competitors'],
      data_completeness: 0.35,
    });
    assert.ok(msg.includes('AAPL'));
    assert.ok(msg.includes('insider_trades'));
    assert.ok(msg.includes('0.35'));
  });
});

describe('formatLowInventoryAlert', () => {
  it('contains blog, count, estimated days', () => {
    const msg = formatLowInventoryAlert({ blog: 'insiderbuying', count: 4 });
    assert.ok(msg.includes('insiderbuying'));
    assert.ok(msg.includes('4'));
    assert.ok(msg.includes('1')); // 4/3 = ~1.3 days
  });
});

describe('formatIndexingAlert', () => {
  it('formats success', () => {
    const msg = formatIndexingAlert({ slug: 'nvda-earnings', success: true, status: 200 });
    assert.ok(msg.includes('SUCCESS'));
    assert.ok(msg.includes('nvda-earnings'));
  });

  it('formats failure', () => {
    const msg = formatIndexingAlert({ slug: 'nvda-earnings', success: false, status: 403 });
    assert.ok(msg.includes('FAILED'));
    assert.ok(msg.includes('403'));
  });
});

// ---------------------------------------------------------------------------
// Cost Estimation
// ---------------------------------------------------------------------------
describe('estimateArticleCost', () => {
  it('calculates from token usage', () => {
    const cost = estimateArticleCost({
      input_tokens: 5000,
      output_tokens: 4000,
      cache_misses: 2,
    });
    assert.equal(typeof cost, 'number');
    assert.ok(cost > 0);
    assert.ok(cost < 0.20); // should be well under $0.20
  });

  it('returns 0 for missing usage', () => {
    assert.equal(estimateArticleCost({}), 0);
  });
});

// ---------------------------------------------------------------------------
// Keyword Inventory Check
// ---------------------------------------------------------------------------
describe('checkKeywordInventory', () => {
  it('flags low inventory (< 7 keywords)', () => {
    const result = checkKeywordInventory(4, 'insiderbuying');
    assert.equal(result.isLow, true);
    assert.ok(result.daysRemaining < 3);
  });

  it('passes normal inventory', () => {
    const result = checkKeywordInventory(21, 'insiderbuying');
    assert.equal(result.isLow, false);
  });
});

// ---------------------------------------------------------------------------
// Environment Variable Validation
// ---------------------------------------------------------------------------
describe('validateEnvVars', () => {
  it('reports missing vars', () => {
    const result = validateEnvVars({}, REQUIRED_N8N_ENV_VARS);
    assert.ok(result.missing.length > 0);
    assert.equal(result.valid, false);
  });

  it('passes when all vars present', () => {
    const env = {};
    for (const v of REQUIRED_N8N_ENV_VARS) env[v] = 'test-value';
    const result = validateEnvVars(env, REQUIRED_N8N_ENV_VARS);
    assert.equal(result.valid, true);
    assert.equal(result.missing.length, 0);
  });
});

// ---------------------------------------------------------------------------
// File Inventory
// ---------------------------------------------------------------------------
describe('CODE_FILES', () => {
  it('lists all 6 code files', () => {
    assert.equal(CODE_FILES.length, 6);
    assert.ok(CODE_FILES.includes('dexter-research.js'));
    assert.ok(CODE_FILES.includes('select-keyword.js'));
    assert.ok(CODE_FILES.includes('generate-article.js'));
    assert.ok(CODE_FILES.includes('generate-image.js'));
    assert.ok(CODE_FILES.includes('cross-link.js'));
    assert.ok(CODE_FILES.includes('blog-helpers.js'));
  });
});

describe('WORKFLOW_FILES', () => {
  it('lists all 5 workflow files', () => {
    assert.equal(WORKFLOW_FILES.length, 5);
  });
});
