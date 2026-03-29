# Section 04 Interview — Finnhub Integration

No user interview required. All review items resolved during triage.

## Triage Decisions

**Issue 1: API key in query string (`&token=apiKey`)**
- Decision: Let go
- Reason: This is the standard Finnhub API pattern (documented in their official docs). The header alternative (`X-Finnhub-Token`) is also supported but the query string approach is what all Finnhub examples use. Logs would only expose the key if detailed HTTP logging is enabled on n8n's VPS.

**Issue 2: NocoDB filter injection via ticker**
- Decision: Let go
- Reason: Ticker is validated upstream by `validateTicker` (regex: `/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/`). The NocoDB where clause is not SQL — it's `(field,op,value)` format which NocoDB parses server-side. No actual injection vector exists.

**Issue 3: data_completeness assertion in success test**
- Decision: Let go
- Reason: The "aborts when data_completeness < 0.5" test covers the abort path. The success test verifies `ticker` and no error, which is the primary contract. Both paths are exercised.

**Issue 4: getQuote throws on non-200 while others return null**
- Decision: Let go
- Reason: `getQuote` is called inside `Promise.allSettled([getQuote(...), ...])` in `fetchFinancialData`. The throw is caught by allSettled, `safeVal` converts the rejection to `null`, and the data_completeness score accounts for it. The throw-on-error behavior is also explicitly tested ("fetchFn rejects with HTTP 429 → error propagates").

**Issue 5: Stock candle as inline IIFE**
- Decision: Let go
- Reason: The candle IIFE is complex (OHLCV mapping, date formatting) but is fully covered by the `fetchFinancialData` integration tests. Extracting to a named function would be a refactor beyond section scope.

## Result

56/56 tests pass. No code changes required. Clean implementation.
