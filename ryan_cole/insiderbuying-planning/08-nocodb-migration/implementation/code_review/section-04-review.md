# Section 04 Code Review

## Issues

| # | Severity | Description |
|---|----------|-------------|
| 1 | Important | GAP 12.14 Part 2 not implemented: `ourArticle.url` still exists on the object in scope inside `buildEmailPrompt`. Spec requires stripping `url` before use. |
| 2 | Important | GAP 12.14 Part 3 (post-gen URL scrub) unimplemented — spec says optional but absence not documented |
| 3 | Minor | `validateEmail('')` test passes for wrong reason (CTA missing, not empty guard) |
| 4 | Suggestion | No test for `site_name` absent → `domain` fallback in prompt |
| 5 | Suggestion | No test for `sent_at` absent → `created_at` fallback in `checkForFollowUps` |
| 6 | Suggestion | `buildSearchQueries` ticker test checks `includes('AAPL')` not `'AAPL analysis'` |
| 7 | Suggestion | `dedup` no test for prospect with missing domain field |

## Verdict
Fix Issue #1 before commit. Issue #2 is optional — will document as deliberate deferral. Issues 3–7 are nice-to-have.
