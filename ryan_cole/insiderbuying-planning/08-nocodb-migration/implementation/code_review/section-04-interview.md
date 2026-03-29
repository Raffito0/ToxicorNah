# Section 04 Code Review Interview

## Auto-fixes Applied

### Fix 1 — Important: GAP 12.14 Part 2 — strip url from article context (send-outreach.js)
**Problem:** `buildEmailPrompt` accepted the full `ourArticle` object including `url` in scope, even though the prompt string no longer interpolated it. Risk: future refactor or LLM hallucination could access the URL.
**Fix:** Destructured only `title` and `summary` at the top of the function. `ourArticle.url` is never extracted. Comment marks the intent: `// GAP 12.14: only extract title and summary — never forward url to the LLM`.
**New test:** "GAP 12.14: article with url passed in — prompt still has no URL" — verifies that even when a full `{ title, url, summary }` object is passed, the URL does not appear in the generated prompt.

## Let Go (deliberate deferrals)

- **Issue 2** (GAP 12.14 Part 3 — `scrubUrls` post-generation): spec marked this optional. Deferred intentionally. If the LLM ever hallucinates URLs despite the prompt fix, this can be added as a post-processing step.
- **Issues 3–7** (minor suggestions): Not blocking. Test semantics for empty string in `validateEmail`, fallback path tests, and ticker query format — all acceptable gaps given the pure-function nature of these modules.

## Final Test Count: 59 (39 send-outreach + 19 find-prospects + 1 new GAP 12.14 context test)
