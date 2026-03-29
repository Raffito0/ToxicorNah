'use strict';

// ─── Color palette ───────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0A1128',
  bgSecondary: '#1A2238',
  bgCard: '#1A2238',
  bgBorder: '#2A3548',
  textPrimary: '#FFFFFF',
  textSecondary: '#8892A4',
  green: '#28A745',
  red: '#DC3545',
  yellow: '#FFC107',
  blue: '#4A9EFF',
  purple: '#7C3AED',
};

// ─── Verdict definitions ─────────────────────────────────────────────────────

const VERDICTS = {
  BUY:     { label: 'BUY',     color: '#28A745' },
  SELL:    { label: 'SELL',    color: '#DC3545' },
  HOLD:    { label: 'HOLD',    color: '#FFC107' },
  CAUTION: { label: 'CAUTION', color: '#FF6B35' },
  WAIT:    { label: 'WAIT',    color: '#8892A4' },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeVerdict(str) {
  if (str == null) return 'HOLD';
  const upper = String(str).toUpperCase();
  return VERDICTS[upper] ? upper : 'HOLD';
}

// ─── Inter font (base64 WOFF2 stubs — replace with full fonts before deploy) ─

// NOTE: The base64 data below are minimal placeholders for test/CI environments.
// Before production deployment, embed full Inter WOFF2 base64 data:
//   base64 -w 0 inter-400.woff2  (and repeat for 500, 600, 700)
// Full Inter font files: https://rsms.me/inter/

const INTER_FONT_CSS = `
@font-face {
  font-family: 'Inter';
  font-weight: 400;
  font-style: normal;
  src: url('data:font/woff2;base64,d09GMgABAAAAAAJIAAoAAAAAAiQAAAH9AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbEBwaBmAAVBEICoIEggULDgABNgIkAxAEIAWDZgcgGwwHRUJBU0UBNgIg') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-weight: 500;
  font-style: normal;
  src: url('data:font/woff2;base64,d09GMgABAAAAAAJIAAoAAAAAAiQAAAH9AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbEBwaBmAAVBEICoIEggULDgABNgIkAxAEIAWDZgcgGwwHRUJBU0UBNgIg') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-weight: 600;
  font-style: normal;
  src: url('data:font/woff2;base64,d09GMgABAAAAAAJIAAoAAAAAAiQAAAH9AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbEBwaBmAAVBEICoIEggULDgABNgIkAxAEIAWDZgcgGwwHRUJBU0UBNgIg') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-weight: 700;
  font-style: normal;
  src: url('data:font/woff2;base64,d09GMgABAAAAAAJIAAoAAAAAAiQAAAH9AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhYbEBwaBmAAVBEICoIEggULDgABNgIkAxAEIAWDZgcgGwwHRUJBU0UBNgIg') format('woff2');
}
`;

// ─── Design tokens ───────────────────────────────────────────────────────────

const DESIGN_TOKENS = `
:root {
  --bg: #0A1128;
  --bg-secondary: #1A2238;
  --bg-card: #1A2238;
  --bg-border: #2A3548;
  --text-primary: #FFFFFF;
  --text-secondary: #8892A4;
  --green: #28A745;
  --red: #DC3545;
  --yellow: #FFC107;
  --blue: #4A9EFF;
  --purple: #7C3AED;
  --radius: 12px;
  --shadow: 0 4px 24px rgba(0,0,0,0.4);
}
`;

// ─── Glassmorphism CSS snippets ───────────────────────────────────────────────

const glassCard = `backdrop-filter: blur(12px); background: rgba(26,34,56,0.85); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.4);`;

const verdictBadge = `display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 13px; letter-spacing: 0.5px;`;

const statRow = `display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06);`;

const tickerPill = `display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 6px; font-weight: 600; font-size: 13px; border: 1px solid currentColor;`;

// ─── Base CSS ─────────────────────────────────────────────────────────────────

const BASE_CSS = `
${INTER_FONT_CSS}
${DESIGN_TOKENS}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0A1128; color: #FFFFFF; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }

.glass-card { ${glassCard} }
.verdict-badge { ${verdictBadge} }
.stat-row { ${statRow} }
.stat-row:last-child { border-bottom: none; }
.ticker-pill { ${tickerPill} }
`;

// ─── wrapTemplate ─────────────────────────────────────────────────────────────

function wrapTemplate(innerHtml, width, height) {
  const w = Math.min(Math.max(Number(width) || 1200, 200), 3000);
  const h = Math.min(Math.max(Number(height) || 675, 200), 3000);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${w}, height=${h}">
  <style>${BASE_CSS}</style>
</head>
<body style="width:${w}px;height:${h}px;overflow:hidden;">
  ${innerHtml}
</body>
</html>`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  COLORS,
  VERDICTS,
  DESIGN_TOKENS,
  BASE_CSS,
  INTER_FONT_CSS,
  escapeHtml,
  normalizeVerdict,
  glassCard,
  verdictBadge,
  statRow,
  tickerPill,
  wrapTemplate,
};
