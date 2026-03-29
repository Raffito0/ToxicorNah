# Section 03 -- X Monitoring Variable Frequency Polling

## Overview

Add market-hours-aware, variable-frequency polling to the W8 X engagement workflow (`x-engagement.js`). Currently W8 uses a fixed cron schedule. After this section, it will run every 1 minute but internally skip if insufficient time has elapsed, achieving 5-minute intervals during market hours, 15-minute in extended hours, and 60-minute overnight and on weekends.

**File to modify:** `n8n/code/insiderbuying/x-engagement.js`
**Test file:** `n8n/tests/x-engagement.test.js`
**Dependencies:** None -- this section is fully independent.

---

## Pre-flight: n8n Workflow Settings

Before writing any code, apply two n8n UI settings to W8:

1. **Single Execution Mode** -- Settings -> Concurrency -> set to 1. This prevents overlapping executions if one engagement run takes longer than 1 minute.
2. **"Save execution data for failed executions only"** -- Settings -> Save execution data. This prevents 1,440 daily execution log entries from bloating n8n's database on the shared VPS. Observability is provided via NocoDB `X_State`, not n8n execution history.

Then change the W8 Schedule Trigger cron from its current fixed schedule to **every 1 minute**.

---

## Tests First

**Test file:** `n8n/tests/x-engagement.test.js`

All tests for `getCurrentPollingInterval(now)` pass a specific `Date` object -- the function accepts an injectable `now` parameter, defaulting to `new Date()`.

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// Import the function under test from x-engagement.js
// const { getCurrentPollingInterval } = require('../code/insiderbuying/x-engagement');
```

### getCurrentPollingInterval -- timezone correctness tests

```
Test: Monday 10:00 AM NY time -> returns 5 * 60 * 1000 (market hours)
Test: Monday 10:00 AM NY expressed as UTC 15:00 -> same result (5 * 60 * 1000)
      // Verifies TZ normalization handles UTC offset correctly
Test: Friday 17:00 NY (extended hours, after market close) -> returns 15 * 60 * 1000
Test: Friday 21:00 NY (overnight) -> returns 60 * 60 * 1000
Test: Saturday 14:00 NY -> returns 60 * 60 * 1000 (weekend)

// Critical TZ bug regression test:
Test: Date that is 00:30 UTC Monday (= 19:30 EST Sunday night)
      -> returns 60 * 60 * 1000 (weekend overnight, NOT weekday after-hours)
      // Without TZ normalization, now.getDay() returns 1 (Monday UTC) and
      // h=0 -> overnight -- but that's still 60 min so the assertion is the same.
      // The real regression is: a Date that is 23:30 UTC Sunday (= 18:30 EST Sunday)
      // getDay() on UTC = 0 (Sunday) -- correct by accident.
      // The confirmed failing case: 00:30 UTC Monday expressed as a JS Date
      // must NOT return 15-min (extended hours) due to h=19 in NY.
      // Verify: result === 60 * 60 * 1000

// DST boundary test:
Test: Date during spring-forward hour (2:00-3:00 AM NY in mid-March, a Sunday)
      -> returns 60 * 60 * 1000 (weekend, regardless of DST ambiguity)
```

### Skip logic ordering tests

```
Test: elapsed < pollingInterval
      -> engagement function is NOT called
      (mock the engagement function, assert it was called 0 times)

Test: elapsed >= pollingInterval
      -> X_State.last_run PATCH is called BEFORE engagement function is called
      (assert call order: PATCH mock precedes engagement mock invocation)

Test: after engagement completes
      -> X_State.polling_interval is updated via a separate PATCH call
      (mock nocodbPatch, assert it was called with the polling_interval field)
```

---

## Implementation

### getCurrentPollingInterval(now)

Add this function to `x-engagement.js`. It must be exported for testability.

```javascript
// Accepts injectable 'now' for testability (tests pass specific Date objects)
function getCurrentPollingInterval(now = new Date()) {
  // Normalize to America/New_York so both hour and day-of-week are in the same TZ.
  // Using now.getDay() directly would use server UTC -- on a UTC server at
  // 00:30 UTC Monday (= 19:30 EST Sunday), getDay() returns 1 (Monday) but
  // the market is closed (Sunday night).
  const nyDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h   = nyDate.getHours();
  const day = nyDate.getDay(); // 0=Sun, 6=Sat -- in NY time

  if ([1,2,3,4,5].includes(day) && h >= 9 && h < 16)
    return 5 * 60 * 1000;   // market hours: Mon-Fri 9:00-15:59 NY
  if ([1,2,3,4,5].includes(day) && h >= 16 && h < 20)
    return 15 * 60 * 1000;  // extended hours: Mon-Fri 16:00-19:59 NY
  return 60 * 60 * 1000;    // overnight + weekends
}
```

Both `h` and `day` are derived from the same TZ-normalized date object. This handles EST (UTC-5) and EDT (UTC-4) correctly across DST transitions because `toLocaleString` with `timeZone: 'America/New_York'` is DST-aware.

### Skip Logic -- Critical Ordering

The ordering of operations matters. A race condition exists if `last_run` is updated after the engagement logic: a slow run could allow a second 1-minute tick to start the engagement flow before the first run finishes.

Correct ordering in the main Code node:

```
1. Read X_State.last_run (timestamp ms) from NocoDB
2. Compute elapsed = Date.now() - last_run
3. If elapsed < getCurrentPollingInterval():
     return immediately -- skip this execution
4. PATCH X_State.last_run = Date.now()   <- BEFORE engagement logic
5. Proceed with existing engagement flow
6. After engagement completes:
     PATCH X_State.polling_interval = getCurrentPollingInterval()  <- for observability
```

The `X_State` table was created in unit 08. Only `last_run` and `polling_interval` fields are read/written by this section.

### NocoDB Access Pattern

Use the existing `nocodbGet` and `nocodbPatch` helpers already present in `x-engagement.js`. The `X_State` table stores a single-row state record. Read it with a GET and update with PATCH by ID.

No new environment variables are needed. Existing `NOCODB_BASE_URL` and `NOCODB_API_TOKEN` are used.

---

## Definition of Done

- [ ] W8 Schedule Trigger set to every 1 minute (n8n UI change -- manual step)
- [ ] W8 Concurrency set to 1 (n8n UI change -- manual step)
- [ ] W8 "Save execution data" set to failed only (n8n UI change -- manual step)
- [x] `getCurrentPollingInterval(now)` implemented and exported in `x-engagement.js`
- [x] `runXPollingCycle(opts)` wrapper implemented with injectable dependencies for testability
- [x] Skip logic reads `X_State.last_run`, patches it BEFORE engagement, patches `polling_interval` AFTER
- [x] All tests in `n8n/tests/x-engagement.test.js` pass: 100/100 (81 pre-existing + 19 new)
- [x] Critical TZ regression test passes (00:30 UTC Monday = Sunday 19:30 EST -> 60 min)
- [x] No hardcoded interval values remain; all routing goes through `getCurrentPollingInterval()`

## Deviations from Plan

1. **runXPollingCycle exposed as named export (D1)**: Spec described the skip logic as "in the main
   Code node" without prescribing a named function. A named `runXPollingCycle(opts)` was created and
   exported for testability. This is the only way to test call ordering without an end-to-end n8n run.

2. **try/finally around runEngagement (D2)**: Code review finding H2. Spec did not specify error
   handling. Added `try/finally` so `polling_interval` is always patched even when engagement throws.
   Re-entry prevention (`last_run` pre-patch) still works correctly regardless.

3. **Test count 100 (D3)**: 19 new tests added (11 TZ tests + 5 skip logic ordering tests + 3 fix
   tests from code review). Spec implied ~8 tests from the spec bullets.
