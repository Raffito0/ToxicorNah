'use strict';

const {
  filterRelevant,
  draftReply,
  sendToTelegramReview,
} = require('../../n8n/code/insiderbuying/x-engagement');

// ─── filterRelevant ───────────────────────────────────────────────────────

describe('filterRelevant()', () => {
  const OLD_DATE = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
  const NEW_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago (too new)

  const GOOD_USER = { followers_count: 50, following_count: 50, created_at: OLD_DATE };
  const BOT_USER_FEW_FOLLOWERS = { followers_count: 5, following_count: 50, created_at: OLD_DATE };
  const BOT_USER_FEW_FOLLOWING = { followers_count: 50, following_count: 5, created_at: OLD_DATE };
  const NEW_ACCOUNT = { followers_count: 50, following_count: 50, created_at: NEW_DATE };

  test('returns empty array for null/non-array input', () => {
    expect(filterRelevant(null)).toEqual([]);
    expect(filterRelevant(undefined)).toEqual([]);
    expect(filterRelevant('string')).toEqual([]);
  });

  test('filters out item with missing user', () => {
    const items = [{ id: '1', text: 'test' }]; // no .user
    expect(filterRelevant(items)).toHaveLength(0);
  });

  test('keeps item with sufficient followers and following', () => {
    const items = [{ id: '1', text: 'test', user: GOOD_USER }];
    expect(filterRelevant(items)).toHaveLength(1);
  });

  test('filters out item with followers < 10', () => {
    const items = [{ id: '1', text: 'test', user: BOT_USER_FEW_FOLLOWERS }];
    expect(filterRelevant(items)).toHaveLength(0);
  });

  test('filters out item with following < 10', () => {
    const items = [{ id: '1', text: 'test', user: BOT_USER_FEW_FOLLOWING }];
    expect(filterRelevant(items)).toHaveLength(0);
  });

  test('filters out account created within last 30 days', () => {
    const items = [{ id: '1', text: 'test', user: NEW_ACCOUNT }];
    expect(filterRelevant(items)).toHaveLength(0);
  });

  test('keeps multiple valid items', () => {
    const items = [
      { id: '1', text: 'a', user: GOOD_USER },
      { id: '2', text: 'b', user: GOOD_USER },
    ];
    expect(filterRelevant(items)).toHaveLength(2);
  });
});

// ─── draftReply ───────────────────────────────────────────────────────────

describe('draftReply()', () => {
  const SAMPLE_TWEET = {
    id: '123456',
    text: 'What do you think about recent insider buying in AAPL?',
    user: { screen_name: 'trader_jane' },
  };

  test('returns object with prompt and maxTokens', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('maxTokens');
  });

  test('prompt includes the original tweet text', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result.prompt).toContain(SAMPLE_TWEET.text);
  });

  test('prompt includes the author handle', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result.prompt).toContain('trader_jane');
  });

  test('prompt contains NO links/URLs rule', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result.prompt.toUpperCase()).toContain('NO LINKS');
  });

  test('prompt contains NO brand names rule', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result.prompt.toUpperCase()).toContain('NO BRAND');
  });

  test('maxTokens is a reasonable number (50-200)', () => {
    const result = draftReply(SAMPLE_TWEET);
    expect(result.maxTokens).toBeGreaterThanOrEqual(50);
    expect(result.maxTokens).toBeLessThanOrEqual(200);
  });

  test('handles null tweet gracefully', () => {
    expect(() => draftReply(null)).not.toThrow();
    const result = draftReply(null);
    expect(result).toHaveProperty('prompt');
  });
});

// ─── sendToTelegramReview ─────────────────────────────────────────────────

describe('sendToTelegramReview()', () => {
  const ORIGINAL = {
    id: '789',
    text: 'Insider data looks bullish on MSFT',
    user: { screen_name: 'some_trader' },
  };
  const DRAFT = 'Great point. Recent filings show strong insider conviction.';
  const CHAT_ID = '-1001234567890';

  test('returns object with method=sendMessage', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    expect(payload.method).toBe('sendMessage');
  });

  test('chat_id matches provided chatId', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    expect(payload.chat_id).toBe(CHAT_ID);
  });

  test('text includes original tweet content', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    expect(payload.text).toContain(ORIGINAL.text);
  });

  test('text includes draft reply', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    expect(payload.text).toContain(DRAFT);
  });

  test('reply_markup has inline keyboard with Approve, Edit, Skip', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    const buttons = payload.reply_markup.inline_keyboard[0].map((b) => b.text);
    expect(buttons).toContain('Approve');
    expect(buttons).toContain('Edit');
    expect(buttons).toContain('Skip');
  });

  test('callback_data includes tweet id for routing', () => {
    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
    const approveCb = payload.reply_markup.inline_keyboard[0].find((b) => b.text === 'Approve');
    expect(approveCb.callback_data).toContain('789');
  });
});
