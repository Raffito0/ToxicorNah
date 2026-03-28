const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  filterRelevant,
  draftReply,
  sendToTelegramReview,
} = require('../code/insiderbuying/x-engagement.js');

// ---------------------------------------------------------------------------
// filterRelevant
// ---------------------------------------------------------------------------
describe('filterRelevant', () => {
  it('removes accounts with low followers (bot-like)', () => {
    const items = [
      { id: '1', text: 'test', user: { followers_count: 5, following_count: 100, created_at: '2020-01-01' } },
    ];
    const result = filterRelevant(items);
    assert.equal(result.length, 0);
  });

  it('removes new accounts (< 30 days old)', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10); // 10 days ago
    const items = [
      { id: '1', text: 'test', user: { followers_count: 500, following_count: 200, created_at: recentDate.toISOString() } },
    ];
    const result = filterRelevant(items);
    assert.equal(result.length, 0);
  });

  it('keeps legitimate accounts', () => {
    const items = [
      { id: '1', text: 'AAPL insider buying', user: { followers_count: 500, following_count: 200, created_at: '2020-01-01' } },
    ];
    const result = filterRelevant(items);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('handles null/empty input', () => {
    assert.deepEqual(filterRelevant(null), []);
    assert.deepEqual(filterRelevant([]), []);
  });

  it('filters out items without user object', () => {
    const items = [{ id: '1', text: 'test' }];
    const result = filterRelevant(items);
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// draftReply
// ---------------------------------------------------------------------------
describe('draftReply', () => {
  it('returns prompt string with maxTokens', () => {
    const tweet = { id: '123', text: 'AAPL insiders bought big', user: { screen_name: 'trader_joe' } };
    const result = draftReply(tweet);
    assert.ok(typeof result.prompt === 'string');
    assert.ok(result.prompt.length > 0);
    assert.ok(typeof result.maxTokens === 'number');
  });

  it('prompt contains the original tweet text', () => {
    const tweet = { id: '123', text: 'Big insider purchase on NVDA', user: { screen_name: 'stockguy' } };
    const result = draftReply(tweet);
    assert.ok(result.prompt.indexOf('Big insider purchase on NVDA') !== -1);
  });

  it('prompt includes no-link and no-brand rules', () => {
    const tweet = { id: '1', text: 'test', user: { screen_name: 'user1' } };
    const result = draftReply(tweet);
    assert.ok(result.prompt.indexOf('NO links') !== -1 || result.prompt.indexOf('No links') !== -1);
    assert.ok(result.prompt.indexOf('brand') !== -1);
  });
});

// ---------------------------------------------------------------------------
// sendToTelegramReview
// ---------------------------------------------------------------------------
describe('sendToTelegramReview', () => {
  it('returns object with inline_keyboard containing 3 buttons', () => {
    const original = { id: 'tw123', text: 'Some tweet', user: { screen_name: 'trader' } };
    const result = sendToTelegramReview(original, 'Draft reply here', 'chat456');

    assert.ok(result.reply_markup);
    assert.ok(result.reply_markup.inline_keyboard);
    const buttons = result.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].text, 'Approve');
    assert.equal(buttons[1].text, 'Edit');
    assert.equal(buttons[2].text, 'Skip');
  });

  it('callback_data contains tweet id', () => {
    const original = { id: 'tw999', text: 'test', user: { screen_name: 'x' } };
    const result = sendToTelegramReview(original, 'reply', 'chat1');
    const buttons = result.reply_markup.inline_keyboard[0];
    assert.ok(buttons[0].callback_data.indexOf('tw999') !== -1);
  });

  it('includes chat_id and message text', () => {
    const result = sendToTelegramReview({ id: '1', text: 'orig', user: { screen_name: 'u' } }, 'draft', 'mychat');
    assert.equal(result.chat_id, 'mychat');
    assert.ok(typeof result.text === 'string');
    assert.ok(result.text.indexOf('draft') !== -1);
  });
});
