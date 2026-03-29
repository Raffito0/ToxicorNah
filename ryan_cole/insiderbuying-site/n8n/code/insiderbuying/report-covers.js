'use strict';

const { escapeHtml, normalizeVerdict, VERDICTS, COLORS } = require('./visual-css');
const { uploadChart } = require('./generate-chart');

const SCREENSHOT_SERVER_PATH = '/screenshot';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function screenshotUrl(helpers) {
  const base = (helpers.env && helpers.env.SCREENSHOT_SERVER_URL)
    ? helpers.env.SCREENSHOT_SERVER_URL
    : 'http://host.docker.internal:3456';
  return base + SCREENSHOT_SERVER_PATH;
}

async function takeScreenshot(html, viewport, helpers) {
  const url = screenshotUrl(helpers);
  const response = await helpers.fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, viewport, format: 'png' }),
  });
  if (!response.ok) throw new Error(`Screenshot server error: ${response.status}`);
  return response.buffer();
}

// ─── Cover A — Single Stock Report ───────────────────────────────────────────

async function renderCoverA(data, helpers) {
  const verdictKey = normalizeVerdict(data.verdict);
  const verdictInfo = VERDICTS[verdictKey];
  const rawTicker = String(data.ticker || '').replace(/[^A-Za-z0-9]/g, '');
  const ticker = escapeHtml(String(data.ticker || ''));
  const companyName = escapeHtml(String(data.companyName || ''));
  const thesis = escapeHtml(String(data.thesis || ''));
  const price = escapeHtml(String(data.price || ''));
  const marketCap = escapeHtml(String(data.marketCap || ''));
  const date = escapeHtml(String(data.date || ''));
  const score = Math.min(5, Math.max(1, Math.round(data.insiderScore || 1)));
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span style="color:${i < score ? COLORS.yellow : COLORS.bgBorder}">&#9733;</span>`
  ).join('');

  const safeLogoUrl = data.logoUrl && /^https?:\/\//i.test(String(data.logoUrl))
    ? escapeHtml(String(data.logoUrl))
    : null;
  const logoHtml = safeLogoUrl
    ? `<img src="${safeLogoUrl}" style="width:48px;height:48px;border-radius:8px;object-fit:contain;" />`
    : `<div style="width:48px;height:48px;background:${COLORS.bgCard};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:${COLORS.blue};">${ticker.slice(0,2)}</div>`;

  const networkSvg = `<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" style="opacity:0.15;width:100%;height:100px;">
    <line x1="50" y1="50" x2="130" y2="30" stroke="#4A9EFF" stroke-width="1"/>
    <line x1="130" y1="30" x2="220" y2="60" stroke="#4A9EFF" stroke-width="1"/>
    <line x1="220" y1="60" x2="310" y2="20" stroke="#4A9EFF" stroke-width="1"/>
    <line x1="310" y1="20" x2="370" y2="70" stroke="#4A9EFF" stroke-width="1"/>
    <line x1="50" y1="50" x2="220" y2="60" stroke="#4A9EFF" stroke-width="0.5"/>
    <line x1="130" y1="30" x2="310" y2="20" stroke="#4A9EFF" stroke-width="0.5"/>
    <circle cx="50" cy="50" r="4" fill="#4A9EFF" opacity="0.6"/>
    <circle cx="130" cy="30" r="4" fill="#4A9EFF" opacity="0.6"/>
    <circle cx="220" cy="60" r="4" fill="#4A9EFF" opacity="0.6"/>
    <circle cx="310" cy="20" r="4" fill="#4A9EFF" opacity="0.6"/>
    <circle cx="370" cy="70" r="4" fill="#4A9EFF" opacity="0.6"/>
  </svg>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:${COLORS.bg}; color:${COLORS.textPrimary}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; width:1240px; height:1754px; overflow:hidden; }
.card { background:${COLORS.bgCard}; border:1px solid ${COLORS.bgBorder}; border-radius:12px; padding:20px; }
.metric-label { color:${COLORS.textSecondary}; font-size:13px; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; }
.metric-value { font-size:22px; font-weight:700; }
</style></head>
<body style="display:flex;flex-direction:column;padding:60px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:60px;">
    <div style="display:flex;align-items:center;gap:16px;">
      ${logoHtml}
      <div>
        <div style="font-size:13px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:1px;">Insider Intelligence Report</div>
        <div style="font-size:18px;font-weight:600;">${companyName}</div>
      </div>
    </div>
    <div style="color:${COLORS.textSecondary};font-size:14px;">${date}</div>
  </div>

  <div style="text-align:center;margin-bottom:48px;">
    <div style="font-size:80px;font-weight:900;letter-spacing:-2px;line-height:1;">${ticker}</div>
    <div style="margin-top:20px;display:inline-flex;align-items:center;gap:10px;background:${COLORS.bgCard};border:2px solid ${verdictInfo.color};border-radius:100px;padding:10px 28px;">
      <span style="width:10px;height:10px;background:${verdictInfo.color};border-radius:50%;display:inline-block;"></span>
      <span style="font-size:16px;font-weight:700;color:${verdictInfo.color};">${verdictInfo.label}</span>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:48px;">
    <div class="card">
      <div class="metric-label">Current Price</div>
      <div class="metric-value">${price}</div>
    </div>
    <div class="card">
      <div class="metric-label">Market Cap</div>
      <div class="metric-value">${marketCap}</div>
    </div>
    <div class="card">
      <div class="metric-label">Insider Signal</div>
      <div style="font-size:22px;">${stars}</div>
    </div>
  </div>

  <div style="text-align:center;max-width:80%;margin:0 auto 60px;font-size:18px;font-style:italic;color:${COLORS.textSecondary};line-height:1.7;">
    &ldquo;${thesis}&rdquo;
  </div>

  <div style="flex:1;display:flex;align-items:flex-end;">
    ${networkSvg}
  </div>

  <div style="text-align:center;padding-top:24px;border-top:1px solid ${COLORS.bgBorder};font-size:13px;color:${COLORS.textSecondary};letter-spacing:1px;text-transform:uppercase;">
    EarlyInsider &bull; Insider Intelligence
  </div>
</body>
</html>`;

  const viewport = { width: 1240, height: 1754, deviceScaleFactor: 2 };
  const buffer = await takeScreenshot(html, viewport, helpers);
  return uploadChart(buffer, `cover-a-${rawTicker.toLowerCase()}`, helpers);
}

// ─── Cover B — Sector Report ──────────────────────────────────────────────────

async function renderCoverB(data, helpers) {
  const rawSectorName = String(data.sectorName || '').replace(/[^A-Za-z0-9 ]/g, '');
  const sectorName = escapeHtml(String(data.sectorName || ''));
  const title = escapeHtml(String(data.title || ''));
  const stocks = Array.isArray(data.stocks) ? data.stocks : [];

  const stockCards = stocks.map(s => {
    const verdictKey = normalizeVerdict(s.verdict);
    const verdictInfo = VERDICTS[verdictKey];
    const ticker = escapeHtml(String(s.ticker || ''));
    const upside = escapeHtml(String(s.upside || ''));
    return `<div style="background:${COLORS.bgCard};border:1px solid ${COLORS.bgBorder};border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:18px;font-weight:700;">${ticker}</div>
      <div style="display:inline-flex;align-items:center;gap:6px;background:${verdictInfo.color}22;border:1px solid ${verdictInfo.color};border-radius:100px;padding:4px 12px;align-self:flex-start;">
        <span style="font-size:12px;font-weight:600;color:${verdictInfo.color};">${verdictInfo.label}</span>
      </div>
      <div style="font-size:16px;font-weight:600;color:${COLORS.green};">${upside}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:${COLORS.bg}; color:${COLORS.textPrimary}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; width:1240px; height:1754px; overflow:hidden; display:flex; flex-direction:column; }
</style></head>
<body>
  <div style="flex:0 0 40%;padding:60px;display:flex;flex-direction:column;justify-content:center;position:relative;">
    <div style="position:absolute;top:40px;right:40px;background:${COLORS.yellow};color:#000;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:8px 16px;border-radius:100px;">Sector Analysis</div>
    <div style="font-size:14px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">${sectorName}</div>
    <div style="font-size:42px;font-weight:800;line-height:1.2;">${title}</div>
  </div>

  <div style="height:3px;background:linear-gradient(90deg,${COLORS.blue},${COLORS.purple},transparent);"></div>

  <div style="flex:1;padding:40px 60px;display:flex;flex-direction:column;justify-content:center;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
      ${stockCards}
    </div>
  </div>

  <div style="padding:24px 60px;border-top:1px solid ${COLORS.bgBorder};text-align:center;font-size:13px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:1px;">
    EarlyInsider &bull; Sector Intelligence
  </div>
</body>
</html>`;

  const viewport = { width: 1240, height: 1754, deviceScaleFactor: 2 };
  const buffer = await takeScreenshot(html, viewport, helpers);
  return uploadChart(buffer, `cover-b-${rawSectorName.toLowerCase().replace(/\s+/g, '-')}`, helpers);
}

// ─── Cover C — Bundle Report ──────────────────────────────────────────────────

async function renderCoverC(data, helpers) {
  const title = escapeHtml(String(data.title || ''));
  const pageCount = escapeHtml(String(data.pageCount || ''));
  const stats = data.stats || {};
  const totalPurchases = escapeHtml(String(stats.totalPurchases || '0'));
  const avgUpside = escapeHtml(String(stats.avgUpside || '0%'));
  const buyPct = escapeHtml(String(stats.buyPct || '0%'));
  const stocks = Array.isArray(data.stocks) ? data.stocks.slice(0, 10) : [];

  const tickerPills = stocks.map(s => {
    const verdictKey = normalizeVerdict(s.verdict);
    const verdictInfo = VERDICTS[verdictKey];
    const ticker = escapeHtml(String(s.ticker || ''));
    return `<div style="border:1.5px solid ${verdictInfo.color};border-radius:100px;padding:8px 18px;font-size:14px;font-weight:700;color:${COLORS.textPrimary};">${ticker}</div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:${COLORS.bg}; color:${COLORS.textPrimary}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; width:1240px; height:1754px; overflow:hidden; display:flex; flex-direction:column; padding:60px; }
.stat-card { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:24px; flex:1; text-align:center; backdrop-filter:blur(10px); }
.stat-label { color:${COLORS.textSecondary}; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; }
.stat-value { font-size:32px; font-weight:800; }
</style></head>
<body>
  <div style="display:flex;gap:20px;margin-bottom:48px;">
    <div class="stat-card">
      <div class="stat-label">Total Purchases</div>
      <div class="stat-value">${totalPurchases}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Upside</div>
      <div class="stat-value" style="color:${COLORS.green};">${avgUpside}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Rated BUY</div>
      <div class="stat-value" style="color:${COLORS.blue};">${buyPct}</div>
    </div>
  </div>

  <div style="font-size:42px;font-weight:800;line-height:1.25;margin-bottom:48px;">${title}</div>

  <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:auto;">
    ${tickerPills}
  </div>

  <div style="display:flex;justify-content:flex-end;margin-top:40px;">
    <div style="background:${COLORS.bgCard};border:1px solid ${COLORS.bgBorder};border-radius:100px;padding:10px 24px;font-size:14px;color:${COLORS.textSecondary};">${pageCount}</div>
  </div>

  <div style="margin-top:24px;padding-top:24px;border-top:1px solid ${COLORS.bgBorder};text-align:center;font-size:13px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:1px;">
    EarlyInsider &bull; Bundle Intelligence
  </div>
</body>
</html>`;

  const viewport = { width: 1240, height: 1754, deviceScaleFactor: 2 };
  const buffer = await takeScreenshot(html, viewport, helpers);
  return uploadChart(buffer, 'cover-c-bundle', helpers);
}

// ─── Cover D — Hero Featured (Web 1200x675) ───────────────────────────────────

async function renderCoverD(data, helpers) {
  const title = escapeHtml(String(data.title || ''));
  const subtitle = escapeHtml(String(data.subtitle || ''));
  const ctaText = escapeHtml(String(data.ctaText || 'Get the full report'));
  const stats = Array.isArray(data.stats) ? data.stats : [];
  const tickers = Array.isArray(data.tickers) ? data.tickers : [];

  const statCards = stats.map(s => {
    const label = escapeHtml(String(s.label || ''));
    const value = escapeHtml(String(s.value || ''));
    return `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:20px 24px;flex:1;text-align:center;">
      <div style="color:${COLORS.textSecondary};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${label}</div>
      <div style="font-size:26px;font-weight:800;">${value}</div>
    </div>`;
  }).join('');

  const tickerPills = tickers.map(t => {
    const ticker = escapeHtml(String(t || ''));
    return `<div style="background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.3);border-radius:100px;padding:6px 16px;font-size:13px;font-weight:600;">${ticker}</div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:
    radial-gradient(ellipse at 20% 50%, rgba(74,158,255,0.15) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(124,58,237,0.12) 0%, transparent 50%),
    ${COLORS.bg};
  color:${COLORS.textPrimary};
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  width:1200px; height:675px; overflow:hidden;
  display:flex; flex-direction:column; padding:48px;
}
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
    <div style="font-size:13px;color:${COLORS.textSecondary};text-transform:uppercase;letter-spacing:1px;">EarlyInsider</div>
    <div style="background:${COLORS.yellow};color:#000;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:100px;">Featured Report</div>
  </div>

  <div style="margin-bottom:28px;">
    <h1 style="font-size:36px;font-weight:800;line-height:1.2;margin-bottom:10px;">${title}</h1>
    <p style="font-size:16px;color:${COLORS.textSecondary};line-height:1.5;">${subtitle}</p>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:auto;">
    ${statCards}
  </div>

  <div style="margin-top:28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${tickerPills}
    </div>
    <div style="font-size:14px;color:${COLORS.blue};font-weight:600;">${ctaText}</div>
  </div>
</body>
</html>`;

  const viewport = { width: 1200, height: 675 };
  const buffer = await takeScreenshot(html, viewport, helpers);
  return uploadChart(buffer, 'cover-d-hero', helpers);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { renderCoverA, renderCoverB, renderCoverC, renderCoverD };
