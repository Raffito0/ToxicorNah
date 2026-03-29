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
  // Section 05
  getReportConfig,
  resolveCharts,
  generateReportPDF,
  generatePreviewPDF,
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

// ---------------------------------------------------------------------------
// Section 05 — getReportConfig
// ---------------------------------------------------------------------------

describe('getReportConfig', () => {
  it("returns price 14.99 and coverTemplate 'A' for 'single'", () => {
    const config = getReportConfig('single');
    assert.equal(config.price, 14.99);
    assert.equal(config.coverTemplate, 'A');
  });

  it("returns price 19.99 and coverTemplate 'A' for 'complex'", () => {
    const config = getReportConfig('complex');
    assert.equal(config.price, 19.99);
    assert.equal(config.coverTemplate, 'A');
  });

  it("returns price 19.99 and coverTemplate 'B' for 'sector'", () => {
    const config = getReportConfig('sector');
    assert.equal(config.price, 19.99);
    assert.equal(config.coverTemplate, 'B');
  });

  it("returns price 24.99 and coverTemplate 'C' for 'bundle'", () => {
    const config = getReportConfig('bundle');
    assert.equal(config.price, 24.99);
    assert.equal(config.coverTemplate, 'C');
  });

  it('throws for unrecognized report type', () => {
    assert.throws(() => getReportConfig('unknown'), /unrecognized/i);
  });
});

// ---------------------------------------------------------------------------
// Section 05 — resolveCharts
// ---------------------------------------------------------------------------

describe('resolveCharts', () => {
  it('fulfilled result converts to base64 data URI', () => {
    const buf = Buffer.from('fake-png-data');
    const results = [{ status: 'fulfilled', value: buf }];
    const charts = resolveCharts(results);
    assert.ok(charts[0].startsWith('data:image/png;base64,'));
  });

  it('rejected result substitutes chart-unavailable placeholder', () => {
    const results = [{ status: 'rejected', reason: new Error('render fail') }];
    const charts = resolveCharts(results);
    assert.ok(charts[0].includes('chart-unavailable'));
  });

  it('5 fulfilled charts all become data URIs', () => {
    const buf = Buffer.from('x');
    const results = Array(5).fill(null).map(() => ({ status: 'fulfilled', value: buf }));
    const charts = resolveCharts(results);
    assert.equal(charts.length, 5);
    for (const c of charts) {
      assert.ok(c.startsWith('data:image/png;base64,'));
    }
  });

  it('mixed results: rejected becomes placeholder, fulfilled stays data URI', () => {
    const buf = Buffer.from('x');
    const results = [
      { status: 'fulfilled', value: buf },
      { status: 'rejected', reason: new Error('fail') },
      { status: 'fulfilled', value: buf },
    ];
    const charts = resolveCharts(results);
    assert.ok(charts[0].startsWith('data:image/png;base64,'));
    assert.ok(charts[1].includes('chart-unavailable'));
    assert.ok(charts[2].startsWith('data:image/png;base64,'));
  });
});

// ---------------------------------------------------------------------------
// Section 05 — buildReportHTML (sections/charts/config variant)
// ---------------------------------------------------------------------------

describe('buildReportHTML (sections/charts/config variant)', () => {
  const sections = {
    exec_summary: 'Executive summary content here.',
    insider_intelligence: 'Insider intelligence content.',
    company_overview: 'Company overview content.',
    financial_analysis: 'Financial analysis content.',
    valuation_analysis: 'Valuation analysis content.',
    bull_case: 'Bull case content.',
    bear_case: 'Bear case content.',
    peer_comparison: 'Peer comparison content.',
    catalysts_timeline: 'Catalysts timeline content.',
    investment_thesis: 'Investment thesis content.',
  };
  const charts = {
    cover: 'data:image/png;base64,abc123',
    price: 'data:image/png;base64,price123',
    revenue: '<div class="chart-unavailable">Chart temporarily unavailable</div>',
    valuation: 'data:image/png;base64,val123',
    peer: 'data:image/png;base64,peer123',
  };
  const config = { price: 14.99, coverTemplate: 'A' };

  it('cover data URI appears before executive summary text', () => {
    const html = buildReportHTML(sections, charts, config);
    const coverIdx = html.indexOf('data:image/png;base64,abc123');
    const execIdx = html.indexOf('Executive summary content here.');
    assert.ok(coverIdx > -1, 'Cover data URI not found');
    assert.ok(execIdx > -1, 'Exec summary not found');
    assert.ok(coverIdx < execIdx, 'Cover should appear before exec summary');
  });

  it('executive summary appears before financial analysis', () => {
    const html = buildReportHTML(sections, charts, config);
    const execIdx = html.indexOf('Executive summary content here.');
    const finIdx = html.indexOf('Financial analysis content.');
    assert.ok(execIdx < finIdx, 'Exec summary should appear before financial analysis');
  });

  it('CONTINUE READING banner is present in HTML', () => {
    const html = buildReportHTML(sections, charts, config);
    assert.ok(
      html.includes('continue-reading') || html.includes('CONTINUE READING'),
      'Banner not found',
    );
  });

  it('CONTINUE READING banner contains the report price', () => {
    const html = buildReportHTML(sections, charts, config);
    assert.ok(html.includes('14.99'), 'Price not in banner');
  });
});

// ---------------------------------------------------------------------------
// Section 05 — generateReportPDF
// ---------------------------------------------------------------------------

describe('generateReportPDF', () => {
  it('sends POST to /weasyprint endpoint', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    const fetchFn = async (url, opts) => {
      capturedUrl = url;
      capturedMethod = opts.method;
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1000),
      };
    };
    await generateReportPDF('<html></html>', { price: 14.99 }, fetchFn);
    assert.ok(capturedUrl.includes('/weasyprint'), 'Should POST to /weasyprint');
    assert.equal(capturedMethod, 'POST');
  });

  it('returns a Buffer', async () => {
    const fetchFn = async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1000),
    });
    const result = await generateReportPDF('<html></html>', { price: 14.99 }, fetchFn);
    assert.ok(Buffer.isBuffer(result), 'Should return a Buffer');
  });

  it('throws when response buffer exceeds 8MB', async () => {
    const bigBuffer = new ArrayBuffer(9 * 1024 * 1024);
    const fetchFn = async () => ({
      ok: true,
      arrayBuffer: async () => bigBuffer,
    });
    await assert.rejects(
      () => generateReportPDF('<html></html>', { price: 14.99 }, fetchFn),
      /8MB|too large/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Section 05 — generatePreviewPDF
// ---------------------------------------------------------------------------

describe('generatePreviewPDF', () => {
  const { PDFDocument } = require('pdf-lib');

  async function makeTestPdf(pageCount) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      doc.addPage([595, 842]);
    }
    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  it('10-page source PDF produces 5-page preview', async () => {
    const source = await makeTestPdf(10);
    const preview = await generatePreviewPDF(source);
    const doc = await PDFDocument.load(preview);
    assert.equal(doc.getPageCount(), 5);
  });

  it('3-page source PDF produces 3-page preview (not 5)', async () => {
    const source = await makeTestPdf(3);
    const preview = await generatePreviewPDF(source);
    const doc = await PDFDocument.load(preview);
    assert.equal(doc.getPageCount(), 3);
  });

  it('5-page source PDF produces exactly 5-page preview', async () => {
    const source = await makeTestPdf(5);
    const preview = await generatePreviewPDF(source);
    const doc = await PDFDocument.load(preview);
    assert.equal(doc.getPageCount(), 5);
  });

  it('returns a Buffer (not Uint8Array)', async () => {
    const source = await makeTestPdf(3);
    const preview = await generatePreviewPDF(source);
    assert.ok(Buffer.isBuffer(preview), 'Should return Buffer');
  });

  it('0-page source PDF does not throw and returns Buffer', async () => {
    const source = await makeTestPdf(0);
    const preview = await generatePreviewPDF(source);
    assert.ok(Buffer.isBuffer(preview));
  });
});
