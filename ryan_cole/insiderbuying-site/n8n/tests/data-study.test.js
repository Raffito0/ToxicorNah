const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  STUDY_TOPICS,
  selectStudyTopic,
  aggregateData,
  generateAnalysisPrompt,
  buildChartsData,
  buildStudyRecord,
} = require('../code/insiderbuying/data-study.js');

// ---------------------------------------------------------------------------
// Study Topics
// ---------------------------------------------------------------------------
describe('STUDY_TOPICS', () => {
  it('has exactly 6 topics', () => {
    assert.equal(STUDY_TOPICS.length, 6);
  });

  it('each topic has title and description', () => {
    STUDY_TOPICS.forEach((t) => {
      assert.equal(typeof t.title, 'string');
      assert.ok(t.title.length > 0);
      assert.equal(typeof t.description, 'string');
    });
  });
});

// ---------------------------------------------------------------------------
// selectStudyTopic
// ---------------------------------------------------------------------------
describe('selectStudyTopic', () => {
  it('returns an object for each month', () => {
    for (let i = 0; i < 12; i++) {
      const topic = selectStudyTopic(i);
      assert.equal(typeof topic, 'object');
      assert.ok(topic.title);
    }
  });

  it('cycles through all 6 topics', () => {
    const seen = new Set();
    for (let i = 0; i < 6; i++) seen.add(selectStudyTopic(i).id);
    assert.equal(seen.size, 6);
  });

  it('month 0 and month 6 return same topic', () => {
    assert.equal(selectStudyTopic(0).id, selectStudyTopic(6).id);
  });
});

// ---------------------------------------------------------------------------
// aggregateData
// ---------------------------------------------------------------------------
describe('aggregateData', () => {
  const mockTopic = STUDY_TOPICS[0];
  const mockAlerts = [
    { ticker: 'NVDA', sector: 'Technology', significance_score: 8, value: 1000000, filing_date: '2026-03-01' },
    { ticker: 'AAPL', sector: 'Technology', significance_score: 9, value: 500000, filing_date: '2026-03-05' },
    { ticker: 'JPM', sector: 'Financials', significance_score: 7, value: 200000, filing_date: '2026-03-10' },
  ];
  const mockPrices = [
    { ticker: 'NVDA', return_30d: 15, return_60d: 20, return_90d: 25 },
    { ticker: 'AAPL', return_30d: -5, return_60d: 2, return_90d: 8 },
    { ticker: 'JPM', return_30d: 10, return_60d: 12, return_90d: 15 },
  ];

  it('returns object with transactions array', () => {
    const result = aggregateData(mockTopic, mockAlerts, mockPrices);
    assert.ok(Array.isArray(result.transactions));
  });

  it('returns statistics object with avgReturn30d', () => {
    const result = aggregateData(mockTopic, mockAlerts, mockPrices);
    assert.ok(result.statistics);
    assert.equal(typeof result.statistics.avgReturn30d, 'number');
    assert.equal(typeof result.statistics.hitRate30d, 'number');
  });

  it('returns sector breakdown as array', () => {
    const result = aggregateData(mockTopic, mockAlerts, mockPrices);
    assert.ok(Array.isArray(result.sectorBreakdown));
    assert.ok(result.sectorBreakdown.length > 0);
  });

  it('returns top performers sorted by return', () => {
    const result = aggregateData(mockTopic, mockAlerts, mockPrices);
    assert.ok(Array.isArray(result.topPerformers));
  });

  it('handles empty alerts', () => {
    const result = aggregateData(mockTopic, [], []);
    assert.deepStrictEqual(result.transactions, []);
    assert.equal(result.statistics.hitRate30d, 0);
  });
});

// ---------------------------------------------------------------------------
// generateAnalysisPrompt
// ---------------------------------------------------------------------------
describe('generateAnalysisPrompt', () => {
  const mockData = {
    transactions: [],
    statistics: { count: 10, avgReturn30d: 5, avgReturn60d: 8, avgReturn90d: 12, hitRate30d: 60, medianReturn30d: 4 },
    sectorBreakdown: [],
    topPerformers: [],
  };
  const mockTopic = { id: 'test', title: 'Cluster Buy Signals', description: 'Test desc', methodology: 'Test method' };

  it('returns a non-empty string', () => {
    const prompt = generateAnalysisPrompt(mockData, mockTopic);
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });

  it('includes the topic name', () => {
    const prompt = generateAnalysisPrompt(mockData, mockTopic);
    assert.ok(prompt.includes('Cluster Buy Signals'));
  });
});

// ---------------------------------------------------------------------------
// buildChartsData
// ---------------------------------------------------------------------------
describe('buildChartsData', () => {
  it('returns array of chart specs', () => {
    const charts = buildChartsData({ avgReturn: 10, hitRate: 65, sectorBreakdown: { Tech: 5 } });
    assert.ok(Array.isArray(charts));
    assert.ok(charts.length > 0);
  });

  it('each chart has type, title, and data', () => {
    const charts = buildChartsData({ avgReturn: 10, hitRate: 65, sectorBreakdown: {} });
    charts.forEach((c) => {
      assert.ok(['bar', 'line', 'scatter'].includes(c.type));
      assert.equal(typeof c.title, 'string');
      assert.ok(Array.isArray(c.data));
    });
  });
});

// ---------------------------------------------------------------------------
// buildStudyRecord
// ---------------------------------------------------------------------------
describe('buildStudyRecord', () => {
  it('returns object with all required fields', () => {
    const record = buildStudyRecord('Test Study', 'Analysis text', []);
    assert.equal(record.title, 'Test Study');
    assert.equal(record.status, 'published');
    assert.ok(record.published_at);
    assert.equal(typeof record.charts_data, 'string');
  });

  it('charts_data is valid JSON string', () => {
    const record = buildStudyRecord('Test', 'Text', [{ type: 'bar', title: 'T', data: [] }]);
    const parsed = JSON.parse(record.charts_data);
    assert.ok(Array.isArray(parsed));
  });
});
