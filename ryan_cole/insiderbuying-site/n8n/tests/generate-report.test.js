const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseWebhook,
  determineReportParams,
  buildReportPrompt,
  buildReportHTML,
  buildDeliveryEmail,
  buildReportRecord,
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
