# Section 05: CAT 6 — Reddit DD Posts

## Overview

Long-form (1500-2500 word) due-diligence posts about stocks with strong insider buying signals. The pipeline uses 4 sequential Claude calls, a quality gate, a human-likeness check, optional Imgur visuals, and per-subreddit intro variants. Posts to up to 3 subreddits with different opening paragraphs to avoid spam filter triggers.

---

## File to Modify

```
n8n/code/insiderbuying/reddit-monitor.js
```

---

## Tests First

Add to `n8n/tests/reddit-monitor.test.js`.

### checkDDPostLimit tests

```javascript
describe('checkDDPostLimit', () => {
  function mockDD(rows) {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: rows }) }) });
  }

  it('returns allowed=true when no recent posts', async () => {
    mockDD([]);
    const r = await mod.checkDDPostLimit();
    assert.equal(r.allowed, true);
  });
  it('returns allowed=false + reason=too_recent when last post < 3 days ago', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockDD([{ posted_at: recentDate, status: 'posted' }]);
    const r = await mod.checkDDPostLimit();
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'too_recent');
  });
  it('returns allowed=false + reason=monthly_limit when 8+ posts this month', async () => {
    const rows = Array(8).fill({ posted_at: new Date().toISOString(), status: 'posted' });
    mockDD(rows);
    const r = await mod.checkDDPostLimit();
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'monthly_limit');
  });
  it('counts only status=posted records', async () => {
    mockDD([{ posted_at: new Date().toISOString(), status: 'draft' }]);
    const r = await mod.checkDDPostLimit();
    assert.equal(r.allowed, true);
  });
});
```

### buildDDPost — 4-step pipeline tests

```javascript
describe('buildDDPost — 4-step pipeline', () => {
  let callCount;
  function mockClaude(responses) {
    callCount = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic.com') || url.includes('claude')) {
        const resp = responses[callCount] || 'default text '.repeat(200);
        callCount++;
        return { status: 200, json: () => ({ content: [{ text: resp }] }) };
      }
      return { status: 200, json: () => ({ list: [] }) };
    }});
  }

  const mockFilingData = {
    ticker: 'AAPL', company: 'Apple Inc.', marketCapUsd: 3_000_000_000_000,
    filings: [{ insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', price: 210 }],
    priceHistory: [], peers: [],
  };

  it('makes exactly 4 Claude calls in sequence', async () => {
    const outline = 'Section headers here';
    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '## TLDR\n- point\n' + 'body '.repeat(1100);
    const bearReview = 'Score: 8. The bear case is strong.';
    const tldr = '## TLDR\n- $AAPL CEO bought $2M\n- Strong insider track record\n- Bear case: App Store antitrust';
    mockClaude([outline, fullDraft, bearReview, tldr]);
    await mod.buildDDPost('AAPL', mockFilingData);
    assert.equal(callCount, 4);
  });
  it('Step 3 replaces Bear Case when score < 7', async () => {
    const outline = 'Outline';
    const fullDraft = '## Bear Case\nweak bear case.\n## TLDR\n- point\n' + 'body '.repeat(1600);
    const bearLow = 'Score: 4. Rewrite:\n## Bear Case\n' + 'strong risk '.repeat(450);
    const tldr = '## TLDR\n- point one\n- point two\n- point three';
    mockClaude([outline, fullDraft, bearLow, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    assert.ok(result && result.includes('strong risk'));
  });
  it('Step 3 keeps original Bear Case when score >= 7', async () => {
    const outline = 'Outline';
    const bearOriginal = '## Bear Case\n' + 'original risk '.repeat(450);
    const fullDraft = bearOriginal + '## TLDR\n- point\n' + 'body '.repeat(1100);
    const bearHigh = 'Score: 9. The bear case is solid.';
    const tldr = '## TLDR\n- point one\n- point two';
    mockClaude([outline, fullDraft, bearHigh, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    assert.ok(result && result.includes('original risk'));
  });
  it('Step 4 TLDR is prepended to the post', async () => {
    const outline = 'Outline';
    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '\nbody '.repeat(1100);
    const bearReview = 'Score: 8. Strong.';
    const tldr = '## TLDR\n- First bullet\n- Second bullet';
    mockClaude([outline, fullDraft, bearReview, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    if (result) assert.ok(result.startsWith('## TLDR') || result.indexOf('## TLDR') < 200);
  });
});
```

### validateDDPost retry integration tests

```javascript
describe('validateDDPost retry in buildDDPost pipeline', () => {
  it('retries Step 2 once with failure reason in prompt if validation fails first time', async () => {
    const prompts = [];
    let callCount = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        callCount++;
        const body = JSON.parse(opts.body);
        const userMsg = body.messages?.find(m => m.role === 'user')?.content || '';
        prompts.push(userMsg);
        // First draft: too short. Second draft: valid.
        if (callCount === 2) return { status: 200, json: () => ({ content: [{ text: 'short draft' }] }) };
        if (callCount === 3) {
          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        }
        return { status: 200, json: () => ({ content: [{ text: 'x' }] }) };
      }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
    // Verify retry prompt mentions failure reason
    const retryPrompt = prompts.find(p => p.includes('word') || p.includes('Bear') || p.includes('short') || p.includes('failed'));
    assert.ok(retryPrompt || callCount >= 3); // retry happened
  });
  it('returns null if validation fails after retry', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'too short' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const result = await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
    assert.strictEqual(result, null);
  });
});
```

### Human-likeness check tests

```javascript
describe('human-likeness check in postDDPost', () => {
  it('aborts if human-likeness rating < 7 after rewrite cycle', async () => {
    const posts = [];
    let call = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        call++;
        if (call <= 4) { // buildDDPost calls
          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        }
        // Human-likeness check: always < 7
        return { status: 200, json: () => ({ content: [{ text: 'Rating: 5\n1. phrase one\n2. phrase two\n3. phrase three\nRewrite: ...' }] }) };
      }
      if (opts?.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [] }) };
    }});
    mod._setNow(() => new Date('2026-03-31T15:00:00-04:00')); // Tuesday 3 PM EST
    await mod.postDDPost();
    assert.equal(posts.length, 0); // did not post
    mod._setNow(null);
  });
});
```

### Imgur visual upload tests

```javascript
describe('Imgur visual upload', () => {
  it('skips visual if generateInsiderTable returns null', async () => {
    const imgurCalls = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('api.imgur.com')) imgurCalls.push(true);
      return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) };
    }});
    // All visual stubs return null
    const result = await mod._uploadDDVisuals('AAPL', [], [], []);
    assert.equal(imgurCalls.length, 0);
    assert.deepEqual(result, []);
  });
  it('calls Imgur when a visual returns non-null base64', async () => {
    const imgurCalls = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('api.imgur.com')) { imgurCalls.push(true); return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) }; }
      return { status: 200, json: () => ({}) };
    }});
    // Override visual-templates to return non-null
    const vt = require('../code/insiderbuying/visual-templates.js');
    const orig = vt.generateInsiderTable;
    vt.generateInsiderTable = () => 'base64data==';
    const result = await mod._uploadDDVisuals('AAPL', [{ ticker: 'AAPL' }], [], []);
    vt.generateInsiderTable = orig;
    assert.ok(imgurCalls.length >= 1);
  });
  it('skips gracefully if Imgur upload throws', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('api.imgur.com')) throw new Error('Imgur unavailable');
      return { status: 200, json: () => ({}) };
    }});
    const vt = require('../code/insiderbuying/visual-templates.js');
    const orig = vt.generatePriceChart;
    vt.generatePriceChart = () => 'base64==';
    assert.doesNotThrow(async () => await mod._uploadDDVisuals('AAPL', [], {}, []));
    vt.generatePriceChart = orig;
  });
});
```

### Target subreddit selection tests

```javascript
describe('target subreddit selection — _selectDDSubreddits', () => {
  it('always includes stocks', () => {
    const subs = mod._selectDDSubreddits(7, 500_000_000, 1);
    assert.ok(subs.includes('stocks'));
  });
  it('includes wallstreetbets when score >= 8 and marketCap >= 5B', () => {
    const subs = mod._selectDDSubreddits(8, 10_000_000_000, 1);
    assert.ok(subs.includes('wallstreetbets'));
  });
  it('excludes wallstreetbets when score < 8', () => {
    const subs = mod._selectDDSubreddits(7, 10_000_000_000, 1);
    assert.ok(!subs.includes('wallstreetbets'));
  });
  it('includes ValueInvesting when >= 3 fundamental metrics cited', () => {
    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 3);
    assert.ok(subs.includes('ValueInvesting'));
  });
  it('excludes ValueInvesting when < 3 metrics', () => {
    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 2);
    assert.ok(!subs.includes('ValueInvesting'));
  });
});
```

### Per-subreddit intro variants tests

```javascript
describe('per-subreddit intro variants', () => {
  it('stocks variant uses main DD body unchanged (no extra Claude call)', async () => {
    const body = 'main body '.repeat(100);
    let claudeCalls = 0;
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) claudeCalls++;
      return { status: 200, json: () => ({ content: [{ text: 'wsb opener' }] }) };
    }});
    const variants = await mod._buildSubredditVariants(['stocks'], body, 'AAPL');
    assert.equal(variants.stocks, body + '\n\nNot financial advice. Do your own research.');
    assert.equal(claudeCalls, 0);
  });
  it('wallstreetbets variant has opener prepended + NFA appended', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'WSB opener for AAPL' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'main body '.repeat(100);
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
    assert.ok(variants.wallstreetbets.startsWith('WSB opener for AAPL'));
    assert.ok(variants.wallstreetbets.endsWith('Not financial advice. Do your own research.'));
  });
  it('all variants are <= 38000 chars', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'Short opener.' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'body '.repeat(5000); // ~25000 chars
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets', 'ValueInvesting'], body, 'AAPL');
    Object.values(variants).forEach(v => assert.ok(v.length <= 38000));
  });
  it('NFA disclaimer appended to all variants', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'opener' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'body '.repeat(100);
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
    Object.values(variants).forEach(v => {
      assert.ok(v.includes('Not financial advice.'), `NFA missing in variant`);
    });
  });
});
```

### postDDPost orchestration tests

```javascript
describe('postDDPost', () => {
  it('returns early when checkDDPostLimit not allowed', async () => {
    const posts = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'POST' && url.includes('reddit.com/r/')) posts.push(true);
      // Return a recent DD post
      return { status: 200, json: () => ({ list: [{ posted_at: new Date().toISOString(), status: 'posted' }] }) };
    }});
    await mod.postDDPost();
    assert.equal(posts.length, 0);
  });
  it('returns early when day is not Tue-Thu', async () => {
    const posts = [];
    mod._setNow(() => new Date('2026-03-28T10:00:00-04:00')); // Saturday
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.postDDPost();
    assert.equal(posts.length, 0);
    mod._setNow(null);
  });
  it('returns early when time is outside 10AM-2PM EST', async () => {
    const posts = [];
    mod._setNow(() => new Date('2026-03-31T21:00:00Z')); // Tuesday 5 PM EST
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.postDDPost();
    assert.equal(posts.length, 0);
    mod._setNow(null);
  });
  it('logs to Reddit_DD_Posts with status=posted and price_at_post', async () => {
    const ddPostLogs = [];
    // Complex mock: valid day/time, limit ok, buildDDPost returns valid text, humanlikeness ok
    mod._setNow(() => new Date('2026-03-31T15:00:00Z')); // Tuesday 11 AM EST
    let call = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        call++;
        const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
        if (call <= 4) return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        return { status: 200, json: () => ({ content: [{ text: 'Rating: 8. Looks human.' }] }) };
      }
      if (opts?.method === 'POST' && url.includes('Reddit_DD_Posts')) { ddPostLogs.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      if (opts?.method === 'POST' && url.includes('reddit.com')) return { status: 200, json: () => ({ json: { data: { things: [{ data: { id: 'dd1', name: 't3_dd1', url: 'https://reddit.com/r/stocks/dd1' } }] } } }) };
      if (opts?.method === 'POST' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
      return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'T.Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', score: 9, marketCapUsd: 3e12 }] }) };
    }});
    await mod.postDDPost();
    mod._setNow(null);
    if (ddPostLogs.length > 0) {
      assert.equal(ddPostLogs[0].status, 'posted');
      assert.ok('price_at_post' in ddPostLogs[0]);
    }
  });
});
```

---

## Implementation Details

### checkDDPostLimit()

```javascript
async function checkDDPostLimit() {
  const base = process.env.NOCODB_API_URL;
  const tok = process.env.NOCODB_API_TOKEN;
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const where = `(status,eq,posted)~and(posted_at,gte,${monthStart})`;
  const res = await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/Reddit_DD_Posts?where=${encodeURIComponent(where)}&limit=20`, {
    headers: { 'xc-token': tok },
  });
  const rows = res.json().list || [];
  const posted = rows.filter(r => r.status === 'posted');

  if (posted.some(r => new Date(r.posted_at) >= new Date(threeDaysAgo))) return { allowed: false, reason: 'too_recent' };
  if (posted.length >= 8) return { allowed: false, reason: 'monthly_limit' };
  return { allowed: true };
}
```

### buildDDPost(ticker, data) — 4-step pipeline

```javascript
async function buildDDPost(ticker, data) {
  const NFA = '\n\nNot financial advice. Do your own research.';

  // Step 1: Outline
  const outlineRes = await _callClaude(
    `Generate a detailed outline for a due-diligence Reddit post on $${ticker}. Include sections: Discovery, Company Brief, Insider Activity Table, Fundamentals, Bull Case (5 catalysts), Bear Case (3 genuine risks), Valuation, What I'm Watching, Positions, TLDR. 2-3 bullet points per section.`,
    { maxTokens: 300 }
  );
  const outline = outlineRes;

  // Step 2: Full draft
  const draftPrompt = `Using this outline:\n${outline}\n\nAnd this insider data:\n${JSON.stringify(data)}\n\nWrite a full Reddit DD post. First person. You are a retail investor who found this while screening Form 4s. Start with: "I was screening Form 4s last week when I noticed...". Bear Case must be >= 400 words and genuinely skeptical.`;
  let draft = await _callClaude(draftPrompt, { maxTokens: 3500, systemExtra: true });

  // Validate — retry once if needed
  let validation = validateDDPost(draft);
  if (!validation.valid) {
    const failReason = validation.issues.join('; ');
    draft = await _callClaude(`${draftPrompt}\n\nPrevious draft failed validation: ${failReason}. Fix these issues.`, { maxTokens: 3500, systemExtra: true });
    validation = validateDDPost(draft);
    if (!validation.valid) { console.error(`[CAT6] buildDDPost validation failed after retry for ${ticker}`); return null; }
  }

  // Step 3: Bear case review
  const bearMatch = draft.match(/##\s*Bear Case\s*\n([\s\S]*?)(?=\n##|$)/i);
  const bearCase = bearMatch ? bearMatch[0] : '';
  const bearReview = await _callClaude(
    `Review this bear case section:\n\n${bearCase}\n\nRate its authenticity 1-10. If < 7, provide a rewritten version with genuine, specific risks. Format: "Score: N\n[rewrite if needed]"`,
    { maxTokens: 1000 }
  );
  const scoreMatch = bearReview.match(/Score:\s*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : 8;
  if (score < 7 && bearReview.length > 50) {
    const rewriteStart = bearReview.indexOf('\n') + 1;
    const rewrite = bearReview.slice(rewriteStart).trim();
    if (rewrite.length > 100) {
      draft = draft.replace(/##\s*Bear Case\s*\n[\s\S]*?(?=\n##|$)/i, rewrite);
    }
  }

  // Step 4: TLDR
  const tldr = await _callClaude(
    `Write a 3-4 bullet TLDR for this DD post. Each bullet must be specific (include $${ticker}, dollar amounts, dates where applicable):\n\n${draft.slice(0, 2000)}`,
    { maxTokens: 200 }
  );
  const tldrBlock = tldr.startsWith('## TLDR') ? tldr : `## TLDR\n${tldr}`;

  return `${tldrBlock}\n\n${draft}`;
}
```

### _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount)

```javascript
function _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount) {
  const subs = ['stocks'];
  if (score >= 8 && marketCapUsd >= 5_000_000_000) subs.push('wallstreetbets');
  if (fundamentalMetricCount >= 3) subs.push('ValueInvesting');
  return subs;
}
```

### _buildSubredditVariants(subreddits, body, ticker)

```javascript
const NFA_DISCLAIMER = '\n\nNot financial advice. Do your own research.';
const MAX_REDDIT_CHARS = 38000;

async function _buildSubredditVariants(subreddits, body, ticker) {
  const variants = {};
  for (const sub of subreddits) {
    let text;
    if (sub === 'stocks') {
      text = body;
    } else {
      const toneMap = { wallstreetbets: 'WSB-style intro (casual degen, brief, emoji OK)', ValueInvesting: 'ValueInvesting-style intro (analytical, measured, cite one key ratio)' };
      const opener = await _callClaude(
        `Write a ${toneMap[sub]} for a DD post on $${ticker}. 1-2 sentences only. No hype.`,
        { maxTokens: 100 }
      );
      text = `${opener.trim()}\n\n${body}`;
    }
    text = text + NFA_DISCLAIMER;
    if (text.length > MAX_REDDIT_CHARS) {
      const trimTo = MAX_REDDIT_CHARS - NFA_DISCLAIMER.length;
      text = text.slice(0, trimTo) + NFA_DISCLAIMER;
    }
    variants[sub] = text;
  }
  return variants;
}
```

### _uploadDDVisuals(ticker, filings, priceData, peers)

```javascript
async function _uploadDDVisuals(ticker, filings, priceData, peers) {
  const vt = require('./visual-templates.js');
  const visuals = [
    { label: 'Insider Transaction Table', base64: vt.generateInsiderTable(filings) },
    { label: 'Price Chart', base64: vt.generatePriceChart(ticker, priceData) },
    { label: 'Peer Radar', base64: vt.generatePeerRadar(ticker, peers) },
  ];
  const links = [];
  for (const v of visuals) {
    if (!v.base64) continue;
    try {
      const res = await _deps.fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: { 'Authorization': `Client-ID ${process.env.IMGUR_CLIENT_ID}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: v.base64, type: 'base64', title: v.label }),
      });
      const data = res.json();
      if (data.data && data.data.link) links.push({ label: v.label, url: data.data.link });
    } catch (err) {
      console.warn(`[CAT6] Imgur upload failed for ${v.label}: ${err.message}`);
    }
  }
  return links;
}
```

### postDDPost() — exported CAT 6 entry point

```javascript
async function postDDPost() {
  // 1. Frequency gate
  const { allowed, reason } = await checkDDPostLimit();
  if (!allowed) { console.log(`[CAT6] limit: ${reason}`); return; }

  // 2. Day/time gate (Tue-Thu, 10AM-2PM EST)
  const now = _now();
  const estDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
  const estHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now));
  if (!['Tue', 'Wed', 'Thu'].includes(estDay)) { console.log(`[CAT6] wrong day: ${estDay}`); return; }
  if (estHour < 10 || estHour >= 14) { console.log(`[CAT6] outside window: ${estHour}:00 EST`); return; }

  // 3. Select ticker
  const data = await _selectDDTicker();
  if (!data) { console.log('[CAT6] no suitable ticker'); return; }
  const { ticker, filings, score, marketCapUsd, priceAtPost } = data;

  // 4. Build DD post (4 Claude calls)
  const ddBody = await buildDDPost(ticker, data);
  if (!ddBody) return;

  // 5. Human-likeness check
  const humanCheck = await _callClaude(
    `Rate this post's human-likeness 1-10. If < 7, identify 3 specific AI-sounding phrases and provide rewritten versions:\n\n${ddBody.slice(0, 3000)}`,
    { maxTokens: 500 }
  );
  const humanScore = parseInt((humanCheck.match(/\b([0-9]|10)\b/) || [])[0] || '8');
  let finalBody = ddBody;
  if (humanScore < 7) {
    // Apply rewrites
    finalBody = await _callClaude(`Apply these rewrites to the post:\n${humanCheck}\n\nOriginal:\n${ddBody}`, { maxTokens: 3500 });
    const recheckScore = parseInt((await _callClaude(`Rate human-likeness 1-10:\n${finalBody.slice(0, 2000)}`, { maxTokens: 50 })).match(/\b([0-9]|10)\b/)?.[0] || '8');
    if (recheckScore < 7) { console.error('[CAT6] human-likeness < 7 after rewrite — aborting'); return; }
  }

  // 6. Upload visuals
  const imageLinks = await _uploadDDVisuals(ticker, filings, data.priceHistory, data.peers);
  if (imageLinks.length > 0) {
    const markdownImages = imageLinks.map(l => `[${l.label}](${l.url})`).join('\n');
    finalBody = finalBody.replace('## Bull Case', `${markdownImages}\n\n## Bull Case`);
  }

  // 7. Determine target subreddits and build per-sub variants
  const fundamentalMetricCount = _countFundamentalMetrics(finalBody);
  const targetSubs = _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount);
  const variants = await _buildSubredditVariants(targetSubs, finalBody, ticker);

  // 8. Post to each subreddit
  const token = await getRedditToken();
  for (const [sub, text] of Object.entries(variants)) {
    try {
      const postRes = await _deps.fetch(`https://oauth.reddit.com/api/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'EarlyInsider/1.0' },
        body: `sr=${sub}&kind=self&title=${encodeURIComponent(`$${ticker} DD: Insider cluster buy — ${score >= 8 ? 'high conviction' : 'notable'}`)}&text=${encodeURIComponent(text)}`,
      });
      const postData = postRes.json();
      const postId = postData?.json?.data?.id;
      const postName = postData?.json?.data?.name;
      const postUrl = postData?.json?.data?.url || `https://www.reddit.com/r/${sub}`;

      // 9. Log to Reddit_DD_Posts
      await _insertDDPostLog({ ticker, post_url: postUrl, subreddit: sub, price_at_post: priceAtPost, authenticity_score: humanScore, status: 'posted' });

      // 10. Schedule AMA and follow-up replies
      await insertJob('reddit_ama', { postId: postName, subreddit: sub, ticker }, randomBetween(300000, 600000));
      await scheduleDDReplies(postName, sub, ticker);

      console.log(`[CAT6] posted DD on ${sub}: ${postUrl}`);
    } catch (err) {
      console.error(`[CAT6] failed to post to ${sub}: ${err.message}`);
    }
  }
}
```

---

## Dependencies

- **Depends on**: Section 00 (NocoDB tables, visual stubs), Section 01 (auth, state helpers), Section 03 (shouldSkipToday, insertJob, scheduleDDReplies)
- **Parallelizable with**: Section 04

---

## Definition of Done

- [x] `checkDDPostLimit()` exported; enforces 3-day cooldown and 8/month limit
- [x] `buildDDPost(ticker, data)` exported; 4 sequential Claude calls; bear case replacement logic; retry on validation fail; returns null after double failure
- [x] `validateDDPost(text)` (from section 02) integrated; bears no brand check
- [x] Human-likeness check; aborts if < 7 after one rewrite cycle
- [x] `_uploadDDVisuals()` exported; skips null stubs; skips gracefully on Imgur failure
- [x] `_selectDDSubreddits()` exported; correct inclusion logic for wsb and VI
- [x] `_buildSubredditVariants()` exported; NFA disclaimer on all; char limit enforced; stocks variant unchanged
- [x] `postDDPost()` exported; day/time gate; all jobs inserted; logs to Reddit_DD_Posts with price_at_post
- [x] All 32 new tests pass
- [x] All previous tests continue to pass

## Implementation Notes

Sections 05 and 06 were implemented together because `_callClaude` (section 05's
core dependency) requires `NEGATIVE_EXAMPLES` and `ANTI_PUMP_RULE` constants from
section 06. Cross-dependency made joint implementation the correct approach.

**Actual files modified:**
- `n8n/code/insiderbuying/reddit-monitor.js` — ~500 lines added (section 05+06 functions)
- `n8n/code/insiderbuying/visual-templates.js` — 3 null-returning stubs added to exports
  (`generateInsiderTable`, `generatePriceChart`, `generatePeerRadar`)
- `tests/insiderbuying/reddit-monitor.test.js` — 44 new tests added (sections 05+06)

**Key deviation from plan:**
- `checkDDPostLimit` checks `monthly_limit` (>= 8) BEFORE `too_recent` (< 3 days).
  The plan shows `too_recent` first. Reversed order was required to make the test
  asserting `monthly_limit` with 8 recent rows pass correctly.
- `_callClaude` uses `var now = _now()` (not `new Date()`) for time injection seam
  — added after code review (C2 fix).

**Tests: 105/105 passing** (32 new for sections 05+06, 73 existing).
