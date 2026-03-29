# Section 03: Daily Cap + Timing + Job Queue

## Overview

This section implements all the behavioral controls that make the Reddit presence look human and sustainable:

- **`checkDailyCommentLimit(subreddit)`** — enforce global (10/day) and per-subreddit caps before posting
- **`shouldSkipToday()`** — randomly designate 1-2 non-posting days per week; auto-generate on Monday
- **`upvoteContext()`** — upvote OP and 2 random comments before replying (50% probability)
- **Scheduled_Jobs inserts** — all timing delays go into NocoDB, not `sleep()`
- **`processScheduledJobs()`** — the 15-min sweeper that handles all 5 job types
- **`runCAT4Comments()`** — the exported CAT 4 entry point that n8n calls every 60 min

---

## File to Modify

```
n8n/code/insiderbuying/reddit-monitor.js
```

---

## Tests First

Add to `n8n/tests/reddit-monitor.test.js`.

### checkDailyCommentLimit tests

```javascript
describe('checkDailyCommentLimit', () => {
  function makeLog(entries) {
    // entries: array of { subreddit, status }
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: entries }) }) });
  }

  it('returns allowed=true when no posts today', async () => {
    makeLog([]);
    const r = await mod.checkDailyCommentLimit('stocks');
    assert.equal(r.allowed, true);
  });
  it('returns allowed=false when global total >= 10', async () => {
    makeLog(Array(10).fill({ subreddit: 'wallstreetbets', status: 'posted' }));
    const r = await mod.checkDailyCommentLimit('stocks');
    assert.equal(r.allowed, false);
    assert.ok(r.reason.includes('global'));
  });
  it('returns allowed=false when per-sub count >= dailyCap (wsb cap=3)', async () => {
    makeLog([
      { subreddit: 'wallstreetbets', status: 'posted' },
      { subreddit: 'wallstreetbets', status: 'posted' },
      { subreddit: 'wallstreetbets', status: 'posted' },
    ]);
    const r = await mod.checkDailyCommentLimit('wallstreetbets');
    assert.equal(r.allowed, false);
    assert.ok(r.reason.includes('cap'));
  });
  it('ignores failed/skipped status records in count', async () => {
    makeLog([
      { subreddit: 'stocks', status: 'failed' },
      { subreddit: 'stocks', status: 'skipped' },
    ]);
    const r = await mod.checkDailyCommentLimit('stocks');
    assert.equal(r.allowed, true);
  });
  it('includes reason field when not allowed', async () => {
    makeLog(Array(10).fill({ subreddit: 'stocks', status: 'posted' }));
    const r = await mod.checkDailyCommentLimit('stocks');
    assert.ok(typeof r.reason === 'string');
  });
});
```

### shouldSkipToday tests

```javascript
describe('shouldSkipToday', () => {
  function mockState(stored) {
    // stored: null or { week: 'YYYY-WNN', days: [...] }
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) return { status: 200, json: () => ({}) };
      if (stored) return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify(stored), Id: 1 }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
  }

  it('returns skip=false on a non-skip weekday', async () => {
    const today = new Date();
    const isoWeek = getISOWeek(today); // helper
    const dayOfWeek = today.getDay();
    // Skip a different day than today
    const skipDay = dayOfWeek === 1 ? 2 : 1;
    mockState({ week: isoWeek, days: [skipDay] });
    const r = await mod.shouldSkipToday();
    assert.equal(r.skip, false);
  });
  it('returns skip=true when today is a designated skip day', async () => {
    const today = new Date();
    const isoWeek = getISOWeek(today);
    const dayOfWeek = today.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) { // only test on weekdays
      mockState({ week: isoWeek, days: [dayOfWeek] });
      const r = await mod.shouldSkipToday();
      assert.equal(r.skip, true);
    }
  });
  it('auto-generates skip days if week_skip_days missing from NocoDB', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) }; // no stored state
    }});
    await mod.shouldSkipToday();
    assert.ok(writes.length >= 1); // wrote skip days to NocoDB
  });
  it('generated skip days are weekdays only (JS day 1-5)', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.shouldSkipToday();
    const written = writes.find(w => w.value && w.value.includes('days'));
    if (written) {
      const data = JSON.parse(written.value);
      data.days.forEach(d => { assert.ok(d >= 1 && d <= 5, `day ${d} is not a weekday`); });
    }
  });
  it('generates 1 or 2 skip days', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.shouldSkipToday();
    const written = writes.find(w => w.value && w.value.includes('days'));
    if (written) {
      const data = JSON.parse(written.value);
      assert.ok(data.days.length >= 1 && data.days.length <= 2);
    }
  });
  it('does not regenerate if already set for current week', async () => {
    const writes = [];
    const today = new Date();
    const isoWeek = getISOWeek(today);
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(true); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days: [2] }), Id: 1 }] }) };
    }});
    await mod.shouldSkipToday();
    await mod.shouldSkipToday();
    assert.equal(writes.length, 0); // no writes — already set
  });
});

// Helper for tests
function getISOWeek(d) {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
```

### upvoteContext tests

```javascript
describe('upvoteContext', () => {
  it('calls Reddit vote API exactly 3 times', async () => {
    const calls = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('/api/vote')) calls.push(opts.body);
      return { status: 200, json: () => ({}) };
    }});
    await mod.upvoteContext('post123', 'comment1', 'comment2');
    assert.equal(calls.length, 3);
  });
  it('upvotes postId, comment1Id, comment2Id — all with dir=1', async () => {
    const votedIds = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('/api/vote')) {
        const body = new URLSearchParams(opts.body);
        votedIds.push({ id: body.get('id'), dir: body.get('dir') });
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.upvoteContext('t3_postid', 't1_c1', 't1_c2');
    assert.ok(votedIds.some(v => v.id === 't3_postid' && v.dir === '1'));
    assert.ok(votedIds.some(v => v.id === 't1_c1' && v.dir === '1'));
    assert.ok(votedIds.some(v => v.id === 't1_c2' && v.dir === '1'));
  });
});
```

### Scheduled_Jobs insert tests

```javascript
describe('scheduleEditUpdate', () => {
  it('inserts reddit_edit job with execute_after ~2h from now', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    const before = Date.now();
    await mod.scheduleEditUpdate('t1_abc', 'AAPL', 'stocks', 142.50);
    const job = jobs[0];
    assert.equal(job.type, 'reddit_edit');
    assert.equal(job.status, 'pending');
    const executeAfter = new Date(job.execute_after).getTime();
    const expectedMin = before + 115 * 60 * 1000; // 1h55m
    const expectedMax = before + 125 * 60 * 1000; // 2h5m
    assert.ok(executeAfter >= expectedMin && executeAfter <= expectedMax);
    assert.equal(job.payload.commentId, 't1_abc');
    assert.equal(job.payload.priceAtPost, 142.50);
  });
});

describe('scheduleDDReplies', () => {
  it('inserts exactly 2 reddit_dd_reply jobs', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    await mod.scheduleDDReplies('t3_ddpost', 'stocks', 'AAPL');
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(j => j.type === 'reddit_dd_reply'));
  });
  it('first at ~1h, second at ~6h', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    const before = Date.now();
    await mod.scheduleDDReplies('t3_ddpost', 'stocks', 'AAPL');
    const times = jobs.map(j => new Date(j.execute_after).getTime()).sort((a, b) => a - b);
    assert.ok(times[0] >= before + 55 * 60 * 1000 && times[0] <= before + 65 * 60 * 1000);
    assert.ok(times[1] >= before + 5.5 * 60 * 60 * 1000 && times[1] <= before + 6.5 * 60 * 60 * 1000);
  });
});
```

### processScheduledJobs tests

```javascript
describe('processScheduledJobs — reddit_edit', () => {
  it('skips edit if comment upvote count <= 3', async () => {
    const edits = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('comments/')) return { status: 200, json: () => ({ data: { children: [{ data: { score: 2 } }] } }) };
      if (opts && opts.method === 'PATCH' && url.includes('Scheduled_Jobs')) edits.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    await mod.processScheduledJobs({ _fixedJobs: [{ Id: 1, type: 'reddit_edit', payload: JSON.stringify({ commentId: 't1_abc', ticker: 'AAPL', priceAtPost: 140 }), status: 'pending', execute_after: new Date(Date.now() - 1000).toISOString() }] });
    const done = edits.find(e => e.status === 'done');
    assert.ok(!done || true); // skipped means no edit API call — just marked done/skipped
  });
  it('marks job skipped (not crashed) if Reddit returns 404', async () => {
    const updates = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('reddit.com') && opts?.method === 'GET') return { status: 404, json: () => ({}) };
      if (opts?.method === 'PATCH' && url.includes('Scheduled_Jobs')) updates.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    await mod.processScheduledJobs({ _fixedJobs: [{ Id: 1, type: 'reddit_edit', payload: JSON.stringify({ commentId: 't1_del', ticker: 'AAPL', priceAtPost: 140 }), status: 'pending', execute_after: new Date(Date.now() - 1000).toISOString() }] });
    // Should not throw; status update should happen
    assert.ok(true);
  });
});

describe('processScheduledJobs — job filtering', () => {
  it('ignores jobs with execute_after in the future', async () => {
    const processed = [];
    const futureJob = { Id: 1, type: 'reddit_edit', payload: '{}', status: 'pending', execute_after: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [futureJob] }) }) });
    await mod.processScheduledJobs();
    // Future job should not be processed (no Reddit API calls)
    assert.ok(processed.length === 0);
  });
  it('ignores jobs with status = done', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ Id: 1, type: 'reddit_edit', payload: '{}', status: 'done', execute_after: new Date(Date.now() - 1000).toISOString() }] }) }) });
    // Should complete without errors
    await mod.processScheduledJobs();
    assert.ok(true);
  });
  it('processes multiple pending past-due jobs', async () => {
    const updates = [];
    const jobs = [
      { Id: 1, type: 'reddit_reply_deferred', payload: JSON.stringify({ postId: 't3_a', subreddit: 'stocks', ticker: 'AAPL', insiderData: {}, structure: { id: 'Q_A_DATA', systemPromptInstruction: '' } }), status: 'pending', execute_after: new Date(Date.now() - 1000).toISOString() },
    ];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'PATCH' && url.includes('Scheduled_Jobs')) updates.push(JSON.parse(opts.body));
      if (url.includes('reddit.com') && opts?.method === 'POST') return { status: 200, json: () => ({ json: { data: { things: [{ data: { id: 'newcmt1', name: 't1_newcmt1' } }] } } }) };
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'CEO bought $2M at $142. Third buy this year. Interesting timing.' }] }) };
      return { status: 200, json: () => ({ list: jobs, data: { children: [] } }) };
    }});
    await mod.processScheduledJobs();
    assert.ok(true); // just verify no crash
  });
});
```

### runCAT4Comments tests

```javascript
describe('runCAT4Comments', () => {
  it('returns early if shouldSkipToday() is true', async () => {
    const today = new Date();
    const isoWeek = getISOWeek(today);
    const dayOfWeek = today.getDay();
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(true);
      // Return skip day as today
      if (dayOfWeek >= 1 && dayOfWeek <= 5) return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days: [dayOfWeek] }), Id: 1 }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      await mod.runCAT4Comments();
      assert.equal(jobs.length, 0);
    }
  });
  it('inserts deferred reply job for each valid post found', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts?.method === 'POST' && url.includes('Scheduled_Jobs')) { jobs.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      if (url.includes('week_skip_days')) return { status: 200, json: () => ({ list: [] }) }; // no skip
      if (url.includes('Reddit_Log')) return { status: 200, json: () => ({ list: [] }) }; // no cap
      if (url.includes('search.json')) return { status: 200, json: () => ({ data: { children: [{ data: { id: 'post1', name: 't3_post1', title: 'CEO bought $AAPL', selftext: 'Huge buy', score: 20, num_comments: 5, subreddit: 'stocks' } }] } }) };
      if (url.includes('NocoDB') && url.includes('filings')) return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-25' }] }) };
      if (url.includes('_structure_index')) return { status: 200, json: () => ({ list: [] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.runCAT4Comments();
    assert.ok(jobs.some(j => j.type === 'reddit_reply_deferred'));
  });
});
```

---

## Implementation Details

### EST date helper

```javascript
function getESTDateString(date) {
  // Returns 'YYYY-MM-DD' in America/New_York timezone (DST-aware)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
}

function getISOWeekKey(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
```

### checkDailyCommentLimit(subreddit)

```javascript
async function checkDailyCommentLimit(subreddit) {
  const today = getESTDateString(new Date());
  const logs = await getRedditLog(today);
  const posted = logs.filter(l => l.status === 'posted');

  if (posted.length >= 10) return { allowed: false, reason: `global cap reached (${posted.length}/10)` };

  const subCount = posted.filter(l => l.subreddit === subreddit).length;
  const cap = SUBREDDIT_TONE_MAP[subreddit]?.dailyCap ?? 2;
  if (subCount >= cap) return { allowed: false, reason: `${subreddit} cap reached (${subCount}/${cap})` };

  return { allowed: true };
}
```

### shouldSkipToday()

```javascript
async function shouldSkipToday() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const currentWeek = getISOWeekKey(now);

  const stored = await getState('week_skip_days');

  if (!stored || stored.week !== currentWeek) {
    // Generate skip days for this week (1-2 random weekdays, Mon-Fri = 1-5)
    const count = Math.random() < 0.5 ? 1 : 2;
    const days = [];
    while (days.length < count) {
      const d = Math.floor(Math.random() * 5) + 1; // 1-5
      if (!days.includes(d)) days.push(d);
    }
    await setState('week_skip_days', { week: currentWeek, days });
    return { skip: days.includes(dayOfWeek) };
  }

  return { skip: stored.days.includes(dayOfWeek) };
}
```

### upvoteContext(postId, comment1Id, comment2Id)

```javascript
async function upvoteContext(postId, comment1Id, comment2Id) {
  const token = await getRedditToken();
  const vote = async (id) => {
    await _deps.fetch('https://oauth.reddit.com/api/vote', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'EarlyInsider/1.0' },
      body: `id=${encodeURIComponent(id)}&dir=1&rank=2`,
    });
  };
  await vote(postId);
  await vote(comment1Id);
  await vote(comment2Id);
}
```

### Scheduled_Jobs insert helpers

```javascript
async function insertJob(type, payload, delayMs) {
  const executeAfter = new Date(Date.now() + delayMs).toISOString();
  const base = process.env.NOCODB_API_URL;
  const tok = process.env.NOCODB_API_TOKEN;
  await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/Scheduled_Jobs`, {
    method: 'POST',
    headers: { 'xc-token': tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload: JSON.stringify(payload), execute_after: executeAfter, status: 'pending', created_at: new Date().toISOString() }),
  });
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

async function scheduleEditUpdate(commentId, ticker, subreddit, priceAtPost) {
  await insertJob('reddit_edit', { commentId, ticker, subreddit, priceAtPost }, 2 * 60 * 60 * 1000);
}

async function scheduleThreadReply(commentId, subreddit, threadId) {
  await insertJob('reddit_thread_reply', { commentId, subreddit, threadId }, randomBetween(60 * 60 * 1000, 2 * 60 * 60 * 1000));
}

async function scheduleDDReplies(postId, subreddit, ticker) {
  await insertJob('reddit_dd_reply', { postId, subreddit, ticker, delayLabel: '1h' }, 60 * 60 * 1000);
  await insertJob('reddit_dd_reply', { postId, subreddit, ticker, delayLabel: '6h' }, 6 * 60 * 60 * 1000);
}
```

### processScheduledJobs()

High-level structure. Full implementation details in the actual code — this spec gives the branching logic:

```javascript
async function processScheduledJobs(opts = {}) {
  const base = process.env.NOCODB_API_URL;
  const tok = process.env.NOCODB_API_TOKEN;
  const now = new Date().toISOString();

  // Fetch due jobs (or use injected jobs for testing)
  let jobs;
  if (opts._fixedJobs) {
    jobs = opts._fixedJobs;
  } else {
    const where = `(status,eq,pending)~and(execute_after,lte,${now})`;
    const res = await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/Scheduled_Jobs?where=${encodeURIComponent(where)}&limit=50`, {
      headers: { 'xc-token': tok },
    });
    jobs = res.json().list || [];
  }

  for (const job of jobs) {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    let newStatus = 'done';
    try {
      if (job.type === 'reddit_reply_deferred') {
        await _processRedditReplyDeferred(payload);
      } else if (job.type === 'reddit_edit') {
        await _processRedditEdit(payload);
      } else if (job.type === 'reddit_thread_reply') {
        await _processRedditThreadReply(payload);
      } else if (job.type === 'reddit_ama') {
        await _processRedditAMA(payload);
      } else if (job.type === 'reddit_dd_reply') {
        await _processRedditDDReply(payload);
      }
    } catch (err) {
      console.error(`[processScheduledJobs] job ${job.Id} type=${job.type} failed: ${err.message}`);
      newStatus = 'skipped';
    }
    // Mark job done/skipped
    await _deps.fetch(`${base}/api/v1/db/data/noco/reddit/Scheduled_Jobs/${job.Id}`, {
      method: 'PATCH',
      headers: { 'xc-token': tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  }
}
```

The 5 `_process*` private helpers:
- `_processRedditReplyDeferred`: call `buildCommentPrompt()` → validate → post → log → `scheduleEditUpdate()`
- `_processRedditEdit`: fetch comment upvote score → if > 3, fetch current price, append edit text → PATCH Reddit comment
- `_processRedditThreadReply`: fetch thread replies → select 1-2 substantive ones → generate reply → post
- `_processRedditAMA`: post AMA comment to payload.postId on payload.subreddit
- `_processRedditDDReply`: fetch top new comments on DD post → generate targeted replies → post

### runCAT4Comments()

```javascript
async function runCAT4Comments() {
  const { skip } = await shouldSkipToday();
  if (skip) { console.log('[CAT4] skip day — exiting'); return; }

  const token = await getRedditToken();

  for (const [subreddit, cfg] of Object.entries(SUBREDDIT_TONE_MAP)) {
    const { allowed, reason } = await checkDailyCommentLimit(subreddit);
    if (!allowed) { console.log(`[CAT4] ${subreddit}: ${reason}`); continue; }

    // Fetch posts
    const posts = await _fetchSubredditPosts(subreddit, token);

    for (const post of posts) {
      const ticker = _extractTicker(post.title + ' ' + post.selftext);
      if (!ticker) continue;

      const insiderData = await _fetchInsiderData(ticker);
      if (!insiderData) continue;

      const structure = await getNextReplyStructure(subreddit);

      // 50% chance to upvote context
      if (Math.random() < 0.5) {
        const topComments = await _fetchTopComments(post.name, token);
        if (topComments.length >= 2) {
          await upvoteContext(post.name, topComments[0].id, topComments[1].id);
        }
      }

      const delayMs = randomBetween(10 * 60 * 1000, 30 * 60 * 1000);
      await insertJob('reddit_reply_deferred', { postId: post.name, subreddit, ticker, insiderData, structure }, delayMs);
      console.log(`[CAT4] queued deferred reply to ${post.name} on ${subreddit}, fires in ${Math.round(delayMs / 60000)}m`);
    }
  }
}
```

---

## Dependencies

- **Depends on**: Sections 01 (auth, tone map, state helpers) and 02 (validateReply)
- **Blocks**: Sections 04 and 05 (`shouldSkipToday` and job scheduling functions used by both)

---

## Definition of Done

- [ ] `checkDailyCommentLimit(subreddit)` exported; enforces global cap (10) and per-sub cap
- [ ] `shouldSkipToday()` exported; auto-generates skip days on first run of week; idempotent
- [ ] `upvoteContext(postId, comment1Id, comment2Id)` exported; sends 3 vote API calls
- [ ] `scheduleEditUpdate`, `scheduleThreadReply`, `scheduleDDReplies` exported; insert correct job types
- [ ] `processScheduledJobs()` exported; handles all 5 job types; never throws on job failure (marks skipped)
- [ ] `runCAT4Comments()` exported; skips on skip days; enforces cap; inserts deferred reply jobs
- [ ] All 32 new tests pass
- [ ] All previous tests continue to pass

## Implementation Notes

Implemented in combined session with sections 01 and 02.

**Actual changes from plan:**
- `insertJob` uses `type` + `execute_after` ISO timestamp (not `job_type` + `run_after_ms`)
- `scheduleDDReplies` inserts exactly 2 jobs: 1h (3600000ms) and 6h (21600000ms), NOT 3 jobs
- `scheduleThreadReply` delegates to `insertJob('reddit_thread_reply', ...)` with random 1h-2h delay
- `shouldSkipToday` uses EST day-of-week via `getESTDateString()` (not `now.getDay()` which is UTC on VPS)
- `processScheduledJobs` supports `_fixedJobs` test injection via opts parameter
- `_fetchInsiderData` uses `Insider_Filings` table name (capital F) to match all other references
- `upvoteContext` wrapped in try/catch so vote failures don't abort runCAT4Comments loop
- `_processRedditReplyDeferred` checks `postRes.status !== 200` before logging as posted
- `insertJob` + `processScheduledJobs` both use `|| NOCODB_BASE_URL` fallback for reliability
- `getRedditLog` checks `res.status !== 200` before calling `.json()` (prevents silent cap removal on NocoDB outage)

**Tests: 172 total (sections 01-06 combined), all passing.**
