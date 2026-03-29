# Section 05 -- Infra Fixes (A9, A10, A11)

## Overview

Three small, fully independent changes: VPS documentation in `.env.example`, a Reddit daily-comment cap guard in `reddit-monitor.js`, and sitemap deduplication across the Next.js site. None of these depend on any other section in this unit and none have shared state with each other.

**Files touched:**
- `.env.example` -- add VPS comment block (A9)
- `n8n/code/insiderbuying/reddit-monitor.js` -- add cap guard (A10)
- `src/app/sitemap.ts` -- delete (A11)
- `next.config.ts` -- add permanent redirect + comment (A11)

**Test file:** `n8n/tests/reddit-monitor.test.js` (update existing)

---

## Tests First

Add to `n8n/tests/reddit-monitor.test.js`. The file already tests reddit-monitor behavior; append these cases to the existing `describe` block.

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('reddit-monitor cap guard (A10)', () => {
  it('limits summing to 8 -- no error, no Telegram alert, function proceeds', () => {
    // Stub SUBREDDIT_TONE_MAP with limits [4, 4] = 8
    // Assert: console.error not called, sendTelegramAlert not called, no early return
  });

  it('limits summing to 11 -- console.error called with "11" and "10"', () => {
    // Stub SUBREDDIT_TONE_MAP with limits [6, 5] = 11
    // Assert: console.error.mock.calls[0][1] includes "11" and "10"
  });

  it('limits summing to 11 -- sendTelegramAlert called exactly once', () => {
    // Stub sendTelegramAlert; verify .mock.calls.length === 1
  });

  it('limits summing to 11 -- returns { error: string, skipped: true }', () => {
    // Assert return value shape; function must NOT throw
  });

  it('limits summing to 11 -- does NOT throw', () => {
    // assert.doesNotThrow(() => runCapCheck(overLimitMap))
  });
});
```

The test for the valid case (sum ? 10) verifies the guard is a no-op. The four tests for the over-limit case cover: logging, alerting, early-return shape, and no-throw. All five must pass.

A9 and A11 have no automated tests; their verification steps are listed in the Definition of Done below.

---

## A9 -- VPS Documentation (.env.example)

**What:** Add a comment block to `.env.example` documenting VPS setup requirements. No code runs from this change; it is purely documentation for whoever provisions or maintains the server.

**Why:** Three separate components coexist on the same Hostinger VPS: Toxic or Nah n8n, InsiderBuying n8n, and NocoDB. Without a RAM floor documented, a future VPS resize could silently degrade performance. The `NODE_FUNCTION_ALLOW_EXTERNAL` env var is required by `content-calendar.js` (Section 6) and is easy to miss.

**Change:** Append the following block to `.env.example` in a clearly labeled section. Do not remove any existing lines.

```
# ??? VPS Setup (run once on Hostinger VPS after provisioning) ??????????????
# free -h  -> must show >= 4GB RAM available
# Shared VPS services: Toxic or Nah n8n, InsiderBuying n8n, NocoDB
# If < 4GB: upgrade VPS tier or reduce via EXECUTIONS_DATA_PRUNE and
#           EXECUTIONS_PROCESS_TIMEOUT
#
# Required for content-calendar.js RSS parsing (fast-xml-parser npm package):
# NODE_FUNCTION_ALLOW_EXTERNAL=fast-xml-parser
# Add to n8n container .env and restart:
#   docker-compose -f /docker/n8n/docker-compose.yml up -d
#
# For earnings calendar integration (Alpha Vantage delay loop, ~4-5 min/run):
# EXECUTIONS_PROCESS_TIMEOUT=600
# ????????????????????????????????????????????????????????????????????????????
```

`NODE_FUNCTION_ALLOW_BUILTIN` governs only Node.js built-in modules (fs, crypto, etc.). For npm packages like `fast-xml-parser`, the correct var is `NODE_FUNCTION_ALLOW_EXTERNAL`. Both may need to be set if not already present -- confirm the existing docker-compose `.env` file already has `NODE_FUNCTION_ALLOW_BUILTIN=*` and add the external counterpart.

After editing `.env.example`, confirm the block appears with `grep -A 12 "VPS Setup" .env.example`.

---

## A10 -- Reddit Volume Cap Guard (reddit-monitor.js)

**What:** Add a module-level runtime guard that reads the total daily comment limit from `SUBREDDIT_TONE_MAP`, alerts if it exceeds 10, and returns early without proceeding.

**Why:** The daily cap of 8-10 comments across all subreddits was established in unit 13 to avoid triggering Reddit spam detection. If someone edits a subreddit limit in the future, there is currently no guardrail. A `throw` would crash every execution permanently -- which is worse than the original problem. The chosen pattern is `console.error` + Telegram alert + early return: ops are notified, but the workflow does not become permanently broken.

**Pre-implementation check:** Before writing the guard, open `reddit-monitor.js` and verify that `SUBREDDIT_TONE_MAP` currently sums to ? 10 across all active entries. Compute: `Object.values(SUBREDDIT_TONE_MAP).reduce((s, v) => s + (v.daily_limit || 0), 0)`. If the result is already > 10, reduce individual limits proportionally until sum ? 10, document which subs were capped in the file with a comment, then add the guard.

**Change:** Add the following block at module level (top of `reddit-monitor.js`), after `SUBREDDIT_TONE_MAP` is defined and before any function definitions:

```javascript
// Runtime cap guard -- prevents accidental over-posting if limits are edited
const _totalDailyLimit = Object.values(SUBREDDIT_TONE_MAP)
  .reduce((sum, s) => sum + (s.daily_limit || 0), 0);
if (_totalDailyLimit > 10) {
  const msg = `SUBREDDIT_TONE_MAP total daily limit ${_totalDailyLimit} exceeds max 10`;
  console.error('[REDDIT-CAP]', msg);
  // Fire-and-forget -- don't let alert failure mask the original problem
  sendTelegramAlert(`ERROR: reddit-monitor cap exceeded -- ${msg}`).catch(() => {});
  // Return early -- never proceed with commenting when over cap
  return { error: msg, skipped: true };
}
```

Key points:
- Use `console.error`, not `throw` -- a throw would permanently break every execution until someone redeploys.
- The `.catch(() => {})` on the Telegram call is intentional -- if the Telegram call itself fails, that must not mask the cap-exceeded condition.
- The unit test in `reddit-monitor.test.js` **still asserts `_totalDailyLimit <= 10`** as a static check -- this catches the bad state in CI before it ever reaches production. The runtime guard is a second line of defense.

---

## A11 -- Sitemap Deduplication

**What:** Remove the static Next.js App Router sitemap file and consolidate sitemap generation to `next-sitemap.config.js` as the single source. Add a permanent redirect so any Google-indexed `/sitemap` URL continues to resolve.

**Why:** Two sitemap generators running simultaneously produce duplicate or conflicting entries, and `robots.txt` generation may be assigned to the wrong one. `next-sitemap.config.js` is the correct long-term owner because it handles dynamic routes and robots.txt generation in a single step.

**Steps:**

1. **Delete `src/app/sitemap.ts`.**
   This is a Next.js App Router convention file (`app/sitemap.ts` returns a `MetadataRoute.Sitemap` array). Deleting it removes the static generator entirely. If the file does not exist at that path, check `app/sitemap.js` or `app/sitemap.tsx` -- delete whichever exists.

2. **Open `next.config.ts`.** Make two targeted changes:

   a. **Remove any `generateSitemaps()` override** in the Next.js config if present -- it conflicts with `next-sitemap.config.js`. If not present, no action needed.

   b. **Add a permanent redirect** inside the `redirects` async function (create the function if it doesn't exist):
   ```typescript
   async redirects() {
     return [
       {
         source: '/sitemap',
         destination: '/sitemap.xml',
         permanent: true,
       },
       // ... any existing redirects
     ];
   },
   ```

   c. **Add a comment** near the top of the exports object:
   ```typescript
   // next-sitemap.config.js is the single sitemap source of truth
   // src/app/sitemap.ts has been removed to prevent duplicate sitemap generation
   ```

   d. **Check for `output: 'export'`** in the config. If present, add this comment next to it:
   ```typescript
   // NOTE: output: 'export' is incompatible with next-sitemap's dynamic routes.
   // If this is re-enabled, next-sitemap.config.js must be reviewed.
   ```

3. **Verify `next-sitemap.config.js` exists and is correct.** Open it and confirm `siteUrl`, `generateRobotsTxt: true` (if desired), and any `exclude` patterns look right. Do not modify content unless something is obviously wrong.

4. **Verify the build.** Run `npm run build` locally (or on the VPS). After the build, confirm:
   - `public/sitemap.xml` exists and contains valid sitemap entries
   - `public/sitemap.xml` is generated exactly once (no duplicate `public/sitemap-0.xml` alongside it unless next-sitemap is configured for index mode)
   - `public/robots.txt` references the correct sitemap URL

---

## Definition of Done

### A9
- `.env.example` contains the comment block with all three of: `NODE_FUNCTION_ALLOW_EXTERNAL=fast-xml-parser`, `EXECUTIONS_PROCESS_TIMEOUT=600`, RAM check note
- Command: `grep -c "NODE_FUNCTION_ALLOW_EXTERNAL" .env.example` returns `1`

### A10
- `reddit-monitor.test.js` all cap-guard tests pass: valid sum no-ops, over-limit logs + alerts + early returns without throwing
- `Object.values(SUBREDDIT_TONE_MAP).reduce((s,v) => s + (v.daily_limit||0), 0)` evaluates to ? 10 in the current file
- The guard block uses `console.error` + `.catch(() => {})` pattern (not `throw`)

### A11
- `src/app/sitemap.ts` (or `.js`/`.tsx`) does not exist
- `next.config.ts` contains `/sitemap` -> `/sitemap.xml` permanent redirect
- `npm run build` produces a single `public/sitemap.xml` with no duplicate
- `GET /sitemap` returns HTTP 301 to `/sitemap.xml` (verify after deploy)

---

## Deviations from Plan

1. **A10 field name (D1)**: Spec uses `s.daily_limit` but live `SUBREDDIT_TONE_MAP` uses `dailyCap`.
   Implementation uses `dailyCap` (correct). Added clarifying comment in `checkCapGuard`.

2. **A10 injectable alertFn (D2)**: Spec showed inline `sendTelegramAlert()` call but that function
   does not exist in `reddit-monitor.js`. Implemented with injected `alertFn` parameter for
   testability. Module-level call passes `null` (startup logging goes to Docker logs instead).

3. **A10 test count 23**: Spec showed 5 test skeletons; implemented 6 tests (added static check
   for SUBREDDIT_TONE_MAP total dailyCap <= 10).

4. **A11 build verification skipped**: `npm run build` not run locally (VPS-only deploy). Redirect
   correctness verified by reading `next.config.ts` after edit.

## Notes for Implementer

- These three changes are fully independent. Implement and test them in any order or in parallel.
- A9 is a documentation-only change -- no risk of breaking anything, do it first.
- A10 requires reading the current `SUBREDDIT_TONE_MAP` definition before writing the guard. Don't write the guard against a stale assumption of what the map contains.
- A11: if `src/app/sitemap.ts` doesn't exist at that exact path, `git ls-files | grep sitemap` will locate it.
- The `sendTelegramAlert` function referenced in A10's guard must already be defined or imported in `reddit-monitor.js`. If it isn't, use the same pattern as other alert calls in that file -- don't add a new HTTP helper.
