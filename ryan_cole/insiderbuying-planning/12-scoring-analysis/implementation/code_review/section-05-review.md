# Section 05 Code Review — Structured Alert Analysis

## Important Issues

### I1 — `cluster_size` not guarded against undefined
`buildAnalysisPrompt` rendered `"undefined insiders buying"` if `alert.is_cluster_buy` is truthy but `alert.cluster_size` is not set. Same pre-existing bug existed in `_buildLegacyPrompt`.
**Fix**: `const clusterSize = alert.cluster_size != null ? alert.cluster_size : 'multiple'`

### I2 — Bare `catch {}` on finnhub require swallows non-MODULE_NOT_FOUND errors
`catch {}` silently ignores syntax errors in an in-progress `finnhub-client.js`. This makes debugging harder if S07's file has a bug.
**Decision**: Accepted as intentional — S07 may be partially implemented during S05 development. Bare catch is the safe choice for inter-section isolation.

### I3 — Minimal fallback template implemented contrary to spec
Spec section 05 line 172 says "do not implement the fallback here — S06 handles it." Implementation includes minimal fallback at lines 311–317.
**Decision**: Accepted as a bridge until S06 is implemented. `runAnalyzeAlert()` must return `analysisText`; cannot leave it undefined. Comment marks it as S06-owned.

## Suggestions

### S1 — Test gap: `getWordTarget(null)` not covered
**Fix**: Added `getWordTarget(null) → { target: 100, max: 150 }` test.

### S2 — Test gap: `direction` field absent not tested
**Fix**: Added test with direction key omitted — verifies BUY framing default.

### S3 — Test gap: `runAnalyzeAlert` error path not tested
**Fix**: Added test where DeepSeek throws — asserts `result === null`.

### S4 — `score_reasoning` silently dropped from new prompt
New `buildAnalysisPrompt` drops `score_reasoning` that old `_buildLegacyPrompt` included. Intentional — new prompt format doesn't need it. `analyze()` still uses `_buildLegacyPrompt`.

### S5 — `percentageDataAvailable` combines two kinds of percentage data
Design note for S06: flag is true for both `pctChangeToday` (market price change) and `portfolioPct` (insider holdings %). S06 must handle both cases when validating percentage references in the text.

## Accepted Patterns

- **Field aliasing for backward compat** (`||` chain with `!= null` checks) is the correct pattern for supporting both snake_case and camelCase without branching
- **`getWordTarget` pure function** — trivially testable, no side effects, correctly covers all score ranges and edge values
- **Direction-aware framing** — `isBuy` boolean derived once, used for label/verb/guidance. SELL framing avoids asserting bearish intent.
- **Market data injection** — `!= null` guards on each `filingLines.push()` correctly handles null, undefined, and falsy-but-valid (like 0)
- **Temperature 0.3** for structured output — correct tradeoff between variance and structure adherence
- **`if (sleep) await sleep(2000)`** — clean optional dep injection for test speed
- **`validateAnalysis` signature extension** — extra params silently ignored, fully forward-compatible with S06
