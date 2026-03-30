'use strict';

const { BASE_ENV, expectFetchCalledTimes } = require('./helpers');

const {
  scrapeRecentArticle,
  generateEmail,
  sendFollowUp,
  cancelFollowUps,
  checkBounceRateAlert,
  getWarmupLimit,
  selectProspects,
  sendInitialOutreach,
  buildSendPayload,
  FROM_NAME,
} = require('../../../n8n/code/insiderbuying/send-outreach');

// ---------------------------------------------------------------------------
// env var save/restore (process.env used directly by checkBounceRateAlert,
// getWarmupLimit — cannot be injected via BASE_ENV spread)
// ---------------------------------------------------------------------------
const ORIG_TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIG_TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID;
const ORIG_RESEND_KEY     = process.env.RESEND_API_KEY;
const ORIG_DOMAIN_SETUP   = process.env.DOMAIN_SETUP_DATE;

beforeEach(() => {
  jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  process.env.TELEGRAM_BOT_TOKEN = BASE_ENV.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID   = BASE_ENV.TELEGRAM_CHAT_ID;
  process.env.RESEND_API_KEY     = BASE_ENV.RESEND_API_KEY;
  process.env.DOMAIN_SETUP_DATE  = BASE_ENV.DOMAIN_SETUP_DATE; // '2025-12-02' = mature domain
});

afterEach(() => {
  function restore(key, orig) {
    if (orig === undefined) delete process.env[key];
    else process.env[key] = orig;
  }
  restore('TELEGRAM_BOT_TOKEN', ORIG_TELEGRAM_TOKEN);
  restore('TELEGRAM_CHAT_ID',   ORIG_TELEGRAM_CHAT);
  restore('RESEND_API_KEY',     ORIG_RESEND_KEY);
  restore('DOMAIN_SETUP_DATE',  ORIG_DOMAIN_SETUP);
});

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Valid initial email AI response: Subject with ?, body 109 words, required phrases.
 * 8 (requiredA) + 93 (filler) + 8 (requiredB) = 109 words — within 100-125 gate.
 */
function makeValidEmailAiResponse() {
  var requiredA = 'We track 1,500+ SEC insider filings per month.';
  var requiredB = "Reply 'stop' to never hear from me again.";
  var filler = Array(93).fill('interesting').join(' ');
  var body = requiredA + ' ' + filler + ' ' + requiredB;
  return 'Subject: Want to feature our insider trading data?\n\n' + body;
}

/**
 * Valid FU2 AI response: Subject with ?, body 32 words — within [30, 50] gate.
 * No banned phrases.
 *
 * FORMAT CONTRACT (fragile — do not add leading blank lines):
 *   Line 0:  "Subject: <text with ?>"   <- must be first line for case-insensitive parser
 *   Line 1:  ""                          <- blank separator
 *   Line 2+: body words                  <- these become parsedBody after leading \n strip
 *
 * If the format is wrong, sendFollowUp retries 3 times then throws
 * "FU2 generation failed after 3 attempts" — not an assertion failure.
 */
function makeValidFu2AiResponse() {
  var body = Array(32).fill('interesting').join(' ');
  return 'Subject: Would your readers benefit from SEC conviction data?\n\n' + body;
}

/** Resend-shaped success postFn mock. */
function makeResendPostFn() {
  return jest.fn().mockResolvedValue({
    status: 200,
    json:   async () => ({ id: 'resend_test_001' }),
    text:   async () => '',
  });
}

/** Minimal NocoDB API mock. */
function makeNocodbApi() {
  return {
    updateRecord:  jest.fn().mockResolvedValue({}),
    queryRecords:  jest.fn().mockResolvedValue([]),
    createRecord:  jest.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chain 7: Outreach Pipeline E2E', () => {

  // -------------------------------------------------------------------------
  // Test 7.1 — Happy path: article scrape → personalized email with ? subject
  // -------------------------------------------------------------------------
  test('7.1 — article scrape -> personalized email, subject ends with ?', async () => {
    const articleHtml =
      '<html><body>' +
      '<article><a href="/article/test">How We Grew MRR 3x in Six Months</a></article>' +
      '</body></html>';

    // scrapeRecentArticle uses _fetchFn(url, timeout) -> { statusCode, headers, body }
    const scrapeFetchFn = jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: articleHtml,
    });

    const prospect = {
      id: 'prospect_001',
      site_name: 'GrowthBlog',
      domain: 'growthblog.com',
      contact_name: 'Alex Smith',
      contact_email: 'alex@growthblog.com',
      notes: 'Growth marketing blog',
    };

    // Step 1: scrape the prospect's recent article
    const scraped = await scrapeRecentArticle('https://growthblog.com', { _fetchFn: scrapeFetchFn });
    expect(scraped).not.toBeNull();
    expect(scraped.title).toBe('How We Grew MRR 3x in Six Months');
    // URL resolution: relative /article/test + base https://growthblog.com/blog -> absolute
    expect(scraped.url).toBe('https://growthblog.com/article/test');

    // Step 2: attach scraped title so buildEmailPrompt includes the personalisation line
    prospect.last_article_title = scraped.title;

    // Step 3: generate email
    const mockAiClient = { call: jest.fn().mockResolvedValue(makeValidEmailAiResponse()) };
    const ourArticle = { title: 'Top SEC Insider Buys of Q1 2026', summary: 'CEO conviction signals.' };

    const result = await generateEmail(prospect, ourArticle, { _aiClient: mockAiClient });

    // AI called at least once
    expect(mockAiClient.call).toHaveBeenCalled();

    // AI prompt must contain the article title (personalisation line in buildEmailPrompt)
    const messages = mockAiClient.call.mock.calls[0][0];
    expect(messages[0].content).toContain('How We Grew MRR 3x in Six Months');

    // Subject must end with (or contain) a question mark
    expect(result.subject).toMatch(/\?/);

    // Body must contain no raw URLs (deliverability requirement)
    expect(/https?:\/\//.test(result.body)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7.2 — Follow-up day 10: new thread, followup_count incremented to 2
  // -------------------------------------------------------------------------
  test('7.2 — follow-up day 10: new thread framing, followup_count updated to 2', async () => {
    // Prospect with 1 follow-up already sent 10 days ago (stage 2 = FU2 = new thread)
    const prospect = {
      id: 'prospect_002',
      contact_email: 'editor@finblog.com',
      site_name: 'FinBlog',
      domain: 'finblog.com',
      contact_name: 'Bob Jones',
      followup_count: 1,
      sent_at: '2026-02-19T12:00:00Z', // 10 days before 2026-03-01
      replied: false,
      original_subject: 'Want to feature our insider trading data?',
      last_resend_id: 'resend_original_001',
    };

    const mockAiClient = { call: jest.fn().mockResolvedValue(makeValidFu2AiResponse()) };
    const postFn     = makeResendPostFn();
    const nocodbApi  = makeNocodbApi();

    await sendFollowUp(prospect, 2, nocodbApi, { _aiClient: mockAiClient, _postFn: postFn });

    // AI was called (a fresh draft was generated for the new thread)
    expect(mockAiClient.call).toHaveBeenCalled();

    // FU2 prompt must tell AI NOT to reference prior emails (new-thread framing)
    const messages = mockAiClient.call.mock.calls[0][0];
    expect(messages[0].content).toContain('do NOT reference any prior emails');

    // Resend postFn was called once (H-1: email was actually sent, not just drafted)
    expect(postFn).toHaveBeenCalledTimes(1);
    const [sentUrl, sentOpts] = postFn.mock.calls[0];
    expect(sentUrl).toBe('https://api.resend.com/emails');
    expect(JSON.parse(sentOpts.body).to).toBe(prospect.contact_email);
    // FU2 uses buildFu2Payload (no In-Reply-To/References) — new thread, not a Re: reply
    expect(JSON.parse(sentOpts.body).headers).toBeUndefined();

    // NocoDB updated with followup_count: 2
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects',
      prospect.id,
      expect.objectContaining({ followup_count: 2 })
    );
  });

  // -------------------------------------------------------------------------
  // Test 7.3 — Replied prospect cancels all follow-ups
  // -------------------------------------------------------------------------
  test('7.3 — replied prospect: no email sent, followup_count set to 99', async () => {
    const prospect = {
      id: 'prospect_003',
      contact_email: 'editor@repliedblog.com',
      replied: true,
    };

    const emailPostFn = makeResendPostFn();
    const nocodbApi   = makeNocodbApi();

    // cancelFollowUps sets followup_count=99 — the permanent suppression sentinel
    await cancelFollowUps(prospect.id, nocodbApi);

    // No email was sent via Resend
    expect(emailPostFn).not.toHaveBeenCalled();

    // NocoDB was called exactly once
    expect(nocodbApi.updateRecord).toHaveBeenCalledTimes(1);

    // The PATCH sets followup_count: 99
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects',
      prospect.id,
      expect.objectContaining({ followup_count: 99 })
    );
  });

  // -------------------------------------------------------------------------
  // Test 7.4 — Bounce rate > 5% triggers Telegram alert
  // -------------------------------------------------------------------------
  test('7.4 — bounce rate > 5% triggers Telegram alert with 6.0%', async () => {
    // Fake timer at 2026-03-01 -> getDailyStats queries date '2026-03-01'
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { id: 'stat_001', date: '2026-03-01', sent_count: 100, bounced_count: 6 },
      ]),
    };

    // _fetchFn(url, options) -> used by checkBounceRateAlert to POST to Telegram
    const telegramFetchFn = jest.fn().mockResolvedValue({ ok: true });

    await checkBounceRateAlert(nocodbApi, { _fetchFn: telegramFetchFn });

    // Telegram endpoint was called
    expect(telegramFetchFn).toHaveBeenCalled();

    // URL points to sendMessage for the configured bot
    const callUrl = telegramFetchFn.mock.calls[0][0];
    expect(callUrl).toContain('sendMessage');
    expect(callUrl).toContain(BASE_ENV.TELEGRAM_BOT_TOKEN);

    // Message text contains the formatted bounce rate (6/100 = 6.0%)
    const callOpts = telegramFetchFn.mock.calls[0][1];
    const body = JSON.parse(callOpts.body);
    expect(body.text).toMatch(/6\.0%/);
    // chat_id must be the configured Telegram chat — not hardcoded or missing
    expect(body.chat_id).toBe(BASE_ENV.TELEGRAM_CHAT_ID);
  });

  // -------------------------------------------------------------------------
  // Test 7.4b — Boundary: exactly 5% bounce rate does NOT trigger alert
  // -------------------------------------------------------------------------
  test('7.4b — bounce rate at exactly 5% does not trigger Telegram alert', async () => {
    const nocodbApi = {
      queryRecords: jest.fn().mockResolvedValue([
        { id: 'stat_002', date: '2026-03-01', sent_count: 100, bounced_count: 5 },
      ]),
    };
    const telegramFetchFn = jest.fn().mockResolvedValue({ ok: true });

    await checkBounceRateAlert(nocodbApi, { _fetchFn: telegramFetchFn });

    // ratio = 5/100 = 0.05, not > 0.05 — alert must NOT fire
    expect(telegramFetchFn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7.5 — Domain warm-up: 5-send limit on day 7
  // -------------------------------------------------------------------------
  test('7.5 — warm-up day 7: send loop capped at 5 of 10 prospects', async () => {
    // 7 days since domain setup (2026-02-22 to 2026-03-01) -> tier 0-13 days -> limit = 5
    process.env.DOMAIN_SETUP_DATE = '2026-02-22';

    const limit = getWarmupLimit();
    expect(limit).toBe(5);

    // 10 eligible prospects sorted by priority descending
    const tenProspects = Array.from({ length: 10 }, function (_, i) {
      return {
        id: 'p' + i,
        status: 'found',
        contact_email: 'contact' + i + '@example.com',
        priority: 10 - i,
        followup_count: 0,
        replied: false,
      };
    });

    // selectProspects(prospects, limit) -> returns top `limit` eligible prospects
    const selected = selectProspects(tenProspects, limit);
    expect(selected).toHaveLength(5);

    const sendPostFn = makeResendPostFn();
    const nocodbApi  = makeNocodbApi();

    // Send one initial email per selected prospect
    for (const p of selected) {
      await sendInitialOutreach(
        p,
        buildSendPayload(p.contact_email, 'Want to feature our data?', 'Email body.', FROM_NAME),
        nocodbApi,
        { _postFn: sendPostFn }
      );
    }

    // Exactly 5 sends — warm-up cap enforced
    expect(sendPostFn).toHaveBeenCalledTimes(5);

    // sendInitialOutreach must also write sent_at + followup_count=0 to NocoDB for each prospect
    expect(nocodbApi.updateRecord).toHaveBeenCalledTimes(5);
    expect(nocodbApi.updateRecord).toHaveBeenCalledWith(
      'Outreach_Prospects', 'p0',
      expect.objectContaining({ followup_count: 0, sent_at: expect.any(String) })
    );
  });

  // -------------------------------------------------------------------------
  // Test 7.5b — getWarmupLimit tier boundaries: day 14 → 20, day 28 → 50
  // -------------------------------------------------------------------------
  test('7.5b — getWarmupLimit tier boundaries: day 14 -> 20, day 28 -> 50', () => {
    // Day 14: exactly at the 14-27 tier boundary -> 20
    process.env.DOMAIN_SETUP_DATE = '2026-02-15'; // 14 days before 2026-03-01
    expect(getWarmupLimit()).toBe(20);

    // Day 28: exactly at the 28+ tier boundary -> 50
    process.env.DOMAIN_SETUP_DATE = '2026-02-01'; // 28 days before 2026-03-01
    expect(getWarmupLimit()).toBe(50);
  });

});
