diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/send-outreach.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/send-outreach.js
index bb8495d..1680054 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/send-outreach.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/send-outreach.js
@@ -58,9 +58,7 @@ function buildEmailPrompt(prospect, ourArticle) {
     '\n\n' +
     'We published: "' +
     ourArticle.title +
-    '" (' +
-    ourArticle.url +
-    ')\n' +
+    '"\n' +
     'Summary: ' +
     ourArticle.summary +
     '\n\n' +
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/find-prospects.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/find-prospects.test.js
new file mode 100644
index 0000000..305455d
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/find-prospects.test.js
@@ -0,0 +1,170 @@
+'use strict';
+
+const {
+  buildSearchQueries,
+  scoreProspect,
+  dedup,
+  buildProspectRecord,
+  WEIGHT_DA,
+  WEIGHT_RELEVANCE,
+  WEIGHT_CONTACT,
+  WEIGHT_RECENCY,
+} = require('../../n8n/code/insiderbuying/find-prospects');
+
+// ─── buildSearchQueries ───────────────────────────────────────────────────
+
+describe('buildSearchQueries()', () => {
+  test('returns a non-empty array', () => {
+    const queries = buildSearchQueries([]);
+    expect(Array.isArray(queries)).toBe(true);
+    expect(queries.length).toBeGreaterThan(0);
+  });
+
+  test('includes generic finance/insider queries', () => {
+    const queries = buildSearchQueries([]);
+    expect(queries.some((q) => q.toLowerCase().includes('insider'))).toBe(true);
+  });
+
+  test('appends ticker-specific queries for each ticker', () => {
+    const queries = buildSearchQueries(['AAPL', 'MSFT']);
+    expect(queries.some((q) => q.includes('AAPL'))).toBe(true);
+    expect(queries.some((q) => q.includes('MSFT'))).toBe(true);
+  });
+
+  test('handles null/empty tickers gracefully', () => {
+    expect(() => buildSearchQueries(null)).not.toThrow();
+    expect(() => buildSearchQueries([])).not.toThrow();
+  });
+});
+
+// ─── scoreProspect ────────────────────────────────────────────────────────
+
+describe('scoreProspect()', () => {
+  test('returns a number between 0 and 100', () => {
+    const score = scoreProspect({
+      domain_authority: 50,
+      relevance_score: 70,
+      contact_quality: 80,
+      recency_score: 60,
+    });
+    expect(typeof score).toBe('number');
+    expect(score).toBeGreaterThanOrEqual(0);
+    expect(score).toBeLessThanOrEqual(100);
+  });
+
+  test('perfect scores yield 100', () => {
+    const score = scoreProspect({
+      domain_authority: 100,
+      relevance_score: 100,
+      contact_quality: 100,
+      recency_score: 100,
+    });
+    expect(score).toBe(100);
+  });
+
+  test('zero scores yield 0', () => {
+    const score = scoreProspect({
+      domain_authority: 0,
+      relevance_score: 0,
+      contact_quality: 0,
+      recency_score: 0,
+    });
+    expect(score).toBe(0);
+  });
+
+  test('handles missing fields gracefully (treats as 0)', () => {
+    expect(() => scoreProspect({})).not.toThrow();
+    expect(scoreProspect({})).toBe(0);
+  });
+
+  test('weights sum to 1.0', () => {
+    expect(WEIGHT_DA + WEIGHT_RELEVANCE + WEIGHT_CONTACT + WEIGHT_RECENCY).toBeCloseTo(1.0);
+  });
+});
+
+// ─── dedup ────────────────────────────────────────────────────────────────
+
+describe('dedup()', () => {
+  test('removes prospects whose domain is in existingDomains', () => {
+    const prospects = [
+      { domain: 'example.com' },
+      { domain: 'newsite.com' },
+    ];
+    const result = dedup(prospects, ['example.com']);
+    expect(result).toHaveLength(1);
+    expect(result[0].domain).toBe('newsite.com');
+  });
+
+  test('domain comparison is case-insensitive', () => {
+    const prospects = [{ domain: 'EXAMPLE.COM' }];
+    const result = dedup(prospects, ['example.com']);
+    expect(result).toHaveLength(0);
+  });
+
+  test('returns all prospects if no existing domains', () => {
+    const prospects = [{ domain: 'a.com' }, { domain: 'b.com' }];
+    expect(dedup(prospects, [])).toHaveLength(2);
+  });
+
+  test('handles null/empty inputs gracefully', () => {
+    expect(dedup(null, [])).toEqual([]);
+    expect(dedup([], null)).toEqual([]);
+    expect(dedup(null, null)).toEqual([]);
+  });
+});
+
+// ─── buildProspectRecord ──────────────────────────────────────────────────
+
+describe('buildProspectRecord()', () => {
+  const PROSPECT_INPUT = {
+    domain: 'tradingblog.com',
+    site_name: 'Trading Blog',
+    contact_email: 'editor@tradingblog.com',
+    contact_name: 'Alice',
+    domain_authority: 55,
+    relevance_score: 70,
+    contact_quality: 80,
+    recency_score: 60,
+    source_query: 'insider buying blog',
+    notes: 'Covers SEC filings',
+  };
+
+  test('returns flat object — no { fields: {} } wrapper', () => {
+    const record = buildProspectRecord(PROSPECT_INPUT);
+    expect(record.fields).toBeUndefined();
+  });
+
+  test('includes domain and contact fields', () => {
+    const record = buildProspectRecord(PROSPECT_INPUT);
+    expect(record.domain).toBe('tradingblog.com');
+    expect(record.contact_email).toBe('editor@tradingblog.com');
+    expect(record.contact_name).toBe('Alice');
+  });
+
+  test('status is "found"', () => {
+    const record = buildProspectRecord(PROSPECT_INPUT);
+    expect(record.status).toBe('found');
+  });
+
+  test('priority is a number between 0 and 100', () => {
+    const record = buildProspectRecord(PROSPECT_INPUT);
+    expect(typeof record.priority).toBe('number');
+    expect(record.priority).toBeGreaterThanOrEqual(0);
+    expect(record.priority).toBeLessThanOrEqual(100);
+  });
+
+  test('found_at is a valid ISO timestamp', () => {
+    const record = buildProspectRecord(PROSPECT_INPUT);
+    expect(() => new Date(record.found_at)).not.toThrow();
+    expect(new Date(record.found_at).toISOString()).toBe(record.found_at);
+  });
+
+  test('handles missing fields with safe defaults', () => {
+    const record = buildProspectRecord({});
+    expect(record.domain).toBe('');
+    expect(record.site_name).toBe('');
+    expect(record.contact_email).toBe('');
+    expect(record.domain_authority).toBe(0);
+    expect(record.status).toBe('found');
+  });
+});
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/send-outreach.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/send-outreach.test.js
new file mode 100644
index 0000000..6e7abff
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/send-outreach.test.js
@@ -0,0 +1,299 @@
+'use strict';
+
+const {
+  selectProspects,
+  buildEmailPrompt,
+  validateEmail,
+  buildSendPayload,
+  buildFollowUpPrompt,
+  checkForFollowUps,
+  logEmail,
+  BANNED_PHRASES,
+} = require('../../n8n/code/insiderbuying/send-outreach');
+
+// ─── selectProspects ──────────────────────────────────────────────────────
+
+describe('selectProspects()', () => {
+  const PROSPECTS = [
+    { status: 'found', contact_email: 'a@example.com', priority: 80 },
+    { status: 'found', contact_email: 'b@example.com', priority: 90 },
+    { status: 'sent',  contact_email: 'c@example.com', priority: 95 },
+    { status: 'found', contact_email: '',              priority: 70 },
+    { status: 'found', contact_email: 'd@example.com', priority: 60 },
+  ];
+
+  test('returns only prospects with status "found" and a non-empty email', () => {
+    const result = selectProspects(PROSPECTS);
+    result.forEach((p) => {
+      expect(p.status).toBe('found');
+      expect(p.contact_email.length).toBeGreaterThan(0);
+    });
+  });
+
+  test('sorts by priority descending', () => {
+    const result = selectProspects(PROSPECTS);
+    for (let i = 1; i < result.length; i++) {
+      expect(result[i - 1].priority).toBeGreaterThanOrEqual(result[i].priority);
+    }
+  });
+
+  test('respects limit parameter', () => {
+    const result = selectProspects(PROSPECTS, 2);
+    expect(result.length).toBeLessThanOrEqual(2);
+  });
+
+  test('defaults limit to 10', () => {
+    const many = Array.from({ length: 20 }, (_, i) => ({
+      status: 'found', contact_email: `e${i}@x.com`, priority: i,
+    }));
+    expect(selectProspects(many).length).toBeLessThanOrEqual(10);
+  });
+
+  test('handles null/empty input gracefully', () => {
+    expect(selectProspects(null)).toEqual([]);
+    expect(selectProspects([])).toEqual([]);
+  });
+});
+
+// ─── buildEmailPrompt ─────────────────────────────────────────────────────
+
+describe('buildEmailPrompt()', () => {
+  const PROSPECT = {
+    contact_name: 'Jane Smith',
+    site_name: 'FinanceBlog',
+    domain: 'financeblog.com',
+    notes: 'Covers insider trading analysis',
+  };
+  const ARTICLE = {
+    title: 'Why Insiders Are Buying AAPL',
+    url: 'https://earlyinsider.com/articles/aapl',
+    summary: 'Strong insider conviction in AAPL this quarter.',
+  };
+
+  test('returns object with prompt and maxTokens', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result).toHaveProperty('prompt');
+    expect(result).toHaveProperty('maxTokens');
+  });
+
+  test('prompt includes contact name and site name', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result.prompt).toContain('Jane Smith');
+    expect(result.prompt).toContain('FinanceBlog');
+  });
+
+  test('prompt includes article title', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result.prompt).toContain(ARTICLE.title);
+  });
+
+  // GAP 12.14 — prompt must not include the article URL
+  test('GAP 12.14: prompt does NOT contain the article URL', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result.prompt).not.toContain('https://');
+    expect(result.prompt).not.toContain(ARTICLE.url);
+  });
+
+  test('GAP 12.14: prompt does not contain any http:// or https:// pattern', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result.prompt).not.toMatch(/https?:\/\//);
+  });
+
+  test('maxTokens is in a reasonable range (100-500)', () => {
+    const result = buildEmailPrompt(PROSPECT, ARTICLE);
+    expect(result.maxTokens).toBeGreaterThanOrEqual(100);
+    expect(result.maxTokens).toBeLessThanOrEqual(500);
+  });
+
+  test('handles missing article url gracefully — does not throw', () => {
+    const articleNoUrl = { title: 'Test Article', summary: 'Summary here.' };
+    expect(() => buildEmailPrompt(PROSPECT, articleNoUrl)).not.toThrow();
+  });
+});
+
+// ─── validateEmail ────────────────────────────────────────────────────────
+
+describe('validateEmail()', () => {
+  const VALID_EMAIL =
+    'Subject: AAPL insider data you might find useful\n\n'
+    + 'Quick note — I tracked an unusual cluster of AAPL buys by C-suite last month. '
+    + 'Would you be interested in a guest post covering the full pattern? '
+    + 'Happy to send the draft over if so.';
+
+  test('returns valid:true for a clean email under 150 words', () => {
+    const result = validateEmail(VALID_EMAIL);
+    expect(result.valid).toBe(true);
+    expect(result.issues).toHaveLength(0);
+  });
+
+  test('returns wordCount in result', () => {
+    const result = validateEmail(VALID_EMAIL);
+    expect(typeof result.wordCount).toBe('number');
+    expect(result.wordCount).toBeGreaterThan(0);
+  });
+
+  test('flags email over 150 words', () => {
+    const long = Array(160).fill('word').join(' ');
+    const result = validateEmail(long);
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('150'))).toBe(true);
+  });
+
+  test('flags banned phrases', () => {
+    const result = validateEmail('I hope this finds you. Would you be interested in a collaboration?');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('banned'))).toBe(true);
+  });
+
+  test('flags email with no CTA', () => {
+    const result = validateEmail('AAPL insiders bought a lot last month. That is interesting.');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('cta'))).toBe(true);
+  });
+
+  test('returns { valid: false } for null/empty input', () => {
+    expect(validateEmail(null).valid).toBe(false);
+    expect(validateEmail('').valid).toBe(false);
+  });
+
+  test('result always has issues array', () => {
+    expect(Array.isArray(validateEmail(VALID_EMAIL).issues)).toBe(true);
+    expect(Array.isArray(validateEmail(null).issues)).toBe(true);
+  });
+});
+
+// ─── buildSendPayload ─────────────────────────────────────────────────────
+
+describe('buildSendPayload()', () => {
+  test('returns object with from, to, subject, html, text fields', () => {
+    const payload = buildSendPayload('to@example.com', 'Subject here', 'Body text', 'from@example.com');
+    expect(payload).toHaveProperty('from');
+    expect(payload).toHaveProperty('to');
+    expect(payload).toHaveProperty('subject');
+    expect(payload).toHaveProperty('html');
+    expect(payload).toHaveProperty('text');
+  });
+
+  test('to field matches input', () => {
+    const payload = buildSendPayload('to@example.com', 'Subject', 'Body', 'from@example.com');
+    expect(payload.to).toBe('to@example.com');
+  });
+
+  test('text field matches raw body', () => {
+    const payload = buildSendPayload('to@x.com', 'S', 'My body text', 'from@x.com');
+    expect(payload.text).toBe('My body text');
+  });
+
+  test('html field wraps lines in <p> tags', () => {
+    const payload = buildSendPayload('t@x.com', 'S', 'Line one\nLine two', 'f@x.com');
+    expect(payload.html).toContain('<p>');
+  });
+});
+
+// ─── buildFollowUpPrompt ─────────────────────────────────────────────────
+
+describe('buildFollowUpPrompt()', () => {
+  const PROSPECT = { contact_name: 'Bob', site_name: 'TradingBlog', domain: 'tradingblog.com' };
+  const SUBJECT = 'AAPL insider conviction last month';
+
+  test('returns object with prompt and maxTokens', () => {
+    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
+    expect(result).toHaveProperty('prompt');
+    expect(result).toHaveProperty('maxTokens');
+  });
+
+  test('prompt includes the original subject line', () => {
+    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
+    expect(result.prompt).toContain(SUBJECT);
+  });
+
+  test('prompt includes the contact name', () => {
+    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
+    expect(result.prompt).toContain('Bob');
+  });
+
+  test('maxTokens is reasonable (50-300)', () => {
+    const result = buildFollowUpPrompt(PROSPECT, SUBJECT);
+    expect(result.maxTokens).toBeGreaterThanOrEqual(50);
+    expect(result.maxTokens).toBeLessThanOrEqual(300);
+  });
+});
+
+// ─── checkForFollowUps ────────────────────────────────────────────────────
+
+describe('checkForFollowUps()', () => {
+  const OLD_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
+  const RECENT_DATE = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
+
+  test('returns empty array for null/empty logs', () => {
+    expect(checkForFollowUps(null)).toEqual([]);
+    expect(checkForFollowUps([])).toEqual([]);
+  });
+
+  test('returns prospect ID when initial was sent over threshold days ago', () => {
+    const logs = [{ email_type: 'initial', prospect_id: 'p1', sent_at: OLD_DATE }];
+    const result = checkForFollowUps(logs, 5);
+    expect(result).toContain('p1');
+  });
+
+  test('does not return prospect if followup already sent', () => {
+    const logs = [
+      { email_type: 'initial', prospect_id: 'p1', sent_at: OLD_DATE },
+      { email_type: 'followup', prospect_id: 'p1', sent_at: OLD_DATE },
+    ];
+    expect(checkForFollowUps(logs, 5)).not.toContain('p1');
+  });
+
+  test('does not return prospect if initial was sent recently (under threshold)', () => {
+    const logs = [{ email_type: 'initial', prospect_id: 'p2', sent_at: RECENT_DATE }];
+    expect(checkForFollowUps(logs, 5)).not.toContain('p2');
+  });
+});
+
+// ─── logEmail ─────────────────────────────────────────────────────────────
+
+describe('logEmail()', () => {
+  test('returns flat object — no { fields: {} } wrapper', () => {
+    const record = logEmail('p1', 'initial');
+    expect(record.fields).toBeUndefined();
+  });
+
+  test('includes prospect_id field', () => {
+    const record = logEmail('p1', 'initial');
+    expect(record.prospect_id).toBe('p1');
+  });
+
+  test('includes email_type field', () => {
+    const record = logEmail('p1', 'followup');
+    expect(record.email_type).toBe('followup');
+  });
+
+  test('status is "sent"', () => {
+    expect(logEmail('p1', 'initial').status).toBe('sent');
+  });
+
+  test('sent_at is a valid ISO timestamp', () => {
+    const record = logEmail('p1', 'initial');
+    expect(() => new Date(record.sent_at)).not.toThrow();
+    expect(new Date(record.sent_at).toISOString()).toBe(record.sent_at);
+  });
+
+  test('defaults email_type to "initial" when not provided', () => {
+    const record = logEmail('p1');
+    expect(record.email_type).toBe('initial');
+  });
+});
+
+// ─── BANNED_PHRASES ───────────────────────────────────────────────────────
+
+describe('BANNED_PHRASES', () => {
+  test('is a non-empty array', () => {
+    expect(Array.isArray(BANNED_PHRASES)).toBe(true);
+    expect(BANNED_PHRASES.length).toBeGreaterThan(0);
+  });
+
+  test('contains classic template phrases', () => {
+    expect(BANNED_PHRASES.some((p) => p.toLowerCase().includes('hope this finds'))).toBe(true);
+    expect(BANNED_PHRASES.some((p) => p.toLowerCase().includes('reaching out'))).toBe(true);
+  });
+});
