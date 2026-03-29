'use strict';

// Mock render-pdf before requiring generate-chart
jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
  uploadToR2: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/charts/test.png'),
}));

const { uploadToR2 } = require('../../n8n/code/insiderbuying/render-pdf');
const {
  renderBarChart,
  renderLineChart,
  renderRadarChart,
  renderScatterChart,
  renderTableImage,
  uploadChart,
} = require('../../n8n/code/insiderbuying/generate-chart');

// ─── helpers ─────────────────────────────────────────────────────────────────

const PNG_BUFFER = Buffer.from('fakepng');

function makeFetch(opts = {}) {
  const { ok = true, contentType = 'image/png', buffer = PNG_BUFFER, status = 200 } = opts;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: jest.fn().mockReturnValue(contentType) },
    buffer: jest.fn().mockResolvedValue(buffer),
    text: jest.fn().mockResolvedValue('error body'),
  });
}

function makeHelpers(opts = {}) {
  return {
    fetchFn: opts.fetchFn || makeFetch(),
    env: { SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456', ...opts.env },
  };
}

const SAMPLE_BAR = {
  labels: ['Jan', 'Feb', 'Mar'],
  datasets: [{ label: 'Revenue', data: [100, 200, 150] }],
};

const SAMPLE_LINE = {
  labels: ['Q1', 'Q2', 'Q3'],
  datasets: [{ label: 'Price', data: [10, 20, 15] }],
};

const SAMPLE_RADAR = {
  labels: ['A', 'B', 'C', 'D', 'E', 'F'],
  datasets: [{ label: 'Subject', data: [80, 60, 70, 90, 50, 65] }],
};

const SAMPLE_SCATTER = {
  datasets: [{ label: 'Points', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
  xLabel: 'Market Cap',
  yLabel: 'Trade Size',
};

const SAMPLE_TABLE = {
  headers: ['Date', 'Insider', 'Shares', 'Type'],
  rows: [
    { values: ['2026-01-01', 'Jane Doe', '10000', 'Purchase'], type: 'purchase' },
    { values: ['2026-01-02', 'John Doe', '5000', 'Sale'], type: 'sale' },
    { values: ['2026-01-03', 'Bob Smith', '2000', null], type: null },
  ],
};

// ─── renderBarChart HTML tests ────────────────────────────────────────────────

describe('renderBarChart HTML generation', () => {
  let html;
  beforeAll(async () => {
    const helpers = makeHelpers();
    await renderBarChart(SAMPLE_BAR, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    html = JSON.parse(call[1].body).html;
  });

  test('HTML contains <canvas> element', () => {
    expect(html).toContain('<canvas');
  });

  test('HTML contains Chart.js CDN script tag', () => {
    expect(html).toContain('cdn.jsdelivr.net/npm/chart.js');
  });

  test('chart config has type "bar"', () => {
    expect(html).toContain('"type":"bar"');
  });

  test('HTML includes dataset label from input', () => {
    expect(html).toContain('Revenue');
  });
});

// ─── renderLineChart HTML tests ───────────────────────────────────────────────

describe('renderLineChart HTML generation', () => {
  test('with annotations includes annotation plugin CDN script', async () => {
    const helpers = makeHelpers();
    await renderLineChart({
      ...SAMPLE_LINE,
      annotations: [{ x: 'Q1', label: 'CEO bought here', color: '#28A745' }],
    }, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).toContain('chartjs-plugin-annotation');
  });

  test('without annotations does NOT include annotation plugin', async () => {
    const helpers = makeHelpers();
    await renderLineChart(SAMPLE_LINE, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).not.toContain('chartjs-plugin-annotation');
  });

  test('dual-axis: yAxisID right in datasets → two y-axes in config', async () => {
    const helpers = makeHelpers();
    await renderLineChart({
      labels: ['Q1', 'Q2'],
      datasets: [
        { label: 'Price', data: [10, 20], yAxisID: 'left' },
        { label: 'Volume', data: [1000, 2000], yAxisID: 'right' },
      ],
    }, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).toContain('"right"');
  });
});

// ─── renderRadarChart HTML tests ──────────────────────────────────────────────

describe('renderRadarChart HTML generation', () => {
  test('uses fixed 600x600 dimensions', async () => {
    const helpers = makeHelpers();
    await renderRadarChart({ ...SAMPLE_RADAR, width: 1200, height: 800 }, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.viewport.width).toBe(600);
    expect(body.viewport.height).toBe(600);
  });

  test('chart config has type "radar"', async () => {
    const helpers = makeHelpers();
    await renderRadarChart(SAMPLE_RADAR, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).toContain('"type":"radar"');
  });
});

// ─── renderScatterChart HTML tests ────────────────────────────────────────────

describe('renderScatterChart HTML generation', () => {
  test('config includes xLabel in axis options', async () => {
    const helpers = makeHelpers();
    await renderScatterChart(SAMPLE_SCATTER, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).toContain('Market Cap');
  });

  test('config includes yLabel in axis options', async () => {
    const helpers = makeHelpers();
    await renderScatterChart(SAMPLE_SCATTER, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const html = JSON.parse(call[1].body).html;
    expect(html).toContain('Trade Size');
  });
});

// ─── renderTableImage HTML tests ──────────────────────────────────────────────

describe('renderTableImage HTML generation', () => {
  let html;
  beforeAll(async () => {
    const helpers = makeHelpers();
    await renderTableImage(SAMPLE_TABLE, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    html = JSON.parse(call[1].body).html;
  });

  test('generates HTML with correct number of data rows', () => {
    // 3 data rows + 1 header row = 4 tr elements
    const matches = (html.match(/<tr/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(3);
  });

  test('applies green tint for purchase type rows', () => {
    expect(html).toContain('40,167,69');
  });

  test('applies red tint for sale type rows', () => {
    expect(html).toContain('220,53,69');
  });

  test('escapes HTML in cell values', async () => {
    const helpers = makeHelpers();
    await renderTableImage({
      headers: ['Name'],
      rows: [{ values: ['<script>alert(1)</script>'], type: null }],
    }, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    const h = JSON.parse(call[1].body).html;
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });
});

// ─── Screenshot server integration ───────────────────────────────────────────

describe('screenshot server integration', () => {
  test('chart render calls fetchFn POST to screenshot server URL', async () => {
    const helpers = makeHelpers();
    await renderBarChart(SAMPLE_BAR, helpers);
    const call = helpers.fetchFn.mock.calls[0];
    expect(call[0]).toContain('3456');
    expect(call[1].method).toBe('POST');
  });

  test('chart render sends { html, viewport, format: "png" } in POST body', async () => {
    const helpers = makeHelpers();
    await renderBarChart(SAMPLE_BAR, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body).toHaveProperty('html');
    expect(body).toHaveProperty('viewport');
    expect(body.format).toBe('png');
  });

  test('chart render returns PNG buffer from screenshot server response', async () => {
    const helpers = makeHelpers();
    const result = await renderBarChart(SAMPLE_BAR, helpers);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test('chart render throws on screenshot server 500 error', async () => {
    const helpers = makeHelpers({ fetchFn: makeFetch({ ok: false, status: 500 }) });
    await expect(renderBarChart(SAMPLE_BAR, helpers)).rejects.toThrow();
  });

  test('chart render throws on non-image content type', async () => {
    const helpers = makeHelpers({ fetchFn: makeFetch({ contentType: 'text/html' }) });
    await expect(renderBarChart(SAMPLE_BAR, helpers)).rejects.toThrow();
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('input validation', () => {
  test('width > 3000 gets clamped to 3000', async () => {
    const helpers = makeHelpers();
    await renderBarChart({ ...SAMPLE_BAR, width: 4000 }, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.width).toBeLessThanOrEqual(3000);
  });

  test('height < 200 gets clamped to 200', async () => {
    const helpers = makeHelpers();
    await renderBarChart({ ...SAMPLE_BAR, height: 50 }, helpers);
    const body = JSON.parse(helpers.fetchFn.mock.calls[0][1].body);
    expect(body.viewport.height).toBeGreaterThanOrEqual(200);
  });

  test('missing datasets throws descriptive error', async () => {
    const helpers = makeHelpers();
    await expect(renderBarChart({ labels: ['A'] }, helpers)).rejects.toThrow(/dataset/i);
  });

  test('empty labels array throws descriptive error', async () => {
    const helpers = makeHelpers();
    await expect(renderBarChart({ labels: [], datasets: [{ data: [] }] }, helpers))
      .rejects.toThrow(/label/i);
  });
});

// ─── uploadChart ─────────────────────────────────────────────────────────────

describe('uploadChart', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls uploadToR2 with key matching pattern', async () => {
    await uploadChart(PNG_BUFFER, 'test-chart', {});
    const key = uploadToR2.mock.calls[0][1];
    expect(key).toMatch(/^earlyinsider\/charts\/test-chart_\d+_[a-z0-9]{6}\.png$/);
  });

  test('key contains random suffix (not just timestamp)', async () => {
    const keys = [];
    for (let i = 0; i < 5; i++) {
      await uploadChart(PNG_BUFFER, 'x', {});
      keys.push(uploadToR2.mock.calls[i][1]);
    }
    // At least two different suffixes out of 5 calls
    const suffixes = keys.map(k => k.split('_').pop());
    const unique = new Set(suffixes);
    expect(unique.size).toBeGreaterThan(1);
  });

  test('returns R2 public URL string', async () => {
    const url = await uploadChart(PNG_BUFFER, 'my-chart', {});
    expect(typeof url).toBe('string');
    expect(url).toContain('r2');
  });
});
