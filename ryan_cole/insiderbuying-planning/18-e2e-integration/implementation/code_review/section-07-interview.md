# Code Review Interview — Section 07: Report Pipeline E2E

**Date**: 2026-03-29
**Review file**: section-07-review.md
**Tests before interview**: 65/65 passing
**Tests after interview**: 69/69 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**HIGH: Add `generateReport()` full orchestration test (H1)**
- Added test in new describe `'generateReport full orchestration'`
- 11-call `makeFetchSeq` sequence: 9 sections + 1 bear_case review (score 8, no retry) + 1 exec_summary
- Word counts chosen to pass each section's gate: TEXT_400 for 400-target sections, TEXT_500 for 500/600-target sections, TEXT_700 for 700/800-target sections
- Asserts: result is array of length 10, contains all 9 section ids plus `exec_summary`, `exec_summary` is last, `expectFetchCalledTimes(fetchFn, 11)`
- Catches bugs in `generateReport`'s completedSections accumulation and bear_case review wiring

**HIGH: Add `reviewBearCaseAuthenticity` parse-failure fallback test (H2)**
- Added test: non-JSON response → `result.score === 5, result.reasoning === 'Parse failed'`
- Confirms fallback score (5) is still < 7 → would still trigger bear_case retry in `generateReport`
- Catches if fallback was accidentally changed to >= 7

**HIGH: Assert `callBody.system` contains 'short seller' for bear_case (H3)**
- Added dedicated test: `generateReportSection('bear_case', ...)` → parse first fetch call body → `expect(callBody.system).toContain('short seller')`
- Verifies `BEAR_CASE_SYSTEM_PROMPT` is selected (not generic `buildSectionSystemPrompt`)

**MEDIUM: Remove unused `makeRouter` import (M1)**
- Removed `makeRouter` from imports — was never used in this file

**MEDIUM: Remove redundant date `typeof`/`length` assertions from first buildReportRecord test (M4)**
- Replaced `typeof result.generated_at === 'string'` + `.length > 0` with `.toBeTruthy()` (weaker but non-redundant with the dedicated ISO parse test)
- Single source of truth for date validity: the ISO parse test at the end of 5.3

**MEDIUM: Add word-count retry test (M5)**
- Added test in new describe `'generateReportSection word-count retry'`
- First response: 200-word text (below 480-word minimum for 600 target) → triggers retry
- Second response: TEXT_500 (in range) → passes
- Asserts: `expectFetchCalledTimes(fetchFn, 2)`, retry call body contains `'Rewrite to hit the target'`, result equals retry response text

---

### Let-go items

**`_buildReportHTMLFromSections` untested (M2)**: Out of scope for this section — requires chart fixtures and config objects. Legacy mode test provides sufficient coverage for the shared template structure.

**Bear case retry content assertions weak (M3)**: The `expectFetchCalledTimes(fetchFn, 3)` is the load-bearing check. Content assertions add minimal value for this test.

**Minor style items (L1-L4)**: Nitpicks not worth modifying.

---

## Result

All fixes applied. Tests re-run after all changes: **69/69 passing**.
