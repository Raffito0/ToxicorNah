const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseWebhook,
  determineReportParams,
  buildReportPrompt,
  buildReportHTML,
  buildDeliveryEmail,
  buildReportRecord,
  generateReportSection,
  buildSectionSystemPrompt,
  reviewBearCaseAuthenticity,
  generateExecSummary,
  REPORT_SECTIONS,
  BEAR_CASE_SYSTEM_PROMPT,
} = require('../code/insiderbuying/generate-report.js');

// ---------------------------------------------------------------------------
// parseWebhook
// ---------------------------------------------------------------------------
describe('parseWebhook', () => {
  const mockEvent = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        customer_email: 'user@example.com',
        metadata: {
          userId: 'usr_abc',
          report_type: 'deep-dive',
          ticker: 'NVDA',
        },
        payment_intent: 'pi_test_456',
      },
    },
  };

  it('extracts customer_email', () => {
    const result = parseWebhook(mockEvent);
    assert.equal(result.customerEmail, 'user@example.com');
  });

  it('extracts report_type from metadata', () => {
    const result = parseWebhook(mockEvent);
    assert.equal(result.reportType, 'deep-dive');
  });

  it('extracts userId from metadata', () => {
    const result = parseWebhook(mockEvent);
    assert.equal(result.userId, 'usr_abc');
  });

  it('extracts paymentId', () => {
    const result = parseWebhook(mockEvent);
    assert.ok(result.paymentId);
  });
});

// ---------------------------------------------------------------------------
// determineReportParams
// ---------------------------------------------------------------------------
describe('determineReportParams', () => {
  it('deep-dive returns single ticker', () => {
    const result = determineReportParams('deep-dive', { ticker: 'NVDA' });
    assert.deepStrictEqual(result.tickers, ['NVDA']);
  });

  it('sector returns sector name', () => {
    const result = determineReportParams('sector', { sector: 'Technology' });
    assert.equal(result.sector, 'Technology');
  });

  it('generates report title', () => {
    const result = determineReportParams('deep-dive', { ticker: 'NVDA' });
    assert.ok(result.reportTitle.length > 0);
  });
});

// ---------------------------------------------------------------------------
// buildReportPrompt
// ---------------------------------------------------------------------------
describe('buildReportPrompt', () => {
  it('returns non-empty string', () => {
    const prompt = buildReportPrompt({ tickers: ['NVDA'], data: {} }, 'deep-dive');
    assert.ok(prompt.length > 100);
  });

  it('includes report type context', () => {
    const prompt = buildReportPrompt({ tickers: ['NVDA'], data: {} }, 'deep-dive');
    assert.ok(prompt.toLowerCase().includes('deep') || prompt.toLowerCase().includes('comprehensive'));
  });
});

// ---------------------------------------------------------------------------
// buildReportHTML
// ---------------------------------------------------------------------------
describe('buildReportHTML', () => {
  it('returns HTML string', () => {
    const html = buildReportHTML('## Executive Summary\nTest content here', 'Test Report', '2026-03-28');
    assert.ok(html.includes('Test Report'));
  });

  it('includes content', () => {
    const html = buildReportHTML('My Summary content goes here', 'Title', '2026-01-01');
    assert.ok(html.includes('My Summary'));
  });
});

// ---------------------------------------------------------------------------
// buildDeliveryEmail
// ---------------------------------------------------------------------------
describe('buildDeliveryEmail', () => {
  it('returns object with to, subject, html', () => {
    const email = buildDeliveryEmail('My Report', 'https://example.com/report.pdf', 'user@test.com');
    assert.equal(email.to, 'user@test.com');
    assert.ok(email.subject.includes('My Report'));
    assert.ok(email.html.includes('https://example.com/report.pdf'));
  });
});

// ---------------------------------------------------------------------------
// buildReportRecord
// ---------------------------------------------------------------------------
describe('buildReportRecord', () => {
  it('returns record with all required fields', () => {
    const record = buildReportRecord('usr_abc', 'deep-dive', 'https://example.com/r.pdf', 'pi_123');
    assert.equal(record.user_id, 'usr_abc');
    assert.equal(record.report_type, 'deep-dive');
    assert.equal(record.pdf_url, 'https://example.com/r.pdf');
    assert.equal(record.payment_id, 'pi_123');
    assert.ok(record.created_at);
  });
});

// ---------------------------------------------------------------------------
// Section 04 — REPORT_SECTIONS constant + buildSectionSystemPrompt
// ---------------------------------------------------------------------------

describe('REPORT_SECTIONS', () => {
  it('has exactly 9 sections (exec_summary not in array)', () => {
    assert.equal(REPORT_SECTIONS.length, 9);
  });

  it('first section is company_overview', () => {
    assert.equal(REPORT_SECTIONS[0].id, 'company_overview');
  });

  it('last section is investment_thesis', () => {
    assert.equal(REPORT_SECTIONS[8].id, 'investment_thesis');
  });

  it('all sections have id and wordTarget', () => {
    for (const s of REPORT_SECTIONS) {
      assert.ok(s.id && typeof s.id === 'string');
      assert.ok(s.wordTarget && typeof s.wordTarget === 'number');
    }
  });

  it('insider_intelligence has wordTarget 800', () => {
    const s = REPORT_SECTIONS.find((x) => x.id === 'insider_intelligence');
    assert.equal(s.wordTarget, 800);
  });
});

describe('buildSectionSystemPrompt', () => {
  it('returns non-empty string for company_overview', () => {
    const p = buildSectionSystemPrompt('company_overview');
    assert.ok(typeof p === 'string' && p.length > 20);
  });

  it('returns non-empty string for each of the 9 section IDs', () => {
    for (const s of REPORT_SECTIONS) {
      if (s.id === 'bear_case') continue; // bear_case uses adversarial prompt, not this fn
      const p = buildSectionSystemPrompt(s.id);
      assert.ok(typeof p === 'string' && p.length > 20, `Empty prompt for ${s.id}`);
    }
  });
});

describe('BEAR_CASE_SYSTEM_PROMPT', () => {
  it('contains "skeptical short seller"', () => {
    assert.ok(BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('skeptical short seller'));
  });

  it('instructs to include a downside price target', () => {
    assert.ok(
      BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('price target') ||
      BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('downside'),
    );
  });
});

// ---------------------------------------------------------------------------
// Section 04 — generateReportSection
// ---------------------------------------------------------------------------

describe('generateReportSection', () => {
  function makeOkFetch(text) {
    return async () => ({
      ok: true,
      json: async () => ({ content: [{ text }] }),
      text: async () => JSON.stringify({ content: [{ text }] }),
    });
  }

  it('returns section text when word count is within ±20% of target', async () => {
    // Build a ~600 word response
    const text = 'word '.repeat(600).trim();
    const result = await generateReportSection('company_overview', 600, [], {}, makeOkFetch(text));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('retries once when response is 25% below target word count', async () => {
    let callCount = 0;
    // First call returns 300 words (50% of 600 target — below 20% tolerance floor of 480)
    // Second call returns 600 words
    const shortText = 'word '.repeat(300).trim();
    const goodText = 'word '.repeat(600).trim();
    const fetchFn = async () => {
      callCount++;
      const text = callCount === 1 ? shortText : goodText;
      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
    };
    await generateReportSection('company_overview', 600, [], {}, fetchFn);
    assert.equal(callCount, 2);
  });

  it('returns text anyway on 2nd attempt even if still below target', async () => {
    const shortText = 'word '.repeat(200).trim();
    const fetchFn = makeOkFetch(shortText);
    const result = await generateReportSection('company_overview', 600, [], {}, fetchFn);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('includes prior sections as XML context in user prompt', async () => {
    let capturedBody = '';
    const fetchFn = async (url, opts) => {
      capturedBody = opts.body || '';
      const text = 'word '.repeat(700).trim();
      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
    };
    const prior = [{ id: 'company_overview', text: 'OVERVIEW TEXT HERE' }];
    await generateReportSection('insider_intelligence', 800, prior, {}, fetchFn);
    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
    assert.ok(userContent.includes('<section name="company_overview">'));
    assert.ok(userContent.includes('OVERVIEW TEXT HERE'));
  });

  it('first section has no XML prior-sections block', async () => {
    let capturedBody = '';
    const fetchFn = async (url, opts) => {
      capturedBody = opts.body || '';
      const text = 'word '.repeat(600).trim();
      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
    };
    await generateReportSection('company_overview', 600, [], {}, fetchFn);
    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
    assert.ok(!userContent.includes('<prior_sections>'));
  });

  it('section text is a plain string (not JSON object)', async () => {
    const text = 'word '.repeat(600).trim();
    const result = await generateReportSection('company_overview', 600, [], {}, makeOkFetch(text));
    assert.equal(typeof result, 'string');
  });
});

// ---------------------------------------------------------------------------
// Section 04 — reviewBearCaseAuthenticity
// ---------------------------------------------------------------------------

describe('reviewBearCaseAuthenticity', () => {
  it('returns score and reasoning from Claude response', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ content: [{ text: '{"score": 8, "reasoning": "Strong bear case"}' }] }),
      text: async () => '',
    });
    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
    assert.equal(result.score, 8);
    assert.equal(result.reasoning, 'Strong bear case');
  });

  it('score < 7 when Claude returns score 4', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ content: [{ text: '{"score": 4, "reasoning": "Too generic"}' }] }),
      text: async () => '',
    });
    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
    assert.ok(result.score < 7);
  });

  it('strips markdown fences before JSON.parse', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ content: [{ text: '```json\n{"score":8,"reasoning":"good"}\n```' }] }),
      text: async () => '',
    });
    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
    assert.equal(result.score, 8);
  });
});

// ---------------------------------------------------------------------------
// Section 04 — generateExecSummary
// ---------------------------------------------------------------------------

describe('generateExecSummary', () => {
  const allSections = REPORT_SECTIONS.map((s) => ({
    id: s.id,
    text: `Content for ${s.id} section goes here with some details.`,
  }));

  it('returns a non-empty string', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ content: [{ text: 'Executive summary text here.' }] }),
      text: async () => '',
    });
    const result = await generateExecSummary(allSections, fetchFn);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('receives all 9 sections as XML context', async () => {
    let capturedBody = '';
    const fetchFn = async (url, opts) => {
      capturedBody = opts.body || '';
      return {
        ok: true,
        json: async () => ({ content: [{ text: 'summary' }] }),
        text: async () => '',
      };
    };
    await generateExecSummary(allSections, fetchFn);
    const parsed = JSON.parse(capturedBody);
    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
    // All 9 sections should appear
    for (const s of allSections) {
      assert.ok(userContent.includes(`<section name="${s.id}">`), `Missing section ${s.id} in exec summary context`);
    }
  });

  it('system prompt instructs to lead with verdict and insider signal', async () => {
    let capturedBody = '';
    const fetchFn = async (url, opts) => {
      capturedBody = opts.body || '';
      return { ok: true, json: async () => ({ content: [{ text: 'summary' }] }), text: async () => '' };
    };
    await generateExecSummary(allSections, fetchFn);
    const parsed = JSON.parse(capturedBody);
    const systemContent = (parsed.system || '').toLowerCase();
    assert.ok(
      systemContent.includes('verdict') || systemContent.includes('buy') || systemContent.includes('hold'),
      'System prompt should mention verdict',
    );
    assert.ok(
      systemContent.includes('insider') || systemContent.includes('signal'),
      'System prompt should mention insider signal',
    );
  });
});
