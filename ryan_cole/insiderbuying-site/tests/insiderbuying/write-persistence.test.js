'use strict';

const {
  createNocoRecord,
  insertToSupabase,
  updateMonitorState,
  handleDeadLetter,
  createOrUpdateClusterSummary,
  writeFilingPersistence,
  runPostProcessing,
} = require('../../n8n/code/insiderbuying/write-persistence');

const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');

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
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_BASE_URL: 'http://localhost:8080',
  NOCODB_PROJECT_ID: 'test-project-id',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_MONITORING_CHAT_ID: '-100123',
};

function makeNocoDB(fetchFn) {
  return new NocoDB(BASE_ENV.NOCODB_BASE_URL, BASE_ENV.NOCODB_API_TOKEN, BASE_ENV.NOCODB_PROJECT_ID, fetchFn);
}

const SAMPLE_FILING = {
  ticker: 'AAPL',
  company_name: 'Apple Inc.',
  insider_name: 'Timothy D. Cook',
  insider_title: 'Chief Executive Officer',
  insider_category: 'C-Suite',
  transaction_type: 'buy',
  shares: 10000,
  price_per_share: 150.25,
  total_value: 1502500,
  transaction_date: '2026-03-20',
  filing_date: '2026-03-22',
  significance_score: 8,
  score_reasoning: 'Large C-Suite purchase signals confidence.',
  ai_analysis: 'Two paragraphs of analysis...\n\nSecond paragraph here.',
  cluster_id: null,
  is_cluster_buy: false,
  cluster_size: 0,
  dedup_key: 'AAPL_Timothy_D._Cook_2026-03-20_10000',
  raw_filing_data: '{"name":"Timothy D. Cook"}',
};

// ─── 5.1 NocoDB Record ───────────────────────────────────────────────────────

describe('5.1: createNocoRecord', () => {
  test('includes all required fields including dedup_key and status=processed', async () => {
    const fetchFn = makeFetch({ Id: 1, ticker: 'AAPL', status: 'processed' });
    const nocodb = makeNocoDB(fetchFn);
    const result = await createNocoRecord(SAMPLE_FILING, {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    expect(result).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const call = fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.dedup_key).toBe(SAMPLE_FILING.dedup_key);
    expect(body.status).toBe('processed');
    expect(body.ticker).toBe('AAPL');
    expect(body.company_name).toBe('Apple Inc.');
    expect(body.insider_name).toBe('Timothy D. Cook');
    expect(body.insider_title).toBe('Chief Executive Officer');
    expect(body.insider_category).toBe('C-Suite');
    expect(body.transaction_type).toBe('buy');
    expect(body.shares).toBe(10000);
    expect(body.price_per_share).toBe(150.25);
    expect(body.total_value).toBe(1502500);
    expect(body.transaction_date).toBe('2026-03-20');
    expect(body.filing_date).toBe('2026-03-22');
  });

  test('includes score_reasoning from Haiku', async () => {
    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
    const nocodb = makeNocoDB(fetchFn);
    await createNocoRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.score_reasoning).toBe('Large C-Suite purchase signals confidence.');
  });

  test('includes ai_analysis (may be null)', async () => {
    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
    const nocodb = makeNocoDB(fetchFn);

    // With analysis
    await createNocoRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });
    let body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.ai_analysis).toBe(SAMPLE_FILING.ai_analysis);

    // With null analysis
    const filingNoAnalysis = { ...SAMPLE_FILING, ai_analysis: null };
    await createNocoRecord(filingNoAnalysis, { fetchFn, nocodb, env: BASE_ENV });
    body = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body.ai_analysis).toBe('');
  });

  test('stores raw_filing_data as JSON string', async () => {
    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
    const nocodb = makeNocoDB(fetchFn);
    await createNocoRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.raw_filing_data).toBe('{"name":"Timothy D. Cook"}');
  });
});

// ─── 5.2 Supabase Insert ─────────────────────────────────────────────────────

describe('5.2: insertToSupabase', () => {
  test('uses onConflict dedup_key with ignore-duplicates header', async () => {
    const fetchFn = makeFetch([{ id: 'uuid-123' }]);
    await insertToSupabase(SAMPLE_FILING, { fetchFn, env: BASE_ENV });

    const call = fetchFn.mock.calls[0];
    expect(call[0]).toContain('/rest/v1/insider_alerts');
    expect(call[1].headers.Prefer).toContain('resolution=ignore-duplicates');
    const url = call[0];
    expect(url).toContain('on_conflict=dedup_key');
  });

  test('duplicate insert returns gracefully, does not throw', async () => {
    // Supabase returns empty array on conflict with DO NOTHING
    const fetchFn = makeFetch([]);
    const result = await insertToSupabase(SAMPLE_FILING, { fetchFn, env: BASE_ENV });
    expect(result).toBeNull(); // no ID returned for duplicate
  });

  test('returned supabase_id (UUID) is extracted', async () => {
    const fetchFn = makeFetch([{ id: 'abc-def-123' }]);
    const result = await insertToSupabase(SAMPLE_FILING, { fetchFn, env: BASE_ENV });
    expect(result).toBe('abc-def-123');
  });
});

// ─── 5.3 Monitor_State Update ────────────────────────────────────────────────

describe('5.3: updateMonitorState', () => {
  test('all-success run sets last_check_timestamp to approximately now()', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } }, // NocoDB update response
    );
    const nocodb = makeNocoDB(fetchFn);

    await updateMonitorState('market', [], [], null, { fetchFn, nocodb, env: BASE_ENV });

    const patchCall = fetchFn.mock.calls[1];
    const body = JSON.parse(patchCall[1].body);
    expect(body.last_run_status).toBe('success');
    // Timestamp should be close to now
    const ts = new Date(body.last_check_timestamp);
    expect(Date.now() - ts.getTime()).toBeLessThan(5000);
  });

  test('partial-failure run rolls back timestamp to min(failed_filing.filing_date)', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);
    const failedFilings = [
      { filing_date: '2026-03-20' },
      { filing_date: '2026-03-18' },
      { filing_date: '2026-03-22' },
    ];

    await updateMonitorState('market', [], failedFilings, 'some error', {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    const body = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body.last_check_timestamp).toBe('2026-03-18');
    expect(body.last_run_status).toBe('error');
    expect(body.last_run_error).toBe('some error');
  });

  test('filing with retry_count > 3 is marked dead_letter, timestamp NOT held back', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);
    const failedFilings = [
      { filing_date: '2026-03-18', retry_count: 4, nocodb_record_id: 1 },
    ];

    await updateMonitorState('market', [{ filing_date: '2026-03-22' }], failedFilings, 'err', {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    // Dead letter filing should not hold back the timestamp
    const body = JSON.parse(fetchFn.mock.calls[1][1].body);
    const ts = new Date(body.last_check_timestamp);
    // Should advance to now() since the only failed filing is dead-lettered
    expect(Date.now() - ts.getTime()).toBeLessThan(5000);
  });

  test('dead-letter filing triggers Telegram notification', async () => {
    const fetchFn = makeFetchSeq(
      { response: { Id: 1, status: 'dead_letter' } }, // NocoDB update
      { response: {} }, // Telegram sendMessage
    );
    const nocodb = makeNocoDB(fetchFn);

    await handleDeadLetter(
      { dedup_key: 'AAPL_Cook_2026-03-20_10000', ticker: 'AAPL', _lastError: 'FD API down' },
      1,
      'market',
      { fetchFn, nocodb, env: BASE_ENV },
    );

    // Should have called NocoDB update and Telegram
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const tgCall = fetchFn.mock.calls[1][0];
    expect(tgCall).toContain('api.telegram.org');
    expect(tgCall).toContain('sendMessage');
  });

  test('last_run_status = error when any filing fails', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    await updateMonitorState('market', [SAMPLE_FILING], [{ filing_date: '2026-03-18' }], 'err', {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    const body = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(body.last_run_status).toBe('error');
  });
});

// ─── 5.4 Cluster Alert Creation ──────────────────────────────────────────────

describe('5.4: createOrUpdateClusterSummary', () => {
  const clusterFilings = [
    { ...SAMPLE_FILING, cluster_id: 'cluster-1', is_cluster_buy: true, significance_score: 7, insider_name: 'Tim Cook', insider_title: 'CEO', total_value: 1500000 },
    { ...SAMPLE_FILING, cluster_id: 'cluster-1', is_cluster_buy: true, significance_score: 6, insider_name: 'Luca Maestri', insider_title: 'CFO', total_value: 800000 },
    { ...SAMPLE_FILING, cluster_id: 'cluster-1', is_cluster_buy: true, significance_score: 5, insider_name: 'Jeff Williams', insider_title: 'COO', total_value: 500000 },
  ];

  test('3 cluster members in one run creates exactly 1 cluster summary record', async () => {
    const fetchFn = makeFetchSeq(
      // Search for existing cluster summary: none found (NocoDB list)
      { response: { list: [], pageInfo: { isLastPage: true } } },
      // Create new NocoDB record
      { response: { Id: 1, ticker: 'AAPL', transaction_type: 'cluster' } },
      // Insert to Supabase
      { response: [{ id: 'uuid-cluster-1' }] },
      // NocoDB update with supabase_id
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const result = await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    expect(result.created).toBe(true);
    expect(result.triggerW5).toBe(true);
  });

  test('cluster summary has transaction_type = cluster', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [], pageInfo: { isLastPage: true } } },
      { response: { Id: 1, transaction_type: 'cluster' } },
      { response: [{ id: 'uuid-cluster-1' }] },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    // The CREATE call is the second call (index 1)
    const createBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(createBody.transaction_type).toBe('cluster');
  });

  test('cluster summary significance_score = min(10, max_individual_score + 3)', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } },
      { response: [{ id: 'uuid-cluster-1' }] },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    const createBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    // max individual score = 7, so cluster score = min(10, 7+3) = 10
    expect(createBody.significance_score).toBe(10);
  });

  test('second run with 4th member updates existing summary (not new row)', async () => {
    const fetchFn = makeFetchSeq(
      // Search finds existing cluster summary (NocoDB list)
      {
        response: {
          list: [{
            Id: 1,
            transaction_type: 'cluster',
            cluster_id: 'cluster-1',
            significance_score: 8,
            cluster_size: 3,
          }],
          pageInfo: { isLastPage: true },
        },
      },
      // NocoDB update existing record
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const newMember = { ...SAMPLE_FILING, cluster_id: 'cluster-1', is_cluster_buy: true, significance_score: 6 };
    const result = await createOrUpdateClusterSummary('cluster-1', [newMember], {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    expect(result.created).toBe(false);
    // Score delta: new max(6)+3=9 vs existing 8. delta=1 < 2 so no re-trigger
  });

  test('cluster summary update does NOT re-trigger W5 if score delta < 2', async () => {
    const fetchFn = makeFetchSeq(
      {
        response: {
          list: [{
            Id: 1,
            significance_score: 9,
            cluster_size: 3,
            cluster_id: 'cluster-1',
            transaction_type: 'cluster',
          }],
          pageInfo: { isLastPage: true },
        },
      },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const result = await createOrUpdateClusterSummary('cluster-1',
      [{ ...SAMPLE_FILING, significance_score: 7 }],
      { fetchFn, nocodb, env: BASE_ENV },
    );

    // new score = min(10, 7+3) = 10, old = 9, delta = 1 < 2
    expect(result.triggerW5).toBe(false);
  });

  test('cluster summary update DOES re-trigger W5 if score increases >= 2', async () => {
    const fetchFn = makeFetchSeq(
      {
        response: {
          list: [{
            Id: 1,
            significance_score: 7,
            cluster_size: 2,
            cluster_id: 'cluster-1',
            transaction_type: 'cluster',
          }],
          pageInfo: { isLastPage: true },
        },
      },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const result = await createOrUpdateClusterSummary('cluster-1',
      [{ ...SAMPLE_FILING, significance_score: 8 }],
      { fetchFn, nocodb, env: BASE_ENV },
    );

    // new score = min(10, 8+3) = 10, old = 7, delta = 3 >= 2
    expect(result.triggerW5).toBe(true);
  });
});

// ─── writeFilingPersistence happy path ───────────────────────────────────────

describe('writeFilingPersistence happy path', () => {
  test('creates NocoDB record, inserts to Supabase, patches cross-reference', async () => {
    const fetchFn = makeFetchSeq(
      // NocoDB create
      { response: { Id: 1, ticker: 'AAPL', status: 'processed' } },
      // Supabase insert
      { response: [{ id: 'uuid-123' }] },
      // NocoDB update supabase_id
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const ctx = { failureCount: 0, firstError: null, failedFilings: [], successfulFilings: [] };
    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, nocodb, env: BASE_ENV });

    expect(ctx.failureCount).toBe(0);
    expect(ctx.successfulFilings).toHaveLength(1);
    expect(ctx.successfulFilings[0].nocodb_record_id).toBe(1);
    expect(ctx.successfulFilings[0].supabase_id).toBe('uuid-123');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

// ─── runPostProcessing dead-letter integration ────────────────────────────────

describe('runPostProcessing dead-letter integration', () => {
  test('calls handleDeadLetter for failed filings with retry_count > 3', async () => {
    const fetchFn = makeFetchSeq(
      // dead-letter: NocoDB update status
      { response: { Id: 1, status: 'dead_letter' } },
      // dead-letter: Telegram
      { response: {} },
      // updateMonitorState: NocoDB list
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      // updateMonitorState: NocoDB update
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const failedFilings = [
      {
        ...SAMPLE_FILING,
        retry_count: 4,
        nocodb_record_id: 1,
        _lastError: 'FD API gone',
      },
    ];

    await runPostProcessing('market', [], failedFilings, 1, 'err', [], {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    // Should have 4 calls: DL NocoDB update, DL telegram, state NocoDB list, state NocoDB update
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const dlPatchCall = fetchFn.mock.calls[0];
    const dlPatchBody = JSON.parse(dlPatchCall[1].body);
    expect(dlPatchBody.status).toBe('dead_letter');
  });
});

// ─── runPostProcessing cluster grouping ──────────────────────────────────────

describe('runPostProcessing cluster grouping', () => {
  test('groups filings by cluster_id and calls createOrUpdateClusterSummary per group', async () => {
    const fetchFn = makeFetchSeq(
      // updateMonitorState: NocoDB list
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      // updateMonitorState: NocoDB update
      { response: { Id: 1 } },
      // Cluster A: NocoDB list (search for existing)
      { response: { list: [], pageInfo: { isLastPage: true } } },
      // Cluster A: NocoDB create
      { response: { Id: 2 } },
      // Cluster A: Supabase insert
      { response: [{ id: 'uuid-ca' }] },
      // Cluster A: NocoDB update (supabase_id)
      { response: { Id: 2 } },
      // Cluster B: NocoDB list (search for existing)
      { response: { list: [], pageInfo: { isLastPage: true } } },
      // Cluster B: NocoDB create
      { response: { Id: 3 } },
      // Cluster B: Supabase insert
      { response: [{ id: 'uuid-cb' }] },
      // Cluster B: NocoDB update (supabase_id)
      { response: { Id: 3 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    const allFilings = [
      { ...SAMPLE_FILING, cluster_id: 'cluster-A', significance_score: 7 },
      { ...SAMPLE_FILING, cluster_id: 'cluster-A', significance_score: 6, insider_name: 'Other' },
      { ...SAMPLE_FILING, cluster_id: 'cluster-B', significance_score: 5, insider_name: 'Third' },
    ];

    const results = await runPostProcessing('market', allFilings, [], 0, null, allFilings, {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    expect(results).toHaveLength(2);
    expect(results[0].clusterId).toBe('cluster-A');
    expect(results[1].clusterId).toBe('cluster-B');
  });
});

// ─── 5.5 Error Counting ──────────────────────────────────────────────────────

describe('5.5: writeFilingPersistence error counting', () => {
  test('failureCount increments on each filing failure', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('NocoDB down'));
    const nocodb = makeNocoDB(fetchFn);

    const ctx = { failureCount: 0, firstError: null, failedFilings: [], successfulFilings: [] };
    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, nocodb, env: BASE_ENV });

    expect(ctx.failureCount).toBe(1);
    expect(ctx.firstError).toContain('NocoDB down');
  });

  test('failureCount <= 5 does NOT trigger Telegram alert in runPostProcessing', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } },
    );
    const nocodb = makeNocoDB(fetchFn);

    await runPostProcessing('market', [SAMPLE_FILING], [], 3, 'err', [], {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    // Only 2 calls: state NocoDB list + state NocoDB update. No Telegram call
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('failureCount > 5 triggers Telegram alert in runPostProcessing', async () => {
    const fetchFn = makeFetchSeq(
      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
      { response: { Id: 1 } }, // state update
      { response: {} }, // Telegram alert
    );
    const nocodb = makeNocoDB(fetchFn);

    await runPostProcessing('market', [SAMPLE_FILING], [], 6, 'big error', [], {
      fetchFn,
      nocodb,
      env: BASE_ENV,
    });

    // 3 calls: state NocoDB list + state NocoDB update + Telegram alert
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const tgCall = fetchFn.mock.calls[2][0];
    expect(tgCall).toContain('api.telegram.org');
    expect(tgCall).toContain('sendMessage');
  });
});
