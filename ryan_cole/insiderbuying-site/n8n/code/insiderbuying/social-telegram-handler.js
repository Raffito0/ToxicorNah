'use strict';

// ---------------------------------------------------------------------------
// Shared Telegram Review Flow for Social Channels (X, Reddit)
// ---------------------------------------------------------------------------

/**
 * Parse callback data from Telegram inline keyboard.
 * Format: 'platform:action:itemId'
 * @param {string} callbackData - e.g. 'x:approve:12345' or 'reddit:skip:abc'
 * @returns {object} { platform, action, itemId }
 */
function parseCallback(callbackData) {
  if (!callbackData || typeof callbackData !== 'string') {
    return { platform: '', action: '', itemId: '' };
  }

  var parts = callbackData.split(':');
  return {
    platform: parts[0] || '',
    action: parts[1] || '',
    itemId: parts.slice(2).join(':') || '', // rejoin in case itemId contains colons
  };
}

/**
 * Handle approve action.
 * @param {string} platform - 'x' or 'reddit'
 * @param {string} itemId - Tweet ID or Reddit post ID
 * @returns {object} { platform, itemId, action: 'post' }
 */
function handleApprove(platform, itemId) {
  return {
    platform: platform,
    itemId: itemId,
    action: 'post',
  };
}

/**
 * Handle skip action.
 * @param {string} platform - 'x' or 'reddit'
 * @param {string} itemId - Tweet ID or Reddit post ID
 * @returns {object} { platform, itemId, action: 'skip', status: 'skipped' }
 */
function handleSkip(platform, itemId) {
  return {
    platform: platform,
    itemId: itemId,
    action: 'skip',
    status: 'skipped',
  };
}

/**
 * Handle edit action -- request new text from user.
 * @param {string} platform - 'x' or 'reddit'
 * @param {string} itemId - Tweet ID or Reddit post ID
 * @param {string} chatId - Telegram chat ID to request edit from
 * @returns {object} { platform, itemId, action: 'edit', chatId }
 */
function handleEdit(platform, itemId, chatId) {
  return {
    platform: platform,
    itemId: itemId,
    action: 'edit',
    chatId: chatId,
  };
}

/**
 * Build Telegram inline keyboard markup with 3 buttons.
 * @param {string} platform - 'x' or 'reddit'
 * @param {string} itemId - Tweet ID or Reddit post ID
 * @returns {object} { inline_keyboard: [[{text, callback_data}]] }
 */
function buildInlineKeyboard(platform, itemId) {
  var prefix = platform + ':';
  var suffix = ':' + itemId;

  return {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: prefix + 'approve' + suffix },
        { text: 'Edit', callback_data: prefix + 'edit' + suffix },
        { text: 'Skip', callback_data: prefix + 'skip' + suffix },
      ],
    ],
  };
}

module.exports = {
  parseCallback: parseCallback,
  handleApprove: handleApprove,
  handleSkip: handleSkip,
  handleEdit: handleEdit,
  buildInlineKeyboard: buildInlineKeyboard,
};
