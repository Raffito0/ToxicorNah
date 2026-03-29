# Code Review Interview -- section-06: content-calendar.js

## Summary

4 auto-fixes applied (M1, L1, L2, L3). 3 let-go (L4, S1, S2).
26/26 tests pass (added 1 new test for M1 date filter).

---

## M1 -- Insider_Alerts missing 30-day date filter (MEDIUM) -- AUTO-FIX

**Finding**: `scheduleFromEarnings` queried `Insider_Alerts` with only `{ ticker, limit: 1 }`.
The spec says "last 30 days." A stale record from years ago would trigger false calendar entries.

**Fix applied**: Changed query to use NocoDB `where` filter:
```javascript
var thirtyDaysAgoAlerts = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
await opts.nocodb.get('Insider_Alerts', {
  where: '(ticker,eq,' + item.ticker + ')~and(created_at,gt,' + thirtyDaysAgoAlerts + ')',
  limit: 1,
});
```
Added test: "Insider_Alerts query includes 30-day date filter" -- verifies `where` contains `created_at,gt`.

---

## L1 -- checkContentSimilarity used raw params instead of NocoDB where filter (LOW) -- AUTO-FIX

**Finding**: `{ ticker: ticker, limit: 10 }` passes ticker as a top-level param. Every other
NocoDB call in this codebase uses the `where` filter string. Inconsistency could silently
return all articles unfiltered against a real NocoDB instance.

**Fix applied**:
```javascript
await opts.nocodb.get('Articles', {
  where: '(ticker,eq,' + ticker + ')~and(status,eq,published)',
  limit: 10,
});
```

---

## L2 -- Atom feed structure silently dropped (LOW) -- AUTO-FIX

**Finding**: When `parsed.rss.channel` is undefined (Atom feed), the code silently `continue`d
with no log. Invisible failure mode.

**Fix applied**: Added `console.warn` before continue:
```javascript
if (!channel) {
  console.warn('[content-calendar] Unrecognised feed structure (not RSS 2.0): ' + feedUrl);
  continue;
}
```

---

## L3 -- checkContentFreshness catch swallowed silently (LOW) -- AUTO-FIX

**Finding**: NocoDB connectivity failures returned `{ fresh: false }` with no log. This would
cause spurious Competitor_Intel records + Telegram alerts during outages.

**Fix applied**: Added console.warn in catch:
```javascript
} catch (e) {
  console.warn('[content-calendar] checkContentFreshness error for ' + ticker + ': ' + (e && e.message));
  return { fresh: false, lastPublished: null };
}
```

---

## L4 -- "Exactly 0.85" test uses identical text (score=1.0) (LOW) -- LET-GO

**Decision**: The threshold comparison `>= 0.85` is correct. Constructing a pair of texts that
produces exactly 0.85 cosine similarity is fragile and adds little real value. Test name is
slightly misleading but the production logic works correctly. Let-go.

---

## S1 -- allFailed flag readability (SUGGESTION) -- LET-GO

**Decision**: Style preference. Current logic is correct. Let-go.

---

## S2 -- Schedule entries with past planned_date (SUGGESTION) -- LET-GO

**Decision**: Business logic gap, out of spec scope. Let-go.

---

## Final state

| Finding | Severity | Action | Result |
|---------|----------|--------|--------|
| Insider_Alerts missing date filter | MEDIUM | Auto-fix + new test | Fixed, 26/26 |
| checkContentSimilarity wrong query format | LOW | Auto-fix | Fixed |
| Atom feed silent drop | LOW | Auto-fix (add warn) | Fixed |
| checkContentFreshness silent catch | LOW | Auto-fix (add warn) | Fixed |
| "Exactly 0.85" test uses identical text | LOW | Let-go | Noted |
| allFailed flag readability | SUGGESTION | Let-go | Noted |
| Past-date scheduling guard | SUGGESTION | Let-go | Noted |

Tests: 26/26 pass.
