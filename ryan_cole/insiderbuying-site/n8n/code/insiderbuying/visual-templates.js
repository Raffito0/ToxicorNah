'use strict';

const {
  escapeHtml,
  normalizeVerdict,
  VERDICTS,
  COLORS,
  wrapTemplate,
  BASE_CSS,
} = require('./visual-css');

const CHARTJS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const ANNOTATION_CDN = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3/dist/chartjs-plugin-annotation.min.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function avatarImg(url, size) {
  if (!url) return '';
  return `<img src="${escapeHtml(url)}" width="${size}" height="${size}" style="border-radius:50%;object-fit:cover;flex-shrink:0;" alt="">`;
}

function tickerPill(ticker) {
  return `<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:6px;font-weight:600;font-size:13px;border:1px solid ${COLORS.blue};color:${COLORS.blue};">${escapeHtml(ticker)}</span>`;
}

function verdictBadge(verdictKey, size) {
  const info = VERDICTS[verdictKey] || VERDICTS.HOLD;
  const fs = size === 'small' ? '11px' : '13px';
  const pad = size === 'small' ? '3px 10px' : '4px 14px';
  return `<span style="display:inline-block;padding:${pad};border-radius:20px;font-weight:700;font-size:${fs};letter-spacing:0.5px;border:1px solid ${info.color};color:${info.color};">${info.label}</span>`;
}

// ─── T1 — Data Card (1200×675) ────────────────────────────────────────────────

function t1DataCard(data) {
  const verdictKey = normalizeVerdict(data.verdict);
  const verdictInfo = VERDICTS[verdictKey];
  const stats = data.stats || [];

  const statsHtml = stats.map(s =>
    `<div style="text-align:center;flex:1;">
      <div style="color:${COLORS.textSecondary};font-size:12px;margin-bottom:4px;">${escapeHtml(s.label ?? 'N/A')}</div>
      <div style="color:${COLORS.textPrimary};font-size:16px;font-weight:600;">${escapeHtml(s.value ?? 'N/A')}</div>
    </div>`
  ).join('<div style="width:1px;background:rgba(255,255,255,0.08);"></div>');

  const inner = `
<div style="width:100%;height:100%;padding:40px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
  <div style="display:flex;align-items:center;gap:16px;">
    ${avatarImg(data.insiderPhotoUrl, 56)}
    <div style="flex:1;">
      <div style="font-size:22px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(data.companyName ?? '')}</div>
    </div>
    ${tickerPill(data.ticker ?? '')}
  </div>

  <div style="text-align:center;">
    <div style="font-size:52px;font-weight:800;color:${COLORS.textPrimary};letter-spacing:-1px;">${escapeHtml(data.amount ?? '')}</div>
    <div style="margin-top:12px;">${verdictBadge(verdictKey)}</div>
  </div>

  <div style="display:flex;align-items:stretch;background:rgba(26,34,56,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 24px;">
    ${statsHtml}
  </div>

  <div style="display:flex;justify-content:space-between;align-items:center;">
    <span style="color:${COLORS.textSecondary};font-size:13px;">${escapeHtml(data.date ?? '')}</span>
    ${data.watermark ? `<span style="color:${COLORS.textSecondary};font-size:12px;opacity:0.6;">${escapeHtml(data.watermark)}</span>` : ''}
  </div>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T2 — SEC Filing Mini Card (600×337) ─────────────────────────────────────

function t2SecFilingMiniCard(data) {
  const verdictKey = normalizeVerdict(data.verdict);

  const inner = `
<div style="width:100%;height:100%;padding:28px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
  <div style="display:flex;gap:24px;align-items:center;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:120px;flex-shrink:0;">
      ${avatarImg(data.insiderPhotoUrl, 48)}
      <div style="font-size:14px;font-weight:600;color:${COLORS.textPrimary};text-align:center;">${escapeHtml(data.insiderName ?? '')}</div>
      <div style="font-size:11px;color:${COLORS.textSecondary};text-align:center;">${escapeHtml(data.insiderTitle ?? '')}</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:32px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(data.ticker ?? '')}</div>
      <div style="font-size:22px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(data.amount ?? '')}</div>
      <div style="font-size:12px;color:${COLORS.textSecondary};">${escapeHtml(data.date ?? '')}</div>
    </div>
  </div>
  <div style="text-align:center;">${verdictBadge(verdictKey, 'small')}</div>
</div>`;

  return wrapTemplate(inner, 600, 337);
}

// ─── T3 — Comparison Card (1200×675) ─────────────────────────────────────────

function t3ComparisonCard(data) {
  const current = data.current || {};
  const historical = data.historical || {};
  const outcome = historical.outcome || '';
  const outcomeHtml = outcome
    ? `<div style="font-size:28px;font-weight:700;color:${COLORS.green};">${escapeHtml(outcome)}</div>`
    : `<div style="font-size:16px;color:${COLORS.textSecondary};">Historical data unavailable</div>`;

  const inner = `
<div style="width:100%;height:100%;padding:48px;display:flex;gap:0;box-sizing:border-box;">
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;padding-right:48px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:${COLORS.textSecondary};">CURRENT</div>
    <div style="font-size:36px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(current.ticker ?? '')}</div>
    <div style="font-size:24px;font-weight:600;color:${COLORS.textPrimary};">${escapeHtml(current.amount ?? '')}</div>
    <div style="font-size:14px;color:${COLORS.textSecondary};">${escapeHtml(current.date ?? '')}</div>
  </div>
  <div style="width:1px;background:linear-gradient(to bottom, transparent, rgba(255,255,255,0.15), transparent);flex-shrink:0;"></div>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;padding-left:48px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:${COLORS.textSecondary};">LAST TIME</div>
    <div style="font-size:14px;color:${COLORS.textSecondary};">${escapeHtml(historical.description ?? '')}</div>
    ${outcomeHtml}
    ${historical.timeframe ? `<div style="font-size:13px;color:${COLORS.textSecondary};">timeframe: ${escapeHtml(historical.timeframe)}</div>` : ''}
  </div>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T4 — Insider Transaction Table (1200×675) ────────────────────────────────

function t4InsiderTransactionTable(data) {
  const transactions = data.transactions || [];

  const rows = transactions.map(tx => {
    const bg = tx.type === 'purchase'
      ? 'background:rgba(40,167,69,0.1);'
      : tx.type === 'sale'
        ? 'background:rgba(220,53,69,0.1);'
        : '';
    return `<tr style="${bg}">
      <td style="padding:8px 12px;color:${COLORS.textPrimary};border-bottom:1px solid ${COLORS.bgBorder};">
        ${avatarImg(tx.insiderPhotoUrl, 32)}
        ${escapeHtml(tx.name ?? '')}
      </td>
      <td style="padding:8px 12px;color:${COLORS.textSecondary};border-bottom:1px solid ${COLORS.bgBorder};">${escapeHtml(tx.title ?? '')}</td>
      <td style="padding:8px 12px;color:${COLORS.textSecondary};border-bottom:1px solid ${COLORS.bgBorder};">${escapeHtml(tx.date ?? '')}</td>
      <td style="padding:8px 12px;color:${COLORS.textPrimary};border-bottom:1px solid ${COLORS.bgBorder};">${escapeHtml(tx.shares ?? '')}</td>
      <td style="padding:8px 12px;color:${COLORS.textPrimary};font-weight:600;border-bottom:1px solid ${COLORS.bgBorder};">${escapeHtml(tx.value ?? '')}</td>
      <td style="padding:8px 12px;color:${String(tx.change || '').startsWith('-') ? COLORS.red : COLORS.green};border-bottom:1px solid ${COLORS.bgBorder};">${escapeHtml(tx.change ?? '')}</td>
    </tr>`;
  }).join('');

  const inner = `
<div style="width:100%;height:100%;padding:32px;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="font-size:18px;font-weight:700;color:${COLORS.textPrimary};margin-bottom:20px;">${escapeHtml(data.title ?? '')}</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:${COLORS.bgSecondary};">
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Name</th>
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Title</th>
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Date</th>
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Shares</th>
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Value</th>
        <th style="padding:10px 12px;color:${COLORS.textPrimary};text-align:left;font-weight:600;border-bottom:2px solid ${COLORS.bgBorder};">Change</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T5 — Price Chart with Buy Marker (1200×675) ──────────────────────────────

function t5PriceChart(data) {
  const priceHistory = data.priceHistory || [];
  const volumeData = data.volumeData || [];
  const hasVolume = volumeData.length > 0;

  const datasets = hasVolume
    ? [
        { label: 'Price', data: priceHistory.map(p => p.price), borderColor: COLORS.blue, yAxisID: 'left', fill: false, tension: 0.4 },
        { label: 'Volume', data: volumeData.map(v => v.volume), borderColor: COLORS.green, yAxisID: 'right', fill: false, tension: 0.4 },
      ]
    : [{ label: 'Price', data: priceHistory.map(p => p.price), borderColor: COLORS.blue, yAxisID: 'y', fill: false, tension: 0.4 }];

  const scales = hasVolume
    ? {
        x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        left: { position: 'left', grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        right: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8892A4' } },
      }
    : {
        x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        y: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
      };

  const config = {
    type: 'line',
    data: {
      labels: priceHistory.map(p => p.date),
      datasets,
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: { display: true, text: String(data.ticker || '') + ' Price History', color: '#FFFFFF' },
        annotation: {
          annotations: {
            buyLine: {
              type: 'line',
              xMin: data.buyDate || '',
              xMax: data.buyDate || '',
              borderColor: COLORS.green,
              borderWidth: 2,
              label: { content: data.buyLabel || 'Buy', enabled: true, color: '#FFFFFF' },
            },
          },
        },
      },
      scales,
    },
  };

  const w = 1200;
  const h = 675;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_CSS}</style>
  <script src="${CHARTJS_CDN}"></script>
  <script src="${ANNOTATION_CDN}"></script>
</head>
<body style="width:${w}px;height:${h}px;overflow:hidden;padding:20px;">
  <canvas id="chart" width="1160" height="635"></canvas>
  <script>
    new Chart(document.getElementById('chart').getContext('2d'), ${JSON.stringify(config)});
  </script>
</body>
</html>`;
}

// ─── T6 — Revenue Trend (1200×675) ───────────────────────────────────────────

function t6RevenueTrend(data) {
  const quarters = data.quarters || [];

  const config = {
    type: 'bar',
    data: {
      labels: quarters.map(q => q.label),
      datasets: [
        {
          label: 'Revenue ($B)',
          data: quarters.map(q => q.revenue),
          backgroundColor: COLORS.blue,
          yAxisID: 'left',
          order: 2,
        },
        {
          label: 'Gross Margin %',
          data: quarters.map(q => Math.round(q.margin * 100)),
          borderColor: COLORS.yellow,
          type: 'line',
          fill: false,
          tension: 0.4,
          yAxisID: 'right',
          order: 1,
        },
      ],
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: { display: true, text: String(data.ticker || '') + ' Revenue Trend', color: '#FFFFFF' },
      },
      scales: {
        x: { grid: { color: '#2A3548' }, ticks: { color: '#8892A4' } },
        left: { position: 'left', grid: { color: '#2A3548' }, ticks: { color: '#8892A4' }, title: { display: true, text: 'Revenue ($B)', color: '#FFFFFF' } },
        right: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8892A4' }, title: { display: true, text: 'Margin %', color: '#FFFFFF' } },
      },
    },
  };

  const w = 1200;
  const h = 675;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_CSS}</style>
  <script src="${CHARTJS_CDN}"></script>
</head>
<body style="width:${w}px;height:${h}px;overflow:hidden;padding:20px;">
  <canvas id="chart" width="1160" height="635"></canvas>
  <script>
    new Chart(document.getElementById('chart').getContext('2d'), ${JSON.stringify(config)});
  </script>
</body>
</html>`;
}

// ─── T7 — Valuation Football Field (1200×675) ────────────────────────────────

function t7ValuationFootballField(data) {
  const methods = data.methods || [];
  const currentPrice = data.currentPrice || 0;

  const allHighs = methods.map(m => m.high).concat([currentPrice]);
  const maxHigh = Math.max(...allHighs, 1);

  const bars = methods.map(m => {
    const leftPct = (m.low / maxHigh) * 100;
    const widthPct = ((m.high - m.low) / maxHigh) * 100;
    const currentPct = (currentPrice / maxHigh) * 100;
    return `
<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
  <div style="width:120px;flex-shrink:0;font-size:13px;color:${COLORS.textSecondary};text-align:right;">${escapeHtml(m.name ?? '')}</div>
  <div style="flex:1;position:relative;height:28px;background:${COLORS.bgSecondary};border-radius:4px;">
    <div style="position:absolute;left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;height:100%;background:linear-gradient(90deg, #2A3548, ${COLORS.blue});border-radius:4px;"></div>
    <div style="position:absolute;left:${currentPct.toFixed(1)}%;top:0;height:100%;width:2px;background:${COLORS.yellow};z-index:10;"></div>
  </div>
  <div style="width:60px;flex-shrink:0;font-size:12px;color:${COLORS.textSecondary};">${escapeHtml(String(m.low ?? ''))}–${escapeHtml(String(m.high ?? ''))}</div>
</div>`;
  }).join('');

  const inner = `
<div style="width:100%;height:100%;padding:48px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;">
  <div style="font-size:20px;font-weight:700;color:${COLORS.textPrimary};margin-bottom:8px;">${escapeHtml(data.ticker ?? '')} Valuation Range</div>
  <div style="font-size:13px;color:${COLORS.textSecondary};margin-bottom:32px;">Current Price: <span style="color:${COLORS.yellow};font-weight:600;">$${escapeHtml(String(currentPrice))}</span></div>
  ${bars}
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T8 — Peer Radar (600×600) ───────────────────────────────────────────────

function t8PeerRadar(data) {
  const subject = data.subjectScores || {};
  const peer = data.peerAvgScores || {};
  const axes = ['revenueGrowth', 'margins', 'valuation', 'insiderActivity', 'momentum', 'analystRating'];
  const axisLabels = ['Revenue Growth', 'Margins', 'Valuation', 'Insider Activity', 'Momentum', 'Analyst Rating'];

  const config = {
    type: 'radar',
    data: {
      labels: axisLabels,
      datasets: [
        {
          label: String(data.ticker || ''),
          data: axes.map(k => subject[k] ?? 0),
          borderColor: COLORS.blue,
          backgroundColor: 'rgba(74,158,255,0.3)',
        },
        {
          label: 'Peer Avg',
          data: axes.map(k => peer[k] ?? 0),
          borderColor: COLORS.textSecondary,
          backgroundColor: 'rgba(136,146,164,0.15)',
        },
      ],
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { labels: { color: '#FFFFFF' } },
        title: { display: true, text: String(data.ticker || '') + ' vs Peers', color: '#FFFFFF' },
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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_CSS}</style>
  <script src="${CHARTJS_CDN}"></script>
</head>
<body style="width:600px;height:600px;overflow:hidden;padding:20px;">
  <canvas id="chart" width="560" height="560"></canvas>
  <script>
    new Chart(document.getElementById('chart').getContext('2d'), ${JSON.stringify(config)});
  </script>
</body>
</html>`;
}

// ─── T9 — Market Movers (1200×675) ───────────────────────────────────────────

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

function t9MarketMovers(data) {
  const movers = data.movers || [];

  const rows = movers.map((m, i) => {
    const verdictKey = normalizeVerdict(m.verdict);
    const rankColor = RANK_COLORS[i] || COLORS.textSecondary;
    return `
<div style="display:flex;align-items:center;gap:16px;padding:14px 20px;background:rgba(26,34,56,0.6);border-radius:8px;margin-bottom:8px;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:2px solid ${rankColor};color:${rankColor};font-weight:700;font-size:14px;flex-shrink:0;">${escapeHtml(String(m.rank ?? i + 1))}</span>
  <div style="width:80px;flex-shrink:0;font-size:18px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(m.ticker ?? '')}</div>
  <div style="flex:1;color:${COLORS.textSecondary};font-size:14px;">${escapeHtml(m.insiderName ?? '')}</div>
  <div style="font-size:16px;font-weight:600;color:${COLORS.textPrimary};">${escapeHtml(m.amount ?? '')}</div>
  <div style="width:80px;text-align:right;">${verdictBadge(verdictKey, 'small')}</div>
</div>`;
  }).join('');

  const inner = `
<div style="width:100%;height:100%;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px;">
    <div style="font-size:22px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(data.title ?? '')}</div>
    <div style="font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(data.weekLabel ?? '')}</div>
  </div>
  ${rows}
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T10 — Contrarian Card (1200×675) ────────────────────────────────────────

function t10ContrarianCard(data) {
  const verdictKey = normalizeVerdict(data.verdict);
  const evidence = data.evidence || [];

  const evidenceHtml = evidence.map(e =>
    `<div style="display:flex;gap:16px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="width:160px;flex-shrink:0;font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(e.metric ?? '')}</div>
      <div style="width:80px;flex-shrink:0;font-size:14px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(e.value ?? '')}</div>
      <div style="flex:1;font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(e.interpretation ?? '')}</div>
    </div>`
  ).join('');

  const inner = `
<div style="width:100%;height:100%;padding:48px;box-sizing:border-box;display:flex;flex-direction:column;gap:24px;">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:28px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(data.ticker ?? '')}</div>
    ${verdictBadge(verdictKey)}
  </div>
  <div style="font-size:18px;font-style:italic;color:${COLORS.textSecondary};line-height:1.6;">${escapeHtml(data.narrative ?? '')}</div>
  <div style="flex:1;">${evidenceHtml}</div>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T11 — Newsletter Stats (1200×675) ───────────────────────────────────────

function t11NewsletterStats(data) {
  const topArticle = data.topArticle || {};

  function statCard(label, value) {
    return `
<div style="flex:1;background:rgba(26,34,56,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:28px 24px;text-align:center;">
  <div style="font-size:36px;font-weight:800;color:${COLORS.textPrimary};margin-bottom:8px;">${escapeHtml(value ?? '')}</div>
  <div style="font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(label)}</div>
</div>`;
  }

  const inner = `
<div style="width:100%;height:100%;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;gap:24px;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;">
    <div style="font-size:20px;font-weight:700;color:${COLORS.textPrimary};">Newsletter Performance</div>
    <div style="font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(data.weekLabel ?? '')}</div>
  </div>
  <div style="display:flex;gap:20px;">
    ${statCard('Subscribers', data.subscribers ?? '')}
    ${statCard('Open Rate', data.openRate ?? '')}
    ${statCard('Click Rate', data.clickRate ?? '')}
  </div>
  <div style="background:rgba(26,34,56,0.6);border-radius:8px;padding:20px;">
    <div style="font-size:12px;color:${COLORS.textSecondary};margin-bottom:8px;">TOP ARTICLE THIS WEEK</div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:16px;font-weight:600;color:${COLORS.textPrimary};">${escapeHtml(topArticle.title ?? '')}</div>
      <div style="font-size:14px;color:${COLORS.blue};">${escapeHtml(topArticle.clicks ?? '')} clicks</div>
    </div>
  </div>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T12 — Sector Activity Heatmap (1200×675) ────────────────────────────────

function t12SectorHeatmap(data) {
  const sectors = data.sectors || [];

  const cells = sectors.map(s => {
    const activity = Number(s.activity) || 0;
    const opacity = (activity / 100).toFixed(2);
    return `
<div style="background:rgba(40,167,69,${opacity});border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:6px;">
  <div style="font-size:12px;color:${COLORS.textSecondary};">${escapeHtml(s.name ?? '')}</div>
  <div style="font-size:20px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(s.topTicker ?? '')}</div>
  <div style="font-size:11px;color:${COLORS.textSecondary};">${escapeHtml(String(activity))}% activity</div>
</div>`;
  }).join('');

  const inner = `
<div style="width:100%;height:100%;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;gap:24px;">
  <div style="font-size:20px;font-weight:700;color:${COLORS.textPrimary};">Sector Activity Heatmap</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:1;">
    ${cells}
  </div>
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── T13 — Article Hero (1200×630) ───────────────────────────────────────────
// Fields: headline, ticker, verdict, insiderName, date

function t13ArticleHero(data) {
  const verdictKey = normalizeVerdict(data.verdict);
  const verdictInfo = VERDICTS[verdictKey] || { color: COLORS.blue, label: data.verdict || '' };

  const inner = `
<div style="width:100%;height:100%;padding:64px 72px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#0A1128 0%,#1A2238 100%);">
  <div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
      <span style="display:inline-block;padding:4px 14px;border-radius:20px;border:1px solid ${verdictInfo.color};color:${verdictInfo.color};font-size:12px;font-weight:700;letter-spacing:1px;">${escapeHtml(data.ticker ?? '')}</span>
      <span style="display:inline-block;padding:4px 14px;border-radius:20px;background:${verdictInfo.color}22;border:1px solid ${verdictInfo.color};color:${verdictInfo.color};font-size:12px;font-weight:700;letter-spacing:1px;">${escapeHtml(verdictInfo.label)}</span>
    </div>
    <div style="font-size:48px;font-weight:800;color:${COLORS.textPrimary};line-height:1.15;max-width:900px;">${escapeHtml(data.headline ?? '')}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:14px;color:${COLORS.textSecondary};">${escapeHtml(data.insiderName ?? '')} &middot; ${escapeHtml(data.date ?? '')}</div>
    <div style="font-size:12px;font-weight:700;color:${verdictInfo.color};letter-spacing:1px;">EARLYINSIDER.COM</div>
  </div>
</div>`;

  return wrapTemplate(inner, 1200, 630);
}

// ─── T14 — Alert Score Badge (400×400) ───────────────────────────────────────

function t14AlertScoreBadge(data) {
  const verdictKey = normalizeVerdict(data.verdict);
  const verdictInfo = VERDICTS[verdictKey];
  const score = Math.round(Number(data.score) || 0);

  const inner = `
<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
  <div style="width:200px;height:200px;border-radius:50%;border:4px solid ${verdictInfo.color};display:flex;align-items:center;justify-content:center;background:rgba(26,34,56,0.9);">
    <span style="font-size:80px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(String(score))}</span>
  </div>
  <div style="font-size:18px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(data.ticker ?? '')}</div>
  <div>${verdictBadge(verdictKey)}</div>
</div>`;

  return wrapTemplate(inner, 400, 400);
}

// ─── T15 — Weekly Leaderboard (1200×675) ─────────────────────────────────────

function t15WeeklyLeaderboard(data) {
  const leaders = data.leaders || [];

  const rows = leaders.map((l, i) => {
    const verdictKey = normalizeVerdict(l.verdict);
    const returnStr = String(l.returnPct ?? '');
    const returnColor = returnStr.startsWith('-') ? COLORS.red : COLORS.green;
    const isTop = i === 0;
    return `
<div style="display:flex;align-items:center;gap:16px;padding:14px 20px;background:${isTop ? 'rgba(74,158,255,0.08)' : 'rgba(26,34,56,0.5)'};border:1px solid ${isTop ? COLORS.blue : 'rgba(255,255,255,0.06)'};border-radius:8px;margin-bottom:8px;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${RANK_COLORS[i] || COLORS.textSecondary};color:#000;font-weight:700;font-size:13px;flex-shrink:0;">${escapeHtml(String(l.rank ?? i + 1))}</span>
  <div style="width:70px;flex-shrink:0;font-size:18px;font-weight:800;color:${COLORS.textPrimary};">${escapeHtml(l.ticker ?? '')}</div>
  <div style="flex:1;color:${COLORS.textSecondary};font-size:14px;">${escapeHtml(l.insiderName ?? '')}</div>
  <div style="font-size:18px;font-weight:700;color:${returnColor};">${escapeHtml(returnStr)}</div>
  <div style="width:80px;text-align:right;">${verdictBadge(verdictKey, 'small')}</div>
</div>`;
  }).join('');

  const inner = `
<div style="width:100%;height:100%;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px;">
    <div style="font-size:22px;font-weight:700;color:${COLORS.textPrimary};">${escapeHtml(data.title ?? '')}</div>
    <div style="font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(data.weekLabel ?? '')}</div>
  </div>
  ${rows}
</div>`;

  return wrapTemplate(inner, 1200, 675);
}

// ─── renderTemplate() — main entry point ──────────────────────────────────────

const { uploadChart } = require('./generate-chart');

const SCREENSHOT_URL = 'http://host.docker.internal:3456/screenshot';

function clampDim(val, defaultVal) {
  return Math.min(Math.max(Number(val) || defaultVal, 200), 3000);
}

const TEMPLATE_MAP = {
  1:  [t1DataCard, 1200, 675],
  2:  [t2SecFilingMiniCard, 600, 337],
  3:  [t3ComparisonCard, 1200, 675],
  4:  [t4InsiderTransactionTable, 1200, 675],
  5:  [t5PriceChart, 1200, 675],
  6:  [t6RevenueTrend, 1200, 675],
  7:  [t7ValuationFootballField, 1200, 675],
  8:  [t8PeerRadar, 600, 600],
  9:  [t9MarketMovers, 1200, 675],
  10: [t10ContrarianCard, 1200, 675],
  11: [t11NewsletterStats, 1200, 675],
  12: [t12SectorHeatmap, 1200, 675],
  13: [t13ArticleHero, 1200, 630],
  14: [t14AlertScoreBadge, 400, 400],
  15: [t15WeeklyLeaderboard, 1200, 675],
};

async function renderTemplate(templateId, data, opts = {}, helpers) {
  const id = Number(templateId);
  if (!Number.isInteger(id) || id < 1 || id > 15) {
    throw new Error(`Invalid templateId: must be 1-15 (got ${String(templateId).slice(0, 20)})`);
  }
  if (data == null) {
    throw new Error('renderTemplate: data is required');
  }

  const [templateFn, rawW, rawH] = TEMPLATE_MAP[id];
  const w = clampDim(rawW, 1200);
  const h = clampDim(rawH, 675);

  const html = templateFn(data);

  const url = (helpers.env && helpers.env.SCREENSHOT_SERVER_URL)
    ? `${helpers.env.SCREENSHOT_SERVER_URL}/screenshot`
    : SCREENSHOT_URL;

  const res = await helpers.fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, viewport: { width: w, height: h }, format: 'png' }),
  });

  if (!res.ok) throw new Error(`Screenshot server error: ${res.status}`);
  const ct = res.headers.get('Content-Type') || res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error(`Screenshot server returned non-image: ${ct}`);

  const buffer = await res.buffer();

  if (opts.upload) {
    return uploadChart(buffer, opts.name || 'template', helpers);
  }
  return buffer;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// ─── DD Post visual stubs (return null until implemented) ─────────────────────

function generateInsiderTable(_filings) { return null; }
function generatePriceChart(_ticker, _priceData) { return null; }
function generatePeerRadar(_ticker, _peers) { return null; }

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
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
  generateInsiderTable,
  generatePriceChart,
  generatePeerRadar,
};
