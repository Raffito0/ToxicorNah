# Section 02 Code Review Interview

## Review findings and decisions

### Auto-fixed: createClaudeClient instantiated inside retry loop
**Finding**: `createClaudeClient(fetchFn, anthropicApiKey)` was called inside the 2-attempt loop in `generateArticleOutline`, creating two client instances unnecessarily.
**Fix**: Moved instantiation above the loop as `outlineClient`.

### Auto-fixed: Check 19 generic opening used unsafe HTML-stripping regex
**Finding**: `body.replace(/^(<[^>]+>)+/, '')` would not strip whitespace between tags (e.g. `<p>\n<strong>In this article`), allowing bypass.
**Fix**: Changed to use already-computed `bodyPlain.trimStart().slice(0, 100)`.

### Auto-fixed: staleness_warning not propagated to NocoDB
**Finding**: `gate.staleness_warning` was computed but discarded. No observable effect in production.
**Fix**: Added `article.staleness_warning = gate.staleness_warning` before `writeArticle()`, and added `staleness_warning` field to the NocoDB payload.

### Let go: Check 16 does not recognize "key takeaways" (plural)
`tldrPhrases` checks for `"key takeaway"` (singular). The plural `"key takeaways"` is included via substring match since `"key takeaway"` is a prefix. No change needed.

### Let go: Plan doc inconsistency (daysSinceFiling=48 → staleness_warning)
Plan text says `daysSinceFiling=48` → `staleness_warning: false`, but threshold is `> 24`. Implementation and tests are correct. Plan doc has the error.

### Let go: Jest test file covers only 3 gate checks
The `tests/insiderbuying/generate-article.test.js` file has 3 source-code checks and 3 gate tests. Full gate coverage lives in `n8n/tests/generate-article.test.js` (115 tests). Acceptable split.
