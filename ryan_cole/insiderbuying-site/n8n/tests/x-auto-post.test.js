const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectNextFormat,
  buildBreakingAlert,
  buildThread,
  buildCommentary,
  buildPoll,
  validatePoll,
  buildLinkValidation,
  buildQuoteRetweetJob,
  buildQuoteRetweetText,
  postToX,
  postToXWithMedia,
  checkDailyLimit,
  logTweet,
} = require('../code/insiderbuying/x-auto-post.js');

// ---------------------------------------------------------------------------
// selectNextFormat
// ---------------------------------------------------------------------------
describe('selectNextFormat', () => {
  const VALID_KEYS = ['breaking_alert', 'thread', 'market_commentary', 'engagement_poll'];

  it('never returns the last used format (run 50 times)', () => {
    for (let i = 0; i < 50; i++) {
      const result = selectNextFormat('breaking_alert');
      assert.notEqual(result, 'breaking_alert', `returned last used on attempt ${i}`);
    }
  });

  it('with lastUsed=null returns any of the 4 valid format keys', () => {
    const result = selectNextFormat(null);
    assert.ok(VALID_KEYS.includes(result), `unexpected: ${result}`);
  });

  it('always returns a valid format key', () => {
    for (let i = 0; i < 20; i++) {
      const r = selectNextFormat('thread');
      assert.ok(VALID_KEYS.includes(r), `unexpected: ${r}`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildBreakingAlert
// ---------------------------------------------------------------------------
describe('buildBreakingAlert', () => {
  const data = {
    ticker: 'NVDA', insiderName: 'Jensen Huang', insiderRole: 'CEO',
    transactionValue: '$2.4M', transactionDate: '2024-11-15',
    priceAtPurchase: 142.50, trackRecord: '+23% avg', clusterCount: 2,
  };

  it('returns the fixture text from DeepSeek', async () => {
    const expected = '$NVDA CEO Jensen Huang: $2.4M buy at $142.50. Watch for breakout above $155.';
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: expected } }] }),
      }),
    };
    const result = await buildBreakingAlert(data, helpers);
    assert.equal(result, expected);
  });

  it('prompt contains filing ticker and transaction value', async () => {
    let capturedBody;
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
      },
    };
    await buildBreakingAlert(data, helpers);
    const msgContent = capturedBody.messages[0].content;
    assert.ok(msgContent.includes('NVDA'), 'ticker missing from prompt');
    assert.ok(msgContent.includes('2.4M'), 'transactionValue missing from prompt');
  });
});

// ---------------------------------------------------------------------------
// buildThread
// ---------------------------------------------------------------------------
describe('buildThread', () => {
  const data = {
    ticker: 'NVDA', insiderName: 'Jensen Huang', insiderRole: 'CEO',
    transactionValue: '$2.4M', transactionDate: '2024-11-15',
    priceAtPurchase: 142.50, trackRecord: '+23% avg', clusterCount: 2,
  };

  it('returns array of exactly 3 strings on valid response', async () => {
    const tweets = [
      '$NVDA CEO just bought $2.4M. Thread on what this means for investors \u{1F9F5}',
      '$NVDA: Jensen Huang purchased 16,901 shares worth $2.4M on Nov 15 at $142.50.',
      "This matches the pattern from 2023. Watch the $150 level. Do you think this is a buying signal?",
    ];
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(tweets) } }] }),
      }),
    };
    const result = await buildThread(data, helpers);
    assert.ok(Array.isArray(result), 'not array');
    assert.equal(result.length, 3);
  });

  it('returns null when tweet 2 exceeds 280 chars (after 2 attempts)', async () => {
    const longTweet = 'x'.repeat(281);
    const tweets = [
      '$NVDA CEO bought big \u{1F9F5}',
      longTweet,
      'Watch this level carefully.',
    ];
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(tweets) } }] }),
      }),
    };
    const result = await buildThread(data, helpers);
    assert.equal(result, null);
  });

  it('returns null when tweet contains link (after 2 attempts)', async () => {
    const tweets = [
      '$NVDA buy signal \u{1F9F5}',
      'See http://example.com for details on the filing.',
      'Watch the key levels.',
    ];
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(tweets) } }] }),
      }),
    };
    const result = await buildThread(data, helpers);
    assert.equal(result, null);
  });

  it('no element in successful result exceeds 280 chars', async () => {
    const tweets = [
      '$NVDA CEO bought $2.4M today \u{1F9F5}',
      'Transaction: 16,901 shares at $142.50 on November 15.',
      "Third cluster buy in 60 days. Watch for breakout. Are you buying here?",
    ];
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(tweets) } }] }),
      }),
    };
    const result = await buildThread(data, helpers);
    if (result) {
      result.forEach((t, i) => assert.ok(t.length <= 280, `tweet ${i} too long`));
    }
  });
});

// ---------------------------------------------------------------------------
// buildCommentary
// ---------------------------------------------------------------------------
describe('buildCommentary', () => {
  const data = {
    ticker: 'NVDA', insiderName: 'Jensen Huang', insiderRole: 'CEO',
    transactionValue: '$2.4M', transactionDate: '2024-11-15',
    priceAtPurchase: 142.50, trackRecord: null, clusterCount: 1,
  };

  it('returns a string', async () => {
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '$NVDA market commentary.' } }] }),
      }),
    };
    const result = await buildCommentary(data, helpers);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('prompt contains filing ticker and transaction data', async () => {
    let capturedBody;
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
      },
    };
    await buildCommentary(data, helpers);
    const msg = capturedBody.messages[0].content;
    assert.ok(msg.includes('NVDA'));
    assert.ok(msg.includes('2.4M'));
  });
});

// ---------------------------------------------------------------------------
// buildPoll
// ---------------------------------------------------------------------------
describe('buildPoll', () => {
  const data = {
    ticker: 'NVDA', insiderName: 'Jensen Huang', insiderRole: 'CEO',
    transactionValue: '$2.4M', transactionDate: '2024-11-15',
    priceAtPurchase: 142.50, trackRecord: null, clusterCount: 1,
  };

  it('returns object with text and poll shape', async () => {
    const fixture = JSON.stringify({
      text: 'Do you think $NVDA insider buy signals a breakout?',
      options: ['Yes, buying', 'No, too late', 'Wait and see'],
    });
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: fixture } }] }),
      }),
    };
    const result = await buildPoll(data, helpers);
    assert.ok(typeof result.text === 'string');
    assert.ok(result.poll && Array.isArray(result.poll.options));
    assert.ok(result.poll.options.length >= 2 && result.poll.options.length <= 4);
  });

  it('returned poll.duration_minutes is 1440', async () => {
    const fixture = JSON.stringify({
      text: '$NVDA insider buy. Are you in?',
      options: ['Yes', 'No'],
    });
    const helpers = {
      deepseekApiKey: 'test',
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: fixture } }] }),
      }),
    };
    const result = await buildPoll(data, helpers);
    assert.equal(result.poll.duration_minutes, 1440);
  });
});

// ---------------------------------------------------------------------------
// validatePoll
// ---------------------------------------------------------------------------
describe('validatePoll', () => {
  it('2 options, each label <=25 chars -> valid', () => {
    const r = validatePoll({ options: [{ label: 'Yes' }, { label: 'No' }], duration_minutes: 1440 });
    assert.equal(r.valid, true);
  });

  it('4 options, each label <=25 chars -> valid', () => {
    const r = validatePoll({ options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }], duration_minutes: 1440 });
    assert.equal(r.valid, true);
  });

  it('1 option -> invalid', () => {
    const r = validatePoll({ options: [{ label: 'Only' }] });
    assert.equal(r.valid, false);
  });

  it('5 options -> invalid', () => {
    const r = validatePoll({ options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }] });
    assert.equal(r.valid, false);
  });

  it('option label of exactly 26 chars -> invalid, error mentions 25 characters', () => {
    const r = validatePoll({ options: [{ label: 'A'.repeat(26) }, { label: 'B' }] });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('25 characters'), `error: ${r.error}`);
  });

  it('option label of exactly 25 chars -> valid', () => {
    const r = validatePoll({ options: [{ label: 'A'.repeat(25) }, { label: 'B' }] });
    assert.equal(r.valid, true);
  });
});

// ---------------------------------------------------------------------------
// buildLinkValidation (section 07)
// ---------------------------------------------------------------------------
describe('buildLinkValidation', () => {
  it('http:// -> invalid', () => {
    assert.equal(buildLinkValidation('Check http://example.com').valid, false);
  });

  it('https:// -> invalid', () => {
    assert.equal(buildLinkValidation('See https://site.com/page').valid, false);
  });

  it('www. -> invalid', () => {
    assert.equal(buildLinkValidation('Visit www.example.com').valid, false);
  });

  it('.com/ -> invalid', () => {
    assert.equal(buildLinkValidation('earnings.com/report').valid, false);
  });

  it('dot-com bubble -> valid', () => {
    assert.equal(buildLinkValidation('Not like the dot-com bubble at all').valid, true);
  });

  it('TechCorp .com domain (no slash) -> valid', () => {
    assert.equal(buildLinkValidation("TechCorp's .com domain is well known").valid, true);
  });

  it('clean text -> valid', () => {
    assert.equal(buildLinkValidation('$NVDA insiders are buying. Strong conviction signal.').valid, true);
  });
});

// ---------------------------------------------------------------------------
// buildQuoteRetweetJob
// ---------------------------------------------------------------------------
describe('buildQuoteRetweetJob', () => {
  it('record has correct fields and types', () => {
    const before = Date.now();
    const r = buildQuoteRetweetJob('123', 'NVDA', 142.50);
    const after = Date.now();
    assert.equal(r.tweet_id, '123');
    assert.equal(r.ticker, 'NVDA');
    assert.equal(typeof r.priceAtPurchase, 'number');
    assert.equal(r.priceAtPurchase, 142.50);
    assert.equal(r.type, 'quote_retweet');
    assert.equal(r.status, 'pending');
    assert.ok(typeof r.execute_after === 'string');
    const ea = new Date(r.execute_after).getTime();
    assert.ok(ea >= before + 7200000 && ea <= after + 10800000, `execute_after out of range`);
  });

  it('status is pending', () => {
    assert.equal(buildQuoteRetweetJob('x', 'AAPL', 100).status, 'pending');
  });

  it('type is quote_retweet', () => {
    assert.equal(buildQuoteRetweetJob('x', 'AAPL', 100).type, 'quote_retweet');
  });

  it('priceAtPurchase is a number not a string', () => {
    const r = buildQuoteRetweetJob('x', 'AAPL', '142.50');
    assert.equal(typeof r.priceAtPurchase, 'number');
  });
});

// ---------------------------------------------------------------------------
// buildQuoteRetweetText
// ---------------------------------------------------------------------------
describe('buildQuoteRetweetText', () => {
  it('+8.3% case contains $NVDA and +8.3%', () => {
    const r = buildQuoteRetweetText('NVDA', 100, 108.3);
    assert.ok(r.includes('$NVDA'), 'cashtag missing');
    assert.ok(r.includes('+8.3%'), `pct missing: ${r}`);
  });

  it('-8.0% case', () => {
    const r = buildQuoteRetweetText('NVDA', 100, 92);
    assert.ok(r.includes('-8.0%'), `pct: ${r}`);
  });

  it('0.0% case', () => {
    const r = buildQuoteRetweetText('NVDA', 100, 100);
    assert.ok(r.includes('0.0%'), `pct: ${r}`);
  });

  it("all results include Here's what to watch", () => {
    const r = buildQuoteRetweetText('AAPL', 150, 160);
    assert.ok(r.includes("Here's what to watch"), `missing: ${r}`);
  });

  it('no URL in result', () => {
    const r = buildQuoteRetweetText('NVDA', 100, 110);
    assert.ok(!r.includes('http') && !r.includes('www.') && !r.includes('.com/'));
  });
});

// ---------------------------------------------------------------------------
// checkDailyLimit (updated cap = 4)
// ---------------------------------------------------------------------------
describe('checkDailyLimit', () => {
  it('returns canPost=false when >= 4 posts', () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const result = checkDailyLimit(entries);
    assert.equal(result.canPost, false);
    assert.equal(result.postsToday, 4);
  });

  it('returns canPost=true when < 4 posts', () => {
    const entries = [{ id: 1 }, { id: 2 }];
    const result = checkDailyLimit(entries);
    assert.equal(result.canPost, true);
    assert.equal(result.postsToday, 2);
  });

  it('handles empty/null input', () => {
    const result = checkDailyLimit(null);
    assert.equal(result.canPost, true);
    assert.equal(result.postsToday, 0);
  });
});

// ---------------------------------------------------------------------------
// logTweet
// ---------------------------------------------------------------------------
describe('logTweet', () => {
  it('returns record with correct fields', () => {
    const record = logTweet('tweet123', 'Hello world', 'article', 'art456');
    assert.equal(record.tweet_id, 'tweet123');
    assert.equal(record.text, 'Hello world');
    assert.equal(record.source_type, 'article');
    assert.equal(record.source_id, 'art456');
    assert.equal(record.status, 'posted');
    assert.ok(typeof record.posted_at === 'string');
  });
});

// ---------------------------------------------------------------------------
// postToXWithMedia
// ---------------------------------------------------------------------------
describe('postToXWithMedia', () => {
  it('with mediaId: body contains media.media_ids', () => {
    const r = postToXWithMedia('hello', 'media123');
    assert.equal(r.method, 'POST');
    assert.ok(r.url.includes('api.twitter.com'));
    assert.ok(r.body.media && r.body.media.media_ids[0] === 'media123');
  });

  it('without mediaId: body has no media key', () => {
    const r = postToXWithMedia('hello', null);
    assert.ok(!r.body.media);
  });
});
