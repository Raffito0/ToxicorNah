# Section 02 Code Review — Quality Gate Upgrade (14 → 19 checks)

**File reviewed**: `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js`
**Test files reviewed**: `n8n/tests/generate-article.test.js`, `tests/insiderbuying/generate-article.test.js`
**Plan ref**: `ryan_cole/insiderbuying-planning/15-articles-reports/sections/section-02-article-quality-gate.md`

---

## What Was Done Well

- All 19 checks are implemented and match the plan specification exactly.
- The `qualityGate` signature change from positional args to an `opts` object is correct and future-proof.
- Return type changed from `{ pass, failures }` to `{ valid, errors, staleness_warning }` as specified.
- Helper functions are all pure and work on in-memory data — no network calls, no side effects.
- The finance abbreviation override map in `countSyllablesInline` handles the most common financial acronyms correctly.
- `extractSentences` protects decimal numbers (e.g., `$26.0B`, `64.2%`) from being split at the decimal point using the middle-dot substitution trick — a subtle but important edge case for financial text.
- `computeFleschKincaidEase` strips `<script>` and `<style>` blocks before stripping HTML tags, as specified.
- Banned phrase check now runs on plain text (HTML stripped) rather than raw HTML, fixing a false-negative if a banned phrase was split across tag boundaries.
- Numeric density check (Check 7) now runs on per-paragraph plain text, preventing `src="..."` values in `<img>` tags from counting as numeric data.
- `generateArticleOutline` migration from a raw `fetchFn` call to `createClaudeClient` is clean and consistent with the rest of the codebase.
- All new helper functions are exported in `module.exports`, making them directly testable.
- Test coverage in the n8n test file is comprehensive: every check has both a PASS and a FAIL case.

---

## Issues Found

### Critical

None.

---

### Important

**1. `staleness_warning` is computed but never consumed by the caller.**

In `generateArticle`, the gate result is assigned to `gate` but only `gate.errors` is read:

```js
// generate-article.js line ~1268
const allFailures = [...gate.errors];
```

`gate.staleness_warning` is never written to the NocoDB record or logged. The plan states it should be saved as a field on the article record. The fix is one line after the gate call:

```js
article.staleness_warning = gate.staleness_warning;
```

And the field must be included in the NocoDB write payload downstream. Without this, the feature is built but has no observable effect in production.

---

**2. `generateArticleOutline` creates a new `createClaudeClient` instance on every loop iteration.**

```js
for (var attempt = 0; attempt < 2; attempt++) {
  // ...
  var client = createClaudeClient(fetchFn, anthropicApiKey);  // created twice
  var result = await client.complete('', prompt, { maxTokens: 400 });
```

The client is stateless so this is not a correctness bug, but it adds unnecessary object allocation on the retry attempt. Move `createClaudeClient` above the loop. Not a production issue, but worth fixing for cleanliness.

---

**3. Check 19 (generic opening) strips only leading tags, but misses tags that appear after whitespace.**

The strip pattern is:
```js
const strippedOpening = body.replace(/^(<[^>]+>)+/, '').slice(0, 100);
```

This strips consecutive leading tags but stops if there is whitespace between them. A body like `<p>\n<strong>In this article</strong>` would not trigger the check. The plan says "stripped of leading HTML tags like `<p>`, `<div>`". A more robust approach uses the full plain-text conversion already computed as `bodyPlain`, then takes the first 100 characters:

```js
const strippedOpening = bodyPlain.slice(0, 100);
```

`bodyPlain` is already defined earlier in the function (line ~292) as the full HTML-stripped lowercase body. This would make the check consistent with how all other text-based checks work in the function.

---

**4. Test for `daysSinceFiling = 48` asserts `staleness_warning: false`, but the spec says `> 24` should set it to `true`.**

In the test file at line ~978–982:
```js
it('daysSinceFiling=48 -> PASS, staleness_warning=true', () => {
  const r = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 48 });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.staleness_warning, true);
});
```

The test name and assertion are correct. However, the test in the section plan at line 124 says:

> `opts.daysSinceFiling = 48` → PASS, `staleness_warning: false`

This is a contradiction in the plan — 48 > 24, so the implementation correctly sets `staleness_warning: true`, and the test assertion is correct. The plan's text is wrong, not the code. This is fine as-is; flagging so the plan can be corrected for future reference.

---

### Suggestions

**5. `countSyllablesInline` does not handle hyphenated words.**

A word like `risk-adjusted` is passed as-is after the `replace(/[^a-z]/g, '')` strips the hyphen, producing `riskadjusted` — a 4-vowel-cluster word that gets 3 syllables instead of the correct 4. For financial text this matters for words like `year-over-year`, `buy-and-hold`, `price-to-earnings`. The impact on FK scores is small (FK is approximate) but worth noting for a financial publication.

---

**6. Check 16 (TLDR) does not recognize `key takeaways` (plural).**

The array is:
```js
const tldrPhrases = ['tldr', 'tl;dr', 'key takeaway', 'in brief'];
```

The article template uses `key_takeaways` as a field name, and in practice authors write "Key Takeaways" (plural) as a section header. Adding `'key takeaways'` to the array would avoid false failures on articles that use the plural form. Low risk to add.

---

**7. The `makeValidBody()` test fixture in the n8n test file is ~160 lines of inline string.**

This is good for test isolation but makes the test file harder to read. For future maintenance, consider extracting it to a fixture file or a shared test helper. Not a blocking issue for the current section.

---

**8. The `tests/insiderbuying/generate-article.test.js` (the Jest test file) has only 3 `qualityGate` tests, all carried over from the old 14-check gate.**

The new Jest file does not cover any of the 10 new checks (FK ease, word count, visual placeholders, internal links, CTA, track record, social proof, filing timeliness, TLDR, sentence variation, keyword density, no generic opening). The comprehensive coverage is only in the n8n test file. If the Jest suite is the canonical CI test, this gap means the new checks are untested in CI. Either add coverage to the Jest file or document that the n8n test file is the authoritative test suite for this module.

---

## Plan Alignment

All 19 checks are implemented as specified. The `generateArticleOutline` migration was added as part of this diff but is not in the section 02 plan — the plan explicitly states "Do not implement `generateArticleOutline` or persona injection — that is section 01." This is a scope deviation: the outline migration belongs in section 01. It is not harmful (the migration is correct), but it means the diff contains work outside this section's scope. The implementation itself is correct regardless.

The `LENGTH_CONFIG` constant still has its `maxTokens` field consumed at line 135 of `generate-article.js`, so the constant itself is not dead. However, the `minWords` and `maxWords` fields within each entry are now unreferenced after Check 8 switched to a fixed 1800–2500 word range. Those sub-fields are dead weight but harmless.
