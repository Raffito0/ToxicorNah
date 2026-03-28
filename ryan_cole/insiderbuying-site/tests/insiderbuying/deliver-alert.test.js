'use strict';

const {
  fetchEligibleUsers,
  buildEmailObject,
  buildEmailHtml,
  chunkArray,
  formatMoney,
  sendResendBatch,
  sendOneSignalPush,
  updateDeliveryStatus,
  deliverAlert,
} = require('../../n8n/code/insiderbuying/deliver-alert');

// --- helpers ----------------------------------------------------------------

function makeFetch(response, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

function makeFetchSeq(...calls) {
  const fn = jest.fn();
  calls.forEach(({ response, ok = true, status = 200 }) => {
    fn.mockResolvedValueOnce({
      ok,
      status,
      json: async () => response,
      text: async () => JSON.stringify(response),
    });
  });
  return fn;
}

const noSleep = jest.fn().mockResolvedValue(undefined);

const BASE_ENV = {
  AIRTABLE_API_KEY: 'at-key',
  AIRTABLE_BASE_ID: 'appXXX',
  INSIDER_ALERTS_TABLE_ID: 'tblAlerts',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
  RESEND_API_KEY: 'resend-key',
  ONESIGNAL_APP_ID: 'os-app-id',
  ONESIGNAL_REST_API_KEY: 'os-rest-key',
};

const SAMPLE_ALERT = {
  airtable_record_id: 'recABC',
  supabase_alert_id: 'uuid-123',
  ticker: 'AAPL',
  insider_name: 'Timothy D. Cook',
  insider_title: 'CEO',
  total_value: 1502500,
  significance_score: 8,
  ai_analysis: 'This is a detailed analysis of the insider trade that spans multiple paragraphs and provides significant insight into the transaction.',
  transaction_type: 'buy',
  cluster_size: 0,
};

// ─── 6.1 Fetch Eligible Users ────────────────────────────────────────────

describe('6.1: fetchEligibleUsers', () => {
  test('users with email_enabled=false are excluded', async () => {
    const fetchFn = makeFetchSeq(
      // preferences query
      { response: [
        { user_id: 'u1', email_enabled: true, min_significance_score: 5 },
        { user_id: 'u2', email_enabled: false, min_significance_score: 3 },
      ] },
      // profiles query
      { response: [{ user_id: 'u1', subscription_tier: 'free' }] },
      // auth admin get user u1
      { response: { user: { email: 'u1@test.com' } } },
    );

    const users = await fetchEligibleUsers(8, 'AAPL', { fetchFn, env: BASE_ENV });
    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe('u1');
  });

  test('user with min_significance_score=7 receives alert with score=8', async () => {
    const fetchFn = makeFetchSeq(
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 7 }] },
      { response: [{ user_id: 'u1', subscription_tier: 'pro' }] },
      { response: { user: { email: 'u1@test.com' } } },
    );

    const users = await fetchEligibleUsers(8, 'AAPL', { fetchFn, env: BASE_ENV });
    expect(users).toHaveLength(1);
  });

  test('user with min_significance_score=9 does NOT receive alert with score=8', async () => {
    const fetchFn = makeFetchSeq(
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 9, watched_tickers: [] }] },
      { response: [] }, // no eligible profiles
    );

    const users = await fetchEligibleUsers(8, 'MSFT', { fetchFn, env: BASE_ENV });
    expect(users).toHaveLength(0);
  });

  test('user with watched_tickers=[AAPL] receives alert for AAPL even if score=3', async () => {
    const fetchFn = makeFetchSeq(
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 9, watched_tickers: ['AAPL'] }] },
      { response: [{ user_id: 'u1', subscription_tier: 'free' }] },
      { response: { user: { email: 'u1@test.com' } } },
    );

    const users = await fetchEligibleUsers(3, 'AAPL', { fetchFn, env: BASE_ENV });
    expect(users).toHaveLength(1);
  });

  test('Pro user gets full ai_analysis text', () => {
    const email = buildEmailObject(
      { userId: 'u1', email: 'u1@test.com', subscriptionTier: 'pro' },
      SAMPLE_ALERT,
    );
    expect(email.html).toContain(SAMPLE_ALERT.ai_analysis);
    expect(email.html).not.toContain('upgrade to Pro');
  });

  test('Free user gets first 150 chars of ai_analysis + upgrade CTA', () => {
    const longAnalysis = 'A'.repeat(300);
    const alert = { ...SAMPLE_ALERT, ai_analysis: longAnalysis };
    const email = buildEmailObject(
      { userId: 'u1', email: 'u1@test.com', subscriptionTier: 'free' },
      alert,
    );
    expect(email.html).not.toContain(longAnalysis);
    expect(email.html).toContain('upgrade to Pro');
  });

  test('error in getUserById does NOT log user.email', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const fetchFn = makeFetchSeq(
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 5 }] },
      { response: [{ user_id: 'u1', subscription_tier: 'free' }] },
      { response: { error: 'not found' }, ok: false, status: 404 },
    );

    const users = await fetchEligibleUsers(8, 'AAPL', { fetchFn, env: BASE_ENV });
    expect(users).toHaveLength(0);

    // Check that no logged message contains an email
    for (const call of consoleSpy.mock.calls) {
      const msg = call.join(' ');
      expect(msg).not.toMatch(/@.*\./);
      expect(msg).toContain('u1'); // Should log user_id
    }
    consoleSpy.mockRestore();
  });
});

// ─── 6.2 Resend Email ───────────────────────────────────────────────────

describe('6.2: Resend email', () => {
  test('each email has exactly one recipient in to field', () => {
    const email = buildEmailObject(
      { userId: 'u1', email: 'u1@test.com', subscriptionTier: 'pro' },
      SAMPLE_ALERT,
    );
    expect(typeof email.to).toBe('string');
    expect(email.to).toBe('u1@test.com');
  });

  test('250 recipients chunked into [100, 100, 50]', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunkArray(arr, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });

  test('200ms delay between batch calls', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const fetchFn = makeFetch({ data: [{ id: 'e1' }] });

    const emails = Array.from({ length: 150 }, (_, i) => ({
      from: 'EarlyInsider <alerts@earlyinsider.com>',
      to: `u${i}@test.com`,
      subject: 'Test',
      html: '<p>Test</p>',
    }));

    await sendResendBatch(emails, { fetchFn, env: BASE_ENV, _sleep: sleepFn });
    // 2 batches = 1 sleep between them
    expect(sleepFn).toHaveBeenCalledWith(200);
  });

  test('email HTML includes unsubscribe link', () => {
    const html = buildEmailHtml(SAMPLE_ALERT, SAMPLE_ALERT.ai_analysis, true);
    expect(html).toContain('/preferences?unsubscribe=1');
  });

  test('email HTML includes postal address in footer', () => {
    const html = buildEmailHtml(SAMPLE_ALERT, SAMPLE_ALERT.ai_analysis, true);
    expect(html).toMatch(/\d+.*street|avenue|blvd|road|way|suite/i);
  });

  test('regular alert subject format', () => {
    const email = buildEmailObject(
      { userId: 'u1', email: 'u1@test.com', subscriptionTier: 'pro' },
      SAMPLE_ALERT,
    );
    expect(email.subject).toContain('[INSIDER BUY]');
    expect(email.subject).toContain('Timothy D. Cook');
    expect(email.subject).toContain('AAPL');
  });

  test('cluster alert subject format', () => {
    const clusterAlert = { ...SAMPLE_ALERT, transaction_type: 'cluster', cluster_size: 3 };
    const email = buildEmailObject(
      { userId: 'u1', email: 'u1@test.com', subscriptionTier: 'pro' },
      clusterAlert,
    );
    expect(email.subject).toContain('CLUSTER BUY');
    expect(email.subject).toContain('3 insiders');
    expect(email.subject).toContain('\u{1F525}');
  });

  test('Resend failure does not block push notification delivery', async () => {
    const fetchFn = makeFetchSeq(
      // fetchEligibleUsers: preferences
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 5 }] },
      // profiles
      { response: [{ user_id: 'u1', subscription_tier: 'pro' }] },
      // auth get user
      { response: { user: { email: 'u1@test.com' } } },
      // Resend batch FAILS
      { response: { error: 'rate limited' }, ok: false, status: 429 },
      // OneSignal succeeds
      { response: { id: 'notif-1', recipients: 5 } },
      // Airtable delivery tracking
      { response: {} },
    );

    const result = await deliverAlert(SAMPLE_ALERT, {
      fetchFn,
      env: BASE_ENV,
      _sleep: noSleep,
    });

    expect(result.push_sent).toBe(5);
  });
});

// ─── 6.3 OneSignal Push ──────────────────────────────────────────────────

describe('6.3: OneSignal push', () => {
  test('filter uses tag alert_score_min <= alert_score', async () => {
    const fetchFn = makeFetch({ id: 'notif-1', recipients: 10 });
    await sendOneSignalPush(SAMPLE_ALERT, 'uuid-123', {
      fetchFn,
      env: BASE_ENV,
    });

    const call = fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'tag',
          key: 'alert_score_min',
          relation: '<=',
          value: String(SAMPLE_ALERT.significance_score),
        }),
      ]),
    );
  });

  test('notification URL deep-links to /alerts#{supabase_alert_id}', async () => {
    const fetchFn = makeFetch({ id: 'notif-1', recipients: 10 });
    await sendOneSignalPush(SAMPLE_ALERT, 'uuid-123', {
      fetchFn,
      env: BASE_ENV,
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.url).toContain('/alerts#uuid-123');
  });

  test('push_sent count is extracted from OneSignal response.recipients', async () => {
    const fetchFn = makeFetch({ id: 'notif-1', recipients: 42 });
    const count = await sendOneSignalPush(SAMPLE_ALERT, 'uuid-123', {
      fetchFn,
      env: BASE_ENV,
    });
    expect(count).toBe(42);
  });

  test('OneSignal failure does not block email delivery', async () => {
    const fetchFn = makeFetchSeq(
      // fetchEligibleUsers: preferences
      { response: [{ user_id: 'u1', email_enabled: true, min_significance_score: 5 }] },
      // profiles
      { response: [{ user_id: 'u1', subscription_tier: 'pro' }] },
      // auth get user
      { response: { user: { email: 'u1@test.com' } } },
      // Resend batch succeeds
      { response: { data: [{ id: 'e1' }] } },
      // OneSignal FAILS
      { response: { error: 'invalid key' }, ok: false, status: 401 },
      // Airtable delivery tracking
      { response: {} },
    );

    const result = await deliverAlert(SAMPLE_ALERT, {
      fetchFn,
      env: BASE_ENV,
      _sleep: noSleep,
    });

    expect(result.emails_sent).toBe(1);
  });
});

// ─── 6.4 Delivery Tracking ──────────────────────────────────────────────

describe('6.4: Delivery tracking', () => {
  test('full success sets status=delivered with emails_sent and push_sent', async () => {
    const fetchFn = makeFetch({});
    await updateDeliveryStatus('recABC', {
      status: 'delivered',
      emails_sent: 10,
      push_sent: 5,
      delivered_at: '2026-03-28T12:00:00Z',
    }, { fetchFn, env: BASE_ENV });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.fields.status).toBe('delivered');
    expect(body.fields.emails_sent).toBe(10);
    expect(body.fields.push_sent).toBe(5);
    expect(body.fields.delivered_at).toBe('2026-03-28T12:00:00Z');
  });

  test('email failure sets status=delivery_failed with error_log', async () => {
    const fetchFn = makeFetch({});
    await updateDeliveryStatus('recABC', {
      status: 'delivery_failed',
      error_log: 'Resend API returned 429',
      push_sent: 5,
    }, { fetchFn, env: BASE_ENV });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.fields.status).toBe('delivery_failed');
    expect(body.fields.error_log).toContain('Resend');
  });

  test('push failure sets status=delivery_failed with error_log', async () => {
    const fetchFn = makeFetch({});
    await updateDeliveryStatus('recABC', {
      status: 'delivery_failed',
      error_log: 'OneSignal API returned 401',
      emails_sent: 10,
    }, { fetchFn, env: BASE_ENV });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.fields.status).toBe('delivery_failed');
    expect(body.fields.error_log).toContain('OneSignal');
  });
});

// ─── formatMoney ─────────────────────────────────────────────────────────

describe('formatMoney', () => {
  test('formats millions', () => {
    expect(formatMoney(1502500)).toBe('$1.5M');
  });

  test('formats thousands', () => {
    expect(formatMoney(50000)).toBe('$50K');
  });

  test('formats small amounts', () => {
    expect(formatMoney(999)).toBe('$999');
  });
});
