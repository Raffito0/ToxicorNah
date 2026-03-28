'use strict';

const {
  checkMarketHours,
  validateEnvVars,
} = require('../../n8n/code/insiderbuying/market-hours-guard');

// ─────────────────────────────────────────────────────────────────────────────
describe('section-07: market-hours-guard', () => {

  // ── checkMarketHours ──────────────────────────────────────────────────────

  describe('checkMarketHours()', () => {

    test('Monday 10:00 ET = market hours → should exit', () => {
      // March 23 2026 is EDT (UTC-4). 10:00 EDT = 14:00 UTC
      const result = checkMarketHours(new Date('2026-03-23T14:00:00Z'));
      expect(result.isMarketHours).toBe(true);
      expect(result.estHour).toBe(10);
      expect(result.weekday).toBe('Mon');
    });

    test('Monday 20:00 ET = afterhours → should proceed', () => {
      // 20:00 EDT = 00:00 UTC March 24
      const result = checkMarketHours(new Date('2026-03-24T00:00:00Z'));
      expect(result.isMarketHours).toBe(false);
      expect(result.estHour).toBe(20);
    });

    test('Saturday 10:00 ET = weekend → should proceed', () => {
      // Saturday March 28 2026. 10:00 EDT = 14:00 UTC
      const result = checkMarketHours(new Date('2026-03-28T14:00:00Z'));
      expect(result.isMarketHours).toBe(false);
      expect(result.weekday).toBe('Sat');
    });

    test('Monday 09:29 ET = before open → should proceed (afterhours)', () => {
      // 09:29 EDT = 13:29 UTC
      const result = checkMarketHours(new Date('2026-03-23T13:29:00Z'));
      expect(result.isMarketHours).toBe(false);
      expect(result.estHour).toBe(9);
      expect(result.estMinute).toBe(29);
    });

    test('Monday 09:30 ET = exact open → market hours', () => {
      // 09:30 EDT = 13:30 UTC
      const result = checkMarketHours(new Date('2026-03-23T13:30:00Z'));
      expect(result.isMarketHours).toBe(true);
      expect(result.estHour).toBe(9);
      expect(result.estMinute).toBe(30);
    });

    test('Monday 16:00 ET = exact close → NOT market hours (close boundary)', () => {
      // 16:00 EDT = 20:00 UTC
      const result = checkMarketHours(new Date('2026-03-23T20:00:00Z'));
      expect(result.isMarketHours).toBe(false);
      expect(result.estHour).toBe(16);
    });

    test('Monday 15:59 ET = last minute of market hours', () => {
      // 15:59 EDT = 19:59 UTC
      const result = checkMarketHours(new Date('2026-03-23T19:59:00Z'));
      expect(result.isMarketHours).toBe(true);
      expect(result.estHour).toBe(15);
    });

    test('Sunday 12:00 ET = weekend → not market hours', () => {
      // Sunday March 22 2026, 12:00 EDT = 16:00 UTC
      const result = checkMarketHours(new Date('2026-03-22T16:00:00Z'));
      expect(result.isMarketHours).toBe(false);
      expect(result.weekday).toBe('Sun');
    });

    test('handles DST transition correctly (EST in November)', () => {
      // November 2 2026 is EST (clocks fall back Nov 1)
      // 10:00 EST = 15:00 UTC (EST = UTC-5)
      const result = checkMarketHours(new Date('2026-11-02T15:00:00Z'));
      expect(result.isMarketHours).toBe(true);
      expect(result.estHour).toBe(10);
    });

    test('Friday 14:00 ET = market hours', () => {
      // Friday March 27 2026, 14:00 EDT = 18:00 UTC
      const result = checkMarketHours(new Date('2026-03-27T18:00:00Z'));
      expect(result.isMarketHours).toBe(true);
      expect(result.weekday).toBe('Fri');
    });
  });

  // ── validateEnvVars ───────────────────────────────────────────────────────

  describe('validateEnvVars()', () => {

    test('does not throw when all vars present', () => {
      const env = {
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        SUPABASE_URL: 'https://example.supabase.co',
        RESEND_API_KEY: 're_xxx',
      };
      expect(() =>
        validateEnvVars(['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'RESEND_API_KEY'], env)
      ).not.toThrow();
    });

    test('throws naming the missing variable', () => {
      const env = {
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        SUPABASE_URL: '',
      };
      expect(() =>
        validateEnvVars(['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'RESEND_API_KEY'], env)
      ).toThrow('SUPABASE_URL');
    });

    test('throws naming all missing variables', () => {
      const env = {};
      expect(() =>
        validateEnvVars(['ANTHROPIC_API_KEY', 'RESEND_API_KEY'], env)
      ).toThrow('ANTHROPIC_API_KEY, RESEND_API_KEY');
    });

    test('treats empty string as missing', () => {
      const env = { KEY: '' };
      expect(() => validateEnvVars(['KEY'], env)).toThrow('KEY');
    });

    test('passes with no required vars', () => {
      expect(() => validateEnvVars([], {})).not.toThrow();
    });
  });
});
