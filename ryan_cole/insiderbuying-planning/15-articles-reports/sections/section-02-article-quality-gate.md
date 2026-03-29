# Section 02: Merged Quality Gate (~18-20 Checks)

## Overview

This section upgrades the quality gate in `generate-article.js` from the current 14-check gate to a merged ~18-20 check gate. It also adds all required helper functions for readability scoring. The result is a single `qualityGate(article, opts)` function with a comprehensive return type.

**File to modify**: `n8n/generate-article.js`
**Test file**: `n8n/tests/generate-article.test.js`
**Dependencies**: None — this section is fully independent.

---

## Tests First

Add these tests to `n8n/tests/generate-article.test.js`. All functions are pure and accept no injectable `fetchFn` — they work entirely on in-memory data.

### Helper Function Tests

```js
// countSyllablesInline
// Test: countSyllablesInline('IPO') → 3
// Test: countSyllablesInline('ETF') → 3
// Test: countSyllablesInline('CEO') → 3
// Test: countSyllablesInline('Ceo') → 3  (mixed case normalized to uppercase before override lookup)
// Test: countSyllablesInline('ceo') → 3  (lowercase normalized to uppercase)
// Test: countSyllablesInline('SEC') → 3
// Test: countSyllablesInline('ESG') → 3
// Test: countSyllablesInline('CFO') → 3
// Test: countSyllablesInline('COO') → 3
// Test: countSyllablesInline('CTO') → 3
// Test: countSyllablesInline('the') → 1
// Test: countSyllablesInline('table') → 2
// Test: countSyllablesInline('introduction') → 4  (tolerance: accept 3–5)

// computeFleschKincaidEase
// Test: computeFleschKincaidEase('') → null  (not throw)
// Test: computeFleschKincaidEase('<p>word</p>') → null  (single word, no full sentence — guard division-by-zero)
// Test: computeFleschKincaidEase('<p>The cat sat.</p>') → score in range [60, 90]
// Test: computeFleschKincaidEase(complexFinanceParagraph) → score in range [20, 60]
//   where complexFinanceParagraph contains multi-syllable financial jargon
// Test: computeFleschKincaidEase('<p>Hello world.</p><h2>Ignored heading</h2>') → strips HTML tags before computing
// Test: computeFleschKincaidEase('<script>var x=1;</script><p>One sentence.</p>') → strips <script> blocks

// extractSentences
// Test: extractSentences('<p>One. Two! Three?</p>') → array of length 3

// countWords
// Test: countWords('<p>Hello world</p>') → 2

// stdDev
// Test: stdDev([1, 1, 1]) → 0
// Test: stdDev([1, 2, 3]) → approximately 0.816  (tolerance ±0.01)

// mean
// Test: mean([2, 4, 6]) → 4
```

### Quality Gate Check Tests (each check individually)

```js
// Title length
// Test: qualityGate({ title: 'X'.repeat(60), ... }) → PASS title check
// Test: qualityGate({ title: 'X'.repeat(54), ... }) → FAIL — error mentions title length

// Meta description
// Test: meta_description of 147 chars → PASS
// Test: meta_description of 139 chars → FAIL

// Key takeaways
// Test: key_takeaways with 3 entries each containing a number → PASS
// Test: key_takeaways with 2 entries → FAIL
// Test: key_takeaways with 3 entries but one has no number → FAIL

// Verdict fields
// Test: verdict_type populated, verdict_text populated with a number → PASS
// Test: verdict_type missing → FAIL
// Test: verdict_text present but contains no number → FAIL

// Banned AI phrases
// Test: body_html contains "In today's fast-paced" → FAIL
// Test: body_html with no banned phrases → PASS

// Numeric density (≥40% of paragraphs contain a number)
// Test: body_html with 4 of 8 paragraphs containing numbers → PASS (50% ≥ 40%)
// Test: body_html with 2 of 8 paragraphs containing numbers → FAIL (25% < 40%)
// Note: check runs on plain text AFTER stripping all HTML tags — img tags must not introduce false positives

// FK Ease 25–55
// Test: FK score 30 → PASS
// Test: FK score 24 → FAIL (below 25)
// Test: FK score 56 → FAIL (above 55)
// Test: FK score 25 → PASS (boundary — inclusive)
// Test: FK score 55 → PASS (boundary — inclusive)

// Word count 1800–2500
// Test: word count 1800 → PASS
// Test: word count 2500 → PASS
// Test: word count 1799 → FAIL
// Test: word count 2501 → FAIL

// Visual placeholders ≥3
// Test: body_html contains {{VISUAL_1}}, {{VISUAL_2}}, {{VISUAL_3}} → PASS
// Test: body_html contains only {{VISUAL_1}} and {{VISUAL_2}} → FAIL

// Internal links ≥4
// Test: body_html contains 4 href="/" links → PASS
// Test: body_html contains 3 href="/" links → FAIL
// Note: only links where href starts with "/" count as internal

// CTA in first 500 chars
// Test: "subscribe" appears within first 500 chars of body_html → PASS
// Test: "subscribe" only appears at char 600 → FAIL
// Test: "alert" within first 500 chars → PASS (any of: alert/subscribe/notification/free)

// Track record section
// Test: body_html contains "track record" (case-insensitive) → PASS
// Test: body_html missing "track record" → FAIL

// Social proof
// Test: body_html contains "subscriber" → PASS
// Test: body_html missing any social proof phrase → FAIL

// Filing timeliness
// Test: opts.daysSinceFiling = 48 → PASS, staleness_warning: false
// Test: opts.daysSinceFiling = 73 → FAIL (hard fail — > 72h)
// Test: opts.daysSinceFiling = 25 → PASS with staleness_warning: true in result
// Test: opts.daysSinceFiling = 23 → PASS with staleness_warning: false

// TLDR in first 200 words
// Test: body_html has a TLDR keyword within first 200 words of plain text → PASS
// Test: TLDR keyword only appears after word 200 → FAIL
// Note: word boundary is computed after stripping HTML tags

// Sentence variation CV > 0.45
// Test: body_html with varied sentence lengths (CV > 0.45) → PASS
// Test: body_html with uniform sentence lengths (CV ≤ 0.45) → FAIL
// Test: body_html with only 1 sentence → CV check skipped — returns null, not FAIL
//   (qualityGate does not add this to the errors array)

// Keyword density 1.0–2.5%
// Test: keyword appears 1.5% of words → PASS
// Test: keyword appears 0.9% → FAIL
// Test: keyword appears 2.6% → FAIL

// No generic opening
// Test: body_html first 100 chars start with "In this article" → FAIL
// Test: body_html first 100 chars start with "Today we explore" → FAIL
// Test: body_html first 100 chars start with a non-banned specific sentence → PASS

// All checks pass
// Test: article passing all checks → { valid: true, errors: [], staleness_warning: false }

// Multiple failures
// Test: article failing 3 checks → errors array has exactly 3 entries, one per failed check
```

---

## Implementation Details

### Return Type

```js
// qualityGate(article, opts) returns:
// { valid: boolean, errors: string[], staleness_warning: boolean }
//
// opts shape:
// { daysSinceFiling: number, primaryKeyword: string }
```

### Checks Retained from Existing Gate

These 5 checks are kept without modification:

1. **Meta description 140–155 chars** — `article.meta_description.length`
2. **Key takeaways** — `article.key_takeaways` is an array of 3–4 items, each containing at least one digit character
3. **Verdict fields** — `article.verdict_type` is non-empty AND `article.verdict_text` contains at least one digit
4. **Zero banned AI phrases** — the 83-phrase list already in the file; scan `article.body_html` stripped of HTML tags
5. **Numeric density ≥40%** — count `<p>` paragraphs in `body_html`; for each, strip HTML and check if the plain text contains a digit. IMPORTANT: run on text after stripping ALL HTML tags, not on raw HTML. Img tags with `src="...123..."` must not count as containing numeric data.

### Checks Upgraded

These 3 checks replace inferior existing versions:

6. **FK Ease 25–55** — replaces the old FK Grade 8–10 check. Range is 25–55 (not 30–50 from spec) to account for the inline syllable counter's inherent ±10% inaccuracy. Uses `computeFleschKincaidEase(article.body_html)`. If `computeFleschKincaidEase` returns null (edge case with no words or sentences), skip this check — do not fail.

7. **Visual placeholders ≥3** — replaces `data_tables_count >= 1`. Count occurrences of `{{VISUAL_1}}`, `{{VISUAL_2}}`, `{{VISUAL_3}}` in `article.body_html`.

8. **Word count 1800–2500** — replaces the length-variant range. Use `countWords(article.body_html)`.

### New Checks from Spec

These 10 checks are new additions:

9. **Internal links ≥4** — regex-match `href="/"` or `href="/[^"]*"` patterns in `body_html`. Only count hrefs that start with `"/"`.

10. **CTA in first 500 chars of body_html** — check if any of these words appear within `body_html.slice(0, 500)`: `alert`, `subscribe`, `notification`, `free` (case-insensitive).

11. **Track record section** — check if `body_html` (plain text) contains the phrase `track record` (case-insensitive).

12. **Social proof** — check if `body_html` (plain text) contains phrases like `subscriber`, `members`, or `readers` (case-insensitive). At least one must be present.

13. **Filing timeliness** — `opts.daysSinceFiling > 72` is a hard FAIL. `opts.daysSinceFiling > 24` sets `staleness_warning: true` in the return object (but does NOT add to `errors`). `daysSinceFiling <= 24` → `staleness_warning: false`. Note: `staleness_warning` is tracked independently of `valid`.

14. **TLDR in first 200 words** — strip HTML from `body_html`, split to words array, take the first 200 words as a string, check if it contains `tldr`, `tl;dr`, `key takeaway`, or `in brief` (case-insensitive).

15. **Sentence variation CV > 0.45** — compute sentence lengths (word count per sentence) from `extractSentences(body_html)`, then compute `stdDev(lengths) / mean(lengths)`. If the result is ≤ 0.45, fail. GUARD: if `extractSentences` returns an array of length ≤ 1, skip this check entirely — do not add to errors.

16. **Keyword density 1.0–2.5%** — count occurrences of `opts.primaryKeyword` (case-insensitive) in the plain text of `body_html`, divide by total word count. Fail if outside `[1.0%, 2.5%]`.

17. **No generic opening** — take the first 100 chars of `body_html` (stripped of leading HTML tags like `<p>`, `<div>`, etc.), then check against a banned opening phrases list: `["In this article", "Today we", "In today's", "Welcome to", "Are you", "Have you ever"]`. Case-insensitive prefix match. If the stripped text starts with any banned phrase, fail.

18. **Title 55–65 chars** — already in the existing gate. Keep unchanged.

### Total Check Count

With the above breakdown: 5 retained + 3 upgraded + 10 new + 1 unchanged title = 19 checks. The `staleness_warning` flag is tracked separately and does not affect `valid`.

---

## Helper Functions

### `countSyllablesInline(word)`

Signature: `countSyllablesInline(word: string) -> number`

A pure, CommonJS-compatible syllable counter (~20 lines) inlined directly in `generate-article.js`. No external package.

Logic overview:
1. Normalize `word` to uppercase for abbreviation lookup.
2. Check against the finance abbreviation override map: `{ IPO: 3, ETF: 3, CEO: 3, SEC: 3, ESG: 3, CFO: 3, COO: 3, CTO: 3 }`. If found, return the override value immediately.
3. Lowercase the word, strip non-alpha characters.
4. Use vowel-cluster regex heuristics: count matches of `/[aeiouy]+/gi`. Apply standard corrections (trailing silent e, etc.).
5. Return at least 1 (minimum syllable count for any non-empty word).

### `computeFleschKincaidEase(html)`

Signature: `computeFleschKincaidEase(html: string) -> number | null`

Steps:
1. Strip `<script>` and `<style>` blocks (including content) before stripping other HTML tags.
2. Strip remaining HTML tags.
3. Call `countWords(plainText)` and `extractSentences(plainText)`.
4. Guard: if `words === 0` or `sentences === 0`, return `null`.
5. Count syllables: sum `countSyllablesInline(w)` over all words.
6. Apply FK formula: `206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)`.
7. Return the result (can be negative for very dense text — do not clamp).

### `extractSentences(html)`

Signature: `extractSentences(html: string) -> string[]`

Strip HTML tags from the input, then split on sentence-ending punctuation (`.`, `!`, `?`) followed by whitespace or end-of-string. Filter out empty strings. Return the array.

### `countWords(html)`

Signature: `countWords(html: string) -> number`

Strip HTML tags, split on whitespace, filter empty strings, return `.length`.

### `stdDev(arr)`

Signature: `stdDev(arr: number[]) -> number`

Population standard deviation: `sqrt(sum((x - mean)^2) / n)`. Return 0 for arrays of length 0 or 1.

### `mean(arr)`

Signature: `mean(arr: number[]) -> number`

Sum divided by length. Return 0 for empty array.

---

## Integration with Retry Logic

The existing retry logic (2 attempts max for the draft) is unchanged. When `qualityGate` returns `{ valid: false, errors: [...] }`, the calling code injects the failure list into the Step 2 draft prompt as:

```
Previous attempt failed quality gate: [error list]. Fix specifically.
```

The `qualityGate` function itself does not know about retries — it is a pure function called by the orchestration layer. The `staleness_warning` flag is saved to the NocoDB record as a field (e.g., `staleness_warning: true`) but does not trigger a retry.

---

## What NOT to Implement in This Section

- Do not implement `replaceVisualPlaceholders` — that is section 03.
- Do not implement `generateArticleOutline` or persona injection — that is section 01.
- Do not modify the NocoDB write step or downstream triggers.
- Do not add any npm packages — all helpers (`countSyllablesInline`, etc.) are inlined.
- The banned AI phrases list already exists in `generate-article.js` — reuse it, do not duplicate it.

---

## Actual Implementation (Completed)

**Files modified:**
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js`
- `ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/generate-article.test.js`

**Functions added:**
- `countSyllablesInline(word)` — finance abbreviation map + vowel-cluster heuristic, min 1
- `mean(arr)` / `stdDev(arr)` — pure math helpers
- `extractSentences(html)` — decimal-point-aware sentence splitter
- `countWords(html)` — strips HTML, splits on whitespace
- `computeFleschKincaidEase(html)` — strips script/style, applies FK formula

**qualityGate rewritten:**
- Signature: `qualityGate(article, opts)` where `opts = { primaryKeyword, daysSinceFiling }`
- Returns: `{ valid, errors, staleness_warning }`
- 19 checks implemented (checks 1-19 as spec'd)
- `staleness_warning` propagated to NocoDB write payload

**Code review fixes applied:**
- `createClaudeClient` moved outside retry loop in `generateArticleOutline`
- Check 19 uses `bodyPlain.trimStart()` instead of unsafe HTML-stripping regex
- `staleness_warning` added to `writeArticle()` NocoDB payload

**Tests:** 115 passing (node:test) + 15 passing (Jest)
