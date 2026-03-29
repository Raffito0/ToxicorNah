'use strict';

const {
  selectProspects,
  buildEmailPrompt,
  validateEmail,
  validateSubject,
  buildSendPayload,
  buildFollowUpPrompt,
  checkForFollowUps,
  logEmail,
  scrapeRecentArticle,
  generateEmail,
  BANNED_PHRASES,
  FROM_NAME,
  getFollowUpStage,
  checkFollowUpsDue,
  buildFu3Body,
  buildFuThreadedPayload,
  buildFu2Payload,
  sendInitialOutreach,
  sendFollowUp,
  cancelFollowUps,
  // section-06
  getWarmupLimit,
  isValidSendTime,
  getDailySentCount,
  incrementDailySentCount,
  verifyEmail,
  pollBounces,
  checkBounceRateAlert,
} = require('../../n8n/code/insiderbuying/send-outreach');

// ─── selectProspects ──────────────────────────────────────────────────────

describe('selectProspects()', () => {
  const PROSPECTS = [
    { status: 'found', contact_email: 'a@example.com', priority: 80 },
    { status: 'found', contact_email: 'b@example.com', priority: 90 },
    { status: 'sent',  contact_email: 'c@example.com', priority: 95 },
    { status: 'found', contact_email: '',              priority: 70 },
    { status: 'found', contact_email: 'd@example.com', priority: 60 },
  ];

  test('returns only prospects with status "found" and a non-empty email', () => {
    const result = selectProspects(PROSPECTS);
    result.forEach((p) => {
      expect(p.status).toBe('found');
      expect(p.contact_email.length).toBeGreaterThan(0);
    });
  });

  test('sorts by priority descending', () => {
    const result = selectProspects(PROSPECTS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].priority).toBeGreaterThanOrEqual(result[i].priority);
    }
  });

  test('respects limit parameter', () => {
    const result = selectProspects(PROSPECTS, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('defaults limit to 10', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      status: 'found', contact_email: `e${i}@x.com`, priority: i,
    }));
    expect(selectProspects(many).length).toBeLessThanOrEqual(10);
  });

  test('handles null/empty input gracefully', () => {
    expect(selectProspects(null)).toEqual([]);
    expect(selectProspects([])).toEqual([]);
  });
});

// ─── buildEmailPrompt ─────────────────────────────────────────────────────

describe('buildEmailPrompt()', () => {
  const PROSPECT = {
    contact_name: 'Jane Smith',
    site_name: 'FinanceBlog',
    domain: 'financeblog.com',
    notes: 'Covers insider trading analysis',
  };
  const ARTICLE = {
    title: 'Why Insiders Are Buying AAPL',
    url: 'https://earlyinsider.com/articles/aapl',
    summary: 'Strong insider conviction in AAPL this quarter.',
  };

  test('returns object with prompt and maxTokens', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('maxTokens');
  });

  test('prompt includes contact name and site name', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result.prompt).toContain('Jane Smith');
    expect(result.prompt).toContain('FinanceBlog');
  });

  test('prompt includes article title', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result.prompt).toContain(ARTICLE.title);
  });

  // GAP 12.14 — prompt must not include the article URL
  test('GAP 12.14: prompt does NOT contain the article URL', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result.prompt).not.toContain('https://');
    expect(result.prompt).not.toContain(ARTICLE.url);
  });

  test('GAP 12.14: prompt does not contain any http:// or https:// pattern', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result.prompt).not.toMatch(/https?:\/\//);
  });

  test('maxTokens is in a reasonable range (100-500)', () => {
    const result = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(result.maxTokens).toBeGreaterThanOrEqual(100);
    expect(result.maxTokens).toBeLessThanOrEqual(500);
  });

  test('GAP 12.14: article with url passed in — prompt still has no URL', () => {
    // Even if the caller passes a full article object with url, it must not leak into prompt
    const articleWithUrl = { title: 'AAPL Insiders Load Up', url: 'https://earlyinsider.com/aapl', summary: 'Strong buy signal.' };
    const result = buildEmailPrompt(PROSPECT, articleWithUrl);
    expect(result.prompt).not.toContain('https://');
    expect(result.prompt).not.toContain('earlyinsider.com');
  });

  test('handles missing article url gracefully — does not throw', () => {
    const articleNoUrl = { title: 'Test Article', summary: 'Summary here.' };
    expect(() => buildEmailPrompt(PROSPECT, articleNoUrl)).not.toThrow();
  });
});

// ─── validateEmail ────────────────────────────────────────────────────────

describe('validateEmail()', () => {
  const VALID_EMAIL =
    'Subject: AAPL insider data you might find useful\n\n'
    + 'Quick note — I tracked an unusual cluster of AAPL buys by C-suite last month. '
    + 'Would you be interested in a guest post covering the full pattern? '
    + 'Happy to send the draft over if so.';

  test('returns valid:true for a clean email under 150 words', () => {
    const result = validateEmail(VALID_EMAIL);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('returns wordCount in result', () => {
    const result = validateEmail(VALID_EMAIL);
    expect(typeof result.wordCount).toBe('number');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  test('flags email over 150 words', () => {
    const long = Array(160).fill('word').join(' ');
    const result = validateEmail(long);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('150'))).toBe(true);
  });

  test('flags banned phrases', () => {
    const result = validateEmail('I hope this finds you. Would you be interested in a collaboration?');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('banned'))).toBe(true);
  });

  test('flags email with no CTA', () => {
    const result = validateEmail('AAPL insiders bought a lot last month. That is interesting.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('cta'))).toBe(true);
  });

  test('returns { valid: false } for null/empty input', () => {
    expect(validateEmail(null).valid).toBe(false);
    expect(validateEmail('').valid).toBe(false);
  });

  test('result always has issues array', () => {
    expect(Array.isArray(validateEmail(VALID_EMAIL).issues)).toBe(true);
    expect(Array.isArray(validateEmail(null).issues)).toBe(true);
  });
});

// ─── buildSendPayload ─────────────────────────────────────────────────────

describe('buildSendPayload()', () => {
  test('returns object with from, to, subject, html, text fields', () => {
    const payload = buildSendPayload('to@example.com', 'Subject here', 'Body text', 'from@example.com');
    expect(payload).toHaveProperty('from');
    expect(payload).toHaveProperty('to');
    expect(payload).toHaveProperty('subject');
    expect(payload).toHaveProperty('html');
    expect(payload).toHaveProperty('text');
  });

  test('to field matches input', () => {
    const payload = buildSendPayload('to@example.com', 'Subject', 'Body', 'from@example.com');
    expect(payload.to).toBe('to@example.com');
  });

  test('text field matches raw body', () => {
    const payload = buildSendPayload('to@x.com', 'S', 'My body text', 'from@x.com');
    expect(payload.text).toBe('My body text');
  });

  test('html field wraps lines in <p> tags', () => {
    const payload = buildSendPayload('t@x.com', 'S', 'Line one\nLine two', 'f@x.com');
    expect(payload.html).toContain('<p>');
  });
});

// ─── buildFollowUpPrompt ─────────────────────────────────────────────────

describe('buildFollowUpPrompt()', () => {
  const PROSPECT = { contact_name: 'Bob', site_name: 'TradingBlog', domain: 'tradingblog.com' };
  const SUBJECT = 'AAPL insider conviction last month';

  test('returns object with prompt and maxTokens', () => {
    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('maxTokens');
  });

  test('prompt includes the original subject line', () => {
    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
    expect(result.prompt).toContain(SUBJECT);
  });

  test('prompt includes the contact name', () => {
    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
    expect(result.prompt).toContain('Bob');
  });

  test('maxTokens is reasonable (50-300)', () => {
    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
    expect(result.maxTokens).toBeGreaterThanOrEqual(50);
    expect(result.maxTokens).toBeLessThanOrEqual(300);
  });
});

// ─── checkForFollowUps ────────────────────────────────────────────────────

describe('checkForFollowUps()', () => {
  const OLD_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const RECENT_DATE = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  test('returns empty array for null/empty logs', () => {
    expect(checkForFollowUps(null)).toEqual([]);
    expect(checkForFollowUps([])).toEqual([]);
  });

  test('returns prospect ID when initial was sent over threshold days ago', () => {
    const logs = [{ email_type: 'initial', prospect_id: 'p1', sent_at: OLD_DATE }];
    const result = checkForFollowUps(logs, 5);
    expect(result).toContain('p1');
  });

  test('does not return prospect if followup already sent', () => {
    const logs = [
      { email_type: 'initial', prospect_id: 'p1', sent_at: OLD_DATE },
      { email_type: 'followup', prospect_id: 'p1', sent_at: OLD_DATE },
    ];
    expect(checkForFollowUps(logs, 5)).not.toContain('p1');
  });

  test('does not return prospect if initial was sent recently (under threshold)', () => {
    const logs = [{ email_type: 'initial', prospect_id: 'p2', sent_at: RECENT_DATE }];
    expect(checkForFollowUps(logs, 5)).not.toContain('p2');
  });
});

// ─── logEmail ─────────────────────────────────────────────────────────────

describe('logEmail()', () => {
  test('returns flat object — no { fields: {} } wrapper', () => {
    const record = logEmail('p1', 'initial');
    expect(record.fields).toBeUndefined();
  });

  test('includes prospect_id field', () => {
    const record = logEmail('p1', 'initial');
    expect(record.prospect_id).toBe('p1');
  });

  test('includes email_type field', () => {
    const record = logEmail('p1', 'followup');
    expect(record.email_type).toBe('followup');
  });

  test('status is "sent"', () => {
    expect(logEmail('p1', 'initial').status).toBe('sent');
  });

  test('sent_at is a valid ISO timestamp', () => {
    const record = logEmail('p1', 'initial');
    expect(() => new Date(record.sent_at)).not.toThrow();
    expect(new Date(record.sent_at).toISOString()).toBe(record.sent_at);
  });

  test('defaults email_type to "initial" when not provided', () => {
    const record = logEmail('p1');
    expect(record.email_type).toBe('initial');
  });
});

// ─── BANNED_PHRASES ───────────────────────────────────────────────────────

describe('BANNED_PHRASES', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(BANNED_PHRASES)).toBe(true);
    expect(BANNED_PHRASES.length).toBeGreaterThan(0);
  });

  test('contains classic template phrases', () => {
    expect(BANNED_PHRASES.some((p) => p.toLowerCase().includes('hope this finds'))).toBe(true);
    expect(BANNED_PHRASES.some((p) => p.toLowerCase().includes('reaching out'))).toBe(true);
  });
});

// ─── section-04: email rewrite + scraping ────────────────────────────────

// Helper: build an AI response that passes all generateEmail validators
function makeValidAiResponse(opts) {
  var subject = (opts && opts.subject) || 'Ready to feature our AAPL insider data?';
  var wordCount = (opts && opts.wordCount) || 110;
  var banned = (opts && opts.bannedPhrase) || '';
  // Build a body with exact word count including required phrases
  // Required phrases: "We track 1,500+" and "Reply 'stop' to never hear from me again."
  var requiredA = "We track 1,500+ SEC insider filings per month.";
  var requiredB = "Reply 'stop' to never hear from me again.";
  var requiredWords = (requiredA + ' ' + requiredB).split(/\s+/).length; // ~15
  var fillerCount = Math.max(0, wordCount - requiredWords);
  var filler = Array(fillerCount).fill('interesting').join(' ');
  var body = requiredA + ' ' + filler + (banned ? ' ' + banned : '') + ' ' + requiredB;
  return 'Subject: ' + subject + '\n\n' + body;
}

// ── section-04: buildEmailPrompt enhancements ─────────────────────────────

describe('section-04: buildEmailPrompt no URL', () => {
  const PROSPECT = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };
  const ARTICLE  = { title: 'AAPL Insiders Load Up', url: 'https://earlyinsider.com/aapl', summary: 'CEO bought $5M.' };

  test('does NOT include http:// or https:// in the prompt', () => {
    const { prompt } = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(prompt).not.toMatch(/https?:\/\//);
  });

  test('prompt explicitly instructs AI not to include URLs', () => {
    const { prompt } = buildEmailPrompt(PROSPECT, ARTICLE);
    expect(prompt.toLowerCase()).toContain('url');
  });
});

describe('section-04: buildEmailPrompt social proof', () => {
  const PROSPECT = { contact_name: 'Bob', site_name: 'TradeBlog', domain: 'tradeblog.com' };

  test('includes "1,500+" in the prompt', () => {
    const { prompt } = buildEmailPrompt(PROSPECT, null);
    expect(prompt).toContain('1,500+');
  });
});

describe('section-04: buildEmailPrompt word count instruction', () => {
  const PROSPECT = { contact_name: 'Bob', site_name: 'TradeBlog', domain: 'tradeblog.com' };

  test('prompt instructs AI to write 100-125 words', () => {
    const { prompt } = buildEmailPrompt(PROSPECT, null);
    expect(prompt).toMatch(/100.{0,5}125/);
  });
});

describe('section-04: buildEmailPrompt opt-out footer', () => {
  const PROSPECT = { contact_name: 'Bob', site_name: 'TradeBlog', domain: 'tradeblog.com' };

  test("prompt includes \"Reply 'stop'\" instruction", () => {
    const { prompt } = buildEmailPrompt(PROSPECT, null);
    expect(prompt.toLowerCase()).toContain("reply 'stop'");
  });
});

describe('section-04: buildEmailPrompt article personalisation', () => {
  const BASE_PROSPECT = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };

  test('includes article title in prompt when last_article_title is set', () => {
    const prospect = Object.assign({}, BASE_PROSPECT, { last_article_title: 'Why CEOs Buy In Q4' });
    const { prompt } = buildEmailPrompt(prospect, null);
    expect(prompt).toContain('Why CEOs Buy In Q4');
  });

  test('generates prompt without article reference when last_article_title is null', () => {
    const { prompt } = buildEmailPrompt(BASE_PROSPECT, null);
    expect(prompt).not.toContain("I just read your piece");
  });
});

// ── section-04: validateSubject ───────────────────────────────────────────

describe('section-04: validateSubject()', () => {
  test('throws when subject has no question mark', () => {
    expect(() => validateSubject('Insider buying update')).toThrow();
    expect(() => validateSubject('Insider buying update')).toThrow(/question/i);
  });

  test('does not throw when subject ends with "?"', () => {
    expect(() => validateSubject('Did you see the latest AAPL data?')).not.toThrow();
  });

  test('does not throw when subject contains "?" in the middle', () => {
    expect(() => validateSubject('Is AAPL a buy? Here is the data')).not.toThrow();
  });
});

// ── section-04: validateEmail new banned phrases ──────────────────────────

describe('section-04: validateEmail new banned phrases (case-insensitive)', () => {
  const newPhrases = [
    'just wanted to reach out',
    'I stumbled upon',
    'I am a huge fan',
    'big fan of your work',
    'as per our conversation',
    'circle back',
    'synergy',
  ];

  newPhrases.forEach((phrase) => {
    test(`rejects body containing "${phrase}" (passed in UPPER CASE)`, () => {
      const body = phrase.toUpperCase() + ' Would you be interested in a guest post?';
      const result = validateEmail(body);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.toLowerCase().includes('banned'))).toBe(true);
    });
  });
});

// ── section-04: FROM_NAME constant ────────────────────────────────────────

describe('section-04: FROM_NAME constant', () => {
  test('equals "Ryan from EarlyInsider" <ryan@earlyinsider.com>', () => {
    expect(FROM_NAME).toBe('"Ryan from EarlyInsider" <ryan@earlyinsider.com>');
  });
});

// ── section-04: generateEmail from name ──────────────────────────────────

describe('section-04: generateEmail from name', () => {
  test('sets email.from to FROM_NAME constant', async () => {
    const prospect = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };
    const mockAi = { call: jest.fn().mockResolvedValue(makeValidAiResponse({})) };
    const result = await generateEmail(prospect, null, { _aiClient: mockAi });
    expect(result.from).toBe(FROM_NAME);
  });
});

// ── section-04: generateEmail word count ─────────────────────────────────

describe('section-04: generateEmail word count', () => {
  test('produces an email body between 100 and 125 words', async () => {
    const prospect = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };
    const mockAi = { call: jest.fn().mockResolvedValue(makeValidAiResponse({ wordCount: 110 })) };
    const result = await generateEmail(prospect, null, { _aiClient: mockAi });
    const words = result.body.trim().split(/\s+/).filter((w) => w.length > 0);
    expect(words.length).toBeGreaterThanOrEqual(100);
    expect(words.length).toBeLessThanOrEqual(125);
  });
});

// ── section-04: AI retry loop ────────────────────────────────────────────

describe('section-04: generateEmail retry loop', () => {
  const PROSPECT = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };

  test('retries when AI returns a banned phrase — succeeds on clean 3rd attempt', async () => {
    let calls = 0;
    const mockAi = {
      call: jest.fn().mockImplementation(async () => {
        calls++;
        if (calls <= 2) {
          // synergy is banned
          return makeValidAiResponse({ bannedPhrase: 'synergy great idea' });
        }
        return makeValidAiResponse({});
      }),
    };
    const result = await generateEmail(PROSPECT, null, { _aiClient: mockAi });
    expect(result.subject).toBeTruthy();
    expect(calls).toBe(3);
  });

  test('retries when AI returns subject without "?"', async () => {
    let calls = 0;
    const mockAi = {
      call: jest.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) return makeValidAiResponse({ subject: 'No question mark here' });
        return makeValidAiResponse({});
      }),
    };
    const result = await generateEmail(PROSPECT, null, { _aiClient: mockAi });
    expect(result.subject).toContain('?');
    expect(calls).toBe(2);
  });

  test('retries when AI returns body over 125 words', async () => {
    let calls = 0;
    const mockAi = {
      call: jest.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) return makeValidAiResponse({ wordCount: 140 });
        return makeValidAiResponse({});
      }),
    };
    const result = await generateEmail(PROSPECT, null, { _aiClient: mockAi });
    const words = result.body.trim().split(/\s+/).filter((w) => w.length > 0);
    expect(words.length).toBeLessThanOrEqual(125);
    expect(calls).toBe(2);
  });

  test('throws after 3 failed attempts', async () => {
    const mockAi = {
      call: jest.fn().mockResolvedValue(makeValidAiResponse({ subject: 'No question mark' })),
    };
    await expect(generateEmail(PROSPECT, null, { _aiClient: mockAi })).rejects.toThrow(/attempts/i);
  });
});

// ── section-04: scrapeRecentArticle HTML mode ────────────────────────────

describe('section-04: scrapeRecentArticle HTML mode', () => {
  function mockFetch(body, contentType) {
    return jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': contentType || 'text/html' },
      body: body,
    });
  }

  test('returns title and url from article:first-of-type a selector', async () => {
    const html = '<html><body><article><a href="/post/1">AAPL Insiders Buy</a></article></body></html>';
    const result = await scrapeRecentArticle('https://example.com', { _fetchFn: mockFetch(html) });
    expect(result).not.toBeNull();
    expect(result.title).toBe('AAPL Insiders Buy');
    expect(result.url).toContain('/post/1');
  });

  test('falls back to .post:first-of-type a when article selector finds nothing', async () => {
    const html = '<html><body><div class="post"><a href="/p/2">Insider Move</a></div></body></html>';
    const result = await scrapeRecentArticle('https://example.com', { _fetchFn: mockFetch(html) });
    expect(result).not.toBeNull();
    expect(result.title).toBe('Insider Move');
  });

  test('falls back to h2 a:first-of-type as last resort', async () => {
    const html = '<html><body><h2><a href="/p/3">Deep Dive</a></h2></body></html>';
    const result = await scrapeRecentArticle('https://example.com', { _fetchFn: mockFetch(html) });
    expect(result).not.toBeNull();
    expect(result.title).toBe('Deep Dive');
  });

  test('returns null gracefully when scraping fails entirely', async () => {
    const throwFn = jest.fn().mockRejectedValue(new Error('network error'));
    const result = await scrapeRecentArticle('https://example.com', { _fetchFn: throwFn });
    expect(result).toBeNull();
  });

  test('returns null gracefully when no selector matches', async () => {
    const html = '<html><body><p>No links here</p></body></html>';
    const result = await scrapeRecentArticle('https://example.com', { _fetchFn: mockFetch(html) });
    expect(result).toBeNull();
  });
});

// ── section-04: generateEmail — no AI client throws (L-10) ──────────────

describe('section-04: generateEmail — no AI client', () => {
  const PROSPECT = { contact_name: 'Jane', site_name: 'FinBlog', domain: 'finblog.com' };
  test('throws immediately when no _aiClient provided', async () => {
    await expect(generateEmail(PROSPECT, null, {})).rejects.toThrow(/AI client not provided/i);
  });
});

// ── section-04: scrapeRecentArticle URL edge cases (L-11) ─────────────────

describe('section-04: scrapeRecentArticle URL edge cases', () => {
  function mockFetch(href) {
    return jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body><article><a href="' + href + '">Article Title</a></article></body></html>',
    });
  }

  test('resolves protocol-relative href (//cdn.example.com/post)', async () => {
    const result = await scrapeRecentArticle('https://example.com', {
      _fetchFn: mockFetch('//cdn.example.com/post'),
    });
    expect(result).not.toBeNull();
    expect(result.url).toMatch(/^https:\/\/cdn\.example\.com\/post/);
  });

  test('resolves relative href (/blog/post-1)', async () => {
    const result = await scrapeRecentArticle('https://example.com', {
      _fetchFn: mockFetch('/blog/post-1'),
    });
    expect(result).not.toBeNull();
    expect(result.url).toMatch(/^https:\/\/example\.com\/blog\/post-1/);
  });
});

// ── section-04: scrapeRecentArticle XML/RSS mode ─────────────────────────

describe('section-04: scrapeRecentArticle XML/RSS mode', () => {
  const RSS_BODY = '<?xml version="1.0"?><rss><channel><item><title>CEO Buys Big</title><link>https://blog.com/1</link></item></channel></rss>';

  test('uses xmlMode when Content-Type is application/xml', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      body: RSS_BODY,
    });
    const result = await scrapeRecentArticle('https://blog.com', { _fetchFn: fetchFn });
    expect(result).not.toBeNull();
    expect(result.title).toBe('CEO Buys Big');
  });

  test('uses xmlMode when Content-Type is text/xml', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'text/xml' },
      body: RSS_BODY,
    });
    const result = await scrapeRecentArticle('https://blog.com', { _fetchFn: fetchFn });
    expect(result).not.toBeNull();
    expect(result.title).toBe('CEO Buys Big');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// section-05: Follow-Up Sequence
// ═══════════════════════════════════════════════════════════════════════════

// ── section-05: getFollowUpStage ─────────────────────────────────────────

describe('section-05: getFollowUpStage', () => {
  test('returns 1 for day 5 with followup_count=0', () => {
    expect(getFollowUpStage(5, 0)).toBe(1);
  });
  test('returns 1 for day 7 with followup_count=0 (resilient to missed cron)', () => {
    expect(getFollowUpStage(7, 0)).toBe(1);
  });
  test('returns 2 for day 10 with followup_count=1', () => {
    expect(getFollowUpStage(10, 1)).toBe(2);
  });
  test('returns 2 for day 12 with followup_count=1', () => {
    expect(getFollowUpStage(12, 1)).toBe(2);
  });
  test('returns 3 for day 16 with followup_count=2', () => {
    expect(getFollowUpStage(16, 2)).toBe(3);
  });
  test('returns null for day 4 with followup_count=0 (not yet due)', () => {
    expect(getFollowUpStage(4, 0)).toBeNull();
  });
  test('returns null for day 5 with followup_count=1 (wrong stage)', () => {
    expect(getFollowUpStage(5, 1)).toBeNull();
  });
  test('returns null for followup_count=99 (cancelled)', () => {
    expect(getFollowUpStage(20, 99)).toBeNull();
  });
});

// ── section-05: checkFollowUpsDue ────────────────────────────────────────

describe('section-05: checkFollowUpsDue', () => {
  function makeNocodbApi(records) {
    return {
      queryRecords: jest.fn().mockResolvedValue(records || []),
      updateRecord: jest.fn().mockResolvedValue({}),
    };
  }

  function makeProspect(daysAgo, followupCount, overrides) {
    return Object.assign({
      id: 'p1',
      contact_email: 'ed@site.com',
      contact_name: 'Ed Smith',
      site_name: 'FinSite',
      domain: 'finsite.com',
      sent_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      followup_count: followupCount,
      replied: false,
      last_resend_id: 'resend-abc-123',
      original_subject: 'Want to partner?',
    }, overrides || {});
  }

  test('selects prospect at day 5 with followup_count=0 as FU1', async () => {
    const api = makeNocodbApi([makeProspect(5, 0)]);
    const result = await checkFollowUpsDue(api);
    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe(1);
  });

  test('selects prospect at day 10 with followup_count=1 as FU2', async () => {
    const api = makeNocodbApi([makeProspect(10, 1)]);
    const result = await checkFollowUpsDue(api);
    expect(result[0].stage).toBe(2);
  });

  test('selects prospect at day 16 with followup_count=2 as FU3', async () => {
    const api = makeNocodbApi([makeProspect(16, 2)]);
    const result = await checkFollowUpsDue(api);
    expect(result[0].stage).toBe(3);
  });

  test('selects FU1 for prospect at day 7 with followup_count=0 (days >= 5)', async () => {
    const api = makeNocodbApi([makeProspect(7, 0)]);
    const result = await checkFollowUpsDue(api);
    expect(result[0].stage).toBe(1);
  });

  test('selects FU2 for prospect at day 12 with followup_count=1 (days >= 10)', async () => {
    const api = makeNocodbApi([makeProspect(12, 1)]);
    const result = await checkFollowUpsDue(api);
    expect(result[0].stage).toBe(2);
  });

  test('does NOT select prospect with followup_count=99 (cancelled)', async () => {
    const api = makeNocodbApi([makeProspect(10, 99)]);
    const result = await checkFollowUpsDue(api);
    expect(result).toHaveLength(0);
  });

  test('does NOT select prospect with replied=true', async () => {
    const api = makeNocodbApi([makeProspect(10, 0, { replied: true })]);
    const result = await checkFollowUpsDue(api);
    expect(result).toHaveLength(0);
  });

  test('does NOT select prospect where sent_at is NULL', async () => {
    const api = makeNocodbApi([makeProspect(5, 0, { sent_at: null })]);
    const result = await checkFollowUpsDue(api);
    expect(result).toHaveLength(0);
  });
});

// ── section-05: buildFuThreadedPayload (FU1/FU3 headers) ─────────────────

describe('section-05: buildFuThreadedPayload', () => {
  test('includes In-Reply-To header with wrapped resendId', () => {
    const payload = buildFuThreadedPayload(
      'ed@site.com', 'Re: Partner?', 'Hello', FROM_NAME, 'resend-abc-123'
    );
    expect(payload.headers['In-Reply-To']).toBe('<resend-abc-123>');
  });

  test('includes References header with wrapped resendId', () => {
    const payload = buildFuThreadedPayload(
      'ed@site.com', 'Re: Partner?', 'Hello', FROM_NAME, 'resend-abc-123'
    );
    expect(payload.headers['References']).toBe('<resend-abc-123>');
  });

  test('omits threading headers when resendId is null', () => {
    const payload = buildFuThreadedPayload(
      'ed@site.com', 'Re: Partner?', 'Hello', FROM_NAME, null
    );
    expect(payload.headers['In-Reply-To']).toBeUndefined();
    expect(payload.headers['References']).toBeUndefined();
  });
});

// ── section-05: buildFu2Payload (new thread) ─────────────────────────────

describe('section-05: buildFu2Payload', () => {
  test('does NOT include In-Reply-To header', () => {
    const payload = buildFu2Payload('ed@site.com', 'Fresh angle?', 'Body text', FROM_NAME);
    expect(payload.headers).toBeUndefined();
    expect(payload['In-Reply-To']).toBeUndefined();
  });

  test('subject does NOT start with "Re:"', () => {
    const payload = buildFu2Payload('ed@site.com', 'Fresh angle?', 'Body text', FROM_NAME);
    expect(payload.subject).not.toMatch(/^Re:/i);
  });
});

// ── section-05: buildFu3Body ──────────────────────────────────────────────

describe('section-05: buildFu3Body', () => {
  test('uses first name from contact_name', () => {
    const body = buildFu3Body({ contact_name: 'John Smith' });
    expect(body).toMatch(/^Hi John,/);
  });

  test('falls back to "there" when contact_name is missing', () => {
    const body = buildFu3Body({ contact_name: '' });
    expect(body).toMatch(/^Hi there,/);
  });

  test('body is approximately 25 words', () => {
    const body = buildFu3Body({ contact_name: 'Jane' });
    const words = body.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(20);
    expect(words).toBeLessThanOrEqual(35);
  });
});

// ── section-05: sendInitialOutreach — state tracking ─────────────────────

describe('section-05: sendInitialOutreach', () => {
  test('stores Resend response id in Outreach_Prospects.last_resend_id', async () => {
    const mockPost = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'resend-xyz-789' }),
    });
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    const prospect = { id: 'p1', contact_email: 'ed@site.com' };
    const emailPayload = { from: FROM_NAME, to: 'ed@site.com', subject: 'Test?', html: '<p>Hi</p>', text: 'Hi' };

    await sendInitialOutreach(prospect, emailPayload, nocodbApi, { _postFn: mockPost });

    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p1',
      expect.objectContaining({ last_resend_id: 'resend-xyz-789' })
    );
  });
});

// ── section-05: sendFollowUp — followup_count increment ──────────────────

describe('section-05: sendFollowUp', () => {
  function makeProspect(stage) {
    return {
      id: 'p1',
      contact_email: 'ed@site.com',
      contact_name: 'Ed',
      site_name: 'FinSite',
      domain: 'finsite.com',
      last_resend_id: 'resend-abc-123',
      original_subject: 'Want to partner?',
      followup_count: stage - 1,
    };
  }

  function makeFu1AiResponse() {
    return Array(60).fill('interesting').join(' ');
  }

  function makeFu2AiResponse() {
    return 'Subject: Different angle for FinSite?\n\n' + Array(40).fill('specific').join(' ');
  }

  function makePostFn() {
    return jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'resend-fu-001' }),
    });
  }

  test('FU1: increments followup_count to 1 after send', async () => {
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    const aiClient = { call: jest.fn().mockResolvedValue(makeFu1AiResponse()) };
    await sendFollowUp(makeProspect(1), 1, nocodbApi, { _aiClient: aiClient, _postFn: makePostFn() });
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p1', expect.objectContaining({ followup_count: 1 })
    );
  });

  test('FU2: increments followup_count to 2 after send', async () => {
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    const aiClient = { call: jest.fn().mockResolvedValue(makeFu2AiResponse()) };
    await sendFollowUp(makeProspect(2), 2, nocodbApi, { _aiClient: aiClient, _postFn: makePostFn() });
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p1', expect.objectContaining({ followup_count: 2 })
    );
  });

  test('FU3: increments followup_count to 3 after send (no AI needed)', async () => {
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    await sendFollowUp(makeProspect(3), 3, nocodbApi, { _postFn: makePostFn() });
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p1', expect.objectContaining({ followup_count: 3 })
    );
  });

  test('FU1: payload includes In-Reply-To header', async () => {
    let capturedPayload = null;
    const postFn = jest.fn().mockImplementation((url, opts) => {
      capturedPayload = JSON.parse(opts.body);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'r1' }) });
    });
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    const aiClient = { call: jest.fn().mockResolvedValue(makeFu1AiResponse()) };
    await sendFollowUp(makeProspect(1), 1, nocodbApi, { _aiClient: aiClient, _postFn: postFn });
    expect(capturedPayload.headers['In-Reply-To']).toBe('<resend-abc-123>');
  });
});

// ── section-05: cancelFollowUps ───────────────────────────────────────────

describe('section-05: cancelFollowUps', () => {
  test('sets followup_count=99 on the given prospect ID', async () => {
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    await cancelFollowUps('p42', nocodbApi);
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p42', { followup_count: 99 }
    );
  });
});

// ── section-05: FU1 banned-phrase retry (M-8) ─────────────────────────────

describe('section-05: sendFollowUp FU1 banned-phrase retry', () => {
  function makeProspect() {
    return {
      id: 'p1',
      contact_email: 'ed@site.com',
      contact_name: 'Ed',
      site_name: 'FinSite',
      domain: 'finsite.com',
      last_resend_id: 'resend-abc-123',
      original_subject: 'Want to partner?',
      followup_count: 0,
    };
  }

  function makePostFn() {
    return jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'r1' }),
    });
  }

  test('retries FU1 when first AI response contains banned phrase, succeeds on 2nd attempt', async () => {
    const bannedBody = 'synergy ' + Array(60).fill('interesting').join(' ');
    const cleanBody = Array(60).fill('interesting').join(' ');
    let callCount = 0;
    const aiClient = {
      call: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? bannedBody : cleanBody);
      }),
    };
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    await sendFollowUp(makeProspect(), 1, nocodbApi, { _aiClient: aiClient, _postFn: makePostFn() });
    expect(aiClient.call).toHaveBeenCalledTimes(2);
  });

  test('throws after 3 FU1 failures all containing banned phrases', async () => {
    const bannedBody = 'synergy ' + Array(60).fill('interesting').join(' ');
    const aiClient = { call: jest.fn().mockResolvedValue(bannedBody) };
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    await expect(
      sendFollowUp(makeProspect(), 1, nocodbApi, { _aiClient: aiClient, _postFn: makePostFn() })
    ).rejects.toThrow(/attempts/i);
  });
});

// ── section-05: FU2 banned-phrase check (M-9) ─────────────────────────────

describe('section-05: sendFollowUp FU2 banned-phrase check', () => {
  function makeProspect() {
    return {
      id: 'p1',
      contact_email: 'ed@site.com',
      contact_name: 'Ed',
      site_name: 'FinSite',
      domain: 'finsite.com',
      last_resend_id: null,
      original_subject: 'Want to partner?',
      followup_count: 1,
    };
  }

  function makePostFn() {
    return jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'r2' }),
    });
  }

  function makeFu2Response(body) {
    return 'Subject: Noticed something specific?\n\n' + body;
  }

  test('rejects FU2 body with banned phrase and retries', async () => {
    const bannedBody = 'synergy ' + Array(40).fill('interesting').join(' ');
    const cleanBody = Array(40).fill('interesting').join(' ');
    let callCount = 0;
    const aiClient = {
      call: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(makeFu2Response(callCount === 1 ? bannedBody : cleanBody));
      }),
    };
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    await sendFollowUp(makeProspect(), 2, nocodbApi, { _aiClient: aiClient, _postFn: makePostFn() });
    expect(aiClient.call).toHaveBeenCalledTimes(2);
  });
});

// ── section-05: HTML escaping in follow-up payloads (L-4) ─────────────────

describe('section-05: HTML escaping in follow-up payloads', () => {
  test('buildFuThreadedPayload escapes & in body', () => {
    const payload = buildFuThreadedPayload(
      'ed@site.com', 'Re: Test?', 'S&P 500 data is here', FROM_NAME, null
    );
    expect(payload.html).toContain('S&amp;P 500 data is here');
    expect(payload.html).not.toContain('S&P');
  });

  test('buildFu2Payload escapes < and > in body', () => {
    const payload = buildFu2Payload(
      'ed@site.com', 'New angle?', 'Insiders <buy> at peaks', FROM_NAME
    );
    expect(payload.html).toContain('Insiders &lt;buy&gt; at peaks');
  });
});

// ── section-06: getWarmupLimit ────────────────────────────────────────────────

describe('section-06: getWarmupLimit', () => {
  const ORIG_DATE = process.env.DOMAIN_SETUP_DATE;

  function setDaysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    process.env.DOMAIN_SETUP_DATE = d.toISOString().slice(0, 10);
  }

  afterEach(() => {
    if (ORIG_DATE === undefined) delete process.env.DOMAIN_SETUP_DATE;
    else process.env.DOMAIN_SETUP_DATE = ORIG_DATE;
  });

  test('returns 5 when days < 14 (day 0)', () => {
    setDaysAgo(0);
    expect(getWarmupLimit()).toBe(5);
  });

  test('returns 5 when days < 14 (day 13)', () => {
    setDaysAgo(13);
    expect(getWarmupLimit()).toBe(5);
  });

  test('returns 20 when days >= 14 and < 28 (day 14)', () => {
    setDaysAgo(14);
    expect(getWarmupLimit()).toBe(20);
  });

  test('returns 20 when days >= 14 and < 28 (day 27)', () => {
    setDaysAgo(27);
    expect(getWarmupLimit()).toBe(20);
  });

  test('returns 50 when days >= 28 (day 28)', () => {
    setDaysAgo(28);
    expect(getWarmupLimit()).toBe(50);
  });

  test('returns 50 when days >= 28 (day 60)', () => {
    setDaysAgo(60);
    expect(getWarmupLimit()).toBe(50);
  });

  test('throws when DOMAIN_SETUP_DATE env var is missing', () => {
    delete process.env.DOMAIN_SETUP_DATE;
    expect(() => getWarmupLimit()).toThrow(/DOMAIN_SETUP_DATE/);
  });
});

// ── section-06: isValidSendTime ───────────────────────────────────────────────

describe('section-06: isValidSendTime', () => {
  // January 2026 is all EST (UTC-5, no DST).
  // Jan 1 2026 = Thursday, so:
  //   Jan 5=Mon, Jan 6=Tue, Jan 7=Wed, Jan 8=Thu, Jan 9=Fri, Jan 10=Sat
  function makeNow(isoString) {
    return function () { return new Date(isoString); };
  }

  test('Tuesday 10 AM Eastern -> true', () => {
    // 2026-01-06T15:00:00Z = Tuesday 10 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-06T15:00:00Z') })).toBe(true);
  });

  test('Wednesday 9 AM Eastern -> true', () => {
    // 2026-01-07T14:00:00Z = Wednesday 9 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-07T14:00:00Z') })).toBe(true);
  });

  test('Thursday 11 AM Eastern -> true', () => {
    // 2026-01-08T16:00:00Z = Thursday 11 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-08T16:00:00Z') })).toBe(true);
  });

  test('Monday 10 AM Eastern -> false', () => {
    // 2026-01-05T15:00:00Z = Monday 10 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-05T15:00:00Z') })).toBe(false);
  });

  test('Friday 10 AM Eastern -> false', () => {
    // 2026-01-09T15:00:00Z = Friday 10 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-09T15:00:00Z') })).toBe(false);
  });

  test('Saturday 10 AM Eastern -> false', () => {
    // 2026-01-10T15:00:00Z = Saturday 10 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-10T15:00:00Z') })).toBe(false);
  });

  test('Wednesday 8 AM Eastern -> false', () => {
    // 2026-01-07T13:00:00Z = Wednesday 8 AM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-07T13:00:00Z') })).toBe(false);
  });

  test('Wednesday 12 PM Eastern -> false', () => {
    // 2026-01-07T17:00:00Z = Wednesday 12 PM EST
    expect(isValidSendTime({ _nowFn: makeNow('2026-01-07T17:00:00Z') })).toBe(false);
  });
});

// ── section-06: daily send counter ───────────────────────────────────────────

describe('section-06: daily send counter', () => {
  const ORIG_DATE = process.env.DOMAIN_SETUP_DATE;

  afterEach(() => {
    if (ORIG_DATE === undefined) delete process.env.DOMAIN_SETUP_DATE;
    else process.env.DOMAIN_SETUP_DATE = ORIG_DATE;
  });

  test('getDailySentCount queries Outreach_Daily_Stats for today UTC date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([{ date: today, sent_count: 7 }]),
    };
    await getDailySentCount(nocodbApi);
    expect(nocodbApi.queryRecords).toHaveBeenCalledWith(
      'Outreach_Daily_Stats',
      expect.objectContaining({ where: expect.stringContaining(today) })
    );
  });

  test('getDailySentCount returns sent_count from record', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([{ date: today, sent_count: 12 }]),
    };
    const count = await getDailySentCount(nocodbApi);
    expect(count).toBe(12);
  });

  test('send loop stops when sent_count >= warmup limit for today', async () => {
    // day 0 -> limit=5. If already sent 5, remaining=0 -> stop.
    process.env.DOMAIN_SETUP_DATE = new Date().toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([{ date: today, sent_count: 5 }]),
    };
    const limit = getWarmupLimit();
    const sent = await getDailySentCount(nocodbApi);
    expect(Math.min(limit, 100) - sent).toBeLessThanOrEqual(0);
  });

  test('sent_count incremented by actual number sent after batch', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { id: 'stats1', date: today, sent_count: 3, bounced_count: 0 },
      ]),
      updateRecord: jest.fn().mockResolvedValue({}),
      createRecord: jest.fn().mockResolvedValue({}),
    };
    await incrementDailySentCount(nocodbApi, 5);
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Daily_Stats',
      'stats1',
      expect.objectContaining({ sent_count: 8 })
    );
  });
});

// ── section-06: verifyEmail ───────────────────────────────────────────────────

describe('section-06: verifyEmail', () => {
  const ORIG_KEY = process.env.QUICKEMAIL_API_KEY;

  beforeEach(() => { process.env.QUICKEMAIL_API_KEY = 'test-qev-key'; });
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.QUICKEMAIL_API_KEY;
    else process.env.QUICKEMAIL_API_KEY = ORIG_KEY;
  });

  test('returns true when result is "valid"', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ result: 'valid', safe_to_send: true });
    const nocodbApi = { updateRecord: jest.fn() };
    const result = await verifyEmail('test@example.com', nocodbApi, 'rec1', { _fetchFn: fetchFn });
    expect(result).toBe(true);
    expect(nocodbApi.updateRecord).not.toHaveBeenCalled();
  });

  test('returns false and updates status="invalid" when result is "invalid"', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ result: 'invalid' });
    const nocodbApi = { updateRecord: jest.fn().mockResolvedValue({}) };
    const result = await verifyEmail('bad@example.com', nocodbApi, 'rec1', { _fetchFn: fetchFn });
    expect(result).toBe(false);
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects',
      'rec1',
      expect.objectContaining({ status: 'invalid' })
    );
  });

  test('returns true when API returns an error', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Network error'));
    const nocodbApi = { updateRecord: jest.fn() };
    const result = await verifyEmail('test@example.com', nocodbApi, 'rec1', { _fetchFn: fetchFn });
    expect(result).toBe(true);
  });

  test('returns true when result is "unknown"', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ result: 'unknown' });
    const nocodbApi = { updateRecord: jest.fn() };
    const result = await verifyEmail('test@example.com', nocodbApi, 'rec1', { _fetchFn: fetchFn });
    expect(result).toBe(true);
  });

  test('throws when QUICKEMAIL_API_KEY is missing', async () => {
    delete process.env.QUICKEMAIL_API_KEY;
    await expect(
      verifyEmail('test@example.com', {}, 'rec1', {})
    ).rejects.toThrow(/QUICKEMAIL_API_KEY/);
  });
});

// ── section-06: bounce monitoring ────────────────────────────────────────────

describe('section-06: bounce monitoring', () => {
  const ORIG_RESEND = process.env.RESEND_API_KEY;
  const ORIG_TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ORIG_TG_CHAT = process.env.TELEGRAM_CHAT_ID;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.TELEGRAM_BOT_TOKEN = 'test-tg-token';
    process.env.TELEGRAM_CHAT_ID = 'test-tg-chat';
  });
  afterEach(() => {
    if (ORIG_RESEND === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIG_RESEND;
    if (ORIG_TG_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = ORIG_TG_TOKEN;
    if (ORIG_TG_CHAT === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = ORIG_TG_CHAT;
  });

  function makeSentAt(hoursAgo) {
    return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  }

  test('pollBounces: bounced email updates status="bounced" and followup_count=99', async () => {
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { id: 'rec1', contact_email: 'a@ex.com', last_resend_id: 'email-123', sent_at: makeSentAt(30) },
      ]),
      updateRecord: jest.fn().mockResolvedValue({}),
      createRecord: jest.fn().mockResolvedValue({}),
    };
    const fetchFn = jest.fn().mockResolvedValue({ last_event: 'bounced', id: 'email-123' });
    await pollBounces(nocodbApi, { _fetchFn: fetchFn });
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects',
      'rec1',
      expect.objectContaining({ status: 'bounced', followup_count: 99 })
    );
  });

  test('pollBounces: delivered email -> no update to prospect status', async () => {
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { id: 'rec2', contact_email: 'b@ex.com', last_resend_id: 'email-456', sent_at: makeSentAt(30) },
      ]),
      updateRecord: jest.fn().mockResolvedValue({}),
      createRecord: jest.fn().mockResolvedValue({}),
    };
    const fetchFn = jest.fn().mockResolvedValue({ last_event: 'delivered', id: 'email-456' });
    await pollBounces(nocodbApi, { _fetchFn: fetchFn });
    expect(nocodbApi.updateRecord).not.toHaveBeenCalledWith(
      'Outreach_Prospects',
      expect.anything(),
      expect.objectContaining({ status: 'bounced' })
    );
  });

  test('checkBounceRateAlert: 6% bounce rate calls Telegram sendMessage', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { date: today, sent_count: 100, bounced_count: 6 },
      ]),
    };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    await checkBounceRateAlert(nocodbApi, { _fetchFn: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toMatch(/sendMessage/);
  });

  test('checkBounceRateAlert: 4% bounce rate -> Telegram NOT called', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { date: today, sent_count: 100, bounced_count: 4 },
      ]),
    };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    await checkBounceRateAlert(nocodbApi, { _fetchFn: fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('checkBounceRateAlert: sent_count=0 -> no division-by-zero, Telegram NOT called', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { date: today, sent_count: 0, bounced_count: 0 },
      ]),
    };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    await expect(checkBounceRateAlert(nocodbApi, { _fetchFn: fetchFn })).resolves.not.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
