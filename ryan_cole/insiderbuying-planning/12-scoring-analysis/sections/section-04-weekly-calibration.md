# Section 04: Weekly Score Calibration

## Overview

Add `runWeeklyCalibration()` to `score-alert.js`. This function is exported and called by a separate n8n Schedule Trigger node — it does NOT run in the per-alert pipeline. It queries NocoDB for all scored alerts from the past 7 days, buckets them into four score ranges, checks whether the distribution is healthy, fires a Telegram alert if it is not, and always writes a record to a dedicated calibration log table.

**Depends on**: section-03 (transaction filtering must be complete so the NocoDB alerts table contains scored records with the expected shape).

**File to modify**: `n8n/code/insiderbuying/score-alert.js`

**New NocoDB table required**: `score_calibration_runs` (schema defined below).

---

## Why This Exists

The deterministic formula in section-01 assigns scores based on weights chosen from research. Those weights may drift out of calibration as the insider trading landscape changes, or may have been set slightly off to begin with. A weekly distribution check catches both problems: if 30% of all alerts are scoring 8-10, the formula is too generous; if only 2% reach that bucket, it is too strict. Both conditions reduce the editorial value of the score.

This check also catches broken pipeline states: if an entire score bucket is empty for a week, something upstream is wrong (e.g., all options exercises being misclassified, or a NocoDB write failing silently).

---

## Tests First

**File**: `score-alert.test.js` — add a `runWeeklyCalibration()` describe block.

All tests use dependency injection: pass `fetchFn` as `jest.fn()`, `sleep` as `() => Promise.resolve()`, and `env` as an object with `NOCODB_API_URL`, `NOCODB_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### Distribution Bucketing

```
test: scores [8, 9, 10, 8, 7, 5, 4, 3, 6, 6]
  → pct_1_3 = 10%, pct_4_5 = 20%, pct_6_7 = 30%, pct_8_10 = 40%
  → (8-10 bucket > 25%) Telegram alert fires

test: scores [8, 9, 10, 8, 7, 5, 4, 3, 6, 6, 5, 4, 5, 4, 5]
  → 8-10 bucket = 4/15 ≈ 27% → Telegram fires

test: 14 alerts all scoring 5
  → pct_4_5 = 100%, all other buckets 0%
  → Telegram fires (empty buckets detected)

test: zero alerts in week
  → returns early with "no alerts this week" message
  → Telegram NOT fired
  → NO calibration record written to NocoDB
  → No division by zero
```

### Telegram Alert Triggering

```
test: 8-10 bucket = 30% → Telegram alert fires
test: 8-10 bucket = 3%  → Telegram alert fires
test: 8-10 bucket = 15%, all buckets non-empty → Telegram does NOT fire
test: any bucket = 0%   → Telegram fires

test: Telegram message contains a distribution table listing all 4 buckets with their percentages
test: Telegram message includes total alert count
```

### NocoDB Calibration Record Write

```
test: healthy distribution → NocoDB write still occurs (flagged = false)
test: unhealthy distribution → NocoDB write occurs (flagged = true)
test: written record shape includes: run_date, total_alerts, pct_1_3, pct_4_5, pct_6_7, pct_8_10, flagged

test: NocoDB query for alerts throws error
  → logs error to console
  → does NOT crash
  → does NOT write a calibration record
  → does NOT fire Telegram
```

---

## Implementation

### Function Signature

```javascript
async function runWeeklyCalibration(deps)
// deps: { fetchFn, sleep, env }
// env keys: NOCODB_BASE_URL, NOCODB_API_TOKEN, NOCODB_PROJECT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Returns: { total, buckets, flagged } or null on query failure
```

Export this function from `score-alert.js` alongside the existing `runScoreAlert` export.

### Step 1: Query NocoDB for Past 7 Days

Query the alerts table for records where `created_at >= (now - 7 days)` and `final_score IS NOT NULL` (exclude nulled-out records such as gifts and exercise-and-sells). The NocoDB query uses a `where` filter on the date field. Retrieve only the `final_score` column to minimize response size.

If the query throws or returns a non-2xx status, log the error and return `null`. Do not write a calibration record and do not fire Telegram.

### Step 2: Guard for Empty Week

If the returned record array has length 0, log `"[calibration] no alerts this week — skipping"` and return early with a message object. Do not proceed to bucketing, do not write to NocoDB, do not send Telegram. This prevents division-by-zero and avoids a noisy alert on weeks with no filings (e.g., holiday weeks).

### Step 3: Bucket the Scores

Four buckets:
- `1–3`: scores where `final_score <= 3`
- `4–5`: scores where `final_score >= 4 && final_score <= 5`
- `6–7`: scores where `final_score >= 6 && final_score <= 7`
- `8–10`: scores where `final_score >= 8`

Compute percentage for each bucket: `count / total * 100`, rounded to one decimal place. Store as `pct_1_3`, `pct_4_5`, `pct_6_7`, `pct_8_10`.

### Step 4: Evaluate Alert Conditions

Set `flagged = false`. Fire Telegram (set `flagged = true`) if any of these conditions is true:
- `pct_8_10 > 25` — formula is too generous
- `pct_8_10 < 5` — formula is too strict
- Any of the four percentage values is `0` — a bucket being entirely empty signals a pipeline anomaly

These thresholds are intentionally conservative: the goal is to catch clearly broken states, not to micro-manage the formula.

### Step 5: Send Telegram Alert (if flagged)

Construct a message that includes:
- A header line: `"[Score Calibration Alert] Week of YYYY-MM-DD"`
- A table showing all four buckets and their percentages
- Total alert count
- The specific condition that triggered the alert (e.g., "8-10 bucket is 28% — formula may be too generous")

Send via the existing Telegram helper pattern used elsewhere in the codebase. If the Telegram send fails, log the error but do not abort the NocoDB write.

### Step 6: Write Calibration Record to NocoDB

Always write a record to `score_calibration_runs` (whether `flagged` is true or false). Shape:

```javascript
{
  run_date: new Date().toISOString().slice(0, 10),  // "YYYY-MM-DD"
  total_alerts: total,
  pct_1_3: pct_1_3,
  pct_4_5: pct_4_5,
  pct_6_7: pct_6_7,
  pct_8_10: pct_8_10,
  flagged: flagged
}
```

Use the same NocoDB POST pattern as other writes in the project (`POST /api/v1/db/data/noco/{projectId}/{tableId}`).

---

## NocoDB Schema Changes

### Alerts Table — Additional Columns

The following columns should exist from unit 08 or earlier units. If missing, add them during this section's migration:

| Column | Type | Notes |
|--------|------|-------|
| `base_score` | Decimal | Score before AI refinement |
| `ai_adjustment` | Integer | -1, 0, or +1 |
| `ai_reason` | Text | AI explanation string |
| `direction` | Text | 'A' (acquisition) or 'D' (disposal) |
| `is10b5_plan` | Boolean | From edgar-parser footnote detection |

These columns are written by section-02 and section-03. This section only reads `final_score` and `created_at`.

### New Table: `score_calibration_runs`

| Column | Type | Notes |
|--------|------|-------|
| `run_date` | Date | ISO date of calibration run |
| `total_alerts` | Integer | Total scored alerts in window |
| `pct_1_3` | Decimal | % of alerts scoring 1–3 |
| `pct_4_5` | Decimal | % of alerts scoring 4–5 |
| `pct_6_7` | Decimal | % of alerts scoring 6–7 |
| `pct_8_10` | Decimal | % of alerts scoring 8–10 |
| `flagged` | Boolean | Whether an admin alert was sent |

Create this table in NocoDB before deploying the function. The table ID must be added to the env configuration used by this function (or hardcoded as a constant if the project uses constants for table IDs).

---

## n8n Workflow Addition

`runWeeklyCalibration()` is called by a new minimal workflow: one Schedule Trigger node (every Monday at 09:00 local time) connected to one Code Node that calls `runWeeklyCalibration(deps)`.

This workflow is separate from `w4-market.json` and `w4-afterhours.json` — it does not modify those workflows. The new workflow is self-contained and can be created manually in the n8n UI or imported from a small JSON snippet included in the unit's `usage.md`.

The Code Node receives `fetchFn`, `sleep`, and `env` via the standard n8n dependency injection pattern used throughout the project.

---

## Expected Distribution Targets (Reference)

Based on professional insider tracking services, the expected healthy distribution is:

| Bucket | Target Range |
|--------|-------------|
| 8–10 | 10–20% of alerts |
| 6–7 | 30–40% |
| 4–5 | 30–40% |
| 1–3 | 10–20% |

If the live distribution consistently falls outside these ranges after the first few weeks of data, the factor weights in `computeBaseScore()` (section-01) need re-tuning — not this calibration function. This function is the detector, not the fix.

---

## Dependency Notes

- **Section-01** must be complete: `computeBaseScore()` must be writing `final_score` to NocoDB records before this function has useful data to query.
- **Section-03** must be complete: the filtering logic ensures that G/F and exercise-and-sell records are stored as null and not counted in the distribution. If section-03 is not complete, calibration may count null records or score-0 records incorrectly.
- **Unit 08 (NocoDB migration)**: `NOCODB_BASE_URL` and `NOCODB_API_TOKEN` must be available in the n8n env. If not available, the function logs a warning and exits without crashing.

---

## Implementation Notes (Actual)

- Files modified: `n8n/code/insiderbuying/score-alert.js`, `tests/insiderbuying/score-alert.test.js`
- **`NOCODB_BASE_URL` vs spec's `NOCODB_API_URL`**: Implementation uses `NOCODB_BASE_URL` throughout, consistent with `nocodb-client.js` constructor terminology and the rest of the codebase. Spec comment updated accordingly.
- **`sleep` dep**: Accepted for dep-injection consistency; unused in this function (calibration does not need artificial delays).
- **NocoDB write guarded**: `nocodb.create(CALIB_TABLE, ...)` is wrapped in try/catch so a missing table or column mismatch does not surface as an unhandled rejection in n8n.
- **Telegram `res.ok` checked**: Non-throwing 4xx responses from Telegram are caught and logged.
- **`limit: 1000`**: Query cap sufficient for 7 days of insider alerts.
- **`fields: 'final_score'`**: Only the score field is fetched to minimize response size.
- 138/138 tests pass (full suite).
