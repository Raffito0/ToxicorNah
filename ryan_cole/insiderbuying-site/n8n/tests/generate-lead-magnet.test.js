const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  gatherBacktestData,
  buildNarrativePrompt,
  buildLeadMagnetHTML,
  buildVersionRecord,
  STABLE_R2_KEY,
} = require('../code/insiderbuying/generate-lead-magnet.js');

// ---------------------------------------------------------------------------
// STABLE_R2_KEY
// ---------------------------------------------------------------------------
describe('STABLE_R2_KEY', () => {
  it('is the stable R2 key for lead magnet', () => {
    assert.equal(STABLE_R2_KEY, 'reports/lead-magnet-latest.pdf');
  });
});

// ---------------------------------------------------------------------------
// gatherBacktestData
// ---------------------------------------------------------------------------
describe('gatherBacktestData', () => {
  const alerts = [
    { ticker: 'NVDA', significance_score: 8, value: 1000000, filing_date: '2026-02-01', insider_name: 'John CEO' },
    { ticker: 'AAPL', significance_score: 9, value: 500000, filing_date: '2026-02-05', insider_name: 'Jane CFO' },
    { ticker: 'JPM', significance_score: 7, value: 300000, filing_date: '2026-02-15', insider_name: 'Bob Dir' },
  ];
  const priceData = [
    { ticker: 'NVDA', return_30d: 12 },
    { ticker: 'AAPL', return_30d: -2.5 },
    { ticker: 'JPM', return_30d: 6.7 },
  ];

  it('returns all passed alerts enriched', () => {
    const result = gatherBacktestData(alerts, priceData);
    assert.equal(result.alerts.length, 3);
  });

  it('enriches alerts with return data', () => {
    const result = gatherBacktestData(alerts, priceData);
    assert.ok(result.alerts[0].return30d !== undefined);
  });

  it('computes hit rate as number', () => {
    const result = gatherBacktestData(alerts, priceData);
    assert.equal(typeof result.hitRate, 'number');
    assert.ok(result.hitRate >= 0 && result.hitRate <= 100);
  });

  it('computes avgReturn as number', () => {
    const result = gatherBacktestData(alerts, priceData);
    assert.equal(typeof result.avgReturn, 'number');
  });

  it('identifies best and worst performers', () => {
    const result = gatherBacktestData(alerts, priceData);
    assert.ok(result.bestPerformer);
    assert.ok(result.worstPerformer);
    assert.ok(result.bestPerformer.ticker);
  });

  it('handles empty arrays', () => {
    const result = gatherBacktestData([], []);
    assert.deepStrictEqual(result.alerts, []);
    assert.equal(result.hitRate, 0);
    assert.equal(result.avgReturn, 0);
  });
});

// ---------------------------------------------------------------------------
// buildNarrativePrompt
// ---------------------------------------------------------------------------
describe('buildNarrativePrompt', () => {
  const baseData = {
    alerts: [],
    hitRate: 65,
    avgReturn: 8.5,
    bestPerformer: { ticker: 'NVDA', return30d: 15, value: 1000000, insiderName: 'Test' },
    worstPerformer: { ticker: 'AAPL', return30d: -5, value: 500000, insiderName: 'Test2' },
    clusterPerformance: { count: 3, avgReturn: 12, hitRate: 80 },
    individualPerformance: { count: 7, avgReturn: 6, hitRate: 55 },
  };

  it('returns non-empty string', () => {
    const prompt = buildNarrativePrompt(baseData);
    assert.ok(prompt.length > 50);
  });

  it('includes hit rate data', () => {
    const data = { ...baseData, hitRate: 72 };
    const prompt = buildNarrativePrompt(data);
    assert.ok(prompt.includes('72'));
  });

  it('mentions Pro upgrade', () => {
    const prompt = buildNarrativePrompt(baseData);
    assert.ok(prompt.toLowerCase().includes('pro') || prompt.toLowerCase().includes('upgrade') || prompt.toLowerCase().includes('real-time'));
  });
});

// ---------------------------------------------------------------------------
// buildLeadMagnetHTML
// ---------------------------------------------------------------------------
describe('buildLeadMagnetHTML', () => {
  it('returns HTML string', () => {
    const data = {
      alerts: [{ ticker: 'NVDA', insiderName: 'Test', value: 100000, return30d: 5 }],
      hitRate: 65,
      avgReturn: 8.5,
      clusterPerformance: { avgReturn: 10, hitRate: 70 },
      individualPerformance: { avgReturn: 7, hitRate: 60 },
    };
    const html = buildLeadMagnetHTML('## Narrative text here', data, 'March 2026');
    assert.ok(html.includes('<') && html.length > 100);
  });
});

// ---------------------------------------------------------------------------
// buildVersionRecord
// ---------------------------------------------------------------------------
describe('buildVersionRecord', () => {
  it('returns record with month_year and pdf_url', () => {
    const record = buildVersionRecord('2026-03', 'https://example.com/report.pdf', { hitRate: 65 });
    assert.equal(record.month_year, '2026-03');
    assert.equal(record.pdf_url, 'https://example.com/report.pdf');
  });

  it('includes hit_rate from stats', () => {
    const record = buildVersionRecord('2026-03', 'url', { hitRate: 65 });
    assert.equal(record.hit_rate, 65);
    assert.ok(record.generated_at);
  });
});
