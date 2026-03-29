'use strict';

const {
  t1DataCard,
  t2SecFilingMiniCard,
  t3ComparisonCard,
  t4InsiderTransactionTable,
  t5PriceChart,
  t6RevenueTrend,
  t7ValuationFootballField,
  t8PeerRadar,
} = require('../../n8n/code/insiderbuying/visual-templates');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const T1_DATA = {
  insiderPhotoUrl: 'https://example.com/photo.jpg',
  companyName: 'NVIDIA Corporation',
  ticker: 'NVDA',
  amount: '$15.2M',
  verdict: 'BUY',
  stats: [
    { label: 'Shares', value: '100,000' },
    { label: 'Price', value: '$152.00' },
    { label: 'Role', value: 'CEO' },
  ],
  date: 'March 14, 2025',
  watermark: 'earlyinsider.com',
};

const T2_DATA = {
  insiderPhotoUrl: null,
  insiderName: 'Jensen Huang',
  insiderTitle: 'Chief Executive Officer',
  ticker: 'NVDA',
  amount: '$15.2M',
  date: 'March 14, 2025',
  verdict: 'SELL',
};

const T3_DATA = {
  current: {
    ticker: 'NVDA',
    amount: '$15.2M',
    date: 'March 14, 2025',
  },
  historical: {
    description: 'Previous cluster buy: March 2020',
    outcome: '+34% in 6 months',
    timeframe: '6 months',
  },
};

const T4_DATA = {
  title: 'Recent Insider Transactions',
  transactions: [
    {
      insiderPhotoUrl: null,
      name: 'Jensen Huang',
      title: 'CEO',
      date: '2025-03-14',
      shares: '100,000',
      value: '$15.2M',
      type: 'purchase',
      change: '+4.2%',
    },
    {
      insiderPhotoUrl: null,
      name: 'Colette Kress',
      title: 'CFO',
      date: '2025-03-10',
      shares: '50,000',
      value: '$7.6M',
      type: 'sale',
      change: '-1.1%',
    },
  ],
};

const T5_DATA = {
  ticker: 'NVDA',
  priceHistory: [
    { date: 'Jan', price: 100 },
    { date: 'Feb', price: 120 },
    { date: 'Mar', price: 115 },
  ],
  buyDate: 'Feb',
  buyLabel: 'CEO bought $15M',
};

const T6_DATA = {
  ticker: 'NVDA',
  quarters: [
    { label: 'Q1 2024', revenue: 22.1, margin: 0.61 },
    { label: 'Q2 2024', revenue: 26.0, margin: 0.63 },
    { label: 'Q3 2024', revenue: 30.0, margin: 0.65 },
  ],
};

const T7_DATA = {
  ticker: 'NVDA',
  currentPrice: 130,
  methods: [
    { name: 'DCF', low: 100, high: 160 },
    { name: 'Comps', low: 110, high: 150 },
    { name: 'Analyst Target', low: 120, high: 170 },
  ],
};

const T8_DATA = {
  ticker: 'NVDA',
  subjectScores: { revenueGrowth: 90, margins: 85, valuation: 60, insiderActivity: 95, momentum: 80, analystRating: 88 },
  peerAvgScores:  { revenueGrowth: 60, margins: 55, valuation: 70, insiderActivity: 50, momentum: 65, analystRating: 70 },
};

// ─── T1 — Data Card ──────────────────────────────────────────────────────────

describe('t1DataCard', () => {
  test('returns HTML containing company name', () => {
    const html = t1DataCard(T1_DATA);
    expect(html).toContain('NVIDIA Corporation');
  });

  test('escapes HTML in company name', () => {
    const html = t1DataCard({ ...T1_DATA, companyName: "O'Reilly" });
    expect(html).toContain('O&#39;Reilly');
    expect(html).not.toContain("O'Reilly");
  });

  test('includes verdict badge with correct color for BUY', () => {
    const html = t1DataCard(T1_DATA);
    expect(html).toContain('#28A745');
  });

  test('returns complete HTML document', () => {
    const html = t1DataCard(T1_DATA);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });

  test('normalizes lowercase verdict', () => {
    const html = t1DataCard({ ...T1_DATA, verdict: 'buy' });
    expect(html).toContain('#28A745');
  });

  test('with undefined stats renders without throwing', () => {
    expect(() => t1DataCard({ ...T1_DATA, stats: undefined })).not.toThrow();
  });

  test('includes ticker', () => {
    const html = t1DataCard(T1_DATA);
    expect(html).toContain('NVDA');
  });

  test('includes amount', () => {
    const html = t1DataCard(T1_DATA);
    expect(html).toContain('$15.2M');
  });
});

// ─── T2 — SEC Filing Mini Card ────────────────────────────────────────────────

describe('t2SecFilingMiniCard', () => {
  test('returns HTML with ticker', () => {
    const html = t2SecFilingMiniCard(T2_DATA);
    expect(html).toContain('NVDA');
  });

  test('returns HTML with amount', () => {
    const html = t2SecFilingMiniCard(T2_DATA);
    expect(html).toContain('$15.2M');
  });

  test('escapes insider name', () => {
    const html = t2SecFilingMiniCard({ ...T2_DATA, insiderName: "O'Brien" });
    expect(html).toContain('O&#39;Brien');
  });

  test('with null insiderPhotoUrl renders without broken img', () => {
    const html = t2SecFilingMiniCard({ ...T2_DATA, insiderPhotoUrl: null });
    expect(html).not.toContain('src="null"');
    expect(html).not.toContain("src='null'");
  });

  test('normalizes verdict via normalizeVerdict', () => {
    const html = t2SecFilingMiniCard({ ...T2_DATA, verdict: 'sell' });
    expect(html).toContain('#DC3545');
  });
});

// ─── T3 — Comparison Card ────────────────────────────────────────────────────

describe('t3ComparisonCard', () => {
  test('includes current section', () => {
    const html = t3ComparisonCard(T3_DATA);
    expect(html).toContain('CURRENT');
  });

  test('includes historical section', () => {
    const html = t3ComparisonCard(T3_DATA);
    expect(html).toContain('LAST TIME');
  });

  test('includes historical outcome', () => {
    const html = t3ComparisonCard(T3_DATA);
    expect(html).toContain('+34% in 6 months');
  });

  test('with missing historical.outcome shows fallback text', () => {
    const data = { ...T3_DATA, historical: { ...T3_DATA.historical, outcome: '' } };
    const html = t3ComparisonCard(data);
    expect(html).toContain('Historical data unavailable');
  });

  test('escapes historical description', () => {
    const data = { ...T3_DATA, historical: { ...T3_DATA.historical, description: '<script>xss</script>' } };
    const html = t3ComparisonCard(data);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── T4 — Transaction Table ───────────────────────────────────────────────────

describe('t4InsiderTransactionTable', () => {
  test('renders all rows from transactions array', () => {
    const html = t4InsiderTransactionTable(T4_DATA);
    expect(html).toContain('Jensen Huang');
    expect(html).toContain('Colette Kress');
  });

  test('empty transactions array does not throw', () => {
    expect(() => t4InsiderTransactionTable({ title: 'Test', transactions: [] })).not.toThrow();
  });

  test('escapes transaction name', () => {
    const data = {
      ...T4_DATA,
      transactions: [{ ...T4_DATA.transactions[0], name: "O'Brien & Co" }],
    };
    const html = t4InsiderTransactionTable(data);
    expect(html).toContain('O&#39;Brien &amp; Co');
  });

  test('purchase rows have green tint', () => {
    const html = t4InsiderTransactionTable(T4_DATA);
    expect(html).toContain('40,167,69');
  });

  test('sale rows have red tint', () => {
    const html = t4InsiderTransactionTable(T4_DATA);
    expect(html).toContain('220,53,69');
  });
});

// ─── T5 — Price Chart ─────────────────────────────────────────────────────────

describe('t5PriceChart', () => {
  test('includes Chart.js CDN script tag', () => {
    const html = t5PriceChart(T5_DATA);
    expect(html).toContain('cdn.jsdelivr.net/npm/chart.js');
  });

  test('includes canvas element', () => {
    const html = t5PriceChart(T5_DATA);
    expect(html).toContain('<canvas');
  });

  test('includes annotation config for buyDate', () => {
    const html = t5PriceChart(T5_DATA);
    expect(html).toContain('chartjs-plugin-annotation');
  });

  test('returns complete HTML document', () => {
    const html = t5PriceChart(T5_DATA);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── T6 — Revenue Trend ───────────────────────────────────────────────────────

describe('t6RevenueTrend', () => {
  test('includes Chart.js CDN script', () => {
    const html = t6RevenueTrend(T6_DATA);
    expect(html).toContain('cdn.jsdelivr.net/npm/chart.js');
  });

  test('includes dual-axis config', () => {
    const html = t6RevenueTrend(T6_DATA);
    expect(html).toContain('"right"');
  });

  test('includes ticker', () => {
    const html = t6RevenueTrend(T6_DATA);
    expect(html).toContain('NVDA');
  });
});

// ─── T7 — Football Field ─────────────────────────────────────────────────────

describe('t7ValuationFootballField', () => {
  test('renders horizontal bars with method names', () => {
    const html = t7ValuationFootballField(T7_DATA);
    expect(html).toContain('DCF');
    expect(html).toContain('Comps');
  });

  test('shows current price marker', () => {
    const html = t7ValuationFootballField(T7_DATA);
    expect(html).toContain('130');
  });

  test('does NOT include Chart.js (pure CSS)', () => {
    const html = t7ValuationFootballField(T7_DATA);
    expect(html).not.toContain('chart.js');
  });

  test('includes CSS width percentages for bars', () => {
    const html = t7ValuationFootballField(T7_DATA);
    expect(html).toMatch(/%/);
  });
});

// ─── T8 — Peer Radar ─────────────────────────────────────────────────────────

describe('t8PeerRadar', () => {
  test('includes Chart.js radar config', () => {
    const html = t8PeerRadar(T8_DATA);
    expect(html).toContain('"type":"radar"');
  });

  test('radar has 6 axes labels', () => {
    const html = t8PeerRadar(T8_DATA);
    expect(html).toContain('Revenue Growth');
    expect(html).toContain('Insider Activity');
  });

  test('always uses 600x600 dimensions', () => {
    const html = t8PeerRadar(T8_DATA);
    expect(html).toContain('width:600px');
    expect(html).toContain('height:600px');
  });

  test('includes ticker', () => {
    const html = t8PeerRadar(T8_DATA);
    expect(html).toContain('NVDA');
  });
});

// ─── All templates return complete HTML ───────────────────────────────────────

describe('all templates return complete HTML documents', () => {
  const templates = [
    ['t1DataCard', () => t1DataCard(T1_DATA)],
    ['t2SecFilingMiniCard', () => t2SecFilingMiniCard(T2_DATA)],
    ['t3ComparisonCard', () => t3ComparisonCard(T3_DATA)],
    ['t4InsiderTransactionTable', () => t4InsiderTransactionTable(T4_DATA)],
    ['t5PriceChart', () => t5PriceChart(T5_DATA)],
    ['t6RevenueTrend', () => t6RevenueTrend(T6_DATA)],
    ['t7ValuationFootballField', () => t7ValuationFootballField(T7_DATA)],
    ['t8PeerRadar', () => t8PeerRadar(T8_DATA)],
  ];

  for (const [name, fn] of templates) {
    test(`${name} returns string starting with <!DOCTYPE html>`, () => {
      const html = fn();
      expect(typeof html).toBe('string');
      expect(html).toMatch(/^<!DOCTYPE html>/i);
    });
  }
});
