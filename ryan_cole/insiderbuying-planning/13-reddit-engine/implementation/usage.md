# Reddit Engine — Usage Guide

Module: `n8n/code/insiderbuying/reddit-monitor.js`
Tests: `tests/insiderbuying/reddit-monitor.test.js`
Tests: **172/172 passing**

---

## What Was Built

The Reddit Engine is a complete autonomous Reddit engagement system for the EarlyInsider insider-buying signal service. It monitors Reddit for relevant posts, generates authentic-sounding comments, manages a posting schedule, and produces long-form DD posts — all without looking AI-generated.

### Sections Completed

| Section | Feature | Commit |
|---------|---------|--------|
| 00 | visual-templates stubs | `(prior)` |
| 01 | SUBREDDIT_TONE_MAP + getRedditToken + getRedditLog | `e375e9c` |
| 02 | REPLY_STRUCTURES + getNextReplyStructure + validateReply + validateDDPost | `e375e9c` |
| 03 | checkDailyCommentLimit + shouldSkipToday + insertJob + schedules + processScheduledJobs + runCAT4Comments | `e375e9c` |
| 04 | CAT 5 — Daily Thread Comments | `1f08cdd` |
| 05 | CAT 6 — Long-form DD Posts | `a3f661e` |
| 06 | Anti-AI Detection + Few-Shot Style | `a3f661e` |

---

## Infrastructure Functions (Sections 01-03)

### `getRedditToken(opts?)`
Reddit OAuth with dual-mode: refresh_token (preferred) or ROPC (password grant) fallback. Token cached in NocoDB `reddit_auth` state key.

```javascript
const token = await getRedditToken();                    // uses cache
const token = await getRedditToken({ _skipCache: true }); // bypass cache (tests)
```

### `getRedditLog(dateStr)`
Returns all posts with `status=posted` for a given date from NocoDB `Reddit_Log` table.

```javascript
const entries = await getRedditLog('2026-03-29'); // [{ subreddit, comment, status, ... }]
```

### `checkDailyCommentLimit(subreddit)`
Checks both global cap (10/day) and per-subreddit dailyCap from `SUBREDDIT_TONE_MAP`.

```javascript
const { allowed, reason } = await checkDailyCommentLimit('stocks');
// { allowed: true } or { allowed: false, reason: 'global_cap' | 'subreddit_cap' }
```

### `shouldSkipToday()`
Auto-generates 1-2 weekday skip days per ISO week (first call). EST-aware day-of-week.

```javascript
const { skip } = await shouldSkipToday();
```

### `getNextReplyStructure(subreddit)`
Rotates through 3 `REPLY_STRUCTURES` per subreddit: `Q_A_DATA` → `AGREEMENT_BUT` → `DATA_INTERPRET` → repeat.

```javascript
const structure = await getNextReplyStructure('stocks');
// { id: 'Q_A_DATA', systemPromptInstruction: '...' }
```

### `validateReply(text, subreddit)`
Validates a comment against the subreddit's word limit (±10% tolerance). Rejects URLs and EarlyInsider brand names.

```javascript
const { valid, words, min, max, issues } = validateReply(text, 'wallstreetbets');
```

### `validateDDPost(text)`
Validates a DD post: 1500-2500 words, bear case ≥400 words, TLDR present, ≤38000 chars.

```javascript
const { valid, wordCount, bearWordCount, hasTLDR, charCount, issues } = validateDDPost(text);
```

### `insertJob(type, payload, delayMs)`
Inserts a scheduled job into NocoDB `Scheduled_Jobs` with `execute_after` ISO timestamp.

```javascript
await insertJob('reddit_edit', { commentId: 't1_abc', ticker: 'AAPL' }, 2 * 60 * 60 * 1000);
```

### `processScheduledJobs(opts?)`
Fetches and processes all pending past-due jobs. Never throws. Marks each job done/skipped.

```javascript
await processScheduledJobs();                         // production
await processScheduledJobs({ _fixedJobs: [...] });    // tests
```

### `runCAT4Comments()`
Full autonomous Reddit comment posting run. Checks skip day, iterates subreddits with cap enforcement, queues deferred reply jobs.

```javascript
await runCAT4Comments(); // called by n8n scheduler
```

---

## Core Functions

### Comment Pipeline

#### `buildCommentPrompt(post, insiderData, subreddit, structure)`
Generates a Reddit comment for a given post using Claude.

```javascript
const { buildCommentPrompt } = require('./reddit-monitor.js');

const text = await buildCommentPrompt(
  {
    title: 'CEO of $AAPL just filed Form 4',
    selftext: 'What do you all think about this insider buying?',
    subreddit: 'stocks',
    score: 120,
    name: 't3_xyz',
  },
  {
    ticker: 'AAPL',
    insider_name: 'Tim Cook',
    role: 'CEO',
    value_usd: 2_000_000,
    date: '2026-03-25',
    track_record: '3 prior buys, avg +22% in 12 months',
  },
  'stocks',
  {
    id: 'Q_A_DATA',
    systemPromptInstruction: 'Open with a question, then answer with data.',
  }
);
// Returns: "Interesting timing — this is his third buy since 2022. Last two were up 18%+ in 6 months. Not telling you what to do with that information."
```

Returns `null` if Claude returns an empty response (caller should skip posting).

---

### CAT 6 — Long-form DD Posts

#### `postDDPost()`
Full autonomous DD post flow. Called by n8n scheduler or manually.

**Guards:**
1. Frequency gate: max 8 posts/month, 3-day minimum between posts
2. Day gate: Tuesday–Thursday only
3. Time gate: 10 AM–2 PM EST only
4. Human-likeness check: aborts if rewritten post still scores < 7/10

**Flow:** select ticker → build 4-step DD post → human-likeness check → upload visuals → per-subreddit variants → post → log → schedule replies

```javascript
// In n8n Code node:
const { postDDPost } = require('./reddit-monitor.js');
await postDDPost();
```

#### `buildDDPost(ticker, data)`
4-step Claude pipeline: outline → full draft → bear case review → TLDR.

```javascript
const post = await buildDDPost('AAPL', {
  ticker: 'AAPL',
  company: 'Apple Inc.',
  marketCapUsd: 3_000_000_000_000,
  filings: [{ insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', price: 210 }],
  priceHistory: [],
  peers: [],
});
// Returns 1500-2500 word string starting with "## TLDR\n..." or null on failure
```

Returns `null` if validation fails after retry (word count < 400 or missing `## Bear Case`).

#### `checkDDPostLimit()`
```javascript
const { allowed, reason } = await checkDDPostLimit();
// { allowed: true } or { allowed: false, reason: 'monthly_limit' | 'too_recent' }
```

---

### Subreddit Selection + Variants

#### `_selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount)`
```javascript
_selectDDSubreddits(9, 10_000_000_000, 4)
// ['stocks', 'wallstreetbets', 'ValueInvesting']
//
// Rules:
// - stocks: always included
// - wallstreetbets: score >= 8 AND marketCap >= $5B
// - ValueInvesting: >= 3 fundamental metrics cited in the DD
```

#### `_buildSubredditVariants(subreddits, body, ticker)`
```javascript
const variants = await _buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
// {
//   stocks: '<body>\n\nNot financial advice. Do your own research.',
//   wallstreetbets: 'WSB-style opener.\n\n<body>\n\nNot financial advice...'
// }
```
- `stocks` variant: body unchanged (no extra Claude call)
- Other variants: Claude generates a 1-2 sentence subreddit-specific opener
- All variants: NFA disclaimer appended, max 38000 chars enforced

---

### Anti-AI Style Constants

Both constants are exported and injected into every Claude system prompt via `_callClaude`:

#### `NEGATIVE_EXAMPLES`
Few-shot style guide: shows a BAD (passive, hedged, corporate) example and a GOOD (direct, specific, personal) example. No URLs, no brand names.

#### `ANTI_PUMP_RULE`
Hard rule: "NEVER explicitly recommend buying or say a stock will go up."

#### `SUBREDDIT_TONE_MAP`
Per-subreddit style + word limit guide:
- `stocks`: balanced, conversational, 100-150 words
- `wallstreetbets`: casual, degen energy, brief, emojis OK, 50-100 words
- `investing`: measured, analytical, cite sources, 100-200 words
- `ValueInvesting`: analytical, precise, cite key ratios, 150-250 words
- `SecurityAnalysis`: formal, data-driven, academic, 150-300 words

---

## Visual Stubs

`visual-templates.js` exports 3 null-returning stubs until real chart generation is implemented:

- `generateInsiderTable(filings)` → `null`
- `generatePriceChart(ticker, priceData)` → `null`
- `generatePeerRadar(ticker, peers)` → `null`

When any stub returns non-null base64, `_uploadDDVisuals` uploads to Imgur and injects
the link into the DD post before `## Bull Case`. Imgur failures are caught silently.

---

## Environment Variables Required

```
NOCODB_API_URL=         NocoDB base URL (e.g., http://localhost:8080)
NOCODB_API_TOKEN=       NocoDB API token
NOCODB_PROJECT_ID=      NocoDB project ID
REDDIT_CLIENT_ID=       Reddit app client ID
REDDIT_CLIENT_SECRET=   Reddit app client secret
REDDIT_USERNAME=        Reddit account username
REDDIT_PASSWORD=        Reddit account password
ANTHROPIC_API_KEY=      Claude API key (for buildCommentPrompt, buildDDPost, human-likeness)
IMGUR_CLIENT_ID=        Imgur API client ID (for visual uploads, optional)
```

---

## NocoDB Tables Used

| Table | Purpose |
|-------|---------|
| `Reddit_State` | Per-account auth tokens, last-used times |
| `Reddit_DD_Posts` | DD post log (ticker, url, posted_at, status, price_at_post) |
| `Scheduled_Jobs` | Queued reply/AMA jobs with `run_at` timestamps |
| `Insider_Filings` | Source data for DD ticker selection |

---

## Test Seams

Both test injection points are available for unit testing:

```javascript
const mod = require('./reddit-monitor.js');

// Mock all HTTP (Reddit, NocoDB, Claude, Imgur)
mod._setDeps({ fetch: async (url, opts) => ({ status: 200, json: () => ({}) }) });

// Mock current time
mod._setNow(() => new Date('2026-03-31T15:00:00Z')); // Tuesday 11AM EST

// Reset after each test
afterEach(() => { mod._setDeps(null); mod._setNow(null); });
```

---

## Commits

| Commit | Description |
|--------|-------------|
| `1f08cdd` | Section 04: CAT 5 daily thread comments |
| `a3f661e` | Sections 05+06: CAT 6 DD posts + anti-AI detection |
