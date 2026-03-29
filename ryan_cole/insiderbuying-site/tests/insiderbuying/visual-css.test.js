'use strict';

const {
  COLORS,
  VERDICTS,
  BASE_CSS,
  INTER_FONT_CSS,
  escapeHtml,
  normalizeVerdict,
  wrapTemplate,
} = require('../../n8n/code/insiderbuying/visual-css');

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes & to &amp;', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  test('escapes < to &lt; and > to &gt;', () => {
    expect(escapeHtml('<em>')).toBe('&lt;em&gt;');
  });

  test('escapes " to &quot;', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  test("escapes ' to &#39;", () => {
    expect(escapeHtml("O'Reilly")).toBe('O&#39;Reilly');
  });

  test('returns empty string for null input', () => {
    expect(escapeHtml(null)).toBe('');
  });

  test('returns empty string for undefined input', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  test('full compound escape', () => {
    expect(escapeHtml("O'Reilly & Company <em>test</em>"))
      .toBe("O&#39;Reilly &amp; Company &lt;em&gt;test&lt;/em&gt;");
  });
});

// ─── normalizeVerdict ─────────────────────────────────────────────────────────

describe('normalizeVerdict', () => {
  test('"buy" returns "BUY"', () => {
    expect(normalizeVerdict('buy')).toBe('BUY');
  });

  test('"Buy" returns "BUY"', () => {
    expect(normalizeVerdict('Buy')).toBe('BUY');
  });

  test('"SELL" returns "SELL"', () => {
    expect(normalizeVerdict('SELL')).toBe('SELL');
  });

  test('"hold" returns "HOLD"', () => {
    expect(normalizeVerdict('hold')).toBe('HOLD');
  });

  test('"caution" returns "CAUTION"', () => {
    expect(normalizeVerdict('caution')).toBe('CAUTION');
  });

  test('"unknown" returns "HOLD" (safe default)', () => {
    expect(normalizeVerdict('unknown')).toBe('HOLD');
  });

  test('undefined returns "HOLD"', () => {
    expect(normalizeVerdict(undefined)).toBe('HOLD');
  });

  test('null returns "HOLD"', () => {
    expect(normalizeVerdict(null)).toBe('HOLD');
  });
});

// ─── VERDICTS ─────────────────────────────────────────────────────────────────

describe('VERDICTS', () => {
  test('VERDICTS.BUY.color equals #28A745', () => {
    expect(VERDICTS.BUY.color).toBe('#28A745');
  });

  test('VERDICTS.SELL.color equals #DC3545', () => {
    expect(VERDICTS.SELL.color).toBe('#DC3545');
  });

  test('VERDICTS.HOLD.color equals #FFC107', () => {
    expect(VERDICTS.HOLD.color).toBe('#FFC107');
  });

  test('VERDICTS.BUY.label is "BUY"', () => {
    expect(VERDICTS.BUY.label).toBe('BUY');
  });
});

// ─── COLORS ───────────────────────────────────────────────────────────────────

describe('COLORS', () => {
  test('COLORS.bg equals #0A1128', () => {
    expect(COLORS.bg).toBe('#0A1128');
  });

  test('COLORS.green equals #28A745', () => {
    expect(COLORS.green).toBe('#28A745');
  });

  test('COLORS.red equals #DC3545', () => {
    expect(COLORS.red).toBe('#DC3545');
  });
});

// ─── INTER_FONT_CSS ──────────────────────────────────────────────────────────

describe('INTER_FONT_CSS', () => {
  test('contains @font-face declarations', () => {
    expect(INTER_FONT_CSS).toContain('@font-face');
  });

  test('declares Inter font family', () => {
    expect(INTER_FONT_CSS).toContain("'Inter'");
  });
});

// ─── wrapTemplate ─────────────────────────────────────────────────────────────

describe('wrapTemplate', () => {
  test('wraps inner HTML in <!DOCTYPE html>', () => {
    const out = wrapTemplate('<div>hello</div>', 1200, 675);
    expect(out).toMatch(/^<!DOCTYPE html>/i);
  });

  test('includes the inner HTML in output', () => {
    const out = wrapTemplate('<div id="test">content</div>', 800, 600);
    expect(out).toContain('<div id="test">content</div>');
  });

  test('output contains Inter @font-face declarations', () => {
    const out = wrapTemplate('<div/>', 1200, 675);
    expect(out).toContain('@font-face');
  });

  test('output contains BASE_CSS', () => {
    const out = wrapTemplate('<div/>', 1200, 675);
    expect(out).toContain('box-sizing: border-box');
  });

  test('sets width and height in viewport meta', () => {
    const out = wrapTemplate('<div/>', 1200, 675);
    expect(out).toContain('width=1200');
  });

  test('sets overflow:hidden on body', () => {
    const out = wrapTemplate('<div/>', 1200, 675);
    expect(out).toContain('overflow:hidden');
  });
});
