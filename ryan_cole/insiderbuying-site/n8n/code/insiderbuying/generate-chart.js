'use strict';

const { BASE_CSS, COLORS, escapeHtml } = require('./visual-css');
const { uploadToR2 } = require('./render-pdf');

const SCREENSHOT_URL = 'http://host.docker.internal:3456/screenshot';
const CHARTJS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const ANNOTATION_CDN = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3/dist/chartjs-plugin-annotation.min.js';

// ─── Shared render helper ─────────────────────────────────────────────────────

async function _renderToBuffer(html, width, height, helpers) {
  const url = (helpers.env && helpers.env.SCREENSHOT_SERVER_URL)
    ? `${helpers.env.SCREENSHOT_SERVER_URL}/screenshot`
    : SCREENSHOT_URL;

  const res = await helpers.fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      viewport: { width, height },
      format: 'png',
    }),
  });

  if (!res.ok) {
    throw new Error(`Screenshot server error: ${res.status}`);
  }

  const ct = res.headers.get('Content-Type') || res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) {
    throw new Error(`Screenshot server returned non-image content-type: ${ct}`);
  }

  return res.buffer();
}

// ─── Dimension clamping ───────────────────────────────────────────────────────

function clamp(val, defaultVal) {
  return Math.min(Math.max(Number(val) || defaultVal, 200), 3000);
}

// ─── Chart HTML builder ───────────────────────────────────────────────────────

function buildChartHtml(config, width, height, { useAnnotation = false } = {}) {
  const configJson = JSON.stringify(config);
  const annotationScript = useAnnotation
    ? `<script src="${ANNOTATION_CDN}"></script>\n  `
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_CSS}</style>
  <script src="${CHARTJS_CDN}"></script>
  ${annotationScript}</head>
<body style="width:${width}px;height:${height}px;margin:0;background:#0A1128;">
  <canvas id="chart" width="${width}" height="${height}"></canvas>
  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx, ${configJson});
  </script>
</body>
</html>`;
}

// ─── Shared chart style defaults ──────────────────────────────────────────────

const CHART_DEFAULTS = {
  animation: false,
  responsive: false,
  plugins: {
    legend: { labels: { color: '#FFFFFF' } },
  },
  scales: {
    x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
    y: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
  },
};

// ─── renderBarChart ───────────────────────────────────────────────────────────

async function renderBarChart(opts, helpers) {
  if (!opts.datasets || opts.datasets.length === 0) {
    throw new Error('renderBarChart: datasets is required and must be non-empty');
  }
  if (!opts.labels || opts.labels.length === 0) {
    throw new Error('renderBarChart: labels array is required and must be non-empty');
  }

  const w = clamp(opts.width, 800);
  const h = clamp(opts.height, 400);

  const config = {
    type: 'bar',
    data: {
      labels: opts.labels,
      datasets: opts.datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.backgroundColor || COLORS.blue,
      })),
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        title: opts.title ? { display: true, text: opts.title, color: '#FFFFFF' } : undefined,
      },
    },
  };

  const html = buildChartHtml(config, w, h);
  return _renderToBuffer(html, w, h, helpers);
}

// ─── renderLineChart ──────────────────────────────────────────────────────────

async function renderLineChart(opts, helpers) {
  if (!opts.datasets || opts.datasets.length === 0) {
    throw new Error('renderLineChart: datasets is required and must be non-empty');
  }
  if (!opts.labels || opts.labels.length === 0) {
    throw new Error('renderLineChart: labels array is required and must be non-empty');
  }

  const w = clamp(opts.width, 800);
  const h = clamp(opts.height, 400);

  const hasDualAxis = opts.datasets.some(ds => ds.yAxisID === 'right');
  const hasAnnotations = opts.annotations && opts.annotations.length > 0;

  const scales = hasDualAxis
    ? {
        x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        left: { position: 'left', grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        right: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8892A4' } },
      }
    : {
        x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        y: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
      };

  const annotationConfig = hasAnnotations
    ? {
        annotation: {
          annotations: opts.annotations.reduce((acc, ann, i) => {
            acc[`line${i}`] = {
              type: 'line',
              xMin: ann.x,
              xMax: ann.x,
              borderColor: ann.color || COLORS.green,
              borderWidth: 2,
              label: { content: ann.label, enabled: true, color: '#FFFFFF' },
            };
            return acc;
          }, {}),
        },
      }
    : {};

  const config = {
    type: 'line',
    data: {
      labels: opts.labels,
      datasets: opts.datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.borderColor || COLORS.blue,
        yAxisID: hasDualAxis ? (ds.yAxisID || 'left') : 'y',
        fill: false,
        tension: 0.4,
      })),
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: opts.title ? { display: true, text: opts.title, color: '#FFFFFF' } : undefined,
        ...annotationConfig,
      },
      scales,
    },
  };

  const html = buildChartHtml(config, w, h, { useAnnotation: hasAnnotations });
  return _renderToBuffer(html, w, h, helpers);
}

// ─── renderRadarChart ─────────────────────────────────────────────────────────

async function renderRadarChart(opts, helpers) {
  if (!opts.datasets || opts.datasets.length === 0) {
    throw new Error('renderRadarChart: datasets is required');
  }
  if (!opts.labels || opts.labels.length === 0) {
    throw new Error('renderRadarChart: labels array is required');
  }

  // Always 600x600
  const w = 600;
  const h = 600;

  const config = {
    type: 'radar',
    data: {
      labels: opts.labels,
      datasets: opts.datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: ds.borderColor || (i === 0 ? COLORS.blue : COLORS.textSecondary),
        backgroundColor: ds.backgroundColor || (i === 0 ? 'rgba(74,158,255,0.3)' : 'rgba(136,146,164,0.15)'),
      })),
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: opts.title ? { display: true, text: opts.title, color: '#FFFFFF' } : undefined,
      },
      scales: {
        r: {
          grid: { color: '#2A3548' },
          ticks: { color: '#8892A4', backdropColor: 'transparent' },
          pointLabels: { color: '#FFFFFF' },
        },
      },
    },
  };

  const html = buildChartHtml(config, w, h);
  return _renderToBuffer(html, w, h, helpers);
}

// ─── renderScatterChart ───────────────────────────────────────────────────────

async function renderScatterChart(opts, helpers) {
  if (!opts.datasets || opts.datasets.length === 0) {
    throw new Error('renderScatterChart: datasets is required');
  }

  const w = clamp(opts.width, 800);
  const h = clamp(opts.height, 500);

  const config = {
    type: 'scatter',
    data: {
      datasets: opts.datasets.map(ds => ({
        label: ds.label,
        data: ds.data,
        backgroundColor: ds.backgroundColor || COLORS.blue,
      })),
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: opts.title ? { display: true, text: opts.title, color: '#FFFFFF' } : undefined,
      },
      scales: {
        x: {
          grid: { color: '#2A3548' },
          ticks: { color: '#8892A4' },
          title: { display: true, text: opts.xLabel || '', color: '#FFFFFF' },
        },
        y: {
          grid: { color: '#2A3548' },
          ticks: { color: '#8892A4' },
          title: { display: true, text: opts.yLabel || '', color: '#FFFFFF' },
        },
      },
    },
  };

  const html = buildChartHtml(config, w, h);
  return _renderToBuffer(html, w, h, helpers);
}

// ─── renderTableImage ─────────────────────────────────────────────────────────

async function renderTableImage(opts, helpers) {
  if (!opts.headers) opts.headers = [];
  if (!opts.rows) opts.rows = [];

  const w = clamp(opts.width, 900);
  const h = clamp(opts.height, 500);

  const headers = opts.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');

  const rows = opts.rows.map(row => {
    const cells = (row.values || []).map(v => `<td>${escapeHtml(v)}</td>`).join('');
    let rowStyle = '';
    if (row.type === 'purchase') rowStyle = ' style="background:rgba(40,167,69,0.15);"';
    else if (row.type === 'sale') rowStyle = ' style="background:rgba(220,53,69,0.15);"';
    return `<tr${rowStyle}>${cells}</tr>`;
  }).join('\n');

  const title = opts.title ? `<h2 style="color:#FFFFFF;margin-bottom:12px;">${escapeHtml(opts.title)}</h2>` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${BASE_CSS}
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { background:#1A2238; color:#FFFFFF; padding:10px 12px; text-align:left; border-bottom:1px solid #2A3548; }
    td { padding:8px 12px; color:#FFFFFF; border-bottom:1px solid #2A3548; }
    tr:last-child td { border-bottom:none; }
  </style>
</head>
<body style="width:${w}px;height:${h}px;overflow:hidden;padding:20px;">
  ${title}
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  return _renderToBuffer(html, w, h, helpers);
}

// ─── uploadChart ──────────────────────────────────────────────────────────────

function _randomSuffix(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function uploadChart(buffer, name, helpers) {
  const key = `earlyinsider/charts/${name}_${Date.now()}_${_randomSuffix(6)}.png`;
  return uploadToR2(buffer, key);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  renderBarChart,
  renderLineChart,
  renderRadarChart,
  renderScatterChart,
  renderTableImage,
  uploadChart,
};
