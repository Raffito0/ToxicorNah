# Section 03 Code Review

## Overall Verdict: Correct, no blocking issues.

### generateSchema
- JSON-LD structure matches spec exactly (@graph with Article, Person, FinancialProduct)
- Fallbacks for missing article fields (empty string) — will not throw
- `published_at` uses `new Date().toISOString()` fallback — correct

### checkContentFreshness
- Date filter uses `Date.now() - 30 * 24 * 60 * 60 * 1000` — correct 30-day window
- Error catch returns `{ fresh: true, effectiveArticleType: 'insider_buying' }` — safe default per spec
- `nocodbGet` call correctly uses `nocodbOpts.token, nocodbOpts` pattern matching existing helpers
- `encodeURIComponent(where)` prevents injection via ticker — good

### uploadChart
- Full AWS Sig V4 implementation matching `generate-image.js` pattern — correct
- `Content-Type: image/png` set in both canonical headers and request headers — correct
- Throws on non-ok response (for caller to catch) — matches spec

### replaceVisualPlaceholders
- Per-token try/catch with `console.warn` on failure — does not throw — matches spec
- Missing token warns and skips (not throws) — correct
- When `templates` is absent, continues gracefully (leaves tokens unreplaced) — correct degradation
- Mutates `article.body_html` and returns the article — consistent with spec

### Pipeline integration
- `checkContentFreshness` placed before outline generation (Step 2.5) — correct per spec
- `replaceVisualPlaceholders` placed after quality gate passes (Step 8.5) — correct
- `generateSchema` placed after visual replacement (Step 8.55) — correct
- `effectiveArticleType` captured but not yet plumbed into outline/slug calls — minor gap, acceptable for this section scope

### Tests
- 18 new tests covering all 4 functions
- `checkContentFreshness` date range test uses year-ago lower bound — robust
- `replaceVisualPlaceholders` tests inject mock `templates.renderTemplate` — correct isolation
