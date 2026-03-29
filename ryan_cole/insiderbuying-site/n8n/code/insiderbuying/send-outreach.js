// W11 Outreach Email Sender -- personalized outreach via DeepSeek
// n8n Code Node (CommonJS)

var cheerio = require('cheerio');
var urlMod = require('url');

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  'synergy',
];

var FROM_NAME = '"Ryan from EarlyInsider" <ryan@earlyinsider.com>';

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
 * Build DeepSeek prompt for a personalized outreach email.
 * @param {object} prospect - { site_name, domain, contact_name, notes, last_article_title }
 * @param {object} ourArticle - { title, summary } (url is intentionally excluded — GAP 12.14)
 * @returns {{ prompt: string, maxTokens: number }}
 */
function buildEmailPrompt(prospect, ourArticle) {
  // GAP 12.14: only extract title and summary — never forward url to the LLM
  var articleTitle = ourArticle ? ourArticle.title : '';
  var articleSummary = ourArticle ? ourArticle.summary : '';

  var personalisation = '';
  if (prospect.last_article_title) {
    // Sanitize: strip newlines and cap at 120 chars to prevent prompt injection
    var safeTitle = (prospect.last_article_title || '')
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 120);
    personalisation =
      "I just read your piece: '" +
      safeTitle +
      "'. That's exactly the kind of audience we want to reach.\n\n";
  }

  var prompt =
    'Write a cold outreach email to ' +
    (prospect.contact_name || 'the editor') +
    ' at ' +
    (prospect.site_name || prospect.domain) +
    '.\n\n' +
    'Context about their site: ' +
    (prospect.notes || 'Finance/investing blog') +
    '\n\n' +
    personalisation +
    (articleTitle ? 'We published: "' + articleTitle + '"\n' : '') +
    (articleSummary ? 'Summary: ' + articleSummary + '\n\n' : '') +
    'Rules:\n' +
    '- EXACTLY 100-125 words total in the email body\n' +
    '- Do not include any URLs or links in this email\n' +
    '- Zero template language (no "I hope this finds you", "reaching out", etc.)\n' +
    '- Include exactly 1 specific data point from our article\n' +
    '- One clear CTA (guest post, link swap, or quote request)\n' +
    '- Tone: direct, knowledgeable, peer-to-peer\n' +
    '- Subject line on first line prefixed with "Subject: " (must end with or contain "?")\n' +
    '- Include verbatim in the body: "We track 1,500+ SEC insider filings per month."\n' +
    "- Last line of body must be exactly: Reply 'stop' to never hear from me again.\n" +
    '- Do NOT use any of these phrases: ' +
    BANNED_PHRASES.join(', ') +
    '\n\n' +
    'Output the email only. No explanations.';

  return { prompt: prompt, maxTokens: 350 };
}

/**
 * Validate that an email subject contains a question mark.
 * @param {string} subject
 * @throws {Error} if subject has no "?"
 */
function validateSubject(subject) {
  if (!((subject || '').trim().match(/\?/))) {
    throw new Error('Subject must be a question: "' + (subject || '') + '"');
  }
}

/**
 * Validate an outreach email body draft.
 * @param {string} text
 * @returns {{ valid: boolean, wordCount: number, issues: string[] }}
 */
function validateEmail(text) {
  var issues = [];
  var words = (text || '').trim().split(/\s+/).filter(function (w) {
    return w.length > 0;
  });
  var wordCount = words.length;

  if (wordCount === 0) {
    issues.push('Email body is empty');
    return { valid: false, wordCount: 0, issues: issues };
  }

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
      return '<p>' + escapeHtml(line) + '</p>';
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
 * Build DeepSeek prompt for a follow-up email.
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

/**
 * Scrape the most recent article from a site's /blog page.
 * Supports HTML (CSS selectors) and XML/RSS (Cheerio xmlMode).
 * Caches result in prospect.last_article_title via NocoDB PATCH (best-effort).
 * @param {string} siteUrl - base URL, e.g. "https://example.com"
 * @param {object} [_opts] - { _fetchFn } for testing
 * @returns {Promise<{title: string, url: string}|null>}
 */
async function scrapeRecentArticle(siteUrl, _opts) {
  var fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _defaultFetch;

  try {
    var result = await fetchFn(siteUrl + '/blog', 5000);
    if (!result || result.statusCode < 200 || result.statusCode >= 300) {
      return null;
    }

    var contentType = ((result.headers && result.headers['content-type']) || '').toLowerCase();
    var isXml =
      contentType.indexOf('application/xml') !== -1 ||
      contentType.indexOf('text/xml') !== -1;

    var $ = cheerio.load(result.body, { xmlMode: isXml });

    if (isXml) {
      var titleEl = $('item > title').first();
      var linkEl = $('item > link').first();
      if (!titleEl.length) return null;
      return { title: titleEl.text().trim(), url: linkEl.text().trim() };
    }

    // HTML: try selectors in priority order
    var selectors = ['article:first-of-type a', '.post:first-of-type a', 'h2 a:first-of-type'];
    for (var i = 0; i < selectors.length; i++) {
      var el = $(selectors[i]).first();
      if (el.length && el.text().trim()) {
        var href = el.attr('href') || '';
        if (href) {
          // Use WHATWG URL resolution to handle relative, protocol-relative, and absolute hrefs
          href = urlMod.resolve(siteUrl + '/blog', href);
        }
        return { title: el.text().trim(), url: href };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

function _defaultFetch(url, timeout) {
  return new Promise(function (resolve, reject) {
    var _https = require('https');
    var _http = require('http');
    var urlMod = require('url');
    var parsed = urlMod.parse(url);
    var transport = parsed.protocol === 'https:' ? _https : _http;
    var timer = setTimeout(function () {
      reject(new Error('Timeout fetching ' + url));
    }, timeout);

    transport
      .get(url, function (res) {
        clearTimeout(timer);
        var chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
        res.on('error', function (e) {
          reject(e);
        });
      })
      .on('error', function (e) {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * Generate an outreach email with AI, with up to 3 retries on validation failure.
 * @param {object} prospect
 * @param {object|null} ourArticle
 * @param {object} [_opts] - { _aiClient: { call(messages): Promise<string> } }
 * @returns {Promise<{subject: string, body: string, from: string}>}
 */
async function generateEmail(prospect, ourArticle, _opts) {
  var aiCall =
    _opts && _opts._aiClient && typeof _opts._aiClient.call === 'function'
      ? function (msgs) {
          return _opts._aiClient.call(msgs);
        }
      : function () {
          throw new Error('AI client not provided — wire _opts._aiClient in production');
        };

  var promptResult = buildEmailPrompt(prospect, ourArticle);
  var messages = [{ role: 'user', content: promptResult.prompt }];
  var maxAttempts = 3;
  var lastError = null;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var raw = await aiCall(messages);

    try {
      var lines = (raw || '').trim().split('\n');
      var subject = '';
      var bodyLines = [];

      for (var j = 0; j < lines.length; j++) {
        if (!subject && lines[j].startsWith('Subject: ')) {
          subject = lines[j].replace('Subject: ', '').trim();
        } else {
          bodyLines.push(lines[j]);
        }
      }

      var body = bodyLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');

      validateSubject(subject);

      var words = body.trim().split(/\s+/).filter(function (w) {
        return w.length > 0;
      });
      if (words.length < 100 || words.length > 125) {
        throw new Error(
          'Body word count out of range: ' + words.length + ' (expected 100-125)'
        );
      }

      // Hard checks (prompt construction guarantees — throw immediately, no retry)
      if (body.indexOf('1,500+') === -1) {
        throw new Error('Missing required social proof "1,500+"');
      }
      if (body.toLowerCase().indexOf("reply 'stop'") === -1) {
        throw new Error("Missing required CAN-SPAM opt-out \"Reply 'stop'\"");
      }

      var lowerBody = body.toLowerCase();
      for (var k = 0; k < BANNED_PHRASES.length; k++) {
        if (lowerBody.indexOf(BANNED_PHRASES[k].toLowerCase()) !== -1) {
          throw new Error('Contains banned phrase: "' + BANNED_PHRASES[k] + '"');
        }
      }

      return { subject: subject, body: body, from: FROM_NAME };
    } catch (err) {
      lastError = err;
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content:
          'That email failed validation: ' + err.message + '. Fix it and try again.',
      });
    }
  }

  throw new Error(
    'generateEmail failed after ' + maxAttempts + ' attempts. Last: ' + lastError.message
  );
}

// ─── Section 05: Follow-Up Sequence ──────────────────────────────────────────

/**
 * Determine which follow-up stage is due given elapsed days and current count.
 * Threshold logic handles missed cron runs gracefully.
 * @param {number} days - days since initial send
 * @param {number} followupCount - current followup_count (0=none sent, 99=cancelled)
 * @returns {1|2|3|null}
 */
function getFollowUpStage(days, followupCount) {
  // Explicit guard: cancelled (99) or completed (>=3) prospects never re-enter the sequence
  if (followupCount >= 3) return null;
  if (days >= 16 && followupCount === 2) return 3;
  if (days >= 10 && followupCount === 1) return 2;
  if (days >= 5  && followupCount === 0) return 1;
  return null;
}

/**
 * Query NocoDB for prospects that are due for a follow-up.
 * Returns array of { prospect, stage } objects.
 * @param {{ queryRecords: Function }} nocodbApi
 * @returns {Promise<Array<{prospect: object, stage: number}>>}
 */
async function checkFollowUpsDue(nocodbApi) {
  var records = await nocodbApi.queryRecords('Outreach_Prospects', {
    where: '(followup_count,lt,3)~and(replied,eq,false)~and(sent_at,isnot,)',
  });

  var now = Date.now();
  var results = [];
  (records || []).forEach(function (p) {
    // Safety guards (NocoDB filter handles these in production; guards here for correctness)
    if (!p.sent_at) return;
    if (p.replied) return;
    if ((p.followup_count || 0) >= 3) return;

    var days = Math.floor((now - new Date(p.sent_at).getTime()) / 86400000);
    var stage = getFollowUpStage(days, p.followup_count || 0);
    if (stage !== null) {
      results.push({ prospect: p, stage: stage });
    }
  });
  return results;
}

/**
 * Build DeepSeek prompt for FU1 (50-75 words, same thread, soft check-in).
 * @param {object} prospect
 * @returns {{ prompt: string, maxTokens: number }}
 */
function buildFu1Prompt(prospect) {
  // M-1: sanitize NocoDB values before interpolating into AI prompt (prevent prompt injection)
  var safeName = ((prospect.contact_name || 'the editor')).replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  var safeSite = ((prospect.site_name || prospect.domain || '')).replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  var prompt =
    'Write a 50-75 word follow-up email body to ' +
    safeName +
    ' at ' +
    safeSite +
    '.\n\n' +
    'Context: They did not reply to a cold email about EarlyInsider — we track 1,500+ SEC insider filings/month.\n\n' +
    'Rules:\n' +
    '- EXACTLY 50-75 words\n' +
    '- Do NOT use any of these phrases: ' + BANNED_PHRASES.join(', ') + '\n' +
    '- Mention one new specific insider-buying data point\n' +
    '- End with a soft, low-pressure question\n' +
    '- No URLs\n\n' +
    'Output the email body only. No subject line.';
  return { prompt: prompt, maxTokens: 200 };
}

/**
 * Build DeepSeek prompt for FU2 (30-50 words, new thread, different angle).
 * @param {object} prospect
 * @returns {{ prompt: string, maxTokens: number }}
 */
function buildFu2Prompt(prospect) {
  // M-1: sanitize NocoDB values before interpolating into AI prompt (prevent prompt injection)
  var safeName = ((prospect.contact_name || 'the editor')).replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  var safeSite = ((prospect.site_name || prospect.domain || '')).replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  var prompt =
    'Write a 30-50 word cold outreach email to ' +
    safeName +
    ' at ' +
    safeSite +
    '.\n\n' +
    'Context: Finance/investing blog. Approach from a completely different angle — do NOT reference any prior emails.\n\n' +
    'Rules:\n' +
    '- EXACTLY 30-50 words in the email body\n' +
    '- Different angle: pitch data depth (we score 1,500+ filings/month for conviction signals)\n' +
    '- One clear question at the end\n' +
    '- No URLs\n' +
    '- Subject line on first line prefixed "Subject: " (must contain "?")\n' +
    '- Do NOT use any of these phrases: ' + BANNED_PHRASES.join(', ') + '\n\n' +
    'Output the email only.';
  return { prompt: prompt, maxTokens: 150 };
}

/**
 * Build fixed-copy FU3 body (~25 words, no AI needed).
 * @param {object} prospect - { contact_name }
 * @returns {string}
 */
function buildFu3Body(prospect) {
  var firstName = ((prospect.contact_name || '').split(' ')[0]) || 'there';
  return (
    'Hi ' + firstName + ', last note from me on this — ' +
    'the data offer stands whenever insider trading coverage is relevant for your readers.'
  );
}

/**
 * Build SMTP payload for FU1 or FU3 (same-thread follow-ups).
 * Includes In-Reply-To and References headers when resendId is present.
 * @param {string} to
 * @param {string} subject
 * @param {string} body
 * @param {string} fromEmail
 * @param {string|null} resendId
 * @returns {object}
 */
function buildFuThreadedPayload(to, subject, body, fromEmail, resendId) {
  var htmlBody = (body || '')
    .split('\n')
    .map(function (line) {
      return '<p>' + escapeHtml(line) + '</p>';
    })
    .join('\n');

  var payload = {
    from: fromEmail,
    to: to,
    subject: subject,
    html: htmlBody,
    text: body,
    headers: {},
  };

  if (resendId) {
    payload.headers['In-Reply-To'] = '<' + resendId + '>';
    payload.headers['References'] = '<' + resendId + '>';
  }

  return payload;
}

/**
 * Build SMTP payload for FU2 (new thread — no In-Reply-To / References).
 * @param {string} to
 * @param {string} subject
 * @param {string} body
 * @param {string} fromEmail
 * @returns {object}
 */
function buildFu2Payload(to, subject, body, fromEmail) {
  var htmlBody = (body || '')
    .split('\n')
    .map(function (line) {
      return '<p>' + escapeHtml(line) + '</p>';
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
 * Low-level HTTPS POST to Resend API.
 * @param {object} payload - email payload object
 * @param {Function} postFn - fetch-like function (url, opts) => { status, json(), text() }
 * @returns {Promise<object>} Resend response JSON
 */
async function _resendEmailPost(payload, postFn) {
  var RESEND_API_KEY = process.env.RESEND_API_KEY || '';
  // NOTE (L-1): RESEND_API_KEY check lives here only for header construction.
  // A missing key results in a Resend 401. Callers should validate env vars at startup.
  var resp = await postFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (resp.status < 200 || resp.status >= 300) {
    var errBody = '';
    try { errBody = await resp.text(); } catch (_e) {}
    throw new Error('Resend send failed with HTTP ' + resp.status + ': ' + errBody);
  }

  var data;
  try {
    data = await resp.json();
  } catch (_e) {
    // M-3: non-JSON body (e.g. HTML error page) — surface a warning so failures are diagnosable
    console.warn('[_resendEmailPost] response body was not JSON; threading headers for follow-ups may be unavailable');
    return {};
  }
  if (data && !data.id) {
    console.warn('[_resendEmailPost] Resend response has no id field:', JSON.stringify(data));
  }
  return data;
}

/**
 * Send initial outreach email and store Resend ID + sent_at + followup_count=0 in NocoDB.
 * @param {object} prospect - { id }
 * @param {object} emailPayload - SMTP payload from buildSendPayload
 * @param {{ updateRecord: Function }} nocodbApi
 * @param {{ _postFn?: Function }} [_opts]
 * @returns {Promise<object>} Resend response
 */
async function sendInitialOutreach(prospect, emailPayload, nocodbApi, _opts) {
  var postFn =
    _opts && _opts._postFn
      ? _opts._postFn
      : function () {
          throw new Error('_postFn not provided — wire _opts._postFn in production');
        };

  var resendResp = await _resendEmailPost(emailPayload, postFn);
  var resendId = (resendResp && resendResp.id) || null;

  await nocodbApi.updateRecord('Outreach_Prospects', prospect.id, {
    last_resend_id: resendId,
    sent_at: new Date().toISOString(),
    followup_count: 0,
  });

  return resendResp;
}

/**
 * Generate a follow-up body with AI, retrying up to 3 times on validation failure.
 * @param {Function} aiCall
 * @param {{ prompt: string }} promptResult
 * @param {number} minWords
 * @param {number} maxWords
 * @returns {Promise<string>}
 */
async function _generateFollowUpBody(aiCall, promptResult, minWords, maxWords) {
  var messages = [{ role: 'user', content: promptResult.prompt }];
  var maxAttempts = 3;
  var lastError = null;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var raw = await aiCall(messages);
    var body = (raw || '').trim();

    try {
      var words = body.split(/\s+/).filter(function (w) { return w.length > 0; });
      if (words.length < minWords || words.length > maxWords) {
        throw new Error(
          'Word count ' + words.length + ' out of range [' + minWords + ',' + maxWords + ']'
        );
      }
      var lowerBody = body.toLowerCase();
      for (var k = 0; k < BANNED_PHRASES.length; k++) {
        if (lowerBody.indexOf(BANNED_PHRASES[k].toLowerCase()) !== -1) {
          throw new Error('Contains banned phrase: "' + BANNED_PHRASES[k] + '"');
        }
      }
      return body;
    } catch (err) {
      lastError = err;
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: 'That follow-up failed validation: ' + err.message + '. Fix it and try again.',
      });
    }
  }

  throw new Error(
    'Follow-up generation failed after ' + maxAttempts + ' attempts. Last: ' +
    ((lastError && lastError.message) || 'unknown')
  );
}

/**
 * Send a follow-up email (FU1, FU2, or FU3) and increment followup_count in NocoDB.
 * @param {object} prospect - { id, contact_email, original_subject, last_resend_id, ... }
 * @param {1|2|3} stage
 * @param {{ updateRecord: Function }} nocodbApi
 * @param {{ _aiClient?: object, _postFn?: Function }} [_opts]
 * @returns {Promise<object>} Resend response
 */
async function sendFollowUp(prospect, stage, nocodbApi, _opts) {
  // M-6: guard against missing contact_email
  if (!prospect.contact_email) {
    throw new Error('[sendFollowUp] prospect.contact_email is missing — cannot send');
  }

  var aiCall =
    _opts && _opts._aiClient && typeof _opts._aiClient.call === 'function'
      ? function (msgs) { return _opts._aiClient.call(msgs); }
      : function () { throw new Error('AI client not provided — wire _opts._aiClient in production'); };

  var postFn =
    _opts && _opts._postFn
      ? _opts._postFn
      : function () { throw new Error('_postFn not provided'); };

  var to = prospect.contact_email;
  var resendId = prospect.last_resend_id || null;
  var originalSubject = prospect.original_subject || '';

  if (stage === 1) {
    var body1 = await _generateFollowUpBody(aiCall, buildFu1Prompt(prospect), 50, 75);
    var payload1 = buildFuThreadedPayload(to, 'Re: ' + originalSubject, body1, FROM_NAME, resendId);
    var resp1 = await _resendEmailPost(payload1, postFn);
    await nocodbApi.updateRecord('Outreach_Prospects', prospect.id, { followup_count: 1 });
    return resp1;
  }

  if (stage === 2) {
    var promptResult2 = buildFu2Prompt(prospect);
    var messages2 = [{ role: 'user', content: promptResult2.prompt }];
    var maxAttempts2 = 3;
    var lastError2 = null;
    var subject2 = '';
    var body2 = '';

    for (var a = 0; a < maxAttempts2; a++) {
      var raw2 = await aiCall(messages2);
      try {
        var lines2 = (raw2 || '').trim().split('\n');
        var parsedSubject = '';
        var bodyLines = [];
        for (var j = 0; j < lines2.length; j++) {
          // M-4: case-insensitive subject line detection
          if (!parsedSubject && lines2[j].toLowerCase().startsWith('subject: ')) {
            parsedSubject = lines2[j].slice(lines2[j].toLowerCase().indexOf('subject: ') + 9).trim();
          } else {
            bodyLines.push(lines2[j]);
          }
        }
        var parsedBody = bodyLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
        validateSubject(parsedSubject);
        var words2 = parsedBody.trim().split(/\s+/).filter(function (w) { return w.length > 0; });
        if (words2.length < 30 || words2.length > 50) {
          throw new Error('FU2 word count ' + words2.length + ' out of range [30,50]');
        }
        // H-1: check banned phrases in FU2 body (same as initial email and FU1)
        var lowerBody2 = parsedBody.toLowerCase();
        for (var bk = 0; bk < BANNED_PHRASES.length; bk++) {
          if (lowerBody2.indexOf(BANNED_PHRASES[bk].toLowerCase()) !== -1) {
            throw new Error('Contains banned phrase: "' + BANNED_PHRASES[bk] + '"');
          }
        }
        subject2 = parsedSubject;
        body2 = parsedBody;
        break;
      } catch (err2) {
        lastError2 = err2;
        messages2.push({ role: 'assistant', content: raw2 });
        messages2.push({
          role: 'user',
          content: 'That FU2 failed validation: ' + err2.message + '. Fix it and try again.',
        });
        if (a === maxAttempts2 - 1) {
          throw new Error('FU2 generation failed after ' + maxAttempts2 + ' attempts. Last: ' + lastError2.message);
        }
      }
    }

    var payload2 = buildFu2Payload(to, subject2, body2, FROM_NAME);
    var resp2 = await _resendEmailPost(payload2, postFn);
    await nocodbApi.updateRecord('Outreach_Prospects', prospect.id, { followup_count: 2 });
    return resp2;
  }

  if (stage === 3) {
    var body3 = buildFu3Body(prospect);
    var payload3 = buildFuThreadedPayload(to, 'Re: ' + originalSubject, body3, FROM_NAME, resendId);
    var resp3 = await _resendEmailPost(payload3, postFn);
    await nocodbApi.updateRecord('Outreach_Prospects', prospect.id, { followup_count: 3 });
    return resp3;
  }

  throw new Error('Invalid follow-up stage: ' + stage);
}

/**
 * Cancel follow-ups for a prospect permanently (e.g. after they reply).
 * Sets followup_count=99 so checkFollowUpsDue never selects them again.
 * @param {string} prospectId
 * @param {{ updateRecord: Function }} nocodbApi
 */
async function cancelFollowUps(prospectId, nocodbApi) {
  await nocodbApi.updateRecord('Outreach_Prospects', prospectId, { followup_count: 99 });
}

// ─── Section 06: Warm-Up, Email Verification, Bounce Monitoring ──────────────

/**
 * Return the maximum emails allowed per day based on domain age.
 * Tiers: days 0-13 -> 5, 14-27 -> 20, 28+ -> 50.
 * Reads DOMAIN_SETUP_DATE from process.env; throws if missing.
 * @returns {5|20|50}
 */
function getWarmupLimit() {
  var setupDate = process.env.DOMAIN_SETUP_DATE;
  if (!setupDate) {
    throw new Error('[getWarmupLimit] DOMAIN_SETUP_DATE env var is required but not set');
  }
  var today = new Date().toISOString().slice(0, 10);
  var days = Math.floor(
    (new Date(today).getTime() - new Date(setupDate).getTime()) / 86400000
  );
  if (days >= 28) return 50;
  if (days >= 14) return 20;
  return 5;
}

/**
 * Return true if current Eastern Time is within the valid send window:
 * Tuesday, Wednesday, or Thursday, hours 9-11 AM (DST-correct via Intl).
 * @param {{ _nowFn?: Function }} [_opts]
 * @returns {boolean}
 */
function isValidSendTime(_opts) {
  var nowFn = (_opts && _opts._nowFn) ? _opts._nowFn : function () { return new Date(); };
  var now = nowFn();
  // weekday:'short' avoids the Tue/Thu collision that weekday:'narrow' causes in en-US
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  var weekday = '';
  var hour = -1;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === 'weekday') weekday = parts[i].value;
    if (parts[i].type === 'hour') hour = parseInt(parts[i].value, 10);
  }
  return (
    ['Tue', 'Wed', 'Thu'].indexOf(weekday) !== -1 &&
    [9, 10, 11].indexOf(hour) !== -1
  );
}

/**
 * Query today's sent count from Outreach_Daily_Stats (UTC date).
 * Returns 0 if no record exists yet.
 * @param {{ queryRecords: Function }} nocodbApi
 * @returns {Promise<number>}
 */
async function getDailySentCount(nocodbApi) {
  var today = new Date().toISOString().slice(0, 10);
  var records = await nocodbApi.queryRecords('Outreach_Daily_Stats', {
    where: '(date,eq,' + today + ')',
    limit: 1,
  });
  if (!records || records.length === 0) return 0;
  return records[0].sent_count || 0;
}

/**
 * Upsert today's Outreach_Daily_Stats record, incrementing sent_count by n.
 * @param {{ queryRecords: Function, updateRecord: Function, createRecord: Function }} nocodbApi
 * @param {number} n
 */
async function incrementDailySentCount(nocodbApi, n) {
  var today = new Date().toISOString().slice(0, 10);
  var records = await nocodbApi.queryRecords('Outreach_Daily_Stats', {
    where: '(date,eq,' + today + ')',
    limit: 1,
  });
  var updatedAt = new Date().toISOString();
  if (records && records.length > 0) {
    var rec = records[0];
    await nocodbApi.updateRecord('Outreach_Daily_Stats', rec.id, {
      sent_count: (rec.sent_count || 0) + n,
      updated_at: updatedAt,
    });
  } else {
    await nocodbApi.createRecord('Outreach_Daily_Stats', {
      date: today,
      sent_count: n,
      bounced_count: 0,
      updated_at: updatedAt,
    });
  }
}

/**
 * Low-level HTTP fetch returning parsed JSON. Supports GET and POST.
 * Used as the default implementation for _fetchFn injection points.
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string }} [options]
 * @returns {Promise<object>}
 */
function _httpFetchJson(url, options) {
  return new Promise(function (resolve, reject) {
    var _https = require('https');
    var _http = require('http');
    var URLC = require('url').URL;
    var parsed = new URLC(url);
    var isHttps = parsed.protocol === 'https:';
    var transport = isHttps ? _https : _http;
    var method = (options && options.method) || 'GET';
    var headers = Object.assign({}, (options && options.headers) || {});
    var bodyStr = (options && options.body) || null;
    if (bodyStr) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: method,
      headers: headers,
    };
    var req = transport.request(reqOpts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString();
        // H-2: surface HTTP error status so callers get a meaningful rejection
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Verify an email address using QuickEmailVerification free-tier API.
 * Returns false (and patches status='invalid') only on definitive "invalid" result.
 * Returns true on "valid", "unknown", or any API/network error.
 * Throws at call time if QUICKEMAIL_API_KEY is not set.
 * @param {string} email
 * @param {{ updateRecord: Function }} nocodbApi
 * @param {string} prospectId
 * @param {{ _fetchFn?: Function }} [_opts]
 * @returns {Promise<boolean>}
 */
async function verifyEmail(email, nocodbApi, prospectId, _opts) {
  var apiKey = process.env.QUICKEMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('[verifyEmail] QUICKEMAIL_API_KEY env var is required but not set');
  }
  var fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _httpFetchJson;
  try {
    var url =
      'https://api.quickemailverification.com/v1/verify?email=' +
      encodeURIComponent(email) +
      '&apikey=' +
      encodeURIComponent(apiKey);
    var resp = await fetchFn(url);
    if (resp && resp.result === 'invalid') {
      await nocodbApi.updateRecord('Outreach_Prospects', prospectId, { status: 'invalid' });
      return false;
    }
    return true;
  } catch (_e) {
    // Unknown result or network error -> proceed (do not block on uncertainty)
    return true;
  }
}

/**
 * Query Outreach_Daily_Stats for a specific date string (YYYY-MM-DD).
 * @param {{ queryRecords: Function }} nocodbApi
 * @param {string} date
 * @returns {Promise<object|null>}
 */
async function getDailyStats(nocodbApi, date) {
  var records = await nocodbApi.queryRecords('Outreach_Daily_Stats', {
    where: '(date,eq,' + date + ')',
    limit: 1,
  });
  return records && records.length > 0 ? records[0] : null;
}

/**
 * Daily cron: poll Resend for bounced emails in the 24-48h window after sending.
 * Updates bounced prospects (status='bounced', followup_count=99) and increments
 * today's bounced_count in Outreach_Daily_Stats.
 * @param {{ queryRecords: Function, updateRecord: Function, createRecord: Function }} nocodbApi
 * @param {{ _fetchFn?: Function }} [_opts]
 */
async function pollBounces(nocodbApi, _opts) {
  var resendKey = process.env.RESEND_API_KEY;
  // M-3: throw early on missing key — consistent with verifyEmail guard pattern
  if (!resendKey) {
    throw new Error('[pollBounces] RESEND_API_KEY env var is required but not set');
  }
  var fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _httpFetchJson;
  var now = Date.now();
  var h24 = 24 * 60 * 60 * 1000;
  var h48 = 48 * 60 * 60 * 1000;

  var records = await nocodbApi.queryRecords('Outreach_Prospects', {
    // M-2: explicit limit prevents NocoDB default pagination (typically 25 records) from
    // silently dropping prospects that fall in the 24-48h window beyond page 1
    where: '(last_resend_id,isnot,)~and(status,ne,bounced)~and(status,ne,invalid)',
    limit: 1000,
  });

  var due = (records || []).filter(function (r) {
    if (!r.sent_at) return false;
    var age = now - new Date(r.sent_at).getTime();
    return age >= h24 && age <= h48;
  });

  var bouncedCount = 0;
  var today = new Date().toISOString().slice(0, 10);

  for (var i = 0; i < due.length; i++) {
    var prospect = due[i];
    try {
      var emailData = await fetchFn(
        'https://api.resend.com/emails/' + prospect.last_resend_id,
        { headers: { Authorization: 'Bearer ' + resendKey } }
      );
      if (emailData && emailData.last_event === 'bounced') {
        await nocodbApi.updateRecord('Outreach_Prospects', prospect.id, {
          status: 'bounced',
          followup_count: 99,
        });
        bouncedCount++;
      }
    } catch (_e) {
      // skip on fetch error; next cron will retry
    }
  }

  if (bouncedCount > 0) {
    var updatedAt = new Date().toISOString();
    var statsRec = await getDailyStats(nocodbApi, today);
    if (statsRec) {
      await nocodbApi.updateRecord('Outreach_Daily_Stats', statsRec.id, {
        bounced_count: (statsRec.bounced_count || 0) + bouncedCount,
        updated_at: updatedAt,
      });
    } else {
      await nocodbApi.createRecord('Outreach_Daily_Stats', {
        date: today,
        sent_count: 0,
        bounced_count: bouncedCount,
        updated_at: updatedAt,
      });
    }
  }
}

/**
 * Check today's bounce rate and send a Telegram alert if it exceeds 5%.
 * Skips silently when sent_count=0 (avoids division-by-zero).
 * @param {{ queryRecords: Function }} nocodbApi
 * @param {{ _fetchFn?: Function }} [_opts]
 */
async function checkBounceRateAlert(nocodbApi, _opts) {
  var fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _httpFetchJson;
  var today = new Date().toISOString().slice(0, 10);
  var stats = await getDailyStats(nocodbApi, today);
  if (!stats || stats.sent_count === 0) return;
  var ratio = stats.bounced_count / stats.sent_count;
  if (ratio > 0.05) {
    var botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    var chatId = process.env.TELEGRAM_CHAT_ID || '';
    // M-4: log clearly when credentials are missing so the broken alert is visible in n8n logs
    if (!botToken || !chatId) {
      console.error('[checkBounceRateAlert] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — alert suppressed');
      return;
    }
    var msg =
      'Bounce rate alert: ' +
      stats.bounced_count +
      '/' +
      stats.sent_count +
      ' emails bounced today (' +
      (ratio * 100).toFixed(1) +
      '%). Consider pausing outreach sends.';
    await fetchFn(
      'https://api.telegram.org/bot' + botToken + '/sendMessage',
      {
        method: 'POST',
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      }
    );
  }
}

module.exports = {
  selectProspects: selectProspects,
  buildEmailPrompt: buildEmailPrompt,
  validateEmail: validateEmail,
  validateSubject: validateSubject,
  buildSendPayload: buildSendPayload,
  buildFollowUpPrompt: buildFollowUpPrompt,
  checkForFollowUps: checkForFollowUps,
  logEmail: logEmail,
  scrapeRecentArticle: scrapeRecentArticle,
  generateEmail: generateEmail,
  BANNED_PHRASES: BANNED_PHRASES,
  FROM_NAME: FROM_NAME,
  // section-05
  getFollowUpStage: getFollowUpStage,
  checkFollowUpsDue: checkFollowUpsDue,
  buildFu3Body: buildFu3Body,
  buildFuThreadedPayload: buildFuThreadedPayload,
  buildFu2Payload: buildFu2Payload,
  sendInitialOutreach: sendInitialOutreach,
  sendFollowUp: sendFollowUp,
  cancelFollowUps: cancelFollowUps,
  // section-06
  getWarmupLimit: getWarmupLimit,
  isValidSendTime: isValidSendTime,
  getDailySentCount: getDailySentCount,
  incrementDailySentCount: incrementDailySentCount,
  verifyEmail: verifyEmail,
  pollBounces: pollBounces,
  checkBounceRateAlert: checkBounceRateAlert,
};
