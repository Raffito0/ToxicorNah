'use strict';

const { BASE_ENV } = require('./helpers');

const {
  generateNewsletter,
  assembleFreeHtml,
  assembleProHtml,
  sendViaBeehiiv,
  sendWeeklyNewsletter,
  checkWordCount,
} = require('../../../n8n/code/insiderbuying/weekly-newsletter');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Generate N uniform words per section (all 7 keys), with sentinel strings so
// section content leakage into the wrong HTML tier is detectable.
function makeSections(wordsPerSection) {
  return {
    s1: 'S1SENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s2: 'S2SENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s3: 'S3SENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s4: 'S4SENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s5: 'S5SENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s6_free: 'S6FREESENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
    s6_pro: 'S6PROSENTINEL ' + 'word '.repeat(wordsPerSection - 1).trim(),
  };
}

// AI response shape expected by generateNewsletter (aiClient.complete returns { content })
function makeAiResponse(sections) {
  return {
    content: JSON.stringify({
      sections: sections,
      subjectA: 'The CEOs buying their own stock this week',
      subjectB: '5 insider buys you missed — one is up 18%',
    }),
  };
}

// Mock HTTP POST function expected by sendViaBeehiiv._postFn signature: (url, headers, bodyStr)
function makeBeehiivPostFn() {
  return jest.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ data: { status: 'confirmed', id: 'post_test_001' } }),
  });
}

// Mock newsletter input data
const MOCK_CONTENT = {
  topAlerts: [
    { ticker: 'NVDA', insider_name: 'Jensen Huang', total_value: 5000000, score: 9 },
    { ticker: 'META', insider_name: 'Mark Zuckerberg', total_value: 2000000, score: 7 },
  ],
  articles: [
    { headline: 'NVDA Insider Buying Signals Conviction', url: 'https://earlyinsider.com/a1', published_at: '2026-02-28' },
  ],
  performance: [{ ticker: 'NVDA', return_pct: 18.4, period: '30d' }],
  upcomingEarnings: [],
};

// ---------------------------------------------------------------------------
// Pre-check
// ---------------------------------------------------------------------------
describe('newsletter pipeline fixtures pre-check', () => {
  it('makeSections(180) produces 1080 words — within checkWordCount range [1000, 1400]', () => {
    const s = makeSections(180);
    // checkWordCount counts s1+s2+s3+s4+s5+max(s6_pro,s6_free)
    expect(() => checkWordCount(s)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Newsletter Pipeline E2E (Chain 6)', () => {

  // -------------------------------------------------------------------------
  // Test 6.1 — Happy path
  // -------------------------------------------------------------------------
  describe('Test 6.1 - happy path: generation, segmentation, delivery', () => {
    it('generateNewsletter returns all section keys and distinct subject lines', async () => {
      const sections = makeSections(180); // 1080 words, passes checkWordCount
      const mockAiClient = { complete: jest.fn().mockResolvedValue(makeAiResponse(sections)) };

      const result = await generateNewsletter(MOCK_CONTENT, { _aiClient: mockAiClient, _env: BASE_ENV });

      expect(result.subjectA).toBe('The CEOs buying their own stock this week');
      expect(result.subjectB).toBe('5 insider buys you missed — one is up 18%');
      expect(result.subjectA).not.toBe(result.subjectB);

      // All 7 section keys present and non-empty
      const REQUIRED_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6_free', 's6_pro'];
      for (const key of REQUIRED_KEYS) {
        expect(typeof result.sections[key]).toBe('string');
        expect(result.sections[key].length).toBeGreaterThan(0);
      }

      // AI was called exactly once
      expect(mockAiClient.complete).toHaveBeenCalledTimes(1);
    });

    it('assembleFreeHtml contains upgrade CTA and omits s4/s5 section headers and content', () => {
      const sections = makeSections(180);

      const html = assembleFreeHtml(sections, MOCK_CONTENT.topAlerts, 'Test Subject');

      // Hardcoded upgrade CTA in the template
      expect(html).toContain('Upgrade to Pro');
      expect(html).toMatch(/upgrade/i);

      // s1-s3 headers are present in free tier
      expect(html).toContain('Move of the Week');
      expect(html).toContain('Scorecard');

      // s4 and s5 section headers (h2) are NOT rendered in free tier
      // Note: section names appear in the upgrade CTA text but not as <h2> headings
      expect(html).not.toContain('<h2>Pattern Recognition</h2>');
      expect(html).not.toContain("<h2>What I'm Watching</h2>");

      // s4 and s5 sentinel content is not present in free tier HTML
      expect(html).not.toContain('S4SENTINEL');
      expect(html).not.toContain('S5SENTINEL');

      // Basic HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('EarlyInsider');
    });

    it('assembleProHtml contains referral block and all content section headers', () => {
      const sections = makeSections(180);

      const html = assembleProHtml(sections, MOCK_CONTENT.topAlerts, 'Test Subject');

      // Hardcoded referral block in the template
      expect(html).toContain('{{rp_refer_url}}');

      // All content sections present
      expect(html).toContain('Move of the Week');
      expect(html).toContain('Scorecard');
      expect(html).toContain('Pattern Recognition');
      expect(html).toContain("What I'm Watching");

      // Pro tier includes s4/s5 content
      expect(html).toContain('S4SENTINEL');
      expect(html).toContain('S5SENTINEL');

      // Basic HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('EarlyInsider');
    });

    it('pro HTML is longer than free HTML (has more sections)', () => {
      const sections = makeSections(180);
      const freeHtml = assembleFreeHtml(sections, [], 'Subject');
      const proHtml = assembleProHtml(sections, [], 'Subject');

      expect(proHtml.length).toBeGreaterThan(freeHtml.length);
    });

    it('sendViaBeehiiv is called twice with correct URL and payload structure', async () => {
      const sections = makeSections(180);
      const subjectA = 'The CEOs buying their own stock this week';
      const freeHtml = assembleFreeHtml(sections, [], subjectA);
      const proHtml = assembleProHtml(sections, [], subjectA);

      const beehiivPostFn = makeBeehiivPostFn();

      await Promise.all([
        sendViaBeehiiv(freeHtml, subjectA, 'free', { _postFn: beehiivPostFn, _env: BASE_ENV }),
        sendViaBeehiiv(proHtml, subjectA, 'pro', { _postFn: beehiivPostFn, _env: BASE_ENV }),
      ]);

      expect(beehiivPostFn).toHaveBeenCalledTimes(2);

      // Both calls target Beehiiv API with correct publication path
      const [call1, call2] = beehiivPostFn.mock.calls;
      expect(call1[0]).toContain('/v2/publications/pub_test_000/posts');
      expect(call2[0]).toContain('/v2/publications/pub_test_000/posts');

      // Authorization header is present on both calls
      expect(call1[1]).toEqual(expect.objectContaining({
        Authorization: 'Bearer test-beehiiv-key-000',
      }));
      expect(call2[1]).toEqual(expect.objectContaining({
        Authorization: 'Bearer test-beehiiv-key-000',
      }));

      // Payload shape: confirmed status, html content present
      const payload1 = JSON.parse(call1[2]);
      const payload2 = JSON.parse(call2[2]);
      expect(payload1.status).toBe('confirmed');
      expect(payload2.status).toBe('confirmed');
      expect(payload1.content_html).toBe(freeHtml);
      expect(payload2.content_html).toBe(proHtml);
      expect(payload1.email_subject_line).toBe(subjectA);
    });

    it('sendViaBeehiiv rejects when Beehiiv returns non-2xx and no resend fallback is provided', async () => {
      const sections = makeSections(180);
      const html = assembleFreeHtml(sections, [], 'Subject');
      const failPostFn = jest.fn().mockResolvedValue({
        status: 500,
        json: async () => ({}),
      });

      await expect(
        sendViaBeehiiv(html, 'Subject', 'free', { _postFn: failPostFn, _env: BASE_ENV }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Test 6.2 — Word count gate
  // -------------------------------------------------------------------------
  describe('Test 6.2 - word count gate', () => {
    it('checkWordCount throws /word count/i when total is < 1000 words', () => {
      // 50 words × 6 sections = 300 words — below 1000 minimum
      const shortSections = makeSections(50);
      expect(() => checkWordCount(shortSections)).toThrow(/word count/i);
    });

    it('checkWordCount passes without throwing for 1000-1400 words', () => {
      // 180 words × 6 sections = 1080 words — in valid range
      const validSections = makeSections(180);
      expect(() => checkWordCount(validSections)).not.toThrow();
    });

    it('checkWordCount throws /word count/i when total exceeds 1400 words', () => {
      // 250 words × 6 sections = 1500 words — above 1400 maximum
      const longSections = makeSections(250);
      expect(() => checkWordCount(longSections)).toThrow(/word count/i);
    });

    it('generateNewsletter with short AI response then fails checkWordCount when called by orchestrator', async () => {
      // Short sections: 30 words × 7 = 210 words total (fails < 1000 gate)
      const shortSections = makeSections(30);
      const mockAiClient = { complete: jest.fn().mockResolvedValue(makeAiResponse(shortSections)) };

      // generateNewsletter itself succeeds — it only validates section presence, not word count
      const result = await generateNewsletter(MOCK_CONTENT, { _aiClient: mockAiClient, _env: BASE_ENV });
      expect(result.sections).toBeDefined();

      // checkWordCount is the guard — it throws on the short sections
      expect(() => checkWordCount(result.sections)).toThrow(/word count/i);
    });

    it('sendWeeklyNewsletter rejects with word count error and Beehiiv is never called', async () => {
      // Orchestrator-level gate: if AI returns short copy, Beehiiv must NOT be called
      const shortSections = makeSections(30);
      const mockAiClient = { complete: jest.fn().mockResolvedValue(makeAiResponse(shortSections)) };
      const beehiivPostFn = makeBeehiivPostFn();
      const nocodbApi = { create: jest.fn(), list: jest.fn() };

      await expect(
        sendWeeklyNewsletter(nocodbApi, {
          _gatherFn: () => Promise.resolve(MOCK_CONTENT),
          _aiClient: mockAiClient,
          _postFn: beehiivPostFn,
          _env: BASE_ENV,
        }),
      ).rejects.toThrow(/word count/i);

      // Beehiiv must not have been called — gate must stop delivery
      expect(beehiivPostFn).toHaveBeenCalledTimes(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 6.3 — sendWeeklyNewsletter full orchestration
  // -------------------------------------------------------------------------
  describe('Test 6.3 - sendWeeklyNewsletter full orchestration', () => {
    it('happy path: runs generate → gates → assemble → sends × 2 → logs', async () => {
      const sections = makeSections(180);
      const mockAiClient = { complete: jest.fn().mockResolvedValue(makeAiResponse(sections)) };
      const beehiivPostFn = makeBeehiivPostFn();
      const nocodbApi = { create: jest.fn().mockResolvedValue({}), list: jest.fn() };

      await sendWeeklyNewsletter(nocodbApi, {
        _gatherFn: () => Promise.resolve(MOCK_CONTENT),
        _aiClient: mockAiClient,
        _postFn: beehiivPostFn,
        _env: BASE_ENV,
      });

      // AI called once, Beehiiv called twice (free + pro)
      expect(mockAiClient.complete).toHaveBeenCalledTimes(1);
      expect(beehiivPostFn).toHaveBeenCalledTimes(2);

      // NocoDB log was written
      expect(nocodbApi.create).toHaveBeenCalledTimes(1);
      expect(nocodbApi.create).toHaveBeenCalledWith('Newsletter_Sends', expect.objectContaining({
        send_path: 'beehiiv',
        subject_a: 'The CEOs buying their own stock this week',
      }));
    });
  });

});
