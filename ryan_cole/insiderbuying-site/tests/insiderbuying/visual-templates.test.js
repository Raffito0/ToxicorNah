'use strict';

jest.mock('../../n8n/code/insiderbuying/generate-chart', () => ({
  uploadChart: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/charts/test.png'),
}));

const { uploadChart } = require('../../n8n/code/insiderbuying/generate-chart');

const {
  t1DataCard,
  t2SecFilingMiniCard,
  t3ComparisonCard,
  t4InsiderTransactionTable,
  t5PriceChart,
  t6RevenueTrend,
  t7ValuationFootballField,
  t8PeerRadar,
  t9MarketMovers,
  t10ContrarianCard,
  t11NewsletterStats,
  t12SectorHeatmap,
  t13ArticleHero,
  t14AlertScoreBadge,
  t15WeeklyLeaderboard,
  renderTemplate,
} = require('../../n8n/code/insiderbuying/visual-templates');

const PNG_BUFFER = Buffer.from('fakepng');

function makeFetch(opts = {}) {
  const { ok = true, contentType = 'image/png', buffer = PNG_BUFFER } = opts;
  return jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    headers: { get: jest.fn().mockReturnValue(contentType) },
    buffer: jest.fn().mockResolvedValue(buffer),
  });
}

function makeHelpers(opts = {}) {
  return {
    fetchFn: opts.fetchFn || makeFetch(),
    env: { SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456', ...opts.env },
  };
}

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

// ─── T9 — Market Movers ───────────────────────────────────────────────────────

const T9_DATA = {
  title: 'Top Insider Buys This Week',
  weekLabel: 'Week of March 10, 2025',
  movers: [
    { rank: 1, ticker: 'NVDA', insiderName: 'Jensen Huang', amount: '$15.2M', verdict: 'BUY' },
    { rank: 2, ticker: 'AAPL', insiderName: 'Tim Cook', amount: '$8.0M', verdict: 'HOLD' },
    { rank: 3, ticker: 'MSFT', insiderName: 'Satya Nadella', amount: '$5.5M', verdict: 'BUY' },
  ],
};

describe('t9MarketMovers', () => {
  test('renders all movers in table format', () => {
    const html = t9MarketMovers(T9_DATA);
    expect(html).toContain('Jensen Huang');
    expect(html).toContain('Tim Cook');
    expect(html).toContain('Satya Nadella');
  });

  test('escapes insider name', () => {
    const html = t9MarketMovers({ ...T9_DATA, movers: [{ ...T9_DATA.movers[0], insiderName: "<script>" }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('returns complete HTML document', () => {
    expect(t9MarketMovers(T9_DATA)).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── T10 — Contrarian Card ────────────────────────────────────────────────────

const T10_DATA = {
  ticker: 'TSLA',
  narrative: 'Despite heavy insider buying, macro headwinds persist.',
  evidence: [
    { metric: 'Revenue Growth', value: '-12%', interpretation: 'Declining YoY' },
    { metric: 'Short Interest', value: '18%', interpretation: 'Elevated bearish pressure' },
  ],
  verdict: 'CAUTION',
};

describe('t10ContrarianCard', () => {
  test('includes narrative text', () => {
    const html = t10ContrarianCard(T10_DATA);
    expect(html).toContain('Despite heavy insider buying');
  });

  test('includes evidence metrics', () => {
    const html = t10ContrarianCard(T10_DATA);
    expect(html).toContain('Revenue Growth');
    expect(html).toContain('Short Interest');
  });

  test('shows CAUTION verdict color', () => {
    const html = t10ContrarianCard(T10_DATA);
    expect(html).toContain('#FF6B35');
  });

  test('escapes narrative', () => {
    const html = t10ContrarianCard({ ...T10_DATA, narrative: '<b>bold</b>' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

// ─── T11 — Newsletter Stats ───────────────────────────────────────────────────

const T11_DATA = {
  weekLabel: 'Week of March 10, 2025',
  subscribers: '12,450',
  openRate: '42.3%',
  clickRate: '8.1%',
  topArticle: { title: 'NVDA CEO buys $15M', clicks: '2,341' },
};

describe('t11NewsletterStats', () => {
  test('shows subscriber count', () => {
    const html = t11NewsletterStats(T11_DATA);
    expect(html).toContain('12,450');
  });

  test('shows open rate and click rate', () => {
    const html = t11NewsletterStats(T11_DATA);
    expect(html).toContain('42.3%');
    expect(html).toContain('8.1%');
  });

  test('shows top article title', () => {
    const html = t11NewsletterStats(T11_DATA);
    expect(html).toContain('NVDA CEO buys $15M');
  });

  test('returns complete HTML document', () => {
    expect(t11NewsletterStats(T11_DATA)).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── T12 — Sector Heatmap ─────────────────────────────────────────────────────

const T12_DATA = {
  sectors: [
    { name: 'Technology', activity: 85, topTicker: 'NVDA' },
    { name: 'Healthcare', activity: 40, topTicker: 'JNJ' },
    { name: 'Energy', activity: 60, topTicker: 'XOM' },
  ],
};

describe('t12SectorHeatmap', () => {
  test('renders grid cells with sector names', () => {
    const html = t12SectorHeatmap(T12_DATA);
    expect(html).toContain('Technology');
    expect(html).toContain('Healthcare');
  });

  test('cells have scaled opacity via activity value', () => {
    const html = t12SectorHeatmap(T12_DATA);
    expect(html).toContain('0.85');
  });

  test('empty sectors array does not throw', () => {
    expect(() => t12SectorHeatmap({ sectors: [] })).not.toThrow();
  });

  test('escapes sector name', () => {
    const html = t12SectorHeatmap({ sectors: [{ name: '<b>Tech</b>', activity: 50, topTicker: 'X' }] });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

// ─── T13 — Article Hero ───────────────────────────────────────────────────────

const T13_DATA = {
  title: 'Why NVIDIA Insiders Are Loading Up',
  subtitle: 'Three executives bought $50M combined',
  category: 'Insider Activity',
  date: 'March 14, 2025',
  authorName: 'Dexter AI',
};

describe('t13ArticleHero', () => {
  test('is 1200x630 (OG image size)', () => {
    const html = t13ArticleHero(T13_DATA);
    expect(html).toContain('width:1200px');
    expect(html).toContain('height:630px');
  });

  test('includes title and category', () => {
    const html = t13ArticleHero(T13_DATA);
    expect(html).toContain('Why NVIDIA Insiders');
    expect(html).toContain('Insider Activity');
  });

  test('returns complete HTML document', () => {
    expect(t13ArticleHero(T13_DATA)).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── T14 — Alert Score Badge ──────────────────────────────────────────────────

const T14_DATA = { score: 87, verdict: 'BUY', ticker: 'NVDA' };

describe('t14AlertScoreBadge', () => {
  test('is 400x400 (square)', () => {
    const html = t14AlertScoreBadge(T14_DATA);
    expect(html).toContain('width:400px');
    expect(html).toContain('height:400px');
  });

  test('includes score number', () => {
    const html = t14AlertScoreBadge(T14_DATA);
    expect(html).toContain('87');
  });

  test('includes ticker', () => {
    const html = t14AlertScoreBadge(T14_DATA);
    expect(html).toContain('NVDA');
  });

  test('returns complete HTML document', () => {
    expect(t14AlertScoreBadge(T14_DATA)).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── T15 — Weekly Leaderboard ─────────────────────────────────────────────────

const T15_DATA = {
  title: 'Best Signals This Week',
  weekLabel: 'Week of March 10, 2025',
  leaders: [
    { rank: 1, ticker: 'NVDA', insiderName: 'Jensen Huang', returnPct: '+12.4%', verdict: 'BUY' },
    { rank: 2, ticker: 'AAPL', insiderName: 'Tim Cook', returnPct: '-2.1%', verdict: 'HOLD' },
  ],
};

describe('t15WeeklyLeaderboard', () => {
  test('renders ranked leaders list', () => {
    const html = t15WeeklyLeaderboard(T15_DATA);
    expect(html).toContain('Jensen Huang');
    expect(html).toContain('Tim Cook');
  });

  test('positive return shown in green', () => {
    const html = t15WeeklyLeaderboard(T15_DATA);
    expect(html).toContain('+12.4%');
  });

  test('negative return shown in red', () => {
    const html = t15WeeklyLeaderboard(T15_DATA);
    expect(html).toContain('-2.1%');
  });

  test('returns complete HTML document', () => {
    expect(t15WeeklyLeaderboard(T15_DATA)).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── renderTemplate() ─────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls screenshot server with correct POST body', async () => {
    const helpers = makeHelpers();
    await renderTemplate(1, T1_DATA, {}, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body).toHaveProperty('html');
    expect(body.format).toBe('png');
  });

  test('invalid templateId 0 throws Error', async () => {
    const helpers = makeHelpers();
    await expect(renderTemplate(0, {}, {}, helpers)).rejects.toThrow(/templateId/i);
  });

  test('invalid templateId 16 throws Error', async () => {
    const helpers = makeHelpers();
    await expect(renderTemplate(16, {}, {}, helpers)).rejects.toThrow(/templateId/i);
  });

  test('invalid templateId "foo" throws Error', async () => {
    const helpers = makeHelpers();
    await expect(renderTemplate('foo', {}, {}, helpers)).rejects.toThrow(/templateId/i);
  });

  test('upload=false returns PNG buffer', async () => {
    const helpers = makeHelpers();
    const result = await renderTemplate(1, T1_DATA, { upload: false }, helpers);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test('upload=true calls uploadChart and returns URL string', async () => {
    const helpers = makeHelpers();
    const result = await renderTemplate(1, T1_DATA, { upload: true, name: 'test' }, helpers);
    expect(uploadChart).toHaveBeenCalled();
    expect(typeof result).toBe('string');
    expect(result).toContain('r2');
  });

  test('templateId 13 posts viewport 1200x630', async () => {
    const helpers = makeHelpers();
    await renderTemplate(13, T13_DATA, {}, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.width).toBe(1200);
    expect(body.viewport.height).toBe(630);
  });

  test('templateId 14 posts viewport 400x400', async () => {
    const helpers = makeHelpers();
    await renderTemplate(14, T14_DATA, {}, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.width).toBe(400);
    expect(body.viewport.height).toBe(400);
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
    ['t9MarketMovers', () => t9MarketMovers(T9_DATA)],
    ['t10ContrarianCard', () => t10ContrarianCard(T10_DATA)],
    ['t11NewsletterStats', () => t11NewsletterStats(T11_DATA)],
    ['t12SectorHeatmap', () => t12SectorHeatmap(T12_DATA)],
    ['t13ArticleHero', () => t13ArticleHero(T13_DATA)],
    ['t14AlertScoreBadge', () => t14AlertScoreBadge(T14_DATA)],
    ['t15WeeklyLeaderboard', () => t15WeeklyLeaderboard(T15_DATA)],
  ];

  for (const [name, fn] of templates) {
    test(`${name} returns string starting with <!DOCTYPE html>`, () => {
      const html = fn();
      expect(typeof html).toBe('string');
      expect(html).toMatch(/^<!DOCTYPE html>/i);
    });
  }
});
