'use strict';

const {
  buildSearchQueries,
  scoreProspect,
  dedup,
  buildProspectRecord,
  WEIGHT_DA,
  WEIGHT_RELEVANCE,
  WEIGHT_CONTACT,
  WEIGHT_RECENCY,
} = require('../../n8n/code/insiderbuying/find-prospects');

// ─── buildSearchQueries ───────────────────────────────────────────────────

describe('buildSearchQueries()', () => {
  test('returns a non-empty array', () => {
    const queries = buildSearchQueries([]);
    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
  });

  test('includes generic finance/insider queries', () => {
    const queries = buildSearchQueries([]);
    expect(queries.some((q) => q.toLowerCase().includes('insider'))).toBe(true);
  });

  test('appends ticker-specific queries for each ticker', () => {
    const queries = buildSearchQueries(['AAPL', 'MSFT']);
    expect(queries.some((q) => q.includes('AAPL'))).toBe(true);
    expect(queries.some((q) => q.includes('MSFT'))).toBe(true);
  });

  test('handles null/empty tickers gracefully', () => {
    expect(() => buildSearchQueries(null)).not.toThrow();
    expect(() => buildSearchQueries([])).not.toThrow();
  });
});

// ─── scoreProspect ────────────────────────────────────────────────────────

describe('scoreProspect()', () => {
  test('returns a number between 0 and 100', () => {
    const score = scoreProspect({
      domain_authority: 50,
      relevance_score: 70,
      contact_quality: 80,
      recency_score: 60,
    });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('perfect scores yield 100', () => {
    const score = scoreProspect({
      domain_authority: 100,
      relevance_score: 100,
      contact_quality: 100,
      recency_score: 100,
    });
    expect(score).toBe(100);
  });

  test('zero scores yield 0', () => {
    const score = scoreProspect({
      domain_authority: 0,
      relevance_score: 0,
      contact_quality: 0,
      recency_score: 0,
    });
    expect(score).toBe(0);
  });

  test('handles missing fields gracefully (treats as 0)', () => {
    expect(() => scoreProspect({})).not.toThrow();
    expect(scoreProspect({})).toBe(0);
  });

  test('weights sum to 1.0', () => {
    expect(WEIGHT_DA + WEIGHT_RELEVANCE + WEIGHT_CONTACT + WEIGHT_RECENCY).toBeCloseTo(1.0);
  });
});

// ─── dedup ────────────────────────────────────────────────────────────────

describe('dedup()', () => {
  test('removes prospects whose domain is in existingDomains', () => {
    const prospects = [
      { domain: 'example.com' },
      { domain: 'newsite.com' },
    ];
    const result = dedup(prospects, ['example.com']);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('newsite.com');
  });

  test('domain comparison is case-insensitive', () => {
    const prospects = [{ domain: 'EXAMPLE.COM' }];
    const result = dedup(prospects, ['example.com']);
    expect(result).toHaveLength(0);
  });

  test('returns all prospects if no existing domains', () => {
    const prospects = [{ domain: 'a.com' }, { domain: 'b.com' }];
    expect(dedup(prospects, [])).toHaveLength(2);
  });

  test('handles null/empty inputs gracefully', () => {
    expect(dedup(null, [])).toEqual([]);
    expect(dedup([], null)).toEqual([]);
    expect(dedup(null, null)).toEqual([]);
  });
});

// ─── buildProspectRecord ──────────────────────────────────────────────────

describe('buildProspectRecord()', () => {
  const PROSPECT_INPUT = {
    domain: 'tradingblog.com',
    site_name: 'Trading Blog',
    contact_email: 'editor@tradingblog.com',
    contact_name: 'Alice',
    domain_authority: 55,
    relevance_score: 70,
    contact_quality: 80,
    recency_score: 60,
    source_query: 'insider buying blog',
    notes: 'Covers SEC filings',
  };

  test('returns flat object — no { fields: {} } wrapper', () => {
    const record = buildProspectRecord(PROSPECT_INPUT);
    expect(record.fields).toBeUndefined();
  });

  test('includes domain and contact fields', () => {
    const record = buildProspectRecord(PROSPECT_INPUT);
    expect(record.domain).toBe('tradingblog.com');
    expect(record.contact_email).toBe('editor@tradingblog.com');
    expect(record.contact_name).toBe('Alice');
  });

  test('status is "found"', () => {
    const record = buildProspectRecord(PROSPECT_INPUT);
    expect(record.status).toBe('found');
  });

  test('priority is a number between 0 and 100', () => {
    const record = buildProspectRecord(PROSPECT_INPUT);
    expect(typeof record.priority).toBe('number');
    expect(record.priority).toBeGreaterThanOrEqual(0);
    expect(record.priority).toBeLessThanOrEqual(100);
  });

  test('found_at is a valid ISO timestamp', () => {
    const record = buildProspectRecord(PROSPECT_INPUT);
    expect(() => new Date(record.found_at)).not.toThrow();
    expect(new Date(record.found_at).toISOString()).toBe(record.found_at);
  });

  test('handles missing fields with safe defaults', () => {
    const record = buildProspectRecord({});
    expect(record.domain).toBe('');
    expect(record.site_name).toBe('');
    expect(record.contact_email).toBe('');
    expect(record.domain_authority).toBe(0);
    expect(record.status).toBe('found');
  });
});
