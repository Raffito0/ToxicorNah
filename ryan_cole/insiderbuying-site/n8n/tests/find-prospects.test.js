const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSearchQueries,
  scoreProspect,
  dedup,
  buildProspectRecord,
  WEIGHT_DA,
  WEIGHT_RELEVANCE,
  WEIGHT_CONTACT,
  WEIGHT_RECENCY,
} = require('../code/insiderbuying/find-prospects.js');

// ---------------------------------------------------------------------------
// buildSearchQueries
// ---------------------------------------------------------------------------
describe('buildSearchQueries', () => {
  it('includes generic queries', () => {
    const queries = buildSearchQueries([]);
    assert.ok(queries.length >= 5);
    assert.ok(queries.some(q => q.indexOf('insider') !== -1 || q.indexOf('finance') !== -1 || q.indexOf('stock') !== -1));
  });

  it('includes ticker queries', () => {
    const queries = buildSearchQueries(['AAPL', 'TSLA']);
    assert.ok(queries.some(q => q === 'AAPL analysis'));
    assert.ok(queries.some(q => q === 'TSLA analysis'));
  });

  it('handles null tickers', () => {
    const queries = buildSearchQueries(null);
    assert.ok(queries.length >= 5);
  });
});

// ---------------------------------------------------------------------------
// scoreProspect
// ---------------------------------------------------------------------------
describe('scoreProspect', () => {
  it('returns number between 0 and 100', () => {
    const score = scoreProspect({
      domain_authority: 50,
      relevance_score: 60,
      contact_quality: 70,
      recency_score: 80,
    });
    assert.ok(typeof score === 'number');
    assert.ok(score >= 0);
    assert.ok(score <= 100);
  });

  it('weights sum to 1.0', () => {
    const sum = WEIGHT_DA + WEIGHT_RELEVANCE + WEIGHT_CONTACT + WEIGHT_RECENCY;
    assert.ok(Math.abs(sum - 1.0) < 0.001, 'Weights should sum to 1.0, got ' + sum);
  });

  it('returns 0 for all-zero scores', () => {
    const score = scoreProspect({
      domain_authority: 0,
      relevance_score: 0,
      contact_quality: 0,
      recency_score: 0,
    });
    assert.equal(score, 0);
  });

  it('returns 100 for all-100 scores', () => {
    const score = scoreProspect({
      domain_authority: 100,
      relevance_score: 100,
      contact_quality: 100,
      recency_score: 100,
    });
    assert.equal(score, 100);
  });
});

// ---------------------------------------------------------------------------
// dedup
// ---------------------------------------------------------------------------
describe('dedup', () => {
  it('removes matching domains', () => {
    const prospects = [
      { domain: 'example.com', site_name: 'Example' },
      { domain: 'new-site.com', site_name: 'New' },
    ];
    const existing = ['example.com'];
    const result = dedup(prospects, existing);
    assert.equal(result.length, 1);
    assert.equal(result[0].domain, 'new-site.com');
  });

  it('keeps non-matching domains', () => {
    const prospects = [
      { domain: 'alpha.com' },
      { domain: 'beta.com' },
    ];
    const existing = ['gamma.com'];
    const result = dedup(prospects, existing);
    assert.equal(result.length, 2);
  });

  it('case-insensitive domain matching', () => {
    const prospects = [{ domain: 'Example.COM' }];
    const existing = ['example.com'];
    const result = dedup(prospects, existing);
    assert.equal(result.length, 0);
  });

  it('handles null inputs', () => {
    assert.deepEqual(dedup(null, null), []);
    assert.deepEqual(dedup([], null), []);
  });
});

// ---------------------------------------------------------------------------
// buildProspectRecord
// ---------------------------------------------------------------------------
describe('buildProspectRecord', () => {
  it('has status=found', () => {
    const record = buildProspectRecord({
      domain: 'test.com',
      site_name: 'Test Site',
      contact_email: 'a@test.com',
      domain_authority: 40,
      relevance_score: 50,
      contact_quality: 60,
      recency_score: 70,
    });
    assert.equal(record.status, 'found');
  });

  it('includes priority from scoreProspect', () => {
    const record = buildProspectRecord({
      domain: 'test.com',
      domain_authority: 50,
      relevance_score: 50,
      contact_quality: 50,
      recency_score: 50,
    });
    assert.ok(typeof record.priority === 'number');
    assert.equal(record.priority, 50);
  });

  it('includes found_at timestamp', () => {
    const record = buildProspectRecord({ domain: 'x.com' });
    assert.ok(typeof record.found_at === 'string');
    assert.match(record.found_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});
