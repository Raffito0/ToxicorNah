# Section 01: Named Persona + Multi-Step Article Generation

**File to modify**: `generate-article.js` (n8n Code node, CommonJS)
**Test file**: `n8n/tests/generate-article.test.js`
**Dependencies**: None — this section is parallelizable with sections 02, 03, 04, 06.

---

## What This Section Does

Replaces the current single-pass Claude Tool Use call in `generate-article.js` with a two-step outline → draft process, and injects a named analyst persona for the insiderbuying blog only.

The outline step is a lightweight Claude call (~300 tokens) that produces a structured H2/H3 skeleton. The validated outline is then passed as additional context into the existing Tool Use draft call. This improves article structure predictability and H2/H3 consistency without changing anything downstream (quality gate, SEO check, NocoDB write, triggers are all unchanged).

---

## Tests First

Add these tests to `n8n/tests/generate-article.test.js`. Write stubs for all functions listed below before implementing.

### 1.1 Persona Injection Tests

```
// Test: buildSystemPrompt({ blog: 'insiderbuying' }) → returned string contains "Ryan Chen"
// Test: buildSystemPrompt({ blog: 'insiderbuying' }) → returned string contains "Goldman Sachs"
// Test: buildSystemPrompt({ blog: 'deepstockanalysis' }) → returned string does NOT contain "Ryan Chen"
// Test: buildSystemPrompt({ blog: 'deepstockanalysis' }) → returned string contains "Dexter Research"
// Test: buildSystemPrompt({ blog: 'dividenddeep' }) → returned string does NOT contain "Ryan Chen"
// Test: persona text is a substring of the full system prompt (not the entire thing — base prompt still present)
```

### 1.2 Outline Generation and Validation Tests

```
// Test: validateOutline({ sections: [{h2:'...'},{h2:'...'},{h2:'...'},{h2:'...'},{h2:'...'}], headline: 'AAPL insider buying' })
//   → { valid: true, errors: [] }  (5 H2 sections, ticker present)

// Test: validateOutline({ sections: [{h2:'...'},{h2:'...'},{h2:'...'},{h2:'...'}], headline: 'AAPL insider buying' })
//   → { valid: false, errors: ['Outline has fewer than 5 H2 sections'] }  (only 4)

// Test: validateOutline({ sections: [{h2:'...'} x 5], headline: 'insider buying' })  // ticker 'AAPL' not in headline
//   → { valid: false, errors: ['Outline does not mention ticker'] }

// Test: validateOutline({ sections: [], headline: 'AAPL' })
//   → { valid: false, errors: ['Outline has fewer than 5 H2 sections'] }  (0 sections edge case)

// Test: generateArticleOutline (mock fetchFn returns valid outline JSON) → returns parsed ArticleOutline object
//   ArticleOutline shape: { headline: string, tldr: string[], sections: Array<{ h2: string, h3s: string[] }>, required_data_points: string[] }

// Test: generateArticleOutline — mock fetchFn returns markdown-fenced JSON:
//   "```json\n{...valid outline...}\n```"
//   → strips fences, parses successfully (no throw)

// Test: generateArticleOutline — mock fetchFn returns invalid outline on 1st call, valid on 2nd call
//   → retries exactly once; 2nd call prompt contains the error list from validateOutline
//   (assert the retry prompt includes something like "Regenerate outline fixing: Outline has fewer than 5 H2 sections")

// Test: generateArticleOutline — mock fetchFn returns invalid outline on BOTH calls
//   → throws after 1 retry (outline budget is exactly 1 retry, meaning 2 total attempts max)

// Test: draft generation user message includes the validated outline content
//   (mock generateArticleOutline to return a known outline, assert draft prompt user message contains outline headline or section names)

// Test: draft prompt contains instruction to embed {{VISUAL_1}}, {{VISUAL_2}}, {{VISUAL_3}}
//   (assert draft system or user prompt string includes "{{VISUAL_1}}" as a placeholder instruction)
```

---

## Implementation Details

### 1.1 Persona Injection

Locate the system prompt builder function in `generate-article.js`. The blog name (`blog`) is already available in the execution context — it comes from the trigger data or NocoDB article record.

Add a constant near the system prompt template:

```js
// Stub — exact wording is yours to craft
const RYAN_CHEN_PERSONA = `
You are Ryan Chen, a former Goldman Sachs equity research analyst...
Write in first-person singular. Reference your analytical background naturally without forcing it.
...
`;
```

In the system prompt builder, conditionally append the persona:

```js
// Stub signature
function buildSystemPrompt({ blog, articleType, ... }) {
  let prompt = BASE_SYSTEM_PROMPT;
  if (blog === 'insiderbuying') {
    prompt += '\n\n' + RYAN_CHEN_PERSONA;
  }
  return prompt;
}
```

Author name logic: when `blog === 'insiderbuying'`, set `author_name = 'Ryan Chen'`. Other blogs keep their existing values: `deepstockanalysis` → "Dexter Research", `dividenddeep` → "Ryan Cole".

### 1.2 Two-Step Generation

**Step 1 — Outline generation**

Add function:

```js
/**
 * Makes a lightweight Claude call (no Tool Use, plain JSON output) and returns a validated ArticleOutline.
 * Has an independent 1-retry budget (max 2 total attempts).
 * On retry, injects the error list from validateOutline into the prompt as:
 *   "Regenerate outline fixing: [error list]"
 *
 * @param {string} ticker
 * @param {string} articleType
 * @param {object} dexterData  - Dexter research data (passed to inform outline data points)
 * @param {function} fetchFn   - injectable fetch for testing
 * @returns {Promise<ArticleOutline>}
 * @throws if both attempts return an invalid outline
 */
async function generateArticleOutline(ticker, articleType, dexterData, fetchFn) { ... }
```

The Claude call for this step:
- Model: same model used elsewhere in the file (do not change models)
- No Tool Use — plain text response, JSON format
- Target ~300 tokens (`max_tokens: 400` is appropriate)
- Prompt instructs Claude to return a JSON object (no markdown fences) with this shape:
  ```
  {
    "headline": "55-65 character headline containing the primary keyword",
    "tldr": ["bullet 1", "bullet 2", "bullet 3"],
    "sections": [
      { "h2": "Section Title", "h3s": ["Subsection A", "Subsection B"] },
      ...  // 5-7 entries
    ],
    "required_data_points": ["specific data point 1", ...]
  }
  ```

**JSON parsing — mandatory fence-stripping pattern** (applies to ALL JSON.parse calls on Claude output throughout the file):

```js
function parseClaudeJSON(text) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}
```

**Validation:**

```js
/**
 * @param {object} outline - parsed outline object
 * @param {string} ticker  - must appear in outline.headline
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOutline(outline, ticker) { ... }
```

Rules:
- `outline.sections.length >= 5` — error text: `'Outline has fewer than 5 H2 sections'`
- `outline.headline` must contain `ticker` (case-insensitive) — error text: `'Outline does not mention ticker'`

**Step 2 — Full draft generation**

The existing Tool Use call is modified to include the validated outline in the user message, before the Dexter data block:

```
[OUTLINE]
Headline: {outline.headline}
Sections:
{outline.sections.map(s => `## ${s.h2}\n${s.h3s.map(h => `### ${h}`).join('\n')}`).join('\n\n')}
[/OUTLINE]

{existing Dexter research data block}
```

Add to the draft prompt (system or user, whichever is most natural given the existing structure): explicit instruction that the article body must include `{{VISUAL_1}}`, `{{VISUAL_2}}`, and `{{VISUAL_3}}` tokens at appropriate chart positions within `body_html`.

**Execution flow** (replace existing single-call flow):

```
1. checkContentFreshness(ticker, nocodbOpts)   // Section 03 — run this first
2. generateArticleOutline(ticker, articleType, dexterData, fetchFn)  // NEW step 1
3. [existing Tool Use draft call, augmented with outline context]    // Step 2
4. qualityGate(article, opts)                  // Section 02 — unchanged position
5. replaceVisualPlaceholders(article, filingData)  // Section 03
6. generateSchema(article)                     // Section 03
7. [NocoDB write + downstream triggers]        // Unchanged
```

Steps 4-7 and the retry loop (2 max for the draft) are **unchanged** by this section. Only the pre-draft logic changes.

---

## Data Shapes

```js
// ArticleOutline
{
  headline: string,                               // 55-65 chars, contains primary keyword
  tldr: string[],                                 // 3-5 bullets
  sections: Array<{ h2: string, h3s: string[] }>, // 5-7 H2s, each with 2-3 H3s
  required_data_points: string[]                  // list of data Claude needs for the draft
}
```

---

## Key Constraints

- **CommonJS only** — no ES module syntax (`import`/`export`). Use `module.exports` and `require()`.
- **No new npm packages** — this section adds no dependencies.
- **fetchFn injection** — `generateArticleOutline` must accept `fetchFn` as its last parameter so tests can mock the Claude call without network access. This is already the pattern in the file.
- **Outline retry budget is 1** (2 total attempts). The draft has its own separate 2-attempt budget. These are independent counters.
- **Do not change the Tool Use structure** of the draft call — only add the outline context to the user message. The tool definition, `tool_choice`, and response parsing remain identical.
- **author_name** `'Ryan Chen'` is only set when `blog === 'insiderbuying'`. It must propagate to the NocoDB write payload (it presumably already has an `author_name` field — just make sure the conditional sets it before the write).

---

## Actual Implementation (Completed)

**Files modified:**
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js`
- `ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js`

**Functions added:**
- `CLAUDE_MODEL` constant (claude-haiku for outline — cost-efficient)
- `BASE_SYSTEM_PROMPT`, `RYAN_CHEN_PERSONA` constants
- `buildSystemPrompt({ blog })` — injects Ryan Chen persona for insiderbuying
- `parseClaudeJSON(text)` — strips any markdown fence type before JSON.parse
- `validateOutline(outline, ticker)` — validates ≥5 sections + ticker in headline
- `generateArticleOutline(ticker, articleType, dexterData, fetchFn, apiKey)` — 2-attempt Claude call
- `buildDraftUserMessage(outline)` — includes outline + {{VISUAL_1/2/3}} instruction
- `extractToolResult(response)` — extracts tool_use input from Claude response

**Tests:** 55 passing (13 describe blocks)
