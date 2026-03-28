const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  gatherWeeklyContent,
  generateSummaries,
  assembleNewsletter,
  sendViaBeehiiv,
} = require('../code/insiderbuying/weekly-newsletter.js');

// ---------------------------------------------------------------------------
// gatherWeeklyContent
// ---------------------------------------------------------------------------
describe('gatherWeeklyContent', () => {
  it('returns expected structure with articles, topAlerts, dataStudy, cutoffDate', async () => {
    const result = await gatherWeeklyContent({ baseUrl: 'http://localhost', token: 'test' });
    assert.ok(Array.isArray(result.articles));
    assert.ok(Array.isArray(result.topAlerts));
    assert.ok('dataStudy' in result);
    assert.ok(typeof result.cutoffDate === 'string');
    assert.match(result.cutoffDate, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// generateSummaries
// ---------------------------------------------------------------------------
describe('generateSummaries', () => {
  it('returns articleTeasers array', () => {
    const content = {
      articles: [
        { title: 'AAPL Analysis', meta_description: 'Apple insiders buying', slug: 'aapl-analysis', ticker: 'AAPL', verdict_type: 'bullish' },
      ],
      topAlerts: [],
    };
    const result = generateSummaries(content);
    assert.ok(Array.isArray(result.articleTeasers));
    assert.equal(result.articleTeasers.length, 1);
    assert.equal(result.articleTeasers[0].title, 'AAPL Analysis');
    assert.equal(result.articleTeasers[0].ticker, 'AAPL');
  });

  it('returns subjectLine, alertDigest', () => {
    const content = { articles: [], topAlerts: [{ ticker: 'TSLA' }] };
    const result = generateSummaries(content);
    assert.ok(typeof result.subjectLine === 'string');
    assert.ok(typeof result.alertDigest === 'string');
    assert.ok(result.alertDigest.length > 0);
  });

  it('subjectLine length is between 40 and 60 characters', () => {
    // With topAlerts (short subject gets padded)
    const short = generateSummaries({ articles: [], topAlerts: [] });
    assert.ok(short.subjectLine.length >= 40, 'subject too short: ' + short.subjectLine.length);
    assert.ok(short.subjectLine.length <= 60, 'subject too long: ' + short.subjectLine.length);

    // With long ticker alert (gets truncated)
    const long = generateSummaries({
      articles: [],
      topAlerts: [{ ticker: 'SUPERLONGTICKERNAME' }],
    });
    assert.ok(long.subjectLine.length <= 60, 'subject too long: ' + long.subjectLine.length);
  });
});

// ---------------------------------------------------------------------------
// assembleNewsletter
// ---------------------------------------------------------------------------
describe('assembleNewsletter', () => {
  const summaries = generateSummaries({
    articles: [{ title: 'Test', slug: 'test', ticker: 'XYZ', verdict_type: 'bullish', meta_description: 'Desc' }],
    topAlerts: [],
  });
  const content = { articles: [], topAlerts: [] };

  it('returns HTML containing THIS WEEK', () => {
    const html = assembleNewsletter(summaries, content);
    assert.ok(html.indexOf('THIS WEEK') !== -1, 'HTML should contain THIS WEEK');
  });

  it('includes CTA section with Upgrade to Pro', () => {
    const html = assembleNewsletter(summaries, content);
    assert.ok(html.indexOf('Upgrade to Pro') !== -1, 'HTML should contain Upgrade to Pro');
  });

  it('returns valid HTML with DOCTYPE', () => {
    const html = assembleNewsletter(summaries, content);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
  });
});

// ---------------------------------------------------------------------------
// sendViaBeehiiv
// ---------------------------------------------------------------------------
describe('sendViaBeehiiv', () => {
  it('returns error when no credentials', () => {
    // Clear env vars
    const origKey = process.env.BEEHIIV_API_KEY;
    const origPub = process.env.BEEHIIV_PUBLICATION_ID;
    delete process.env.BEEHIIV_API_KEY;
    delete process.env.BEEHIIV_PUBLICATION_ID;

    const result = sendViaBeehiiv('<html></html>', 'Test', 'Preview');
    assert.equal(result.success, false);
    assert.ok(result.error.indexOf('credentials') !== -1 || result.error.indexOf('Beehiiv') !== -1);

    // Restore
    if (origKey) process.env.BEEHIIV_API_KEY = origKey;
    if (origPub) process.env.BEEHIIV_PUBLICATION_ID = origPub;
  });

  it('returns success true when credentials are set', () => {
    process.env.BEEHIIV_API_KEY = 'test-key';
    process.env.BEEHIIV_PUBLICATION_ID = 'test-pub';

    const result = sendViaBeehiiv('<html></html>', 'Subject', 'Preview');
    assert.equal(result.success, true);
    assert.ok(result.url.indexOf('test-pub') !== -1);

    delete process.env.BEEHIIV_API_KEY;
    delete process.env.BEEHIIV_PUBLICATION_ID;
  });
});
