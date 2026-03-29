# Section 05: Structured Alert Analysis

## Overview

Rewrite `runAnalyzeAlert()` in `analyze-alert.js` to produce structured, data-rich analysis copy with a Hook/Context/What-to-Watch format. Add a `getWordTarget(score)` helper, a direction-aware prompt, real-time Finnhub data injection, earnings date lookup, and portfolio percentage computation.

This section has no dependencies on sections 01–04. It runs in parallel with section-01 and section-07. Section 06 (analysis validation) depends on this section.

---

## Dependency on Section 07

Section 07 builds `finnhub-client.js`. This section calls `getQuote()` and `getNextEarningsDate()` from that module. Both functions return `null` on failure — this section must handle null gracefully (omit the data rather than crash).

If implementing this section before section 07 is complete, stub `getQuote` and `getNextEarningsDate` as functions that return `null`.

---

## Files to Modify

- `n8n/code/insiderbuying/analyze-alert.js` — rewrite `runAnalyzeAlert()`, add `getWordTarget()`

---

## Tests First

**File**: `n8n/tests/analyze-alert.test.js` — add a `"Structured Analysis (Section 05)"` describe block.

Write these tests before implementing. Use Jest with dependency injection: pass `fetchFn` as `jest.fn()`, `sleep` as `() => Promise.resolve()`, and `env` as a plain object.

### Word Target Routing

```
describe('getWordTarget', () => {
  // getWordTarget(9)  → { target: 225, max: 300 }
  // getWordTarget(7)  → { target: 200, max: 275 }
  // getWordTarget(5)  → { target: 125, max: 175 }
  // getWordTarget(2)  → { target: 100, max: 150 }
  // getWordTarget(score not matching any bucket) → returns default (lowest) target
})
```

### Direction-Aware Prompt

```
describe('direction-aware prompt', () => {
  // direction = 'A' → prompt string contains "buy" framing, does NOT contain "sold" language
  // direction = 'D' → prompt string contains "sold" framing, does NOT contain bullish language
  // direction = 'D' → sell prompt includes the question "tax plan or bearish signal?"
  //                   in the hook guidance section
})
```

These tests should inspect the string that would be sent to DeepSeek, not the final returned analysis. Extract prompt construction into a testable helper so the string is accessible without making a real API call.

### Data Injection

```
describe('data injection', () => {
  // Finnhub returns valid quote →
  //   current_price and pct_change_today are present in the prompt string
  // Finnhub returns null →
  //   price fields are omitted from prompt, no throw
  // sharesOwnedAfter is a number →
  //   portfolio_pct is computed and injected into the prompt
  // sharesOwnedAfter = null →
  //   portfolio_pct is omitted from the prompt
  // earnings date within 60 days →
  //   "Earnings in X days" phrase is present in the prompt
  // earnings date = null →
  //   earnings sentence is omitted from the prompt entirely
})
```

---

## Implementation

### `getWordTarget(score)`

A small pure function exported from `analyze-alert.js`. Maps the final alert score to a word budget object.

```javascript
function getWordTarget(score) {
  // Returns { target, max }
  // Buckets (inclusive ranges):
  //   score 8–10  → { target: 225, max: 300 }
  //   score 6–7   → { target: 200, max: 275 }
  //   score 4–5   → { target: 125, max: 175 }
  //   score 1–3   → { target: 100, max: 150 }
  //   fallback    → { target: 100, max: 150 }  (default for unexpected values)
}
```

The `target` is the ideal word count injected into the prompt. The `max` is the hard upper limit enforced by the validation layer (section 06). This function is called before prompt construction so both values can be used in the prompt template.

### Prompt Construction Helper

Extract prompt building into a dedicated internal function so it can be tested without calling DeepSeek:

```javascript
function buildAnalysisPrompt(alert, marketData, wordTarget) {
  // alert: { ticker, insiderName, transactionValue, sharesTraded, pricePerShare,
  //          direction, canonicalRole, finalScore, sharesOwnedAfter, ... }
  // marketData: { currentPrice, pctChangeToday, daysToEarnings, portfolioPct }
  //             (any field may be null — omit that sentence from the prompt if so)
  // wordTarget: { target, max } from getWordTarget()
  // Returns: prompt string ready to send to DeepSeek
}
```

The returned string must:
1. Include the three structural sections: **Hook**, **Context**, **What-to-Watch**
2. Inject available market data inline (e.g., "Current price: $52.30, up 3.1% today")
3. Omit any data sentence whose value is null (do not write "Current price: unknown")
4. Set word target explicitly: "Write approximately {target} words, do not exceed {max}"
5. Be direction-aware (see below)

### Direction-Aware Framing

The prompt template uses `direction_text` to adapt framing. Key differences:

| Section | Buy (`direction = 'A'`) | Sell (`direction = 'D'`) |
|---------|------------------------|--------------------------|
| Hook guidance | Frame conviction, bullish timing | Frame ambiguity: tax plan or bearish signal? |
| Context | Why this purchase signals confidence | Why insiders sell (tax, diversification, conviction) |
| What-to-Watch | Named catalyst (earnings date, price level) | Same catalyst requirement applies |

Both directions require the **same structural output**: Hook, Context, What-to-Watch. Only the framing language changes.

### What-to-Watch Requirements

The prompt must be explicit that What-to-Watch requires a **specific catalyst with a date or price level**. Vague statements are prohibited. Include these examples in the prompt:

- "Earnings on April 15"
- "FDA decision expected May"
- "Next resistance: $52.30"
- "Watch for Form 4 follow-on filings by other insiders before month-end"

### Data Injection Details

Before building the prompt, `runAnalyzeAlert()` must:

1. **Call `getQuote(ticker, fetchFn, env)`** from `finnhub-client.js`. If the return is non-null, extract `c` (current price) and `dp` (% change today). If null, skip both fields.

2. **Call `getNextEarningsDate(ticker, fetchFn, env)`** from `finnhub-client.js`. If a date is returned, compute `daysToEarnings = Math.ceil((Date.parse(earningsDate) - Date.now()) / 86400000)`. Include the sentence only if `daysToEarnings > 0` and `daysToEarnings <= 90`.

3. **Compute portfolio percentage** if `alert.sharesOwnedAfter` is present and non-zero. The formula is `(sharesTraded / sharesOwnedAfter) * 100`, rounded to one decimal. Example output: "represents 12.4% of their current holdings."

4. **Set `percentageDataAvailable`** to `true` if either `pctChangeToday` (from Finnhub) or `portfolioPct` (from `sharesOwnedAfter`) was successfully computed. Pass this flag to `validateAnalysis()` in section 06.

### `runAnalyzeAlert()` Updated Flow

```
1. getWordTarget(alert.finalScore)         → wordTarget
2. getQuote(ticker, fetchFn, env)          → quote (nullable)
3. getNextEarningsDate(ticker, fetchFn, env) → earningsDate (nullable)
4. compute portfolioPct if sharesOwnedAfter present
5. set percentageDataAvailable flag
6. buildAnalysisPrompt(alert, marketData, wordTarget) → promptString
7. call DeepSeek with promptString, temperature 0.3
8. validateAnalysis(text, score, direction, percentageDataAvailable)
   → if invalid: retry with errors appended (section 06 handles this)
   → if double fail: return minimal fallback template (section 06 handles this)
9. return { analysisText, percentageDataAvailable, wordTarget, attemptCount }
```

The function signature `runAnalyzeAlert(alert, deps)` is unchanged. `deps` includes `fetchFn`, `sleep`, and `env`.

### Minimal Fallback Template (for reference)

The fallback template is defined and returned in section 06's validation retry logic. This section only needs to know its shape exists — do not implement it here. When double validation fails, section 06 returns:

```
"{insiderName} {bought/sold} {sharesTraded} shares at ${pricePerShare}. Score: {finalScore}/10."
```

---

## NocoDB Earnings Calendar

`getNextEarningsDate()` reads from the NocoDB `earnings_calendar` table, which is populated daily by the unit 09 data pipeline job. This section does NOT write to that table — it only reads. The table structure expected by `finnhub-client.js`:

- `ticker` (text): stock ticker symbol
- `earnings_date` (date): next earnings date in ISO format
- `confirmed` (boolean): whether the date is confirmed or estimated

If the table does not exist (unit 09 not yet complete), `getNextEarningsDate()` returns null and the earnings sentence is silently omitted from the prompt. No crash.

---

## Word Target Map (Canonical Reference)

| Score Range | target | max  |
|-------------|--------|------|
| 8–10        | 225    | 300  |
| 6–7         | 200    | 275  |
| 4–5         | 125    | 175  |
| 1–3         | 100    | 150  |

Lower-scored alerts have less to say (routine director purchase). Higher-scored alerts warrant more depth. The upper bound is a hard max enforced by `validateAnalysis()`; the target is the ideal length communicated to the LLM.

---

## Banned Phrases (for context — enforced in section 06)

Do not include these in any prompt template or example output. They are caught by `validateAnalysis()` in section 06:

- "guaranteed"
- "will moon"
- "to the moon"
- "can't lose"
- "sure thing"

---

## Integration Notes

- `runAnalyzeAlert()` is called by `w4-market.json` and `w4-afterhours.json` workflow nodes. The function signature must remain `runAnalyzeAlert(alert, deps)` — no changes to callers.
- The `direction` field on the alert object comes from `runScoreAlert()` (section 03). If `direction` is absent (unit 09 not yet providing it), default to `'A'` (acquisition framing) rather than crashing.
- Section 06 (analysis validation) depends directly on `validateAnalysis()` being called from within `runAnalyzeAlert()`. Keep the validation call inside this function — do not move it elsewhere.

---

## Implementation Notes (Actual)

- Files modified: `n8n/code/insiderbuying/analyze-alert.js`, `tests/insiderbuying/analyze-alert.test.js`
- **Backward compatibility**: Old `buildAnalysisPrompt(filing)` → renamed to internal `_buildLegacyPrompt(filing)`, used only by `analyze()`. New exported `buildAnalysisPrompt(alert, marketData={}, wordTarget=null)` aliases both snake_case and camelCase field names. All old tests pass unchanged.
- **Finnhub stub pattern**: Module-level `let _getQuote = async () => null` replaced by `require('./finnhub-client')` inside a `try/catch` — bare catch is intentional to handle in-progress S07 state gracefully.
- **Minimal fallback template**: Implemented in S05 as a bridge until S06 provides the richer version. Comment marks it as S06-owned. Spec says "don't implement here" but the function cannot omit `analysisText` when both API calls fail.
- **`cluster_size` guard**: Added `!= null` fallback to `'multiple'` — pre-existing bug in legacy prompt, fixed in new prompt.
- **`validateAnalysis` signature extended**: Added optional `(score, direction, pctAvailable)` params silently ignored for now — S06 adds the logic.
- **52/52 tests pass** (19 legacy + 33 new S05 tests).
