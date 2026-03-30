'use strict';

const { BASE_ENV, makeRouter, expectFetchCalledTimes } = require('./helpers');

const {
  filterRelevant,
  draftReply,
  buildFilingContext,
  buildReplyPrompt,
  validateReply,
  selectArchetype,
  checkDailyReplyCap,
} = require('../../../n8n/code/insiderbuying/x-engagement');

const {
  postToX,
} = require('../../../n8n/code/insiderbuying/x-auto-post');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Tweet with valid user — passes all filterRelevant checks.
// Fake timers frozen at 2026-03-01T12:00:00Z; MIN_ACCOUNT_AGE_DAYS = 30
// → created_at must be before 2026-01-30. Using 2025-09-01 (181 days prior).
const VALID_TWEET = {
  id: 'tweet_001',
  text: 'Just saw $NVDA insider activity — CEO bought huge. What do you all think?',
  user: {
    screen_name: 'someuser',
    followers_count: 150,
    following_count: 80,
    created_at: '2025-09-01T00:00:00Z',
  },
};

// Tweet from a user whose account is only 15 days old — fails age check.
const BOT_TWEET = {
  id: 'tweet_002',
  text: '$NVDA moving big today, what is going on?',
  user: {
    screen_name: 'newaccount',
    followers_count: 50,
    following_count: 50,
    created_at: '2026-02-14T00:00:00Z', // 15 days before 2026-03-01
  },
};

// NocoDB-style filing records for NVDA
const MOCK_FILINGS = [
  {
    ticker: 'NVDA',
    insider_name: 'Jensen Huang',
    insider_role: 'CEO',
    transaction_value: 5000000,
    transaction_date: '2026-02-15',
    price_at_purchase: 134,
    historical_return: '+18% avg 90 days',
  },
];

// A valid reply: 196 chars, has $NVDA cashtag, no links, zero emojis.
// Verified against validateReply rules (150-220 chars, <=2 emojis, no links, has cashtag).
const VALID_REPLY = '$NVDA CEO Jensen Huang purchased $5M worth of shares on Feb 15, 2026 at $134 per share. This is the third insider cluster buy in 60 days. Historical track record shows +18% average 90-day returns.';

// Anthropic API response shape expected by _aiClient.claude()
function makeAnthropicResponse(text) {
  return {
    id: 'msg_test_001',
    content: [{ type: 'text', text: text }],
    usage: { input_tokens: 200, output_tokens: 50 },
  };
}

// ---------------------------------------------------------------------------
// Static validation — VALID_REPLY must pass all rules before running tests
// ---------------------------------------------------------------------------
describe('VALID_REPLY fixture pre-check', () => {
  it('VALID_REPLY satisfies validateReply rules', () => {
    const result = validateReply(VALID_REPLY);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('X Pipeline E2E (Chain 4)', () => {

  // -------------------------------------------------------------------------
  // Test 4.1 — Happy path: filterRelevant → draftReply → buildReplyPrompt → validateReply
  // -------------------------------------------------------------------------
  describe('Test 4.1 - happy path: filter → draft → validate chain', () => {
    it('chains filterRelevant, draftReply prompt builder, buildReplyPrompt AI caller, and validateReply', async () => {
      // -- Stage 1: filterRelevant (sync) --
      const relevant = filterRelevant([VALID_TWEET]);
      expect(relevant).toHaveLength(1);
      expect(relevant[0].id).toBe('tweet_001');

      // -- Stage 2: draftReply (sync prompt builder, NOT an AI caller) --
      const { prompt, maxTokens } = draftReply(relevant[0]);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      // Prompt must mention the original tweet text and the author handle
      expect(prompt).toContain(VALID_TWEET.text);
      expect(prompt).toContain(VALID_TWEET.user.screen_name);
      expect(typeof maxTokens).toBe('number');
      expect(maxTokens).toBeGreaterThan(0);

      // -- Stage 3: buildFilingContext (sync) --
      const filingCtx = buildFilingContext(relevant[0], MOCK_FILINGS);
      expect(filingCtx).not.toBeNull();
      expect(filingCtx.ticker).toBe('NVDA');
      expect(filingCtx.insiderName).toBe('Jensen Huang');

      // -- Stage 4: buildReplyPrompt (async AI caller via _aiClient.claude) --
      // makeRouter matches 'anthropic' → returns VALID_REPLY from Claude
      const fetchFn = makeRouter({ 'anthropic': makeAnthropicResponse(VALID_REPLY) });

      // selectArchetype with injected random=0 deterministically returns 'data_bomb'
      const archetype = selectArchetype(null, () => 0);
      expect(archetype).toBe('data_bomb');

      const reply = await buildReplyPrompt(archetype, relevant[0], filingCtx, {
        fetchFn: fetchFn,
        anthropicApiKey: BASE_ENV.ANTHROPIC_API_KEY,
      });

      expect(reply).toBe(VALID_REPLY);

      // Anthropic was called exactly once with filing context in the request body
      expectFetchCalledTimes(fetchFn, 1, 'buildReplyPrompt');
      const callBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      const userContent = callBody.messages[0].content;
      expect(userContent).toContain('NVDA');
      expect(userContent).toContain('Jensen Huang');
      // System prompt comes from the data_bomb archetype definition
      expect(callBody.system).toContain('data-driven');

      // -- Stage 5: validateReply (sync) --
      const validation = validateReply(reply);
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.2 — No matching filing → pipeline skip
  // -------------------------------------------------------------------------
  describe('Test 4.2 - no matching filing / bot filtering', () => {
    it('buildFilingContext returns null when no filing matches the tweet ticker', () => {
      const unknownTweet = Object.assign({}, VALID_TWEET, {
        id: 'tweet_003',
        text: 'What is going on with $ZZZZZ today? Big move!',
      });

      // Pass quality checks
      const relevant = filterRelevant([unknownTweet]);
      expect(relevant).toHaveLength(1);

      // buildFilingContext with empty filings → null stops the pipeline
      const filingCtx = buildFilingContext(relevant[0], []);
      expect(filingCtx).toBeNull();
      // Pipeline correctly cannot call buildReplyPrompt without a valid filingCtx
    });

    it('buildFilingContext returns null when filings array exists but has no matching ticker', () => {
      const aaaplTweet = Object.assign({}, VALID_TWEET, {
        text: 'Interesting $AAPL move today',
      });
      // MOCK_FILINGS only has NVDA
      const filingCtx = buildFilingContext(aaaplTweet, MOCK_FILINGS);
      expect(filingCtx).toBeNull();
    });

    it('filterRelevant removes accounts below follower minimum (< 10)', () => {
      const lowFollowerTweet = {
        id: 'tweet_low',
        text: '$NVDA insider buy!',
        user: {
          screen_name: 'newbie',
          followers_count: 5,  // below MIN_FOLLOWERS = 10
          following_count: 50,
          created_at: '2025-01-01T00:00:00Z',
        },
      };
      expect(filterRelevant([lowFollowerTweet])).toHaveLength(0);
    });

    it('filterRelevant removes accounts below following minimum (< 10)', () => {
      // C1: following_count guard is independent from followers_count guard
      const lowFollowingTweet = {
        id: 'tweet_lowfollowing',
        text: '$NVDA insider buy!',
        user: { screen_name: 'lurker', followers_count: 500, following_count: 5, created_at: '2025-01-01T00:00:00Z' },
      };
      expect(filterRelevant([lowFollowingTweet])).toHaveLength(0);
    });

    it('filterRelevant removes accounts created less than 30 days ago', () => {
      // BOT_TWEET created 2026-02-14 = 15 days before frozen clock 2026-03-01
      expect(filterRelevant([BOT_TWEET])).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.3 — postToX payload structure + daily cap
  // -------------------------------------------------------------------------
  describe('Test 4.3 - postToX payload and daily cap', () => {
    it('postToX returns correct Twitter API v2 payload structure without making HTTP calls', () => {
      const tweetText = '$NVDA CEO bought $5M — here is what the data says';
      const payload = postToX(tweetText);

      expect(payload.method).toBe('POST');
      expect(payload.url).toContain('api.twitter.com');
      expect(payload.url).toContain('/2/tweets');
      expect(payload.body.text).toBe(tweetText);
    });

    it('checkDailyReplyCap returns canReply=false when daily cap (15) is reached', () => {
      const logEntries = Array.from({ length: 15 }, function(_, i) {
        return { reply_id: 'reply_' + i, created_at: '2026-03-01T' + String(i).padStart(2, '0') + ':00:00Z' };
      });
      const result = checkDailyReplyCap(logEntries);
      expect(result.canReply).toBe(false);
      expect(result.repliesToday).toBe(15);
    });

    it('checkDailyReplyCap returns canReply=true when under daily cap', () => {
      const logEntries = [{ reply_id: 'r1' }, { reply_id: 'r2' }];
      const result = checkDailyReplyCap(logEntries);
      expect(result.canReply).toBe(true);
      expect(result.repliesToday).toBe(2);
    });

    it('validateReply rejects a reply missing a $CASHTAG', () => {
      // String is 165+ chars (>= 150 minimum) but has no cashtag — triggers cashtag rule, not length rule
      const noCashtag = 'CEO Jensen Huang purchased five million dollars worth of shares on Feb 15 at one hundred thirty four dollars per share. Historical track record shows strong returns over ninety days.';
      const result = validateReply(noCashtag);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/cashtag/i);
    });

    it('validateReply rejects a reply containing a URL', () => {
      // H2: URL guard — any of http, www., .com/ triggers the link rule
      const withUrl = '$NVDA CEO Jensen Huang purchased $5M on Feb 15. See full analysis at insider-tracker.com/nvda for historical comparison data from SEC Form 4 filings and 90-day return context.';
      const result = validateReply(withUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/link/i);
    });

    it('validateReply rejects a reply containing an AI refusal phrase', () => {
      // H2: AI refusal guard catches common LLM self-identification patterns
      const withRefusal = '$NVDA CEO Jensen Huang purchased $5M worth of shares on Feb 15. As an AI language model I cannot provide financial advice but this insider cluster buy shows strong historical returns.';
      const result = validateReply(withRefusal);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/AI refusal/i);
    });

    it('selectArchetype returns contrarian for r in [0.40, 0.70) range', () => {
      // M2: verify contrarian branch (weight 0.30, cumulative 0.40-0.70)
      expect(selectArchetype(null, () => 0.45)).toBe('contrarian');
    });

    it('selectArchetype returns pattern for r >= 0.70', () => {
      // M2: verify pattern branch (weight 0.30, cumulative 0.70-1.00)
      expect(selectArchetype(null, () => 0.75)).toBe('pattern');
    });
  });

});
