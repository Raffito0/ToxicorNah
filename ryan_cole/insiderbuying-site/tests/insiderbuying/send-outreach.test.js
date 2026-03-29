'use strict';

const {
  selectProspects,
  buildEmailPrompt,
  validateEmail,
  buildSendPayload,
  buildFollowUpPrompt,
  checkForFollowUps,
  logEmail,
  BANNED_PHRASES,
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
