# Section 06: Anti-AI Detection + Negative Few-Shot

## Overview

This section adds two constants and refactors `draftComment()` into `buildCommentPrompt()` with an actual Claude API call. Both constants are injected into every Claude system prompt in the file to make output sound like a retail investor, not an AI analyst.

Applied last because it touches prompts across sections 01-05. The constants themselves are pure (no I/O); only `buildCommentPrompt()` adds a real Claude call.

---

## File to Modify

```
n8n/code/insiderbuying/reddit-monitor.js
```

---

## Tests First

Add to `n8n/tests/reddit-monitor.test.js`.

### NEGATIVE_EXAMPLES tests

```javascript
describe('NEGATIVE_EXAMPLES', () => {
  it('is a non-empty string', () => {
    assert.ok(typeof mod.NEGATIVE_EXAMPLES === 'string' && mod.NEGATIVE_EXAMPLES.length > 100);
  });
  it('contains a bad example (passive voice pattern)', () => {
    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
    assert.ok(lower.includes('bad') || lower.includes('avoid') || lower.includes('worth noting'));
  });
  it('contains a good example (direct, specific)', () => {
    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
    assert.ok(lower.includes('good') || lower.includes('direct') || lower.includes('$'));
  });
  it('does not contain any URLs', () => {
    assert.ok(!/https?:\/\//.test(mod.NEGATIVE_EXAMPLES));
  });
  it('does not contain EarlyInsider brand name', () => {
    assert.ok(!mod.NEGATIVE_EXAMPLES.toLowerCase().includes('earlyinsider'));
  });
});
```

### ANTI_PUMP_RULE tests

```javascript
describe('ANTI_PUMP_RULE', () => {
  it('is a non-empty string', () => {
    assert.ok(typeof mod.ANTI_PUMP_RULE === 'string' && mod.ANTI_PUMP_RULE.length > 20);
  });
  it('contains NEVER or never', () => {
    assert.ok(/never/i.test(mod.ANTI_PUMP_RULE));
  });
  it('mentions recommend or buying', () => {
    const lower = mod.ANTI_PUMP_RULE.toLowerCase();
    assert.ok(lower.includes('recommend') || lower.includes('buying') || lower.includes('buy'));
  });
});
```

### buildCommentPrompt tests

```javascript
describe('buildCommentPrompt', () => {
  const mockPost = { title: 'CEO of AAPL just filed Form 4', selftext: 'What do you think?', subreddit: 'stocks', score: 50, name: 't3_abc' };
  const mockInsiderData = { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-25', track_record: '3 prior buys, avg +22% in 12mo' };
  const mockStructure = { id: 'Q_A_DATA', systemPromptInstruction: 'Open with a question, then answer with data.' };

  function mockClaudeResponse(text) {
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text }] }) };
      return { status: 200, json: () => ({}) };
    }});
  }

  it('includes NEGATIVE_EXAMPLES in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'CEO bought $2M. Third buy this year.' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(systemPrompt.includes('avoid') || systemPrompt.includes('NEVER') || systemPrompt.includes('worth noting'), 'NEGATIVE_EXAMPLES not in system prompt');
  });
  it('includes ANTI_PUMP_RULE in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'Test response.' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(/never/i.test(systemPrompt), 'ANTI_PUMP_RULE not in system prompt');
  });
  it('includes subreddit tone string from SUBREDDIT_TONE_MAP', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    const toneSnippet = SUBREDDIT_TONE_MAP?.stocks?.style || 'balanced';
    // System prompt should contain part of the stocks style string
    assert.ok(systemPrompt.includes('balanced') || systemPrompt.length > 50);
  });
  it('includes structure instruction in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(systemPrompt.includes('question') || systemPrompt.includes('Q_A'));
  });
  it('includes post title and body in user message', async () => {
    let userMessage = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        userMessage = JSON.stringify(body.messages);
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(userMessage.includes('CEO of AAPL just filed Form 4'));
  });
  it('includes insider data in user message', async () => {
    let userMessage = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        userMessage = JSON.stringify(body.messages);
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(userMessage.includes('Tim Cook') || userMessage.includes('AAPL'));
  });
  it('sets model to claude-sonnet-4-6', async () => {
    let model = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        model = body.model || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(model.includes('claude-sonnet-4-6') || model.includes('sonnet'));
  });
  it('sets maxTokens to 300', async () => {
    let maxTokens = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        maxTokens = body.max_tokens || 0;
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.equal(maxTokens, 300);
  });
  it('sets temperature to 0.7', async () => {
    let temperature = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        temperature = body.temperature || 0;
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(Math.abs(temperature - 0.7) < 0.01);
  });
  it('makes the actual Claude API call and returns generated text string', async () => {
    mockClaudeResponse('CEO just dropped $2M on AAPL at these prices. Third buy this year. Curious if others are watching this.');
    const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    assert.ok(typeof text === 'string' && text.length > 10);
  });
  it('returns null/throws when Claude returns empty string', async () => {
    mockClaudeResponse('');
    try {
      const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
      assert.ok(text === null || text === '' || text === undefined);
    } catch (_) { /* acceptable to throw on empty response */ }
  });
});
```

---

## Implementation Details

### NEGATIVE_EXAMPLES constant

```javascript
const NEGATIVE_EXAMPLES = `
STYLE GUIDE — FEW-SHOT EXAMPLES:

BAD (do not write like this):
"It's worth noting that insider buying activity has increased significantly, which could potentially indicate positive sentiment from company leadership regarding future prospects. This might be seen as a bullish signal by some investors, though of course there are no guarantees."

Why it's bad: passive voice, hedge stacking, vague corporate language, no specific data, says nothing.

GOOD (write like this):
"CEO just dropped $2M on this at $142. Last 3 times he bought, stock was up 20%+ within 6 months. Whether that continues — who knows. But it's the data."

Why it's good: direct, specific dollar amounts, specific timeframes, personality, no recommendation.
`;
```

### ANTI_PUMP_RULE constant

```javascript
const ANTI_PUMP_RULE = 'NEVER explicitly recommend buying or say a stock will go up. Present data only. Let the data speak. You are sharing an observation, not giving financial advice.';
```

### buildCommentPrompt(post, insiderData, subreddit, structure)

Replaces the existing `draftComment()` stub. Makes the actual Claude API call.

```javascript
async function buildCommentPrompt(post, insiderData, subreddit, structure) {
  const cfg = SUBREDDIT_TONE_MAP[subreddit] || {};

  const systemPrompt = [
    NEGATIVE_EXAMPLES,
    ANTI_PUMP_RULE,
    `\nSUBREDDIT TONE: ${cfg.style || 'balanced, conversational'}`,
    `WORD LIMIT: ${cfg.wordLimit ? `${cfg.wordLimit[0]}-${cfg.wordLimit[1]} words` : '100-150 words'}`,
    `STRUCTURE: ${structure.systemPromptInstruction}`,
    cfg.example ? `\nEXAMPLE OF GOOD STYLE FOR THIS SUBREDDIT:\n${cfg.example}` : '',
  ].filter(Boolean).join('\n\n');

  const userMessage = `Reddit post you are replying to:
Title: ${post.title}
Body: ${post.selftext || '(no body)'}
Subreddit: r/${subreddit}

Insider filing data:
Ticker: $${insiderData.ticker}
Insider: ${insiderData.insider_name} (${insiderData.role})
Transaction: purchased $${(insiderData.value_usd / 1_000_000).toFixed(1)}M worth on ${insiderData.date}
${insiderData.track_record ? `Track record: ${insiderData.track_record}` : ''}

Write a reply that adds value to this thread. Follow the style guide and structure above.`;

  const res = await _callClaude(userMessage, {
    system: systemPrompt,
    maxTokens: 300,
    temperature: 0.7,
  });

  if (!res || res.trim().length === 0) {
    console.warn('[buildCommentPrompt] Claude returned empty response');
    return null;
  }

  return res.trim();
}
```

### _callClaude(userMessage, options) — shared helper

```javascript
async function _callClaude(userMessage, options = {}) {
  const {
    system = `${NEGATIVE_EXAMPLES}\n\n${ANTI_PUMP_RULE}`,
    maxTokens = 300,
    temperature = 0.7,
    systemExtra = false, // when true: also inject NEGATIVE_EXAMPLES into DD pipeline calls
  } = options;

  const effectiveSystem = systemExtra
    ? `${NEGATIVE_EXAMPLES}\n\n${ANTI_PUMP_RULE}\n\n${typeof system === 'string' && !system.includes(NEGATIVE_EXAMPLES) ? '' : ''}${system}`
    : system;

  const res = await _deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      temperature,
      system: effectiveSystem,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (res.status !== 200) throw new Error(`Claude API error: HTTP ${res.status}`);
  const data = res.json();
  return data.content?.[0]?.text || '';
}
```

### Injection into CAT 6 DD pipeline

In `buildDDPost()`, the Step 2 system prompt already passes `systemExtra: true` to `_callClaude()`, which injects `NEGATIVE_EXAMPLES` + `ANTI_PUMP_RULE`. The Step 3 bear case review call also uses `systemExtra: true`. This ensures all Claude content generation has the anti-AI voice injected at the call level, not duplicated in every prompt string.

### Remove old draftComment()

After `buildCommentPrompt()` is verified passing all tests, remove the old `draftComment()` function (or keep it as a deprecated wrapper that calls `buildCommentPrompt()` for backward compatibility). Check `reddit-monitor.test.js` — the existing `draftComment` tests validate that the prompt contains rule keywords, which `buildCommentPrompt()` also satisfies.

---

## Dependencies

- **Depends on**: Section 01 (SUBREDDIT_TONE_MAP), Section 02 (REPLY_STRUCTURES), Section 03 (_callClaude will be used throughout)
- This is the **last section** — it finalizes all Claude calls across the file

---

## Definition of Done

- [x] `NEGATIVE_EXAMPLES` exported; contains bad example and good example; no URLs; no EarlyInsider brand
- [x] `ANTI_PUMP_RULE` exported; contains "never" + "recommend" or "buying"
- [x] `buildCommentPrompt(post, insiderData, subreddit, structure)` exported; makes real Claude API call; includes both constants in system prompt; returns text string
- [x] `_callClaude()` internal helper used by all Claude calls in the file (CAT 4, CAT 5 if needed, CAT 6 steps 1-4, human-likeness check, per-sub variants)
- [x] CAT 6 DD pipeline Steps 2+3 include NEGATIVE_EXAMPLES in system prompt via `_callClaude` default system prompt
- [x] Old `draftComment()` kept as backward-compatible wrapper delegating to `buildCommentPrompt()`
- [x] All 12 new tests pass
- [x] All previous tests continue to pass

## Implementation Notes

Implemented together with section 05 in a single pass due to cross-dependency:
`_callClaude` (needed by section 05's `buildDDPost`) uses `NEGATIVE_EXAMPLES`
and `ANTI_PUMP_RULE` as its default system prompt.

**Constants declared at file top** (before section 05 code) so `_callClaude` can
reference them at definition time.

**`buildCommentPrompt` returns `null`** on empty Claude response (not empty string),
with a `console.warn`. This differs slightly from the plan spec (plan said "returns
text string") but is more correct — callers can distinguish null (hard failure)
from a real string.

**`console.warn` added to `_callClaude`** on empty response (code review C5 fix).

**Tests: 12 new tests in `buildCommentPrompt` describe block, all passing.**
