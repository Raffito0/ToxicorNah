'use strict';

jest.mock('../../n8n/code/insiderbuying/generate-chart', () => ({
  uploadChart: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/covers/test.png'),
}));

const { uploadChart } = require('../../n8n/code/insiderbuying/generate-chart');
const { renderCoverA, renderCoverB, renderCoverC, renderCoverD } = require('../../n8n/code/insiderbuying/report-covers');

const PNG_BUFFER = Buffer.from('fakepng');

function makeFetch(opts = {}) {
  const { ok = true, contentType = 'image/png', status = 200 } = opts;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: jest.fn().mockReturnValue(contentType) },
    buffer: jest.fn().mockResolvedValue(PNG_BUFFER),
  });
}

function makeHelpers(opts = {}) {
  return {
    fetchFn: opts.fetchFn || makeFetch(),
    env: { SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456' },
  };
}

const COVER_A_DATA = {
  ticker: 'NVDA',
  companyName: 'NVIDIA Corporation',
  logoUrl: null,
  verdict: 'BUY',
  price: '$875.40',
  marketCap: '$2.1T',
  insiderScore: 4,
  thesis: 'Data center boom drives unprecedented insider conviction.',
  date: 'March 2025',
};

const COVER_B_DATA = {
  sectorName: 'Technology',
  title: 'AI Infrastructure Dominance',
  stocks: [
    { ticker: 'NVDA', verdict: 'BUY', upside: '+34%' },
    { ticker: 'AMD', verdict: 'HOLD', upside: '+12%' },
    { ticker: 'INTC', verdict: 'SELL', upside: '-8%' },
  ],
};

const COVER_C_DATA = {
  title: 'Q1 2025 Insider Intelligence Bundle',
  stats: { totalPurchases: '47', avgUpside: '+28%', buyPct: '73%' },
  stocks: [
    { ticker: 'NVDA', verdict: 'BUY' },
    { ticker: 'AAPL', verdict: 'BUY' },
    { ticker: 'MSFT', verdict: 'HOLD' },
    { ticker: 'GOOGL', verdict: 'BUY' },
    { ticker: 'META', verdict: 'BUY' },
    { ticker: 'TSLA', verdict: 'CAUTION' },
    { ticker: 'AMZN', verdict: 'BUY' },
    { ticker: 'NFLX', verdict: 'HOLD' },
    { ticker: 'AMD', verdict: 'BUY' },
    { ticker: 'INTC', verdict: 'SELL' },
  ],
  pageCount: '127 pages',
};

const COVER_D_DATA = {
  title: 'The Insider Edge Report',
  subtitle: 'What CEOs are buying before earnings',
  stats: [
    { label: 'Stocks Analyzed', value: '127' },
    { label: 'Avg Upside', value: '+28%' },
    { label: 'Win Rate', value: '73%' },
  ],
  tickers: ['NVDA', 'AAPL', 'MSFT'],
  ctaText: 'Get the full report →',
};

// ─── Cover A ──────────────────────────────────────────────────────────────────

describe('renderCoverA', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns R2 URL on success', async () => {
    const url = await renderCoverA(COVER_A_DATA, makeHelpers());
    expect(typeof url).toBe('string');
    expect(url).toContain('r2');
  });

  test('HTML contains ticker and company name', async () => {
    const helpers = makeHelpers();
    await renderCoverA(COVER_A_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('NVDA');
    expect(body.html).toContain('NVIDIA Corporation');
  });

  test('escapes HTML in thesis text', async () => {
    const helpers = makeHelpers();
    await renderCoverA({ ...COVER_A_DATA, thesis: '<script>xss</script>' }, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });

  test('uses 1240x1754 viewport for A4', async () => {
    const helpers = makeHelpers();
    await renderCoverA(COVER_A_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.width).toBe(1240);
    expect(body.viewport.height).toBe(1754);
  });

  test('screenshot request includes deviceScaleFactor: 2', async () => {
    const helpers = makeHelpers();
    await renderCoverA(COVER_A_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.deviceScaleFactor).toBe(2);
  });

  test('calls uploadChart and returns URL', async () => {
    await renderCoverA(COVER_A_DATA, makeHelpers());
    expect(uploadChart).toHaveBeenCalledWith(PNG_BUFFER, expect.any(String), expect.anything());
  });

  test('propagates screenshot server error', async () => {
    const helpers = makeHelpers({ fetchFn: makeFetch({ ok: false, status: 500 }) });
    await expect(renderCoverA(COVER_A_DATA, helpers)).rejects.toThrow();
  });
});

// ─── Cover B ──────────────────────────────────────────────────────────────────

describe('renderCoverB', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders stock cards with tickers', async () => {
    const helpers = makeHelpers();
    await renderCoverB(COVER_B_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('NVDA');
    expect(body.html).toContain('AMD');
  });

  test('with fewer than 6 stocks does not throw', async () => {
    const helpers = makeHelpers();
    await expect(renderCoverB({
      sectorName: 'Tech',
      title: 'Test',
      stocks: [{ ticker: 'NVDA', verdict: 'BUY', upside: '+20%' }],
    }, helpers)).resolves.not.toThrow();
  });

  test('uses A4 viewport with deviceScaleFactor 2', async () => {
    const helpers = makeHelpers();
    await renderCoverB(COVER_B_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.deviceScaleFactor).toBe(2);
    expect(body.viewport.width).toBe(1240);
  });

  test('escapes sector name', async () => {
    const helpers = makeHelpers();
    await renderCoverB({ ...COVER_B_DATA, sectorName: '<b>Tech</b>' }, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).not.toContain('<b>');
    expect(body.html).toContain('&lt;b&gt;');
  });
});

// ─── Cover C ──────────────────────────────────────────────────────────────────

describe('renderCoverC', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders 10 ticker pills', async () => {
    const helpers = makeHelpers();
    await renderCoverC(COVER_C_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('NVDA');
    expect(body.html).toContain('INTC');
  });

  test('includes metric bar with stats', async () => {
    const helpers = makeHelpers();
    await renderCoverC(COVER_C_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('47');
    expect(body.html).toContain('+28%');
    expect(body.html).toContain('73%');
  });

  test('uses A4 viewport with deviceScaleFactor 2', async () => {
    const helpers = makeHelpers();
    await renderCoverC(COVER_C_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.deviceScaleFactor).toBe(2);
  });
});

// ─── Cover D ──────────────────────────────────────────────────────────────────

describe('renderCoverD', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses 1200x675 viewport (web size)', async () => {
    const helpers = makeHelpers();
    await renderCoverD(COVER_D_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.width).toBe(1200);
    expect(body.viewport.height).toBe(675);
  });

  test('does NOT use deviceScaleFactor: 2', async () => {
    const helpers = makeHelpers();
    await renderCoverD(COVER_D_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.deviceScaleFactor).toBeUndefined();
  });

  test('includes mesh gradient CSS', async () => {
    const helpers = makeHelpers();
    await renderCoverD(COVER_D_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('radial-gradient');
  });

  test('includes title and subtitle', async () => {
    const helpers = makeHelpers();
    await renderCoverD(COVER_D_DATA, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).toContain('The Insider Edge Report');
    expect(body.html).toContain('What CEOs are buying');
  });

  test('escapes title', async () => {
    const helpers = makeHelpers();
    await renderCoverD({ ...COVER_D_DATA, title: "<script>xss</script>" }, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });
});
