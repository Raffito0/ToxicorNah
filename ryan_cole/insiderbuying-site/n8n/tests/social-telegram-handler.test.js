const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCallback,
  handleApprove,
  handleSkip,
  handleEdit,
  buildInlineKeyboard,
} = require('../code/insiderbuying/social-telegram-handler.js');

// ---------------------------------------------------------------------------
// parseCallback
// ---------------------------------------------------------------------------
describe('parseCallback', () => {
  it('extracts platform, action, itemId', () => {
    const result = parseCallback('x:approve:12345');
    assert.equal(result.platform, 'x');
    assert.equal(result.action, 'approve');
    assert.equal(result.itemId, '12345');
  });

  it('handles reddit callbacks', () => {
    const result = parseCallback('reddit:skip:post_abc');
    assert.equal(result.platform, 'reddit');
    assert.equal(result.action, 'skip');
    assert.equal(result.itemId, 'post_abc');
  });

  it('handles itemId with colons', () => {
    const result = parseCallback('x:edit:item:with:colons');
    assert.equal(result.platform, 'x');
    assert.equal(result.action, 'edit');
    assert.equal(result.itemId, 'item:with:colons');
  });

  it('handles null/empty input', () => {
    const result = parseCallback(null);
    assert.equal(result.platform, '');
    assert.equal(result.action, '');
    assert.equal(result.itemId, '');
  });
});

// ---------------------------------------------------------------------------
// handleApprove
// ---------------------------------------------------------------------------
describe('handleApprove', () => {
  it('returns action=post', () => {
    const result = handleApprove('x', 'tweet123');
    assert.equal(result.action, 'post');
    assert.equal(result.platform, 'x');
    assert.equal(result.itemId, 'tweet123');
  });
});

// ---------------------------------------------------------------------------
// handleSkip
// ---------------------------------------------------------------------------
describe('handleSkip', () => {
  it('returns status=skipped', () => {
    const result = handleSkip('reddit', 'post456');
    assert.equal(result.status, 'skipped');
    assert.equal(result.action, 'skip');
    assert.equal(result.platform, 'reddit');
    assert.equal(result.itemId, 'post456');
  });
});

// ---------------------------------------------------------------------------
// buildInlineKeyboard
// ---------------------------------------------------------------------------
describe('buildInlineKeyboard', () => {
  it('returns 3 buttons: Approve, Edit, Skip', () => {
    const result = buildInlineKeyboard('x', 'tw789');
    assert.ok(result.inline_keyboard);
    const buttons = result.inline_keyboard[0];
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].text, 'Approve');
    assert.equal(buttons[1].text, 'Edit');
    assert.equal(buttons[2].text, 'Skip');
  });

  it('callback_data includes platform and itemId', () => {
    const result = buildInlineKeyboard('reddit', 'post999');
    const buttons = result.inline_keyboard[0];
    assert.ok(buttons[0].callback_data.indexOf('reddit') !== -1);
    assert.ok(buttons[0].callback_data.indexOf('post999') !== -1);
    assert.ok(buttons[0].callback_data.indexOf('approve') !== -1);
    assert.ok(buttons[2].callback_data.indexOf('skip') !== -1);
  });
});
