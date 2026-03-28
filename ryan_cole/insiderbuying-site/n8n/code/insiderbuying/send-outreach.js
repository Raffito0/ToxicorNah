// W11 Outreach Email Sender -- personalized outreach via Claude Haiku
// n8n Code Node (CommonJS)

var BANNED_PHRASES = [
  'I hope this finds you',
  'hope this finds you well',
  'just wanted to reach out',
  'reaching out',
  'just checking in',
  'touching base',
  'circle back',
  'per my last email',
  'as per our conversation',
  'I wanted to follow up',
  'quick question for you',
  'hope you are doing well',
  'I came across your',
  'I stumbled upon',
  'I am a huge fan',
  'big fan of your work',
];

/**
 * Select top N prospects by priority, filtered to status='found' with email.
 * @param {object[]} prospects
 * @param {number} [limit=10]
 * @returns {object[]}
 */
function selectProspects(prospects, limit) {
  var n = limit || 10;

  var eligible = (prospects || []).filter(function (p) {
    return p.status === 'found' && p.contact_email && p.contact_email.length > 0;
  });

  eligible.sort(function (a, b) {
    return (b.priority || 0) - (a.priority || 0);
  });

  return eligible.slice(0, n);
}

/**
 * Build Claude Haiku prompt for a personalized outreach email.
 * @param {object} prospect - { site_name, domain, contact_name, notes }
 * @param {object} ourArticle - { title, url, summary }
 * @returns {{ prompt: string, maxTokens: number }}
 */
function buildEmailPrompt(prospect, ourArticle) {
  var prompt =
    'Write a cold outreach email to ' +
    (prospect.contact_name || 'the editor') +
    ' at ' +
    (prospect.site_name || prospect.domain) +
    '.\n\n' +
    'Context about their site: ' +
    (prospect.notes || 'Finance/investing blog') +
    '\n\n' +
    'We published: "' +
    ourArticle.title +
    '" (' +
    ourArticle.url +
    ')\n' +
    'Summary: ' +
    ourArticle.summary +
    '\n\n' +
    'Rules:\n' +
    '- MAX 150 words total\n' +
    '- Zero template language (no "I hope this finds you", "reaching out", etc.)\n' +
    '- Include exactly 1 specific data point from our article\n' +
    '- One clear CTA (guest post, link swap, or quote request)\n' +
    '- Tone: direct, knowledgeable, peer-to-peer\n' +
    '- Subject line on first line prefixed with "Subject: "\n' +
    '- Do NOT use any of these phrases: ' +
    BANNED_PHRASES.join(', ') +
    '\n\n' +
    'Output the email only. No explanations.';

  return { prompt: prompt, maxTokens: 300 };
}

/**
 * Validate an outreach email draft.
 * @param {string} text
 * @returns {{ valid: boolean, wordCount: number, issues: string[] }}
 */
function validateEmail(text) {
  var issues = [];
  var words = (text || '').trim().split(/\s+/).filter(function (w) {
    return w.length > 0;
  });
  var wordCount = words.length;

  if (wordCount > 150) {
    issues.push('Over 150 word limit (' + wordCount + ' words)');
  }

  var lowerText = (text || '').toLowerCase();
  BANNED_PHRASES.forEach(function (phrase) {
    if (lowerText.indexOf(phrase.toLowerCase()) !== -1) {
      issues.push('Contains banned phrase: "' + phrase + '"');
    }
  });

  // Check for one clear ask (question mark or imperative)
  var hasQuestion = (text || '').indexOf('?') !== -1;
  var hasImperative =
    lowerText.indexOf('let me know') !== -1 ||
    lowerText.indexOf('would you') !== -1 ||
    lowerText.indexOf('can we') !== -1 ||
    lowerText.indexOf('interested in') !== -1 ||
    lowerText.indexOf('check it out') !== -1 ||
    lowerText.indexOf('take a look') !== -1;

  if (!hasQuestion && !hasImperative) {
    issues.push('No clear CTA or ask detected');
  }

  return {
    valid: issues.length === 0,
    wordCount: wordCount,
    issues: issues,
  };
}

/**
 * Build SMTP-compatible email payload.
 * @param {string} to
 * @param {string} subject
 * @param {string} body
 * @param {string} fromEmail
 * @returns {{ from: string, to: string, subject: string, html: string, text: string }}
 */
function buildSendPayload(to, subject, body, fromEmail) {
  var htmlBody = (body || '')
    .split('\n')
    .map(function (line) {
      return '<p>' + line + '</p>';
    })
    .join('\n');

  return {
    from: fromEmail,
    to: to,
    subject: subject,
    html: htmlBody,
    text: body,
  };
}

/**
 * Build Claude prompt for a follow-up email.
 * @param {object} prospect
 * @param {string} originalSubject
 * @returns {{ prompt: string, maxTokens: number }}
 */
function buildFollowUpPrompt(prospect, originalSubject) {
  var prompt =
    'Write a follow-up email to ' +
    (prospect.contact_name || 'the editor') +
    ' at ' +
    (prospect.site_name || prospect.domain) +
    '.\n\n' +
    'Original subject line was: "' +
    originalSubject +
    '"\n\n' +
    'Rules:\n' +
    '- 2-3 sentences MAX\n' +
    '- NOT "just checking in" or "following up"\n' +
    '- Add one new piece of value (new data, new angle, or new reason)\n' +
    '- Keep the same subject line with "Re: " prefix\n' +
    '- Tone: casual, brief, zero desperation\n\n' +
    'Output the email body only. No subject line. No explanations.';

  return { prompt: prompt, maxTokens: 150 };
}

/**
 * Find prospects needing a follow-up email.
 * @param {object[]} logs - Outreach_Log entries
 * @param {number} [daysSince=5]
 * @returns {string[]} prospect IDs needing follow-up
 */
function checkForFollowUps(logs, daysSince) {
  var threshold = daysSince || 5;
  var now = Date.now();
  var msThreshold = threshold * 24 * 60 * 60 * 1000;

  // Build sets of who got initial vs follow-up
  var initialSent = {};
  var followUpSent = {};

  (logs || []).forEach(function (entry) {
    if (entry.email_type === 'initial' && entry.prospect_id) {
      initialSent[entry.prospect_id] = entry.sent_at || entry.created_at;
    }
    if (entry.email_type === 'followup' && entry.prospect_id) {
      followUpSent[entry.prospect_id] = true;
    }
  });

  var needsFollowUp = [];
  Object.keys(initialSent).forEach(function (pid) {
    if (followUpSent[pid]) return; // already followed up

    var sentTime = new Date(initialSent[pid]).getTime();
    if (now - sentTime >= msThreshold) {
      needsFollowUp.push(pid);
    }
  });

  return needsFollowUp;
}

/**
 * Build an Outreach_Log record.
 * @param {string} prospectId
 * @param {string} emailType - 'initial' or 'followup'
 * @returns {object} record ready for NocoDB insert
 */
function logEmail(prospectId, emailType) {
  return {
    prospect_id: prospectId,
    email_type: emailType || 'initial',
    sent_at: new Date().toISOString(),
    status: 'sent',
  };
}

module.exports = {
  selectProspects: selectProspects,
  buildEmailPrompt: buildEmailPrompt,
  validateEmail: validateEmail,
  buildSendPayload: buildSendPayload,
  buildFollowUpPrompt: buildFollowUpPrompt,
  checkForFollowUps: checkForFollowUps,
  logEmail: logEmail,
  BANNED_PHRASES: BANNED_PHRASES,
};
