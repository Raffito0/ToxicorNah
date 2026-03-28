const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGSCRequest,
  parseGSCResponse,
  detectChanges,
  buildAlertMessage,
  buildWeeklySummary,
} = require('../code/insiderbuying/seo-monitor.js');

// ---------------------------------------------------------------------------
// buildGSCRequest
// ---------------------------------------------------------------------------
describe('buildGSCRequest', () => {
  it('has correct dimensions: query and page', () => {
    const req = buildGSCRequest('https://insiderbuying.ai', '2026-03-01', '2026-03-07');
    assert.deepEqual(req.dimensions, ['query', 'page']);
  });

  it('includes startDate and endDate', () => {
    const req = buildGSCRequest('https://insiderbuying.ai', '2026-03-01', '2026-03-07');
    assert.equal(req.startDate, '2026-03-01');
    assert.equal(req.endDate, '2026-03-07');
  });

  it('requests up to 1000 rows', () => {
    const req = buildGSCRequest('https://insiderbuying.ai', '2026-03-01', '2026-03-07');
    assert.equal(req.rowLimit, 1000);
  });
});

// ---------------------------------------------------------------------------
// parseGSCResponse
// ---------------------------------------------------------------------------
describe('parseGSCResponse', () => {
  it('returns normalized array', () => {
    const data = {
      rows: [
        { keys: ['insider buying', '/blog/aapl'], position: 3.2, clicks: 50, impressions: 1000, ctr: 0.05 },
        { keys: ['sec filing'], position: 12.7, clicks: 5, impressions: 200, ctr: 0.025 },
      ],
    };
    const result = parseGSCResponse(data);
    assert.equal(result.length, 2);
    assert.equal(result[0].query, 'insider buying');
    assert.equal(result[0].page, '/blog/aapl');
    assert.equal(result[0].position, 3.2);
    assert.equal(result[0].clicks, 50);
    assert.equal(result[1].query, 'sec filing');
  });

  it('returns empty array for null data', () => {
    assert.deepEqual(parseGSCResponse(null), []);
    assert.deepEqual(parseGSCResponse({}), []);
  });

  it('handles missing keys gracefully', () => {
    const data = { rows: [{ keys: [], position: 5, clicks: 0, impressions: 0, ctr: 0 }] };
    const result = parseGSCResponse(data);
    assert.equal(result[0].query, '');
    assert.equal(result[0].page, '');
  });
});

// ---------------------------------------------------------------------------
// detectChanges
// ---------------------------------------------------------------------------
describe('detectChanges', () => {
  it('identifies improvements (position decreased by 5+)', () => {
    const current = [{ query: 'insider buying', page: '/blog', position: 5, clicks: 100 }];
    const previous = [{ query: 'insider buying', page: '/blog', position: 15, clicks: 50 }];
    const changes = detectChanges(current, previous);
    assert.equal(changes.improvements.length, 1);
    assert.equal(changes.improvements[0].query, 'insider buying');
    assert.equal(changes.improvements[0].change, 10);
  });

  it('identifies drops (position increased by 5+)', () => {
    const current = [{ query: 'sec filing', page: '/blog', position: 25, clicks: 10 }];
    const previous = [{ query: 'sec filing', page: '/blog', position: 15, clicks: 30 }];
    const changes = detectChanges(current, previous);
    assert.equal(changes.drops.length, 1);
    assert.equal(changes.drops[0].query, 'sec filing');
    assert.equal(changes.drops[0].change, -10);
  });

  it('identifies new rankings', () => {
    const current = [{ query: 'new keyword', page: '/new', position: 8, clicks: 5 }];
    const previous = [];
    const changes = detectChanges(current, previous);
    assert.equal(changes.newRankings.length, 1);
    assert.equal(changes.newRankings[0].query, 'new keyword');
  });

  it('identifies top 10 entries (was >10, now <=10)', () => {
    const current = [{ query: 'form 4 filing', page: '/blog', position: 7, clicks: 20 }];
    const previous = [{ query: 'form 4 filing', page: '/blog', position: 18, clicks: 5 }];
    const changes = detectChanges(current, previous);
    assert.equal(changes.top10Entries.length, 1);
    assert.equal(changes.top10Entries[0].query, 'form 4 filing');
    assert.equal(changes.top10Entries[0].previousPosition, 18);
  });

  it('also counts new rankings in top 10 as top10Entries', () => {
    const current = [{ query: 'brand new', page: '/x', position: 3, clicks: 10 }];
    const previous = [];
    const changes = detectChanges(current, previous);
    assert.equal(changes.top10Entries.length, 1);
    assert.equal(changes.newRankings.length, 1);
  });

  it('ignores small position changes (< 5)', () => {
    const current = [{ query: 'test', page: '/p', position: 10, clicks: 5 }];
    const previous = [{ query: 'test', page: '/p', position: 12, clicks: 5 }];
    const changes = detectChanges(current, previous);
    assert.equal(changes.improvements.length, 0);
    assert.equal(changes.drops.length, 0);
  });
});

// ---------------------------------------------------------------------------
// buildAlertMessage
// ---------------------------------------------------------------------------
describe('buildAlertMessage', () => {
  it('includes [+] for improvements', () => {
    const changes = {
      improvements: [{ query: 'insider buying', page: '/blog', position: 5, previousPosition: 15, change: 10, clicks: 50 }],
      drops: [],
      newRankings: [],
      top10Entries: [],
    };
    const msg = buildAlertMessage(changes);
    assert.ok(msg.indexOf('[+]') !== -1);
    assert.ok(msg.indexOf('insider buying') !== -1);
  });

  it('includes [-] for drops', () => {
    const changes = {
      improvements: [],
      drops: [{ query: 'sec filing', page: '/blog', position: 25, previousPosition: 15, change: -10, clicks: 5 }],
      newRankings: [],
      top10Entries: [],
    };
    const msg = buildAlertMessage(changes);
    assert.ok(msg.indexOf('[-]') !== -1);
    assert.ok(msg.indexOf('sec filing') !== -1);
  });

  it('shows no changes message when empty', () => {
    const changes = { improvements: [], drops: [], newRankings: [], top10Entries: [] };
    const msg = buildAlertMessage(changes);
    assert.ok(msg.indexOf('No significant') !== -1);
  });
});

// ---------------------------------------------------------------------------
// buildWeeklySummary
// ---------------------------------------------------------------------------
describe('buildWeeklySummary', () => {
  it('includes top keywords section', () => {
    const rankings = [
      { query: 'insider buying', page: '/blog', position: 3, clicks: 100, impressions: 2000, ctr: 0.05 },
      { query: 'sec filing', page: '/blog2', position: 8, clicks: 50, impressions: 800, ctr: 0.0625 },
    ];
    const summary = buildWeeklySummary(rankings);
    assert.ok(summary.indexOf('TOP 10 KEYWORDS') !== -1);
    assert.ok(summary.indexOf('insider buying') !== -1);
    assert.ok(summary.indexOf('Total Clicks') !== -1);
  });

  it('handles empty rankings', () => {
    const summary = buildWeeklySummary([]);
    assert.ok(summary.indexOf('No ranking data') !== -1);
  });

  it('includes opportunity keywords section for pos 11-20', () => {
    const rankings = [
      { query: 'top10', page: '/a', position: 5, clicks: 50, impressions: 500, ctr: 0.1 },
      { query: 'opportunity', page: '/b', position: 15, clicks: 10, impressions: 200, ctr: 0.05 },
    ];
    const summary = buildWeeklySummary(rankings);
    assert.ok(summary.indexOf('OPPORTUNITY') !== -1);
    assert.ok(summary.indexOf('opportunity') !== -1);
  });
});
