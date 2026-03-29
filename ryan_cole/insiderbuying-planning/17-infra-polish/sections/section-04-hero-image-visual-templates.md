# Section 04: Hero Image Swap -- fal.ai -> Template 13 (visual-templates.js)

## Overview

This section eliminates the fal.ai Flux async job polling path for hero image generation and replaces it with a synchronous call to a local `visual-templates.js` module (Template 13). The screenshot server at `host.docker.internal:3456` already powers `generateOgCard()`; Template 13 uses the same server. The `generateOgCard()` function is not touched.

**No dependencies on other sections.** This section can be implemented in parallel with all others.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `n8n/code/insiderbuying/visual-templates.js` | Create (or extend if partially exists) -- add Template 13 |
| `n8n/code/insiderbuying/generate-image.js` | Modify -- rewrite `generateHeroImage()`, leave `generateOgCard()` unchanged |
| `n8n/tests/generate-image.test.js` | Update existing test file |
| `.env.example` | Modify -- mark `FAL_KEY` for removal (only if not used elsewhere) |

---

## Tests First

**Test file:** `n8n/tests/generate-image.test.js` (update existing)

All tests use `node:test` + `node:assert/strict`. All external dependencies (screenshot server, R2, fal.ai) are mocked.

### generateHeroImage -- Template 13 path

```
Test: calls templates.renderTemplate(13, data) with all required fields:
      { headline, ticker, verdict, insiderName, date }

Test: the Buffer returned by renderTemplate is passed directly to uploadToR2()

Test: the R2 URL returned from uploadToR2 is the function's return value
      (i.e. generateHeroImage returns what uploadToR2 returns)

Test: R2 key passed to uploadToR2 is exactly `hero-${article.slug}.png`

Test: when templates.renderTemplate is not a function (missing module),
      the guard at the top of generateHeroImage throws before any R2 upload

Test: no fal.ai / queue.fal.run calls are made -- mock the old fal client
      and assert it is called zero times
```

### generateOgCard -- regression guard

```
Test: generateOgCard() still calls the screenshot server at host.docker.internal:3456

Test: generateOgCard() does NOT call templates.renderTemplate or fal.ai
```

### visual-templates.js -- Template 13 unit

```
Test: templates.renderTemplate(13, mockData) resolves without throwing

Test: return value is a Buffer (Buffer.isBuffer(result) === true)

Test: Buffer length > 0 (non-empty image)
```

---

## Background: Current State of generate-image.js

`generate-image.js` contains two independent functions:

1. **`generateHeroImage(article)`** -- currently calls `queue.fal.run('fal-ai/flux/dev', ...)`, polls the async job, downloads the image buffer, and uploads to R2.
2. **`generateOgCard(article)`** -- calls the screenshot server at `host.docker.internal:3456`. This function is NOT changed.

The fal.ai async job pattern involves: submitting a job, polling status until complete, downloading the resulting image URL. This entire path is removed from the hero image function.

---

## Implementation: visual-templates.js -- Template 13

Create (or add to existing) `n8n/code/insiderbuying/visual-templates.js`.

Template 13 is the **Article Hero** template: 1200?630 px, dark navy background, ticker badge with verdict color accent, headline text, EarlyInsider logo bottom-right, abstract financial pattern background.

The rendering approach mirrors `generateOgCard()`: build an HTML payload, POST it to the screenshot server at `host.docker.internal:3456`, receive a PNG buffer back.

**Exported interface:**

```javascript
// visual-templates.js

/**
 * Render a named template to a PNG Buffer.
 *
 * @param {number} templateId - Template number (13 = Article Hero 1200x630)
 * @param {object} data       - Template-specific data fields
 * @returns {Promise<Buffer>} - PNG image buffer
 */
async function renderTemplate(templateId, data) { ... }

module.exports = { renderTemplate };
```

**Template 13 data fields** (all required):

| Field | Type | Description |
|-------|------|-------------|
| `headline` | string | Article headline text |
| `ticker` | string | Stock ticker symbol (e.g. "AAPL") |
| `verdict` | string | Verdict label (e.g. "BULLISH", "BEARISH") |
| `insiderName` | string | Insider's name |
| `date` | string | Publication date (display format) |

**Template 13 HTML spec** (for the screenshot server payload):
- Canvas: 1200?630 px
- Background: dark navy (`#0a0f1e` or similar)
- Abstract financial pattern: subtle SVG grid or line pattern in background layer
- Ticker badge: pill/badge element, color accent driven by verdict (`BULLISH` = green accent, `BEARISH` = red accent, neutral = gray)
- Headline: large white serif or sans-serif text, max 2 lines
- Insider name + date: smaller text, below headline
- EarlyInsider logo: bottom-right corner

If `renderTemplate` receives an unknown `templateId`, it must throw:
```
throw new Error(`Template ${templateId} not found in visual-templates.js`);
```

---

## Implementation: Rewrite generateHeroImage() in generate-image.js

Replace the body of `generateHeroImage(article)` entirely. The function signature stays identical so all callers remain unchanged.

**Guard at the top of the function:**

```javascript
async function generateHeroImage(article) {
  if (!templates || typeof templates.renderTemplate !== 'function') {
    throw new Error('visual-templates.js renderTemplate not found');
  }
  // ... rest of implementation
}
```

**New body logic (stub -- prose description):**

1. Build the data object for Template 13 from `article` fields: map `article.headline` -> `headline`, `article.ticker` -> `ticker`, `article.verdict` -> `verdict`, `article.insiderName` -> `insiderName`, `article.date` -> `date`.
2. Call `await templates.renderTemplate(13, data)` -- receives a PNG Buffer.
3. Construct the R2 key: `hero-${article.slug}.png`.
4. Call `await uploadToR2(buffer, r2Key)` -- uses the existing `uploadToR2` helper already in scope.
5. Return the R2 URL string from `uploadToR2`.

**What is completely removed:**
- Any `queue.fal.run(...)` call
- The fal.ai async job polling loop
- Any `fal` import or require

**What is not touched:**
- `generateOgCard()` -- the entire function body stays exactly as-is
- `uploadToR2()` helper -- called by both functions, unchanged
- Any other functions in `generate-image.js`

---

## Env Var Cleanup

Before removing `FAL_KEY` from `.env.example`:

Run the following grep to confirm no other module references fal.ai:
```
grep -ri "queue.fal.run\|FAL_KEY\|fal-ai" n8n/code/insiderbuying/
```

- If the only match is `generate-image.js` and it's in the hero path being removed: delete `FAL_KEY` from `.env.example` and add a comment `# FAL_KEY removed -- hero images now use visual-templates.js Template 13`.
- If `FAL_KEY` appears in any other file: **keep it** in `.env.example` and add an inline comment noting which file still uses it.

---

## Definition of Done

- [x] `visual-templates.js` exports `renderTemplate` and `renderTemplate(13, validData)` returns a non-empty Buffer
- [x] `generateHeroImage()` calls `templates.renderTemplate(13, ...)` -- not fal.ai
- [x] `generateOgCard()` is byte-for-byte unchanged (no fal.ai calls, no Template 13 calls)
- [x] Guard at top of `generateHeroImage()` throws if `renderTemplate` is not a function
- [x] R2 key for hero images is `hero-${article.slug}.png`
- [x] `grep -ri "queue.fal.run" n8n/code/insiderbuying/generate-image.js` = 0 matches within the hero function
- [x] All tests in `n8n/tests/generate-image.test.js` pass (34/34)
- [x] No fal.ai mock is called during tests (zero-call assertion passes)

## Deviations from Plan

1. **t13ArticleHero field rename (D1)**: Existing t13 used `title`, `category`, `subtitle`, `authorName`.
   Updated to `headline`, `ticker`, `verdict`, `insiderName`, `date` per spec. Added verdict badge
   with color accent from `VERDICTS` map, ticker pill, and EarlyInsider watermark at bottom right.

2. **generateHeroImage accepts opts.templates injection (D2)**: Spec showed guard referencing a
   module-level `templates` variable. Implemented as `opts.templates` injectable dependency instead,
   which is the only testable pattern without a real visual-templates.js module loaded.

3. **generateImages orchestrator updated (D3)**: Spec said "signature stays identical so callers
   unchanged." The `generateImages` orchestrator had to be updated because it was constructing a
   `heroPrompt` string and downloading a URL from fal.ai. Now it builds the article data object and
   passes `templates: require('./visual-templates')`.

4. **heroPrompt ReferenceError auto-fix (D4)**: Code review finding H1. `generateImages` still
   referenced `heroPrompt` in the Published_Images body after removal. Fixed to `prompt_used: null`.

5. **Test count 34**: 22 pre-existing + 12 new (6 generateHeroImage + 2 OgCard regression + 3 T13 unit
   + 1 import update).
