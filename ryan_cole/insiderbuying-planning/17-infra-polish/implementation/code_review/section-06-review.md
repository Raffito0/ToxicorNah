# Code Review: Section 06 — content-calendar.js

**Date:** 2026-03-30
**Reviewer:** Senior Code Reviewer
**Files reviewed:**
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/content-calendar.js` (new, 396 lines)
- `ryan_cole/insiderbuying-site/n8n/tests/content-calendar.test.js` (new, 376 lines)

---

## Summary

The implementation delivers all six exported functions, all 25 tests pass, and the overall structure is solid. Dependency injection via `opts` is applied consistently, the TF-IDF engine is correct, and the failure-handling contract for `checkCompetitorFeeds` is fully honoured. There are no critical blocking issues. The findings below are one medium-severity logic gap, four low-severity issues, and two suggestions.

What was done well:
- Clean `'use strict'` throughout, consistent `var`-based style matching the existing codebase.
- Graceful degradation when `fast-xml-parser` is absent at runtime (warn and continue rather than throw).
- `opts.delay` mockability in `scheduleFromEarnings` — the test for delay invocation count is correctly written.
- Smooth IDF (`+1`) prevents zero-vector degenerate cases in small corpora; the comment explains why.
- The semantic-mismatch note about `generate-article.js#checkContentFreshness` (inverted `fresh` meaning) is correctly documented and the decision not to extract is defensible.
- Single Telegram error message on all-feeds-fail is correctly implemented and tested.

---

## Findings

### MEDIUM

**M1 — `scheduleFromEarnings`: `Insider_Alerts` query has no date filter — stale alerts trigger calendar entries**

Location: `content-calendar.js` line 371

The spec says "queries `Insider_Alerts` (last 30 days) for any matching insider activity." The implementation queries with only `{ ticker: item.ticker, limit: 1 }`, which will match alerts of any age including records that are years old. An insider trade from two years ago would cause a new calendar entry to be scheduled for an upcoming earnings date, producing false positives.

The spec is explicit: "last 30 days." The fix requires adding a date filter analogous to the one already used in `checkContentFreshness`:

```javascript
var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
var alertResult = await opts.nocodb.get('Insider_Alerts', {
  where: '(ticker,eq,' + item.ticker + ')~and(created_at,gt,' + thirtyDaysAgo + ')',
  limit: 1
});
```

The test for this path (`'does NOT call addToCalendar when ticker in earnings but NOT in Insider_Alerts'`) passes because it returns an empty list — it does not cover the case where a stale record exists. A test using a record with `created_at` older than 30 days would catch this.

---

### LOW

**L1 — `checkContentSimilarity` passes `{ ticker, limit }` but `checkContentFreshness` uses a `where` filter — inconsistent NocoDB query style**

Location: `content-calendar.js` line 295

```javascript
var result = await opts.nocodb.get('Articles', { ticker: ticker, limit: 10 });
```

Every other `nocodbGet` call in this file and across the codebase uses NocoDB's `where` filter string. Passing `{ ticker: ticker }` as a top-level param relies on the NocoDB client silently forwarding arbitrary keys as query parameters, which may or may not work depending on the NocoDB version. The `checkContentFreshness` function in the same file uses the correct `where` pattern. For consistency and reliability this should be:

```javascript
var result = await opts.nocodb.get('Articles', {
  where: '(ticker,eq,' + ticker + ')~and(status,eq,published)',
  limit: 10
});
```

The test stubs `opts.nocodb.get` to return a hardcoded list regardless of params, so this bug does not cause test failures but will silently return all articles (not filtered by ticker) against a real NocoDB instance.

---

**L2 — `checkCompetitorFeeds`: Atom feed format (`<feed>/<entry>`) silently drops all items**

Location: `content-calendar.js` lines 230-235

```javascript
var channel = parsed && parsed.rss && parsed.rss.channel;
if (!channel) continue;
var items = channel.item;
```

The code only handles RSS 2.0 structure (`<rss><channel><item>`). Atom feeds (`<feed><entry>`) — used by many finance sites — will parse successfully via `fast-xml-parser` but produce `channel = undefined`, causing a silent `continue`. No error is logged and no Telegram alert is sent. The caller receives no indication that the feed was processed but yielded zero results.

This is low rather than medium because the `COMPETITOR_RSS_FEEDS` constant is currently an empty array and feeds are supplied at call time, giving the caller control. However if Atom feeds are ever added the failure mode is invisible. A minimal mitigation is to log a warning when `channel` is null:

```javascript
if (!channel) {
  console.warn('[content-calendar] Unrecognised feed structure (not RSS 2.0): ' + feedUrl);
  continue;
}
```

---

**L3 — `checkContentFreshness` error handler silently returns `fresh: false`, masking NocoDB connectivity failures**

Location: `content-calendar.js` lines 199-201

```javascript
} catch (e) {
  return { fresh: false, lastPublished: null };
}
```

When `opts.nocodb.get` throws (e.g. NocoDB is unreachable), the function returns `{ fresh: false }`, which tells `checkCompetitorFeeds` the ticker has no recent coverage. This causes a Competitor_Intel record and a Telegram alert to be posted for every ticker in every feed item, even if articles exist. The generate-article.js version has the same pattern but uses the opposite safe default (`fresh: true`) which stops generation — a correct conservative failure mode.

For `checkCompetitorFeeds` use, `fresh: false` on error is too aggressive. A `{ fresh: true, lastPublished: null, error: true }` return (or re-throwing) would prevent spurious alerts during outages. At minimum the error should be logged:

```javascript
} catch (e) {
  console.warn('[content-calendar] checkContentFreshness error for ' + ticker + ': ' + (e && e.message));
  return { fresh: false, lastPublished: null };
}
```

The existing tests do not cover the error path, so this is not caught by the test suite.

---

**L4 — `checkContentSimilarity` 0.85 threshold test does not actually validate boundary behaviour**

Location: `content-calendar.test.js` lines 705-710

```javascript
it('similarity at exactly 0.85 returns similar: true (inclusive threshold)', async () => {
  var text = 'insider purchase form four sec filing stock buyback significant amount shares';
  var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-2', body_text: text }] }) });
  var result = await checkContentSimilarity(text, 'AAPL', { nocodb: nocodb });
  assert.equal(result.similar, true);
});
```

This test uses identical text for both the new article and the existing article. It will always produce a similarity of 1.0, not 0.85. The test passes, but it tests the case score=1.0 >= 0.85, not score=exactly 0.85 >= 0.85. The boundary case — where a score is within floating-point epsilon of 0.85 — is not exercised. The spec calls this test out explicitly ("similarity exactly at 0.85 -> { similar: true } (threshold is inclusive)").

This is a test quality gap, not a logic bug. The threshold comparison `>= 0.85` on line 332 is correct. The test should use a pre-computed pair of texts where the cosine similarity is known to be close to 0.85, or alternatively test the boundary by constructing the vectors directly and calling the internal `cosineSimilarity` helper (which is not exported). For now the test name is misleading.

---

## Suggestions

**S1 — `checkCompetitorFeeds`: `allFailed` flag logic is subtle and could be replaced with a simpler pattern**

The `allFailed` variable is initialised to `true` and only set to `false` after a successful fetch. The condition `if (failCount > 0 && allFailed)` is correct but non-obvious. An equivalent and more readable approach is to track successful feed count directly:

```javascript
var successCount = 0;
// ... inside try block after xml = await opts.fetchRSS(feedUrl):
successCount++;
// ... after loop:
if (feeds.length > 0 && successCount === 0) { /* send single error */ }
```

This is a style suggestion; the current logic is not wrong.

---

**S2 — `scheduleFromEarnings` does not guard against scheduling in the past**

If `earningsDate - 3 days` is in the past (e.g. earnings were yesterday), the function will create a calendar entry with `planned_date` already elapsed. Callers querying `getCalendarForDate(today)` would never see it. A guard `if (scheduledDate < new Date()) continue;` would prevent cluttering the calendar with unreachable entries. This is a business logic gap, not a code defect, so it is a suggestion rather than a finding.

---

## Plan Alignment

All six functions are present and exported. The spec's Definition of Done items are satisfied with one exception: the `checkContentFreshness` duplication in `generate-article.js` has **not** been extracted. The implementation summary correctly identifies the semantic mismatch (inverted `fresh` boolean) as the reason. The spec note says "if it exists in `generate-article.js`, extract it here and update `generate-article.js` to import from this module." The semantic mismatch is real (`generate-article.js` returns `fresh: true` when no recent article exists, meaning generation should proceed; `content-calendar.js` returns `fresh: false` for the same condition, meaning no recent coverage). Extracting would require renaming or wrapping, which introduces risk. The decision to leave it as a documented known divergence is acceptable, but it should be explicitly noted in the Definition of Done tracking as a waived item with the reason recorded.

The `COMPETITOR_RSS_FEEDS` constant is left as an empty array with a comment, which matches the spec's placeholder approach.

---

## Action Items

| # | Severity | Action |
|---|----------|--------|
| M1 | MEDIUM | Add `~and(created_at,gt,thirtyDaysAgo)` date filter to the `Insider_Alerts` query in `scheduleFromEarnings`. Add a test case with a stale alert record. |
| L1 | LOW | Change `{ ticker: ticker, limit: 10 }` in `checkContentSimilarity` to use a NocoDB `where` filter string. |
| L2 | LOW | Add a `console.warn` when the parsed feed has no RSS channel structure, to make Atom-feed failures visible. |
| L3 | LOW | Add `console.warn` logging in the `checkContentFreshness` catch block so NocoDB errors are not silently swallowed. |
| L4 | LOW | Rename or rewrite the "similarity at exactly 0.85" test to actually exercise the boundary rather than identical-text (score=1.0). |
| S1 | SUGGESTION | Simplify `allFailed` flag to a `successCount` counter for readability. |
| S2 | SUGGESTION | Guard against scheduling calendar entries with `planned_date` in the past in `scheduleFromEarnings`. |
