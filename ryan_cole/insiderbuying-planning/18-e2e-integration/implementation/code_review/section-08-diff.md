# Section 08 Diff — Newsletter Pipeline E2E

## File Created
`ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/06-newsletter-pipeline.test.js`

## Summary
9 tests in 3 describes (1 fixture pre-check + 2 chain test groups) — 79 total passing after this section.

## Key deviations from spec
1. `assembleFreeHtml` mentions "Pattern Recognition" and "What I'm Watching" in the upgrade CTA text — test assertion changed from `.not.toContain('Pattern Recognition')` to `.not.toContain('<h2>Pattern Recognition</h2>')` to correctly verify section headers are absent (not the text itself)
2. `generateNewsletter` uses `_aiClient.complete()` (not fetchFn) — tests use `{ _aiClient: mockAiClient }` injection
3. `sendViaBeehiiv` uses `_postFn(url, headersObj, bodyStr)` signature — test verifies `call[2]` (third arg) as JSON body string
4. `checkWordCount` formula: s1+s2+s3+s4+s5+max(s6_pro,s6_free) — using `makeSections(180)` gives 180×6=1080 words (valid range)
