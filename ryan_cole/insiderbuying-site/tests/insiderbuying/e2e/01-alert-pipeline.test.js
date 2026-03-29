'use strict';

const { makeRouter, makeFetch, makeNoSleep, BASE_ENV, expectFetchCalledTimes,
  MOCK_RESEND_OK, MOCK_ONESIGNAL_OK } = require('./helpers');

const EDGAR_FIXTURE = require('./fixtures/edgar-rss-response.json');
const ANALYSIS_FIXTURE = require('./fixtures/claude-analysis-response.json');

const {
  buildEdgarUrl,
  parseEdgarResponse,
  isBuyTransaction,
  enrichFiling,
} = require('../../../n8n/code/insiderbuying/sec-monitor');

const { runScoreAlert } = require('../../../n8n/code/insiderbuying/score-alert');
const { analyze } = require('../../../n8n/code/insiderbuying/analyze-alert');
const { deliverAlert } = require('../../../n8n/code/insiderbuying/deliver-alert');
const { buildBreakingAlert } = require('../../../n8n/code/insiderbuying/x-auto-post');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Env extended with fields not in BASE_ENV that deliver-alert/score-alert reads
const TEST_ENV = Object.assign({}, BASE_ENV, {
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-000',
  DEEPSEEK_API_KEY: 'test-deepseek-key-000',
});

// NocoDB mock — computeTrackRecord + updateDeliveryStatus
function makeMockNocodb() {
  return {
    list: jest.fn().mockResolvedValue({ list: [] }),
    update: jest.fn().mockResolvedValue(null),
  };
}

// DeepSeek refinement response (adjustment=1 → raises base score by 1)
const DEEPSEEK_REFINEMENT = {
  choices: [{
    message: { content: '{"adjustment": 1, "reason": "CEO direct-market-purchase, large value, no 10b5-1 plan."}' },
  }],
  usage: { prompt_tokens: 150, completion_tokens: 25 },
};

// Financial Datasets enrichment response
const FD_ENRICHMENT = {
  insider_trades: [{
    name: EDGAR_FIXTURE.insider_name,
    title: EDGAR_FIXTURE.insider_title,
    is_board_director: false,
    transaction_date: EDGAR_FIXTURE.filing_date,
    transaction_shares: EDGAR_FIXTURE.shares,
    transaction_price_per_share: EDGAR_FIXTURE.price_per_share,
    transaction_value: EDGAR_FIXTURE.total_value,
    transaction_type: 'P - Purchase',
    filing_date: EDGAR_FIXTURE.filing_date,
  }],
};

// Supabase user preferences (one user with score threshold 8, matching our score)
const SUPABASE_PREFS = [
  { user_id: 'u1', min_significance_score: 8, watched_tickers: [] },
];
const SUPABASE_PROFILES = [
  { user_id: 'u1', subscription_tier: 'pro' },
];
const SUPABASE_USER = { user: { email: 'test@example.com' } };

// Build a scored filing directly (bypasses enrichFiling + score chain for
// tests that only need downstream stages)
function makeScoredFiling(overrides) {
  return Object.assign({
    ticker: EDGAR_FIXTURE.ticker,
    company_name: EDGAR_FIXTURE.company_name,
    insider_name: EDGAR_FIXTURE.insider_name,
    insider_title: EDGAR_FIXTURE.insider_title,
    transactionCode: 'P',
    transactionValue: EDGAR_FIXTURE.total_value,
    canonicalRole: 'CEO',
    is10b5Plan: false,
    filing_date: EDGAR_FIXTURE.filing_date,
    total_value: EDGAR_FIXTURE.total_value,
    transaction_type: 'P - Purchase',
    significance_score: 9,
    score_reasoning: 'CEO buy',
    dedup_key: `${EDGAR_FIXTURE.ticker}_JensenHuang_${EDGAR_FIXTURE.filing_date}_50000`,
  }, overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Alert Pipeline E2E (Chain 1)', () => {

  // -------------------------------------------------------------------------
  // Test 1.1 — Happy path: EDGAR → delivery
  // -------------------------------------------------------------------------
  describe('Test 1.1 - Happy path: EDGAR → delivery', () => {
    it('flows a CEO $5M buy through scoring, analysis, and delivery', async () => {
      const noSleep = makeNoSleep();

      // -- Stage 1: buildEdgarUrl + parseEdgarResponse --
      const url = buildEdgarUrl('2026-02-01', '2026-02-28');
      expect(typeof url).toBe('string');
      expect(url).toContain('sec.gov');

      const mockEdgarBody = {
        hits: {
          hits: [{
            _id: '0001045810-26-000001',
            _source: {
              entity_name: EDGAR_FIXTURE.company_name,
              file_date: EDGAR_FIXTURE.filing_date,
            },
          }],
        },
      };
      const parsedFilings = parseEdgarResponse(mockEdgarBody);
      expect(parsedFilings.length).toBe(1);
      expect(parsedFilings[0].entity_name).toBeTruthy();

      // -- Stage 2: enrichFiling --
      const enrichFetchFn = makeRouter({
        'financialdatasets': FD_ENRICHMENT,
      });
      const enriched = await enrichFiling(
        EDGAR_FIXTURE.ticker,
        EDGAR_FIXTURE.filing_date,
        { fetchFn: enrichFetchFn, apiKey: 'test-fd-key', _sleep: noSleep }
      );
      expect(enrichFetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
      // enrichFiling returns the enriched trade data or null if no coverage
      // Either way the chain can continue with a constructed filing
      const enrichedFiling = enriched || {};

      // -- Stage 3: runScoreAlert --
      const scoreFetchFn = makeRouter({
        'deepseek.com': DEEPSEEK_REFINEMENT,
      });
      const nocodb = makeMockNocodb();

      // Build filing with all required fields for scoring
      const filingForScore = Object.assign({
        ticker: EDGAR_FIXTURE.ticker,
        insider_name: EDGAR_FIXTURE.insider_name,
        insider_title: EDGAR_FIXTURE.insider_title,
        transactionCode: 'P',
        transactionValue: EDGAR_FIXTURE.total_value,
        canonicalRole: 'CEO',
        is10b5Plan: false,
        filing_date: EDGAR_FIXTURE.filing_date,
        total_value: EDGAR_FIXTURE.total_value,
        dedup_key: `${EDGAR_FIXTURE.ticker}_JensenHuang_${EDGAR_FIXTURE.filing_date}_50000`,
      }, enrichedFiling);

      const scoredFilings = await runScoreAlert([filingForScore], {
        fetchFn: scoreFetchFn,
        nocodb,
        deepseekApiKey: TEST_ENV.DEEPSEEK_API_KEY,
        _sleep: noSleep,
      });

      expect(Array.isArray(scoredFilings)).toBe(true);
      expect(scoredFilings.length).toBe(1);
      const scoredFiling = scoredFilings[0];
      expect(scoredFiling.significance_score).toBeGreaterThanOrEqual(8);

      // -- Stage 4: analyze --
      const analyzeFetchFn = makeRouter({
        'kie.ai': ANALYSIS_FIXTURE,
        'deepseek.com': ANALYSIS_FIXTURE,
      });

      const analysisText = await analyze(scoredFiling, {
        fetchFn: analyzeFetchFn,
        kieaiApiKey: 'test-kieai-key',
        deepSeekApiKey: TEST_ENV.ANTHROPIC_API_KEY,
        _sleep: noSleep,
      });

      // analyze returns text string directly (or null on failure)
      // With our mock it should return text from the fixture
      expect(analysisText).not.toBeNull();
      expect(analysisText).toMatch(/bought|purchased/i);
      expect(analysisText).toMatch(/last time|previous|track record/i);
      expect(analysisText).toMatch(/earnings|watch|catalyst/i);
      expect(analysisText.split(/\s+/).filter(Boolean).length).toBeGreaterThan(150);

      // -- Stage 5: deliverAlert --
      const deliverFetchFn = makeRouter({
        '/rest/v1/user_alert_preferences': SUPABASE_PREFS,
        '/rest/v1/profiles': SUPABASE_PROFILES,
        '/auth/v1/admin/users': SUPABASE_USER,
        'resend.com': { id: 'resend-msg-001' },
        'onesignal.com': { id: 'onesignal-notif-001', recipients: 1 },
      });

      // Construct alertData from scored filing + analysis
      const alertData = Object.assign({}, scoredFiling, {
        analysis_text: analysisText,
        supabase_alert_id: 'alert-uuid-001',
        nocodb_record_id: 'nocodb-rec-001',
      });

      const deliveryNocodb = makeMockNocodb();
      const deliveryResult = await deliverAlert(alertData, {
        fetchFn: deliverFetchFn,
        env: TEST_ENV,
        nocodb: deliveryNocodb,
        _sleep: noSleep,
      });

      expect(deliveryResult).toBeDefined();
      expect(deliveryResult.ticker).toBe(EDGAR_FIXTURE.ticker);
      expect(deliveryResult.status).toBe('delivered');
      // At least supabase preferences + onesignal = 2 fetch calls minimum
      expect(deliverFetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Test 1.2 — Gift transaction excluded
  // -------------------------------------------------------------------------
  describe('Test 1.2 - Gift transaction excluded', () => {
    it('isBuyTransaction returns false for gift code G', () => {
      expect(isBuyTransaction('G')).toBe(false);
    });

    it('gift filing never reaches enrichFiling', async () => {
      const noSleep = makeNoSleep();
      const enrichFetchFn = jest.fn();

      const giftFiling = { transactionType: 'G', ticker: 'NVDA', filing_date: '2026-02-15' };

      // Simulate pipeline guard: only call enrichFiling for buy transactions
      if (isBuyTransaction(giftFiling.transactionType)) {
        await enrichFiling(giftFiling.ticker, giftFiling.filing_date, {
          fetchFn: enrichFetchFn, apiKey: 'test-key', _sleep: noSleep,
        });
      }

      expectFetchCalledTimes(enrichFetchFn, 0, 'gift-filing-guard');
    });

    it('gift filing is filtered out by runScoreAlert', async () => {
      const noSleep = makeNoSleep();
      const scoreFetchFn = makeRouter({ 'deepseek.com': DEEPSEEK_REFINEMENT });
      const nocodb = makeMockNocodb();

      const giftFiling = {
        ticker: 'NVDA',
        insider_name: 'Jensen Huang',
        insider_title: 'CEO',
        transactionCode: 'G',
        transactionValue: 5_000_000,
        canonicalRole: 'CEO',
        is10b5Plan: false,
        filing_date: '2026-02-15',
        total_value: 5_000_000,
        dedup_key: 'NVDA_JensenHuang_2026-02-15_gift',
      };

      const result = await runScoreAlert([giftFiling], {
        fetchFn: scoreFetchFn,
        nocodb,
        deepseekApiKey: TEST_ENV.DEEPSEEK_API_KEY,
        _sleep: noSleep,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 1.3 — 10b5-1 hard cap
  // -------------------------------------------------------------------------
  describe('Test 1.3 - 10b5-1 hard cap', () => {
    it('10b5-1 filing is capped at significance_score <= 5', async () => {
      const noSleep = makeNoSleep();
      // Even if DeepSeek would return a high adjustment, the 10b5-1 cap fires first
      const scoreFetchFn = makeRouter({
        'deepseek.com': DEEPSEEK_REFINEMENT,
      });
      const nocodb = makeMockNocodb();

      const filing10b5 = {
        ticker: 'NVDA',
        insider_name: 'Jensen Huang',
        insider_title: 'CEO',
        transactionCode: 'P',
        transactionValue: 10_000_000,
        canonicalRole: 'CEO',
        is10b5Plan: true,
        filing_date: '2026-02-15',
        total_value: 10_000_000,
        dedup_key: 'NVDA_JensenHuang_2026-02-15_100000',
      };

      const scoredFilings = await runScoreAlert([filing10b5], {
        fetchFn: scoreFetchFn,
        nocodb,
        deepseekApiKey: TEST_ENV.DEEPSEEK_API_KEY,
        _sleep: noSleep,
      });

      expect(scoredFilings.length).toBe(1);
      expect(scoredFilings[0].significance_score).toBeLessThanOrEqual(5);
      // 10b5-1 cap fires before DeepSeek refinement — no AI call should have been made
      expectFetchCalledTimes(scoreFetchFn, 0, '10b5-no-ai');
    });
  });

  // -------------------------------------------------------------------------
  // Test 1.4 — High-score triggers X auto-post
  // -------------------------------------------------------------------------
  describe('Test 1.4 - High-score triggers X auto-post', () => {
    it('buildBreakingAlert returns a string with a cashtag', async () => {
      // Mock the DeepSeek API call inside buildBreakingAlert
      const TWEET_TEXT = `$NVDA INSIDER BUY: CEO purchases $5M. Watch for earnings beat catalyst. Key level: $100.`;
      const xFetchFn = makeRouter({
        'deepseek.com': {
          choices: [{ message: { content: TWEET_TEXT } }],
          usage: { prompt_tokens: 200, completion_tokens: 50 },
        },
      });

      const scoredFiling = makeScoredFiling({ significance_score: 9 });

      const tweetText = await buildBreakingAlert(
        {
          ticker: scoredFiling.ticker,
          insiderName: scoredFiling.insider_name,
          insiderRole: scoredFiling.insider_title,
          transactionValue: `$${(scoredFiling.total_value / 1_000_000).toFixed(1)}M`,
          transactionDate: scoredFiling.filing_date,
          priceAtPurchase: EDGAR_FIXTURE.price_per_share,
          trackRecord: null,
          clusterCount: 1,
        },
        { fetchFn: xFetchFn, deepseekApiKey: 'test-deepseek-key' }
      );

      expect(typeof tweetText).toBe('string');
      expect(tweetText).toMatch(/\$[A-Z]+/);
    });
  });

});
