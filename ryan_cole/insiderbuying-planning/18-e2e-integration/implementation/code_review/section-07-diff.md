# Section 07 Diff — Report Pipeline E2E

## File Created
`ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/05-report-pipeline.test.js`

## Summary
14 tests in 5 describes (1 fixture pre-check + 4 chain test groups) — 69 total passing after this section.

## Key deviations from spec
1. Spec says to call `buildReportPrompt` 9 times in a loop — production uses `generateReportSection()` as the section generator; `buildReportPrompt` is a completely different function (single-call prompt builder for legacy mode)
2. `buildReportRecord` returns `status: 'delivered'` not `status: 'published'` as spec states
3. Context accumulation uses `completedSections` array (not a key-value context object) — tested via `generateReportSection` directly, not via a context-merging loop
4. `generateReport` tested directly (H1 fix) with a 11-call `makeFetchSeq` sequence covering all 9 sections + bear_case review + exec_summary
5. Word-count gate requires section-specific mock text lengths; TEXT_400/TEXT_500/TEXT_700 fixtures chosen to pass each section's [0.8*wt, 1.2*wt] range
