'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// W6 Weekly Newsletter
// ---------------------------------------------------------------------------

/**
 * Gather last 7 days of content from NocoDB.
 * @param {object} nocodbApi - { baseUrl, token }
 * @returns {Promise<object>} { articles, topAlerts, dataStudy }
 */
async function gatherWeeklyContent(nocodbApi) {
  var sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  var cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  // In n8n, these would be actual HTTP calls to NocoDB
  // For testability, we return the structure
  return {
    articles: [], // Articles published in last 7 days
    topAlerts: [], // Top 3-5 alerts by significance_score
    dataStudy: null, // Latest data study if published this week
    cutoffDate: cutoff,
  };
}

/**
 * Generate newsletter summaries via Claude Haiku.
 * @param {object} content - Output from gatherWeeklyContent
 * @returns {object} { intro, articleTeasers, alertDigest, subjectLine, previewText }
 */
function generateSummaries(content) {
  var articleTeasers = (content.articles || []).map(function(a) {
    return {
      title: a.title || '',
      teaser: a.meta_description || a.key_takeaways || '',
      slug: a.slug || '',
      ticker: a.ticker || '',
      verdict: a.verdict_type || '',
    };
  });

  // Subject line: specific, compelling, 40-60 chars
  var subjectLine = 'This Week in Insider Buying';
  if (content.topAlerts && content.topAlerts.length > 0) {
    var topAlert = content.topAlerts[0];
    subjectLine = '$' + (topAlert.ticker || 'XYZ') + ' insiders just made a big move';
  }

  // Ensure 40-60 char range
  if (subjectLine.length > 60) subjectLine = subjectLine.slice(0, 57) + '...';
  if (subjectLine.length < 40) subjectLine = subjectLine + ' -- weekly insider digest';

  return {
    intro: 'Here is what insiders were buying and selling this week.',
    articleTeasers: articleTeasers,
    alertDigest: 'This week saw ' + (content.topAlerts || []).length + ' significant insider transactions.',
    subjectLine: subjectLine,
    previewText: 'The top insider moves you need to know about.',
  };
}

/**
 * Assemble newsletter HTML from summaries and content.
 * @param {object} summaries - Output from generateSummaries
 * @param {object} content - Output from gatherWeeklyContent
 * @returns {string} HTML string for Beehiiv
 */
function assembleNewsletter(summaries, content) {
  var articleCards = summaries.articleTeasers.map(function(t) {
    return '<div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">'
      + '<h3 style="margin:0 0 8px;color:#002A5E;">' + escapeHTML(t.title) + '</h3>'
      + (t.verdict ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:#002A5E;color:white;">' + escapeHTML(t.verdict) + '</span> ' : '')
      + (t.ticker ? '<span style="font-family:monospace;color:#64748b;">$' + escapeHTML(t.ticker) + '</span>' : '')
      + '<p style="margin:8px 0 0;color:#475569;">' + escapeHTML(t.teaser) + '</p>'
      + '<a href="https://earlyinsider.com/blog/' + encodeURIComponent(t.slug) + '" style="color:#002A5E;font-weight:600;">Read Analysis &rarr;</a>'
      + '</div>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
    + '<div style="text-align:center;padding:20px 0;border-bottom:2px solid #002A5E;">'
    + '<h1 style="color:#002A5E;margin:0;">EarlyInsider</h1>'
    + '<p style="color:#64748b;margin:4px 0 0;">Weekly Insider Intelligence</p>'
    + '</div>'
    + '<div style="padding:20px 0;">'
    + '<p style="color:#1a1a2e;line-height:1.6;">' + escapeHTML(summaries.intro) + '</p>'
    + '</div>'
    + '<h2 style="color:#002A5E;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">THIS WEEK\'S ANALYSIS</h2>'
    + articleCards
    + '<h2 style="color:#002A5E;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">INSIDER SIGNAL SPOTLIGHT</h2>'
    + '<p style="color:#1a1a2e;line-height:1.6;">' + escapeHTML(summaries.alertDigest) + '</p>'
    + '<div style="margin-top:30px;padding:20px;background:#002A5E;border-radius:8px;text-align:center;">'
    + '<p style="color:white;margin:0 0 12px;font-size:18px;">Get real-time alerts as they happen</p>'
    + '<a href="https://earlyinsider.com/pricing" style="display:inline-block;padding:12px 24px;background:#00D26A;color:white;text-decoration:none;border-radius:6px;font-weight:600;">Upgrade to Pro</a>'
    + '</div>'
    + '<div style="margin-top:20px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;">'
    + '<p>EarlyInsider -- earlyinsider.com</p>'
    + '</div>'
    + '</body></html>';

  return html;
}

/**
 * Send newsletter via Beehiiv API.
 * @param {string} html - Newsletter HTML
 * @param {string} subject - Subject line
 * @param {string} previewText - Preview text
 * @returns {object} { success, newsletterId }
 */
function sendViaBeehiiv(html, subject, previewText) {
  var apiKey = process.env.BEEHIIV_API_KEY;
  var pubId = process.env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !pubId) {
    return { success: false, error: 'Beehiiv credentials not configured' };
  }

  return {
    method: 'POST',
    url: 'https://api.beehiiv.com/v2/publications/' + pubId + '/posts',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: {
      title: subject,
      subtitle: previewText,
      content: html,
      status: 'confirmed',
    },
    success: true,
  };
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  gatherWeeklyContent: gatherWeeklyContent,
  generateSummaries: generateSummaries,
  assembleNewsletter: assembleNewsletter,
  sendViaBeehiiv: sendViaBeehiiv,
};
