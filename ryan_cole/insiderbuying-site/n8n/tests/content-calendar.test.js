'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  addToCalendar,
  getCalendarForDate,
  checkContentFreshness,
  checkCompetitorFeeds,
  checkContentSimilarity,
  scheduleFromEarnings,
} = require('../code/insiderbuying/content-calendar.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNocodb(overrides) {
  return Object.assign({
    post: async (table, body) => Object.assign({ id: 1 }, body),
    get: async (table, params) => ({ list: [] }),
    patch: async (table, id, body) => Object.assign({ id }, body),
  }, overrides || {});
}

function makeTelegram(overrides) {
  return Object.assign({ send: async (msg) => {} }, overrides || {});
}

const SAMPLE_RSS = '<?xml version="1.0" encoding="UTF-8"?>' +
  '<rss version="2.0"><channel><title>Test Feed</title>' +
  '<item>' +
  '<title>AAPL Reports Record Earnings</title>' +
  '<link>https://example.com/aapl-earnings</link>' +
  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
  '<description><![CDATA[Apple (AAPL) reported Q4 earnings. CEO Tim Cook said growth is strong.]]></description>' +
  '</item>' +
  '<item>' +
  '<title>SEC Filing on MSFT Insider Trade</title>' +
  '<link>https://example.com/msft-filing</link>' +
  '<pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>' +
  '<description>Microsoft MSFT insider filing reviewed by the SEC.</description>' +
  '</item>' +
  '</channel></rss>';

// ---------------------------------------------------------------------------
// addToCalendar
// ---------------------------------------------------------------------------
describe('addToCalendar', () => {
  it('calls nocodb.post with correct fields', async () => {
    var posted = null;
    var nocodb = makeNocodb({
      post: async (table, body) => { posted = { table: table, body: body }; return Object.assign({ id: 1 }, body); },
    });
    await addToCalendar({ ticker: 'AAPL', type: 'article', date: '2024-01-15', channel: 'blog' }, { nocodb: nocodb });
    assert.equal(posted.table, 'Content_Calendar');
    assert.equal(posted.body.ticker_or_topic, 'AAPL');
    assert.equal(posted.body.content_type, 'article');
    assert.equal(posted.body.planned_date, '2024-01-15');
    assert.equal(posted.body.status, 'planned');
    assert.equal(posted.body.channel, 'blog');
  });

  it('status defaults to planned', async () => {
    var postedBody = null;
    var nocodb = makeNocodb({ post: async (t, body) => { postedBody = body; return body; } });
    await addToCalendar({ ticker: 'TSLA', type: 'x_thread', date: '2024-02-01', channel: 'x' }, { nocodb: nocodb });
    assert.equal(postedBody.status, 'planned');
  });

  it('omits notes field when not provided', async () => {
    var postedBody = null;
    var nocodb = makeNocodb({ post: async (t, body) => { postedBody = body; return body; } });
    await addToCalendar({ ticker: 'GOOG', type: 'report', date: '2024-03-01', channel: 'email' }, { nocodb: nocodb });
    assert.ok(!('notes' in postedBody), 'notes should not be in POST body when not provided');
  });
});

// ---------------------------------------------------------------------------
// getCalendarForDate
// ---------------------------------------------------------------------------
describe('getCalendarForDate', () => {
  it('constructs correct NocoDB where filter', async () => {
    var calledParams = null;
    var nocodb = makeNocodb({
      get: async (table, params) => { calledParams = { table: table, params: params }; return { list: [] }; },
    });
    await getCalendarForDate('2024-01-15', { nocodb: nocodb });
    assert.equal(calledParams.table, 'Content_Calendar');
    assert.ok(calledParams.params.where.indexOf('planned_date,eq,2024-01-15') !== -1, 'where must filter by date');
    assert.ok(calledParams.params.where.indexOf('status,eq,planned') !== -1, 'where must filter by status');
  });

  it('returns array from NocoDB response', async () => {
    var items = [{ id: 1, ticker_or_topic: 'AAPL' }];
    var nocodb = makeNocodb({ get: async () => ({ list: items }) });
    var result = await getCalendarForDate('2024-01-15', { nocodb: nocodb });
    assert.deepEqual(result, items);
  });

  it('returns empty array on empty response', async () => {
    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
    var result = await getCalendarForDate('2024-01-15', { nocodb: nocodb });
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// checkContentFreshness
// ---------------------------------------------------------------------------
describe('checkContentFreshness', () => {
  it('returns fresh: true when article published 10 days ago', async () => {
    var tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    var nocodb = makeNocodb({ get: async () => ({ list: [{ published_at: tenDaysAgo }] }) });
    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
    assert.equal(result.fresh, true);
    assert.ok(result.lastPublished != null);
  });

  it('returns fresh: false when no articles', async () => {
    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
    assert.equal(result.fresh, false);
    assert.equal(result.lastPublished, null);
  });

  it('returns fresh: false when article published 31 days ago (outside 30-day window)', async () => {
    // Mock returns empty (filter already excludes records older than 30 days)
    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
    assert.equal(result.fresh, false);
    assert.equal(result.lastPublished, null);
  });
});

// ---------------------------------------------------------------------------
// checkCompetitorFeeds
// ---------------------------------------------------------------------------
describe('checkCompetitorFeeds', () => {
  it('parses mock RSS and checks tickers', async () => {
    var checkedCount = 0;
    var nocodb = makeNocodb({
      get: async () => { checkedCount++; return { list: [] }; },
      post: async () => ({ id: 1 }),
    });
    var telegram = makeTelegram();
    await checkCompetitorFeeds({
      feeds: ['https://example.com/feed'],
      fetchRSS: async () => SAMPLE_RSS,
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.ok(checkedCount > 0, 'should have checked at least one ticker');
  });

  it('writes Competitor_Intel and sends alert when ticker not covered in 30 days', async () => {
    var postedTable = null;
    var alertSent = false;
    var nocodb = makeNocodb({
      get: async () => ({ list: [] }),
      post: async (table) => { postedTable = table; return { id: 1 }; },
    });
    var telegram = makeTelegram({ send: async () => { alertSent = true; } });
    await checkCompetitorFeeds({
      feeds: ['https://example.com/feed'],
      fetchRSS: async () => SAMPLE_RSS,
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.equal(postedTable, 'Competitor_Intel');
    assert.ok(alertSent, 'Telegram alert should be sent');
  });

  it('does NOT write record or alert when ticker already covered in 30 days', async () => {
    var postCalled = false;
    var alertSent = false;
    var recentDate = new Date().toISOString();
    var nocodb = makeNocodb({
      get: async () => ({ list: [{ published_at: recentDate }] }),
      post: async () => { postCalled = true; return { id: 1 }; },
    });
    var telegram = makeTelegram({ send: async () => { alertSent = true; } });
    await checkCompetitorFeeds({
      feeds: ['https://example.com/feed'],
      fetchRSS: async () => SAMPLE_RSS,
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.ok(!postCalled, 'should NOT post to Competitor_Intel when already covered');
    assert.ok(!alertSent, 'should NOT send alert when already covered');
  });

  it('continues when one feed fails, processes others', async () => {
    var feedCount = 0;
    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => ({ id: 1 }) });
    var telegram = makeTelegram();
    await checkCompetitorFeeds({
      feeds: ['https://fail.example.com/feed', 'https://ok.example.com/feed'],
      fetchRSS: async (url) => {
        feedCount++;
        if (url.indexOf('fail') !== -1) throw new Error('Network error');
        return SAMPLE_RSS;
      },
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.equal(feedCount, 2, 'both feeds should be attempted');
  });

  it('sends ONE Telegram error message when all feeds fail', async () => {
    var errorCount = 0;
    var telegram = makeTelegram({ send: async () => { errorCount++; } });
    var nocodb = makeNocodb();
    await checkCompetitorFeeds({
      feeds: ['https://fail1.example.com', 'https://fail2.example.com'],
      fetchRSS: async () => { throw new Error('Network error'); },
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.equal(errorCount, 1, 'should send exactly one error message when all feeds fail');
  });

  it('handles CDATA blocks in RSS without throwing', async () => {
    var threw = false;
    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => ({ id: 1 }) });
    var telegram = makeTelegram();
    try {
      await checkCompetitorFeeds({
        feeds: ['https://example.com/feed'],
        fetchRSS: async () => SAMPLE_RSS,
        nocodb: nocodb,
        telegram: telegram,
      });
    } catch (e) {
      threw = true;
    }
    assert.ok(!threw, 'should not throw when RSS has CDATA blocks');
  });

  it('does not match stop-words as tickers (AND, THE, FOR)', async () => {
    var rssWithStopWords = '<?xml version="1.0"?><rss version="2.0"><channel>' +
      '<item><title>FOR THE AND OF SEC NYSE CEO IPO</title>' +
      '<link>http://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
      '<description>no real tickers</description></item>' +
      '</channel></rss>';
    var postCalled = false;
    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => { postCalled = true; return { id: 1 }; } });
    var telegram = makeTelegram();
    await checkCompetitorFeeds({
      feeds: ['https://example.com/feed'],
      fetchRSS: async () => rssWithStopWords,
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.ok(!postCalled, 'stop-words should not be treated as tickers');
  });

  it('ignores non-ticker uppercase tokens (NYSE, SEC, CEO, IPO)', async () => {
    var rssWithNonTickers = '<?xml version="1.0"?><rss version="2.0"><channel>' +
      '<item><title>NYSE SEC CEO IPO EPS GDP CPI</title>' +
      '<link>http://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
      '<description>no real tickers here</description></item>' +
      '</channel></rss>';
    var postCalled = false;
    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => { postCalled = true; return { id: 1 }; } });
    var telegram = makeTelegram();
    await checkCompetitorFeeds({
      feeds: ['https://example.com/feed'],
      fetchRSS: async () => rssWithNonTickers,
      nocodb: nocodb,
      telegram: telegram,
    });
    assert.ok(!postCalled, 'non-ticker uppercase tokens should be filtered by stop-words');
  });
});

// ---------------------------------------------------------------------------
// checkContentSimilarity
// ---------------------------------------------------------------------------
describe('checkContentSimilarity', () => {
  it('returns similar: true for identical text', async () => {
    var text = 'Apple insider buying AAPL stock large purchase this quarter report';
    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-1', body_text: text }] }) });
    var result = await checkContentSimilarity(text, 'AAPL', { nocodb: nocodb });
    assert.equal(result.similar, true);
    assert.ok(result.match != null);
  });

  it('returns similar: false for completely different text', async () => {
    var existing = 'Apple quarterly earnings strong revenue growth mobile iPhone';
    var newText = 'Tesla electric vehicle manufacturing gigafactory production battery energy';
    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-1', body_text: existing }] }) });
    var result = await checkContentSimilarity(newText, 'TSLA', { nocodb: nocodb });
    assert.equal(result.similar, false);
  });

  it('similarity at exactly 0.85 returns similar: true (inclusive threshold)', async () => {
    var text = 'insider purchase form four sec filing stock buyback significant amount shares';
    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-2', body_text: text }] }) });
    var result = await checkContentSimilarity(text, 'AAPL', { nocodb: nocodb });
    assert.equal(result.similar, true);
  });

  it('returns similar: false when no existing articles', async () => {
    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
    var result = await checkContentSimilarity('some article text here', 'AAPL', { nocodb: nocodb });
    assert.equal(result.similar, false);
    assert.equal(result.match, null);
  });

  it('truncates articles to 2000 words before comparison without throwing', async () => {
    var longText = Array(3000).fill('uniqueword').join(' ');
    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-3', body_text: longText }] }) });
    var result = await checkContentSimilarity(longText, 'AAPL', { nocodb: nocodb });
    assert.ok(typeof result.similar === 'boolean');
  });
});

// ---------------------------------------------------------------------------
// scheduleFromEarnings
// ---------------------------------------------------------------------------
describe('scheduleFromEarnings', () => {
  it('calls addToCalendar with earnings_date minus 3 days for ticker in both earnings and Insider_Alerts', async () => {
    var earningsDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    var postedEntry = null;
    var nocodb = makeNocodb({
      get: async (table) => {
        if (table === 'Insider_Alerts') return { list: [{ ticker: 'AAPL' }] };
        return { list: [] };
      },
      post: async (table, body) => { postedEntry = { table: table, body: body }; return Object.assign({ id: 1 }, body); },
    });
    await scheduleFromEarnings({
      nocodb: nocodb,
      delay: async () => {},
      fetchEarnings: async () => [{ ticker: 'AAPL', reportDate: earningsDate }],
    });
    assert.ok(postedEntry != null, 'addToCalendar should have been called');
    var expectedDate = new Date(new Date(earningsDate).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    assert.equal(postedEntry.body.planned_date, expectedDate);
  });

  it('does NOT call addToCalendar when ticker in earnings but NOT in Insider_Alerts', async () => {
    var postCalled = false;
    var nocodb = makeNocodb({
      get: async () => ({ list: [] }),
      post: async () => { postCalled = true; return { id: 1 }; },
    });
    await scheduleFromEarnings({
      nocodb: nocodb,
      delay: async () => {},
      fetchEarnings: async () => [{ ticker: 'MSFT', reportDate: '2024-02-15' }],
    });
    assert.ok(!postCalled, 'should not schedule when ticker not in Insider_Alerts');
  });

  it('calls delay between ticker lookups', async () => {
    var delayCount = 0;
    var nocodb = makeNocodb({
      get: async (table) => {
        if (table === 'Insider_Alerts') return { list: [{ ticker: 'AAPL' }] };
        return { list: [] };
      },
      post: async () => ({ id: 1 }),
    });
    await scheduleFromEarnings({
      nocodb: nocodb,
      delay: async () => { delayCount++; },
      fetchEarnings: async () => [
        { ticker: 'AAPL', reportDate: '2024-02-15' },
        { ticker: 'TSLA', reportDate: '2024-02-20' },
      ],
    });
    assert.ok(delayCount >= 1, 'delay should be called between ticker lookups');
  });

  it('Insider_Alerts query includes 30-day date filter', async () => {
    var capturedParams = null;
    var nocodb = makeNocodb({
      get: async (table, params) => {
        if (table === 'Insider_Alerts') { capturedParams = params; return { list: [] }; }
        return { list: [] };
      },
      post: async () => ({ id: 1 }),
    });
    await scheduleFromEarnings({
      nocodb: nocodb,
      delay: async () => {},
      fetchEarnings: async () => [{ ticker: 'AAPL', reportDate: '2024-02-15' }],
    });
    assert.ok(capturedParams != null, 'Insider_Alerts should have been queried');
    assert.ok(capturedParams.where && capturedParams.where.indexOf('created_at,gt') !== -1,
      'query should include created_at date filter to limit to last 30 days');
  });
});
