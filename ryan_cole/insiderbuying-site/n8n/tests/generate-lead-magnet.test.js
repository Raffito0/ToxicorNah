const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  gatherBacktestData,
  buildNarrativePrompt,
  buildLeadMagnetHTML,
  buildVersionRecord,
  STABLE_R2_KEY,
  // Section 06
  buildDynamicTitle,
  computeWhatIfSimulation,
  verifyMathAccuracy,
  extractLosersSection,
  buildLosersRetryPrompt,
  generateLeadMagnetNarrative,
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

// ---------------------------------------------------------------------------
// buildDynamicTitle
// ---------------------------------------------------------------------------
describe('buildDynamicTitle', () => {
  it('includes count of performers as "X Insider Buys"', () => {
    const performers = Array.from({ length: 17 }, function(_, i) { return { ticker: 'T' + i, return: 50 }; });
    const title = buildDynamicTitle(performers);
    assert.ok(title.includes('17 Insider Buys'), 'expected "17 Insider Buys" in: ' + title);
  });

  it('uses Math.floor of top return (not round)', () => {
    const performers = [{ ticker: 'AAPL', return: 340.7 }];
    const title = buildDynamicTitle(performers);
    assert.ok(title.includes('340%+'), 'expected "340%+" in: ' + title);
    assert.ok(!title.includes('341%'), 'should not round up to 341%');
  });

  it('includes current year', () => {
    const performers = [{ ticker: 'AAPL', return: 50 }];
    const title = buildDynamicTitle(performers);
    const year = String(new Date().getFullYear());
    assert.ok(title.includes(year), 'expected year ' + year + ' in: ' + title);
  });

  it('uses singular "Insider Buy" for count of 1', () => {
    const performers = [{ ticker: 'AAPL', return: 50 }];
    const title = buildDynamicTitle(performers);
    assert.ok(title.includes('1 Insider Buy'), 'expected singular in: ' + title);
    assert.ok(!title.includes('1 Insider Buys'), 'should not use plural for 1');
  });
});

// ---------------------------------------------------------------------------
// computeWhatIfSimulation
// ---------------------------------------------------------------------------
describe('computeWhatIfSimulation', () => {
  it('100% return on $10k yields $20k value', () => {
    const result = computeWhatIfSimulation([{ ticker: 'AAPL', return: 100 }]);
    assert.equal(result.perPick[0].value, 20000);
  });

  it('two picks compute correct totals', () => {
    const result = computeWhatIfSimulation([
      { ticker: 'AAPL', return: 50 },
      { ticker: 'MSFT', return: 200 },
    ]);
    assert.equal(result.totalInvested, 20000);
    assert.equal(result.totalValue, 45000);
  });

  it('values are integers (Math.round applied)', () => {
    const result = computeWhatIfSimulation([{ ticker: 'NVDA', return: 123.456 }]);
    assert.equal(result.perPick[0].value, Math.round(10000 * (1 + 123.456 / 100)));
    assert.equal(result.perPick[0].value % 1, 0);
  });

  it('empty array returns zeroed structure', () => {
    const result = computeWhatIfSimulation([]);
    assert.deepStrictEqual(result, { perPick: [], totalInvested: 0, totalValue: 0, totalReturn: 0 });
  });

  it('losing pick (-30%) yields $7000 (no clamp to zero)', () => {
    const result = computeWhatIfSimulation([{ ticker: 'X', return: -30 }]);
    assert.equal(result.perPick[0].value, 7000);
  });
});

// ---------------------------------------------------------------------------
// verifyMathAccuracy
// ---------------------------------------------------------------------------
describe('verifyMathAccuracy', () => {
  it('returns empty array when numbers match exactly', () => {
    const text = 'The data shows a 75% win rate across all alerts.';
    const result = verifyMathAccuracy(text, { winRate: 75, avgReturn: 120, portfolioValue: 45000 });
    assert.deepStrictEqual(result, []);
  });

  it('accepts win rate 1pp off (within tolerance)', () => {
    const text = 'showing a 76% win rate this month';
    const result = verifyMathAccuracy(text, { winRate: 75, avgReturn: 120, portfolioValue: 45000 });
    assert.deepStrictEqual(result, []);
  });

  it('flags win rate 2pp off as error', () => {
    const text = 'only a 73% win rate despite strong signals';
    const result = verifyMathAccuracy(text, { winRate: 75, avgReturn: 120, portfolioValue: 45000 });
    assert.ok(result.length >= 1);
    assert.ok(result[0].toLowerCase().includes('win'));
  });

  it('flags portfolio value off by more than 1%', () => {
    const text = 'total portfolio value reached $46,000 in one month';
    const result = verifyMathAccuracy(text, { winRate: 75, avgReturn: 120, portfolioValue: 45000 });
    assert.ok(result.length >= 1);
  });

  it('returns string[] (allows multiple errors)', () => {
    const result = verifyMathAccuracy('no numbers here', { winRate: 75, avgReturn: 120, portfolioValue: 45000 });
    assert.ok(Array.isArray(result));
  });
});

// ---------------------------------------------------------------------------
// extractLosersSection
// ---------------------------------------------------------------------------
describe('extractLosersSection', () => {
  it('500+ word div is accepted (wordCount >= 500)', () => {
    const inner = 'word '.repeat(520).trim();
    const text = '<div id="losers-section">' + inner + '</div>';
    const result = extractLosersSection(text);
    assert.ok(result.wordCount >= 500, 'expected >= 500, got ' + result.wordCount);
  });

  it('400-word div triggers retry (wordCount < 500)', () => {
    const inner = 'word '.repeat(400).trim();
    const text = '<div id="losers-section">' + inner + '</div>';
    const result = extractLosersSection(text);
    assert.ok(result.wordCount < 500, 'expected < 500, got ' + result.wordCount);
  });

  it('missing div returns wordCount of 0', () => {
    const text = 'Some narrative without the special div.';
    const result = extractLosersSection(text);
    assert.equal(result.wordCount, 0);
  });
});

// ---------------------------------------------------------------------------
// buildLosersRetryPrompt
// ---------------------------------------------------------------------------
describe('buildLosersRetryPrompt', () => {
  it('includes "what went wrong"', () => {
    const prompt = buildLosersRetryPrompt();
    assert.ok(prompt.toLowerCase().includes('what went wrong'));
  });

  it('includes "losers-section" div id', () => {
    const prompt = buildLosersRetryPrompt();
    assert.ok(prompt.includes('losers-section'));
  });
});

// ---------------------------------------------------------------------------
// generateLeadMagnetNarrative
// ---------------------------------------------------------------------------
describe('generateLeadMagnetNarrative', () => {
  const baseData = {
    alerts: [],
    hitRate: 65,
    avgReturn: 8.5,
    bestPerformer: { ticker: 'NVDA', return30d: 15, value: 1000000, insiderName: 'Test' },
    worstPerformer: { ticker: 'AAPL', return30d: -5, value: 500000, insiderName: 'Test2' },
    clusterPerformance: { count: 3, avgReturn: 12, hitRate: 80 },
    individualPerformance: { count: 7, avgReturn: 6, hitRate: 55 },
  };
  const baseWhatIf = { perPick: [], totalInvested: 20000, totalValue: 45000, totalReturn: 125 };
  const longText = 'word '.repeat(3900).trim();

  it('calls API with max_tokens 8192', async () => {
    let capturedBody;
    const mockFetch = async function(url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { json: async function() { return { content: [{ type: 'text', text: longText }] }; } };
    };
    await generateLeadMagnetNarrative(baseData, baseWhatIf, mockFetch);
    assert.equal(capturedBody.max_tokens, 8192);
  });

  it('includes anthropic-beta header with extended token value', async () => {
    let capturedHeaders;
    const mockFetch = async function(url, opts) {
      capturedHeaders = opts.headers;
      return { json: async function() { return { content: [{ type: 'text', text: longText }] }; } };
    };
    await generateLeadMagnetNarrative(baseData, baseWhatIf, mockFetch);
    assert.ok(
      capturedHeaders['anthropic-beta'] &&
      capturedHeaders['anthropic-beta'].includes('max-tokens-3-5-sonnet-2024-07-15'),
      'missing or wrong anthropic-beta header'
    );
  });

  it('includes pre-computed totalValue in prompt', async () => {
    let capturedBody;
    const mockFetch = async function(url, opts) {
      capturedBody = JSON.parse(opts.body);
      return { json: async function() { return { content: [{ type: 'text', text: longText }] }; } };
    };
    const whatIfData = { perPick: [], totalInvested: 20000, totalValue: 99999, totalReturn: 400 };
    await generateLeadMagnetNarrative(baseData, whatIfData, mockFetch);
    const prompt = capturedBody.messages[0].content;
    assert.ok(
      prompt.includes('99999') || prompt.includes('99,999'),
      'expected totalValue 99999 in prompt'
    );
  });

  it('retries once when word count is below 3800', async () => {
    let callCount = 0;
    const mockFetch = async function(url, opts) {
      callCount++;
      const text = callCount === 1 ? 'word '.repeat(100).trim() : longText;
      return { json: async function() { return { content: [{ type: 'text', text: text }] }; } };
    };
    await generateLeadMagnetNarrative(baseData, baseWhatIf, mockFetch);
    assert.equal(callCount, 2);
  });

  it('does not retry when word count is >= 3800', async () => {
    let callCount = 0;
    const mockFetch = async function(url, opts) {
      callCount++;
      return { json: async function() { return { content: [{ type: 'text', text: longText }] }; } };
    };
    await generateLeadMagnetNarrative(baseData, baseWhatIf, mockFetch);
    assert.equal(callCount, 1);
  });
});

// ---------------------------------------------------------------------------
// buildLeadMagnetHTML CTA blocks
// ---------------------------------------------------------------------------
describe('buildLeadMagnetHTML CTA blocks', () => {
  const data = {
    alerts: [{ ticker: 'NVDA', insiderName: 'Test', value: 100000, return30d: 5 }],
    hitRate: 65,
    avgReturn: 8.5,
    clusterPerformance: { avgReturn: 10, hitRate: 70 },
    individualPerformance: { avgReturn: 7, hitRate: 60 },
  };

  it('output contains exactly two cta-block elements', () => {
    const html = buildLeadMagnetHTML('Narrative text', data, 'March 2026');
    const matches = html.match(/class="cta-block"/g) || [];
    assert.equal(matches.length, 2);
  });

  it('first cta-block appears in the first half of HTML', () => {
    const html = buildLeadMagnetHTML('Narrative text', data, 'March 2026');
    const firstIdx = html.indexOf('cta-block');
    assert.ok(firstIdx < html.length / 2, 'first cta-block at index ' + firstIdx + ' should be < ' + (html.length / 2));
  });

  it('both cta-blocks link to earlyinsider.com/alerts', () => {
    const html = buildLeadMagnetHTML('Narrative text', data, 'March 2026');
    const count = (html.match(/earlyinsider\.com\/alerts/g) || []).length;
    assert.equal(count, 2);
  });
});

// ---------------------------------------------------------------------------
// buildLeadMagnetHTML worst performers table
// ---------------------------------------------------------------------------
describe('buildLeadMagnetHTML worst performers table', () => {
  const data = {
    alerts: [{ ticker: 'NVDA', insiderName: 'Test', value: 100000, return30d: 5 }],
    hitRate: 65,
    avgReturn: 8.5,
    clusterPerformance: { avgReturn: 10, hitRate: 70 },
    individualPerformance: { avgReturn: 7, hitRate: 60 },
  };
  const worstPerformers = [
    { ticker: 'AAPL', insiderName: 'Jane CFO', value: 500000, return30d: -10, whatWentWrong: 'Missed earnings' },
  ];

  it('worst performers table includes correct column headers', () => {
    const html = buildLeadMagnetHTML('Narrative text', data, 'March 2026', [], worstPerformers);
    assert.ok(html.includes('What Went Wrong'), 'missing "What Went Wrong" header');
    assert.ok(html.includes('worst-performers-table'), 'missing worst-performers-table class');
  });

  it('worst performers table appears after top performers table', () => {
    const html = buildLeadMagnetHTML('Narrative text', data, 'March 2026', [], worstPerformers);
    const topIdx = html.indexOf('top-performers-table');
    const worstIdx = html.indexOf('worst-performers-table');
    assert.ok(topIdx >= 0, 'top-performers-table not found');
    assert.ok(worstIdx >= 0, 'worst-performers-table not found');
    assert.ok(worstIdx > topIdx, 'worst table should come after top table');
  });
});
