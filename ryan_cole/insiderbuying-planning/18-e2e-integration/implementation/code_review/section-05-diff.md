diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js
new file mode 100644
index 0000000..f3182b9
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js
@@ -0,0 +1,226 @@
+'use strict';
+
+const { makeNoSleep, BASE_ENV, expectFetchCalledTimes } = require('./helpers');
+
+const {
+  buildSearchQueries,
+  buildCommentPrompt,
+  validateComment,
+  checkDailyCommentLimit,
+  REPLY_STRUCTURES,
+  SUBREDDIT_TONE_MAP,
+  _setDeps,
+} = require('../../../n8n/code/insiderbuying/reddit-monitor');
+
+// ---------------------------------------------------------------------------
+// Shared helpers
+// ---------------------------------------------------------------------------
+
+// A comment that satisfies validateComment: no URLs, no brand names, 3-5 sentences
+const VALID_COMMENT = 'Jensen Huang purchased $5M of NVDA shares last month per SEC Form 4 filings. '
+  + 'CEO buys of this size have historically preceded strong quarters for the company. '
+  + 'I found this while digging through EDGAR filings this week. '
+  + 'Curious to see how this plays out into earnings.';
+
+// A longer comment for ValueInvesting-style tests (4+ sentences, no URLs)
+const VALID_COMMENT_LONG = 'According to recent SEC Form 4 filings, the CEO of NVDA purchased 50,000 shares worth approximately $5 million. '
+  + 'This level of insider conviction is notable given the current valuation multiples in the semiconductor sector. '
+  + 'Historical analysis of similar executive purchases at NVDA shows positive stock performance over the following 6 months in 8 of the last 10 cases. '
+  + 'The transaction was a direct market purchase with no 10b5-1 plan designation, which historically signals higher conviction. '
+  + 'Worth monitoring alongside the next earnings release for context on management guidance.';
+
+// Claude API mock response factory
+function makeClaudeResponse(text) {
+  return {
+    content: [{ type: 'text', text: text }],
+    usage: { input_tokens: 100, output_tokens: 50 },
+  };
+}
+
+// Build a _setDeps fetch mock that routes by URL pattern
+function makeDepsFetch(claudeText) {
+  return jest.fn().mockImplementation(function(url) {
+    if (typeof url === 'string' && url.includes('anthropic.com')) {
+      var body = makeClaudeResponse(claudeText);
+      return Promise.resolve({
+        ok: true, status: 200,
+        json: function() { return body; },
+        text: function() { return JSON.stringify(body); },
+        headers: { get: function() { return 'application/json'; } },
+      });
+    }
+    // NocoDB state calls (getState/setState from getNextReplyStructure)
+    return Promise.resolve({
+      ok: true, status: 200,
+      json: function() { return { list: [] }; },
+      text: function() { return '{}'; },
+      headers: { get: function() { return 'application/json'; } },
+    });
+  });
+}
+
+// Build a mock post object for the reddit pipeline
+const MOCK_POST = {
+  title: 'NVDA up 5% — anyone tracking insiders?',
+  selftext: 'Curious about recent SEC filings. CEO seems bullish.',
+  subreddit: 'stocks',
+  score: 120,
+  name: 't3_abc123',
+};
+
+const MOCK_INSIDER_DATA = {
+  ticker: 'NVDA',
+  insider_name: 'Jensen Huang',
+  role: 'CEO',
+  transaction_type: 'purchased',
+  shares: 50000,
+  value_usd: 5000000,
+  date: '2026-02-15',
+};
+
+// ---------------------------------------------------------------------------
+// Tests
+// ---------------------------------------------------------------------------
+
+describe('Reddit Pipeline E2E (Chain 3)', () => {
+
+  afterEach(function() {
+    // Reset _deps to production fetch after each test
+    _setDeps(null);
+  });
+
+  // -------------------------------------------------------------------------
+  // Test 3.1 — Happy path: search → draft → validate chain
+  // -------------------------------------------------------------------------
+  describe('Test 3.1 - happy path: buildSearchQueries → buildCommentPrompt → validateComment', () => {
+    it('chains query construction, AI comment generation, and validation', async () => {
+      const noSleep = makeNoSleep();
+      const depsFetch = makeDepsFetch(VALID_COMMENT);
+      _setDeps({ fetch: depsFetch });
+
+      // -- Stage 1: buildSearchQueries --
+      const queries = buildSearchQueries(['NVDA', 'AAPL']);
+      expect(Array.isArray(queries)).toBe(true);
+      expect(queries.length).toBeGreaterThan(0);
+      // Custom ticker queries appended
+      expect(queries.some(q => q.includes('NVDA'))).toBe(true);
+
+      // -- Stage 2: buildCommentPrompt (calls Claude via _deps.fetch) --
+      const structure = REPLY_STRUCTURES[0];
+      const comment = await buildCommentPrompt(MOCK_POST, MOCK_INSIDER_DATA, 'stocks', structure);
+
+      expect(typeof comment).toBe('string');
+      expect(comment.length).toBeGreaterThan(0);
+      // Claude was called at least once
+      const anthropicCalls = depsFetch.mock.calls.filter(c => String(c[0]).includes('anthropic.com'));
+      expect(anthropicCalls.length).toBeGreaterThanOrEqual(1);
+
+      // -- Stage 3: validateComment --
+      const validation = validateComment(comment);
+      expect(validation.valid).toBe(true);
+      expect(validation.issues).toHaveLength(0);
+    });
+  });
+
+  // -------------------------------------------------------------------------
+  // Test 3.2 — Subreddit tone routing: WSB shorter than ValueInvesting
+  // -------------------------------------------------------------------------
+  describe('Test 3.2 - subreddit tone difference', () => {
+    it('WSB system prompt uses shorter word limit than ValueInvesting', async () => {
+      const callBodies = [];
+      const depsFetch = jest.fn().mockImplementation(function(url, opts) {
+        if (typeof url === 'string' && url.includes('anthropic.com')) {
+          if (opts && opts.body) callBodies.push(JSON.parse(opts.body));
+          // Return appropriate comment based on call order
+          const idx = callBodies.length - 1;
+          const text = idx === 0 ? VALID_COMMENT : VALID_COMMENT_LONG;
+          var body = makeClaudeResponse(text);
+          return Promise.resolve({
+            ok: true, status: 200,
+            json: function() { return body; },
+            text: function() { return JSON.stringify(body); },
+            headers: { get: function() { return null; } },
+          });
+        }
+        return Promise.resolve({
+          ok: true, status: 200,
+          json: function() { return { list: [] }; },
+          text: function() { return '{}'; },
+          headers: { get: function() { return null; } },
+        });
+      });
+      _setDeps({ fetch: depsFetch });
+
+      const wsbPost = Object.assign({}, MOCK_POST, { subreddit: 'wallstreetbets' });
+      const viPost = Object.assign({}, MOCK_POST, { subreddit: 'ValueInvesting' });
+      const structure = REPLY_STRUCTURES[0];
+
+      // Call both subreddits
+      await buildCommentPrompt(wsbPost, MOCK_INSIDER_DATA, 'wallstreetbets', structure);
+      await buildCommentPrompt(viPost, MOCK_INSIDER_DATA, 'ValueInvesting', structure);
+
+      expect(callBodies.length).toBe(2);
+
+      // WSB system prompt must contain shorter word limit
+      const wsbSystem = callBodies[0].system || '';
+      expect(wsbSystem).toContain('50-100 words');
+
+      // ValueInvesting system prompt must contain longer word limit
+      const viSystem = callBodies[1].system || '';
+      expect(viSystem).toContain('150-200 words');
+
+      // Confirm tone map word limits match what was sent
+      expect(SUBREDDIT_TONE_MAP.wallstreetbets.wordLimit[1]).toBeLessThanOrEqual(100);
+      expect(SUBREDDIT_TONE_MAP.ValueInvesting.wordLimit[0]).toBeGreaterThanOrEqual(150);
+    });
+  });
+
+  // -------------------------------------------------------------------------
+  // Test 3.3 — Daily cap enforcement: cap reached → no Reddit API call
+  // -------------------------------------------------------------------------
+  describe('Test 3.3 - daily cap enforcement', () => {
+    it('returns allowed:false and makes no Reddit API call when daily cap is reached', async () => {
+      // Simulate 10 already-posted comments today (global cap is 10)
+      const postedLogs = Array.from({ length: 10 }, function(_, i) {
+        return { subreddit: 'stocks', status: 'posted', posted_at: '2026-03-01T' + String(i).padStart(2, '0') + ':00:00Z' };
+      });
+      const logResponse = { list: postedLogs };
+
+      const depsFetch = jest.fn().mockResolvedValue({
+        ok: true, status: 200,
+        json: function() { return logResponse; },
+        text: function() { return JSON.stringify(logResponse); },
+        headers: { get: function() { return null; } },
+      });
+      _setDeps({ fetch: depsFetch });
+
+      const result = await checkDailyCommentLimit('stocks');
+
+      expect(result.allowed).toBe(false);
+      expect(typeof result.reason).toBe('string');
+      expect(result.reason).toMatch(/cap reached/i);
+
+      // Only the log fetch was made (1 NocoDB call) — no Reddit API calls
+      expect(depsFetch.mock.calls.length).toBe(1);
+      const calledUrl = depsFetch.mock.calls[0][0];
+      expect(calledUrl).not.toContain('reddit.com');
+      expectFetchCalledTimes(depsFetch, 1, 'cap-reached-log-only');
+    });
+
+    it('returns allowed:true when daily cap is not reached', async () => {
+      // Only 1 posted comment today — under the per-subreddit cap
+      const logResponse = { list: [{ subreddit: 'stocks', status: 'posted', posted_at: '2026-03-01T10:00:00Z' }] };
+      const depsFetch = jest.fn().mockResolvedValue({
+        ok: true, status: 200,
+        json: function() { return logResponse; },
+        text: function() { return JSON.stringify(logResponse); },
+        headers: { get: function() { return null; } },
+      });
+      _setDeps({ fetch: depsFetch });
+
+      const result = await checkDailyCommentLimit('stocks');
+      expect(result.allowed).toBe(true);
+    });
+  });
+
+});
