const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectProspects,
  validateEmail,
  buildSendPayload,
  checkForFollowUps,
  logEmail,
  BANNED_PHRASES,
} = require('../code/insiderbuying/send-outreach.js');

// ---------------------------------------------------------------------------
// BANNED_PHRASES
// ---------------------------------------------------------------------------
describe('BANNED_PHRASES', () => {
  it('is non-empty array', () => {
    assert.ok(Array.isArray(BANNED_PHRASES));
    assert.ok(BANNED_PHRASES.length > 0);
  });
});

// ---------------------------------------------------------------------------
// selectProspects
// ---------------------------------------------------------------------------
describe('selectProspects', () => {
  it('sorts by priority descending and limits results', () => {
    const prospects = [
      { status: 'found', contact_email: 'a@a.com', priority: 30 },
      { status: 'found', contact_email: 'b@b.com', priority: 90 },
      { status: 'found', contact_email: 'c@c.com', priority: 60 },
    ];
    const result = selectProspects(prospects, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].priority, 90);
    assert.equal(result[1].priority, 60);
  });

  it('filters out non-found status', () => {
    const prospects = [
      { status: 'contacted', contact_email: 'a@a.com', priority: 90 },
      { status: 'found', contact_email: 'b@b.com', priority: 50 },
    ];
    const result = selectProspects(prospects);
    assert.equal(result.length, 1);
    assert.equal(result[0].priority, 50);
  });

  it('filters out prospects without email', () => {
    const prospects = [
      { status: 'found', contact_email: '', priority: 90 },
      { status: 'found', contact_email: 'b@b.com', priority: 50 },
    ];
    const result = selectProspects(prospects);
    assert.equal(result.length, 1);
  });
});

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------
describe('validateEmail', () => {
  it('rejects > 150 words', () => {
    const longText = Array.from({ length: 160 }, () => 'word').join(' ') + '? Would you be interested in this?';
    const result = validateEmail(longText);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.indexOf('150') !== -1));
  });

  it('rejects template phrases', () => {
    const text = 'I hope this finds you well. I have a great article to share. Would you be interested in a guest post?';
    const result = validateEmail(text);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.indexOf('banned') !== -1 || i.indexOf('phrase') !== -1));
  });

  it('accepts valid short email with CTA', () => {
    const text = 'We published insider data on AAPL showing the CEO bought $5M in shares. Would you be interested in featuring this as a guest post?';
    const result = validateEmail(text);
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it('rejects email without CTA', () => {
    const text = 'We published insider data on AAPL. The CEO bought shares. This is interesting information for your readers.';
    const result = validateEmail(text);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.indexOf('CTA') !== -1 || i.indexOf('ask') !== -1));
  });
});

// ---------------------------------------------------------------------------
// buildSendPayload
// ---------------------------------------------------------------------------
describe('buildSendPayload', () => {
  it('has from/to/subject/html', () => {
    const payload = buildSendPayload('recipient@test.com', 'Subject Line', 'Email body here', 'sender@earlyinsider.com');
    assert.equal(payload.from, 'sender@earlyinsider.com');
    assert.equal(payload.to, 'recipient@test.com');
    assert.equal(payload.subject, 'Subject Line');
    assert.ok(typeof payload.html === 'string');
    assert.ok(payload.html.indexOf('<p>') !== -1);
  });

  it('includes text field with raw body', () => {
    const payload = buildSendPayload('a@b.com', 'Sub', 'Raw text', 'from@x.com');
    assert.equal(payload.text, 'Raw text');
  });
});

// ---------------------------------------------------------------------------
// checkForFollowUps
// ---------------------------------------------------------------------------
describe('checkForFollowUps', () => {
  it('filters by date -- returns prospects needing follow-up', () => {
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    const logs = [
      { prospect_id: 'p1', email_type: 'initial', sent_at: sixDaysAgo.toISOString() },
    ];
    const result = checkForFollowUps(logs, 5);
    assert.ok(result.indexOf('p1') !== -1);
  });

  it('excludes prospects already followed up', () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const logs = [
      { prospect_id: 'p1', email_type: 'initial', sent_at: tenDaysAgo.toISOString() },
      { prospect_id: 'p1', email_type: 'followup', sent_at: new Date().toISOString() },
    ];
    const result = checkForFollowUps(logs, 5);
    assert.equal(result.indexOf('p1'), -1);
  });

  it('excludes recent initial emails', () => {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const logs = [
      { prospect_id: 'p1', email_type: 'initial', sent_at: oneDayAgo.toISOString() },
    ];
    const result = checkForFollowUps(logs, 5);
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// logEmail
// ---------------------------------------------------------------------------
describe('logEmail', () => {
  it('returns record with email_type', () => {
    const record = logEmail('prospect_123', 'initial');
    assert.equal(record.prospect_id, 'prospect_123');
    assert.equal(record.email_type, 'initial');
    assert.equal(record.status, 'sent');
    assert.ok(typeof record.sent_at === 'string');
  });

  it('defaults email_type to initial', () => {
    const record = logEmail('p1');
    assert.equal(record.email_type, 'initial');
  });
});
