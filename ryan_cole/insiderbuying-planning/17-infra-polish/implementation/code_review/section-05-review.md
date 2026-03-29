# Section 05 Code Review — Infra Fixes (A9, A10, A11)

Reviewed against spec at:
`ryan_cole/insiderbuying-planning/17-infra-polish/sections/section-05-infra-fixes.md`

---

## Summary

Three independent changes were implemented. All three are functionally correct. Two issues require attention before this section is considered done: the A10 guard uses the wrong property key compared to what the spec prescribes, and the A10 tests specified in the section spec were not written.

---

## What Was Done Well

All three changes are well-scoped and do not touch anything beyond their stated target files. The A11 deletion of `src/app/sitemap.ts` is confirmed (file no longer exists at that path). The redirect in `next.config.ts` is correct syntax and matches the spec exactly. The `next.config.ts` comment block is placed at module level, which is clear and will not interfere with the config object. The A9 documentation block is correctly appended, does not remove any existing lines, and contains all three items required by the Definition of Done.

---

## Findings

### MEDIUM — A10: `dailyCap` used instead of `daily_limit` in guard function

**File:** `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js`, line 718

The spec's pre-implementation check instructs:

> Compute: `Object.values(SUBREDDIT_TONE_MAP).reduce((s, v) => s + (v.daily_limit || 0), 0)`

And the spec's code block uses `s.daily_limit || 0` throughout. The implementation uses `s.dailyCap || 0` instead.

In this specific codebase the property name in `SUBREDDIT_TONE_MAP` is actually `dailyCap` (confirmed at lines 681, 688, 695, 702, 709 of `reddit-monitor.js`), and `checkDailyCommentLimit` at line 1308 also reads `dailyCap`. So the implementation is functionally correct against the live data structure.

However, there is a real correctness risk here. The spec defined the guard using `daily_limit` as the key. The guard's `|| 0` fallback silently returns zero for any entry that uses `daily_limit` instead of `dailyCap`, meaning if a future developer adds a subreddit with the spec's key name rather than the implementation's key name, the guard would undercount and not fire. The property name inconsistency between spec and implementation is a future-maintenance trap.

The existing test at line 1108 asserts `dailyCaps sum to 10` using `dailyCap`, which confirms the current map is consistent. The guard will fire correctly today. But the discrepancy should be resolved by either updating the spec's pre-implementation check reference or adding a comment in the guard function explaining why `dailyCap` is used instead of `daily_limit`.

**Recommendation:** Add a one-line comment in `checkCapGuard` noting that the field is `dailyCap` (not `daily_limit` as suggested in the spec), so the next editor knows this was intentional and not a typo.

---

### HIGH — A10: Spec-required unit tests were not written

**File:** `ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js`

The spec explicitly required five new test cases to be appended to the existing `describe` block:

1. Valid sum (total = 8) — no error, no alert, no early return
2. Over-limit (total = 11) — `console.error` called with "11" and "10"
3. Over-limit (total = 11) — `alertFn` called exactly once
4. Over-limit (total = 11) — returns `{ error: string, skipped: true }`
5. Over-limit (total = 11) — does not throw

The Definition of Done states: "reddit-monitor.test.js all cap-guard tests pass."

None of these five tests exist anywhere in `reddit-monitor.test.js`. The file ends at line 1682 and contains no `describe` block referencing `checkCapGuard`, `cap guard`, or `A10`. The claim "23/23 pass" in the context description refers to existing tests passing (i.e., the new code did not break anything), not to new tests being written.

The pre-existing test at line 1108 (`dailyCaps sum to 10`) is a static structural check on the map data, not a behavioral test of the guard function. It does not cover the guard's alerting logic, early return shape, or no-throw guarantee.

The section cannot be marked done until these five tests are written and pass. The `checkCapGuard` function is exported (line 1625), so it is testable by calling `mod.checkCapGuard(overLimitMap, alertFn)` directly.

---

### LOW — A10: Module-level fire-and-forget call passes `null` as alertFn, silently suppressing Telegram alert on startup

**File:** `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js`, line 731

```javascript
checkCapGuard(SUBREDDIT_TONE_MAP, null);
```

The module-level call passes `null` for `alertFn`, which means that if the cap is exceeded at module load time (i.e., when the file is first required in n8n), no Telegram alert is sent. The comment says "no alert needed at startup" but this reasoning is inconsistent: the cap is either exceeded or it isn't, and the caller using it at runtime will have the same map. If the sum is over 10, the operator needs to know regardless of when the check runs.

The current map sums to exactly 10 (3+2+2+1+2=10), so this path does not trigger today. But once the map exceeds 10, the startup check will log to `console.error` without alerting, while the runtime check (which callers invoke with a real `alertFn`) would alert. This creates an asymmetry where the startup log silently disappears in n8n execution logs unless someone is watching the Docker container output.

This is low severity because it does not cause incorrect behavior in the over-limit case at runtime — the runtime call site is responsible for passing a real `alertFn`. But it is worth noting so the comment ("no alert needed at startup") is understood to be a deliberate choice rather than an oversight.

---

### LOW — A11: Redirect covers `/sitemap` but not `/sitemap/` (trailing slash variant)

**File:** `ryan_cole/insiderbuying-site/next.config.ts`, lines 11-17

The redirect source is `/sitemap` with no trailing slash handling. Next.js does not automatically normalize `/sitemap/` to `/sitemap` unless `trailingSlash: true` is set in the config (it is not set here). If Google has ever indexed `/sitemap/` (with trailing slash), that URL will return a 404 rather than redirecting to `/sitemap.xml`.

This is low severity because: (a) the sitemap URL in a typical `robots.txt` points to `/sitemap.xml` directly, not `/sitemap`, so Google's primary crawl path is unaffected; (b) the previous `src/app/sitemap.ts` would have served the App Router convention at `/sitemap`, not `/sitemap/`; (c) the redirect is a convenience path for humans typing the URL, not the primary SEO signal.

If the site has been live with Google indexing `/sitemap` it is worth checking Search Console for any indexed variants before the next deploy.

---

## Plan Alignment

| Item | Spec requirement | Implementation | Status |
|------|-----------------|----------------|--------|
| A9: VPS block appended to `.env.example` | Yes, with all 3 required items | Present at lines 37-50 | Pass |
| A9: No existing lines removed | Yes | Confirmed | Pass |
| A10: Guard placed after `SUBREDDIT_TONE_MAP`, before function defs | Yes | Lines 713-731 | Pass |
| A10: Uses `console.error` not `throw` | Yes | Confirmed | Pass |
| A10: `.catch(() => {})` on alertFn | Yes | Line 723 | Pass |
| A10: Returns `{ error, skipped: true }` | Yes | Line 725 | Pass |
| A10: Exported as `checkCapGuard` | Yes | Line 1625 | Pass |
| A10: Property key matches live map | Spec says `daily_limit`, map uses `dailyCap` | Guard uses `dailyCap` | Functional pass, spec divergence noted |
| A10: 5 new unit tests written | Required by DoD | Not written | Fail |
| A11: `src/app/sitemap.ts` deleted | Yes | Confirmed (file absent) | Pass |
| A11: Permanent redirect `/sitemap` -> `/sitemap.xml` | Yes | Lines 10-18 of `next.config.ts` | Pass |
| A11: Comment added explaining change | Yes | Lines 3-4 of `next.config.ts` | Pass |
| A11: `output: 'export'` comment | If present, add note | Not present in config | N/A |

---

## Definition of Done Assessment

- A9: Pass. All three required items (`NODE_FUNCTION_ALLOW_EXTERNAL=fast-xml-parser`, `EXECUTIONS_PROCESS_TIMEOUT=600`, RAM check note) are present in the block.
- A10: Fail. The five cap-guard unit tests required by the spec are missing. This is the blocking item.
- A11: Pass (conditional). Redirect and file deletion are correct. Build verification (`npm run build` producing a single `public/sitemap.xml`) cannot be confirmed from static review alone and must be run.

The section is not done until the A10 unit tests are written and pass (23 existing tests passing is a necessary but not sufficient condition for the DoD).

---

## Files Reviewed

- `C:/Users/rafca/OneDrive/Desktop/Toxic or Nah/ryan_cole/insiderbuying-site/.env.example`
- `C:/Users/rafca/OneDrive/Desktop/Toxic or Nah/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js`
- `C:/Users/rafca/OneDrive/Desktop/Toxic or Nah/ryan_cole/insiderbuying-site/next.config.ts`
- `C:/Users/rafca/OneDrive/Desktop/Toxic or Nah/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js`
- `C:/Users/rafca/OneDrive/Desktop/Toxic or Nah/ryan_cole/insiderbuying-planning/17-infra-polish/sections/section-05-infra-fixes.md`
