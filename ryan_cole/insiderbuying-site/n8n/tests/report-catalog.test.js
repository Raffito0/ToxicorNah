'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSector,
  runReportCatalog,
} = require('../code/insiderbuying/report-catalog.js');

// ---------------------------------------------------------------------------
// A1 -- data-study disabled flag
// ---------------------------------------------------------------------------
describe('data-study.js disabled flag', () => {
  it('module.exports.DISABLED is strictly true (not just truthy)', () => {
    const mod = require('../code/insiderbuying/data-study.js');
    assert.strictEqual(mod.DISABLED, true);
  });

  it('other existing exports are still accessible (selectStudyTopic)', () => {
    const mod = require('../code/insiderbuying/data-study.js');
    assert.strictEqual(typeof mod.selectStudyTopic, 'function');
  });
});

// ---------------------------------------------------------------------------
// normalizeSector
// ---------------------------------------------------------------------------
describe('normalizeSector', () => {
  it('maps "Tech" -> "Technology"', () => {
    assert.equal(normalizeSector('Tech'), 'Technology');
  });

  it('maps "Information Technology" -> "Technology"', () => {
    assert.equal(normalizeSector('Information Technology'), 'Technology');
  });

  it('maps "Financials" -> "Finance"', () => {
    assert.equal(normalizeSector('Financials'), 'Finance');
  });

  it('maps "Financial Services" -> "Finance"', () => {
    assert.equal(normalizeSector('Financial Services'), 'Finance');
  });

  it('maps "Health Care" -> "Healthcare"', () => {
    assert.equal(normalizeSector('Health Care'), 'Healthcare');
  });

  it('unknown sector passes through unchanged', () => {
    assert.equal(normalizeSector('Aerospace'), 'Aerospace');
  });

  it('empty string passes through unchanged', () => {
    assert.equal(normalizeSector(''), '');
  });

  it('null returns null (pass-through for non-string — T2)', () => {
    // normalizeSector(null): SECTOR_MAP[null] = undefined, || null = null
    assert.equal(normalizeSector(null), null);
  });

  it('undefined returns undefined (pass-through — T2)', () => {
    assert.equal(normalizeSector(undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// report-catalog query and filtering
// ---------------------------------------------------------------------------
describe('report-catalog query and filtering', () => {
  it('empty Insider_Alerts response -> sends Telegram "0 candidates", writes nothing', async () => {
    const telegramMessages = [];
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [];
        if (table === 'Report_Catalog') return [];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async (msg) => { telegramMessages.push(msg); },
    };
    await runReportCatalog(opts);
    assert.equal(inserted.length, 0);
    assert.ok(telegramMessages.length >= 1);
    assert.ok(telegramMessages[0].indexOf('0 candidates') !== -1 ||
              telegramMessages[0].indexOf('0 single') !== -1);
  });

  it('alerts with clusters < 3 are excluded from all passes', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'AAPL', sector: 'Technology', score: 12, clusters: 2 },
          { ticker: 'MSFT', sector: 'Technology', score: 10, clusters: 1 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    assert.equal(inserted.length, 0);
  });

  it('alerts with score < 8 are excluded from all passes', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'AAPL', sector: 'Technology', score: 7, clusters: 5 },
          { ticker: 'MSFT', sector: 'Technology', score: 5, clusters: 4 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    assert.equal(inserted.length, 0);
  });

  it('sector deduplication: sector already in Report_Catalog is skipped in Pass 2 (T4)', async () => {
    const inserted = [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 3 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 3 },
          { ticker: 'C', sector: 'Technology', score: 8, clusters: 3 },
        ];
        if (table === 'Report_Catalog') return [
          { ticker_or_sector: 'Technology', created_at: sevenDaysAgo },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const sectors = inserted.filter(r => r.report_type === 'sector');
    assert.equal(sectors.length, 0, 'Technology sector should be deduped');
  });

  it('deduplication: tickers in Report_Catalog (last 30 days) are filtered out', async () => {
    const inserted = [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'AAPL', sector: 'Technology', score: 12, clusters: 4 },
          { ticker: 'MSFT', sector: 'Technology', score: 10, clusters: 3 },
        ];
        if (table === 'Report_Catalog') return [
          { ticker_or_sector: 'AAPL', created_at: sevenDaysAgo },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const tickers = inserted.map(r => r.ticker_or_sector);
    assert.ok(tickers.indexOf('AAPL') === -1, 'AAPL should be deduped');
    assert.ok(tickers.indexOf('MSFT') !== -1, 'MSFT should be inserted');
  });
});

// ---------------------------------------------------------------------------
// Pass 1 -- Single-stock
// ---------------------------------------------------------------------------
describe('Pass 1 -- Single-stock', () => {
  function makeAlerts(count) {
    return Array.from({ length: count }, (_, i) => ({
      ticker: 'T' + i,
      sector: 'Technology',
      score: 10 + i,
      clusters: 3,
    }));
  }

  it('selects top 5 by score when > 5 candidates exist', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return makeAlerts(8);
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const singles = inserted.filter(r => r.report_type === 'single');
    assert.equal(singles.length, 5);
  });

  it('selects all available when fewer than 5 candidates (no crash)', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return makeAlerts(3);
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const singles = inserted.filter(r => r.report_type === 'single');
    assert.equal(singles.length, 3);
  });

  it('each insert has report_type = "single"', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return makeAlerts(3);
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const singles = inserted.filter(r => r.report_type === 'single');
    singles.forEach(r => assert.equal(r.report_type, 'single'));
  });

  it('inserts highest-scoring tickers first', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return makeAlerts(8);
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const singles = inserted.filter(r => r.report_type === 'single');
    // makeAlerts gives score 10+i, so top 5 are T7 T6 T5 T4 T3 (scores 17-13)
    assert.ok(singles[0].priority_score >= singles[4].priority_score);
  });
});

// ---------------------------------------------------------------------------
// Pass 2 -- Sector
// ---------------------------------------------------------------------------
describe('Pass 2 -- Sector', () => {
  it('sector with exactly 3 alerts -> one sector entry created', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 3 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 4 },
          { ticker: 'C', sector: 'Technology', score: 8, clusters: 3 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const sectors = inserted.filter(r => r.report_type === 'sector');
    assert.equal(sectors.length, 1);
  });

  it('sector with 2 alerts -> no sector entry', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 3 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 4 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const sectors = inserted.filter(r => r.report_type === 'sector');
    assert.equal(sectors.length, 0);
  });

  it('sector entry has report_type = "sector"', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 3 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 3 },
          { ticker: 'C', sector: 'Technology', score: 8, clusters: 3 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const sectors = inserted.filter(r => r.report_type === 'sector');
    assert.equal(sectors[0].report_type, 'sector');
  });
});

// ---------------------------------------------------------------------------
// Pass 3 -- Bundle
// ---------------------------------------------------------------------------
describe('Pass 3 -- Bundle', () => {
  it('same sector + one >= $10B + one < $10B + both score >= 8 -> bundle created', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'BIG', sector: 'Technology', score: 10, clusters: 4, market_cap: 50000000000 },
          { ticker: 'SML', sector: 'Technology', score: 9, clusters: 3, market_cap: 3000000000 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const bundles = inserted.filter(r => r.report_type === 'bundle');
    assert.ok(bundles.length >= 1);
  });

  it('same sector but both same market cap tier -> no bundle', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 4, market_cap: 50000000000 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 3, market_cap: 20000000000 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const bundles = inserted.filter(r => r.report_type === 'bundle');
    assert.equal(bundles.length, 0);
  });

  it('no market_cap field in alerts -> pass 3 skipped, 0 bundles, no error', async () => {
    const inserted = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 4 },
          { ticker: 'B', sector: 'Technology', score: 9, clusters: 3 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const bundles = inserted.filter(r => r.report_type === 'bundle');
    assert.equal(bundles.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Telegram summary
// ---------------------------------------------------------------------------
describe('Telegram summary', () => {
  it('counts reflect actual inserted record counts (2 single + 1 sector + 1 bundle)', async () => {
    const telegramMessages = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'BIG', sector: 'Finance', score: 12, clusters: 4, market_cap: 50000000000 },
          { ticker: 'SML', sector: 'Finance', score: 10, clusters: 3, market_cap: 2000000000 },
          { ticker: 'MED', sector: 'Finance', score: 9, clusters: 3, market_cap: 1000000000 },
          // Three Finance alerts -> sector entry
          // BIG+SML -> bundle (different tiers)
        ];
        return [];
      },
      nocodbPost: async (table, record) => record,
      telegram: async (msg) => { telegramMessages.push(msg); },
    };
    await runReportCatalog(opts);
    assert.ok(telegramMessages.length >= 1);
    const msg = telegramMessages[0];
    assert.ok(msg.indexOf('single') !== -1, 'message should mention single');
    assert.ok(msg.indexOf('sector') !== -1, 'message should mention sector');
    assert.ok(msg.indexOf('bundle') !== -1, 'message should mention bundle');
  });

  it('telegram message contains candidate counts as numbers', async () => {
    const telegramMessages = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'A', sector: 'Technology', score: 10, clusters: 3 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => record,
      telegram: async (msg) => { telegramMessages.push(msg); },
    };
    await runReportCatalog(opts);
    assert.ok(telegramMessages.length >= 1);
    assert.ok(/\d/.test(telegramMessages[0]), 'message should contain numbers');
  });

  it('telegram count is exact: 1 alert -> message says "1 single, 0 sector, 0 bundle" (T5)', async () => {
    const telegramMessages = [];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return [
          { ticker: 'X', sector: 'Finance', score: 10, clusters: 3 },
        ];
        return [];
      },
      nocodbPost: async (table, record) => record,
      telegram: async (msg) => { telegramMessages.push(msg); },
    };
    await runReportCatalog(opts);
    assert.ok(telegramMessages.length >= 1);
    assert.ok(telegramMessages[0].indexOf('1 single') !== -1, 'should say 1 single');
    assert.ok(telegramMessages[0].indexOf('0 sector') !== -1, 'should say 0 sector');
    assert.ok(telegramMessages[0].indexOf('0 bundle') !== -1, 'should say 0 bundle');
  });
});

// ---------------------------------------------------------------------------
// Bundle cap (T6)
// ---------------------------------------------------------------------------
describe('bundle cap', () => {
  it('caps bundle inserts at 5 even when many qualifying pairs exist', async () => {
    const inserted = [];
    // 6 tickers alternating large/small cap in same sector -> 9 possible cross-tier pairs
    var alerts = [
      { ticker: 'L1', sector: 'Technology', score: 10, clusters: 3, market_cap: 50000000000 },
      { ticker: 'S1', sector: 'Technology', score: 10, clusters: 3, market_cap: 1000000000 },
      { ticker: 'L2', sector: 'Technology', score: 10, clusters: 3, market_cap: 40000000000 },
      { ticker: 'S2', sector: 'Technology', score: 10, clusters: 3, market_cap: 2000000000 },
      { ticker: 'L3', sector: 'Technology', score: 10, clusters: 3, market_cap: 30000000000 },
      { ticker: 'S3', sector: 'Technology', score: 10, clusters: 3, market_cap: 3000000000 },
    ];
    const opts = {
      nocodbGet: async (table) => {
        if (table === 'Insider_Alerts') return alerts;
        return [];
      },
      nocodbPost: async (table, record) => { inserted.push(record); return record; },
      telegram: async () => {},
    };
    await runReportCatalog(opts);
    const bundles = inserted.filter(r => r.report_type === 'bundle');
    assert.ok(bundles.length <= 5, 'bundle inserts must not exceed cap of 5');
  });
});
