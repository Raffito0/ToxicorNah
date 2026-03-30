'use strict';

const { makeFetch, makeRouter, BASE_ENV } = require('./helpers');

// Chain 1: Alert persistence (insertToSupabase) — the Supabase write for scored filings
const { insertToSupabase } = require('../../../n8n/code/insiderbuying/write-persistence');

// Chain 2: Article persistence (writeArticle) — NocoDB POST for published articles
const { writeArticle } = require('../../../n8n/code/insiderbuying/generate-article');

// Chain 4: X auto-post — breakingAlert tweet builder and raw POST helper
const { buildBreakingAlert, postToX } = require('../../../n8n/code/insiderbuying/x-auto-post');

// Chain 5: Report record builder — pure record factory, no HTTP calls
const { buildReportRecord } = require('../../../n8n/code/insiderbuying/generate-report');

// Chain 6: Newsletter summary — derives article teasers and subject line from gathered content
const { generateSummaries } = require('../../../n8n/code/insiderbuying/weekly-newsletter');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Build a scored+analyzed filing suitable for insertToSupabase. */
function makeScoredAlert(overrides) {
  return Object.assign({
    dedup_key: 'NVDA_JensenHuang_2026-02-15_50000',
    ticker: 'NVDA',
    company_name: 'NVIDIA Corporation',
    insider_name: 'Jensen Huang',
    insider_title: 'CEO',
    insider_category: 'Officer',
    transaction_type: 'P - Purchase',
    shares: 50000,
    price_per_share: 100,
    total_value: 5000000,
    transaction_date: '2026-02-15',
    filing_date: '2026-02-15',
    significance_score: 9,
    score_reasoning: 'CEO buy, large value, no 10b5-1 plan',
    ai_analysis: 'Strong conviction buy signal from NVDA CEO.',
    raw_filing_data: JSON.stringify({ form: '4' }),
  }, overrides);
}

/** Build an article suitable for writeArticle. */
function makeArticle() {
  return {
    title: 'NVDA Insider Buying: CEO Jensen Huang Signals Strong Conviction',
    slug: 'nvda-insider-buying-ceo-signals-conviction',
    meta_description: 'CEO Jensen Huang purchased $5M worth of NVDA shares.',
    body_html: '<p>Full article body here with detailed analysis.</p>',
    verdict_type: 'BUY',
    verdict_text: 'Strong buy signal based on CEO purchase size and timing.',
    key_takeaways: ['CEO purchased $5M of shares', 'Signal rates 9/10 conviction'],
    word_count: 1200,
    primary_keyword: 'NVDA insider buying',
    secondary_keywords_used: ['NVDA CEO buy', 'Form 4 NVDA'],
    data_tables_count: 1,
    filing_citations_count: 2,
    confidence_notes: '',
    staleness_warning: false,
  };
}

/** Build NocoDB opts with a given fetchFn spy. */
function makeNocodbOpts(fetchFn) {
  return {
    fetchFn,
    baseUrl: BASE_ENV.NOCODB_BASE_URL,
    token: BASE_ENV.NOCODB_API_TOKEN,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Chain Integration Tests', () => {

  beforeEach(() => {
    jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });

  // -------------------------------------------------------------------------
  // Test 8.1 — Alert write (Chain 1) payload → X auto-post (Chain 4) breakingAlert
  // -------------------------------------------------------------------------
  test('8.1 — Alert write payload (insertToSupabase) is compatible with X buildBreakingAlert', async () => {
    const alert = makeScoredAlert();

    // Step 1–2: Spy on Supabase write — capture the POST body
    const supabaseFetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ id: 'sup_001' }],
      text: async () => '',
    });
    const supabaseOpts = {
      fetchFn: supabaseFetchFn,
      env: {
        SUPABASE_URL: BASE_ENV.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-000',
      },
    };

    await insertToSupabase(alert, supabaseOpts);

    // Step 3: Capture the serialized write body
    expect(supabaseFetchFn).toHaveBeenCalledTimes(1);
    const capturedBody = JSON.parse(supabaseFetchFn.mock.calls[0][1].body);

    // Step 4: Assert Chain 4 required fields are in the write payload
    expect(capturedBody.ticker).toBe('NVDA');
    expect(capturedBody.significance_score).toBe(9);
    expect(capturedBody.insider_name).toBe('Jensen Huang');
    expect(capturedBody.insider_title).toBe('CEO');
    expect(capturedBody.total_value).toBe(5000000);

    // Step 5–6: Replay captured fields into buildBreakingAlert (Chain 4)
    const EXPECTED_TWEET = '$NVDA INSIDER BUY: CEO Jensen Huang purchases $5M. Watch for earnings catalyst. Key level: $100.';
    const xFetchFn = makeRouter({
      'deepseek.com': {
        choices: [{ message: { content: EXPECTED_TWEET } }],
        usage: { prompt_tokens: 200, completion_tokens: 50 },
      },
    });

    const tweetText = await buildBreakingAlert(
      {
        ticker: capturedBody.ticker,
        insiderName: capturedBody.insider_name,
        insiderRole: capturedBody.insider_title,
        transactionValue: '$' + (capturedBody.total_value / 1_000_000).toFixed(1) + 'M',
        transactionDate: capturedBody.transaction_date,
        priceAtPurchase: capturedBody.price_per_share,
        trackRecord: null,
        clusterCount: 1,
      },
      { fetchFn: xFetchFn, deepseekApiKey: 'test-deepseek-key-000' }
    );

    // Step 7: Assert tweet contains the captured ticker as a $CASHTAG
    expect(typeof tweetText).toBe('string');
    expect(tweetText).toMatch(/\$NVDA/);
  });

  // -------------------------------------------------------------------------
  // Test 8.2 — Article write (Chain 2) payload → X postToX with headline
  // -------------------------------------------------------------------------
  test('8.2 — Article write payload (writeArticle) title_text and slug reach X postToX', async () => {
    const article = makeArticle();
    const keyword = { ticker: 'NVDA', blog: 'earlyinsider', keyword: 'NVDA insider buying' };

    // Step 1–2: Spy on NocoDB POST to capture writeArticle body
    const nocodbFetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ Id: 42 }),
      text: async () => '',
    });

    await writeArticle(article, keyword, makeNocodbOpts(nocodbFetchFn));

    // Step 3: Capture the POST body written to NocoDB /Articles
    const articlesCall = nocodbFetchFn.mock.calls.find(([url]) => url.includes('/Articles'));
    expect(articlesCall).toBeDefined();
    const capturedBody = JSON.parse(articlesCall[1].body);

    // Step 4: Assert Chain 4 needed fields are present with correct values
    expect(capturedBody.title_text).toBe(article.title);
    expect(capturedBody.slug).toBe(article.slug);
    expect(capturedBody.ticker).toBe('NVDA');

    // Step 5–6: Build article tweet text from captured fields and call postToX
    // The integration layer constructs a URL from the slug + canonical domain.
    const articleUrl = 'https://earlyinsider.com/blog/' + capturedBody.slug;
    const tweetText = '$' + capturedBody.ticker + ': ' + capturedBody.title_text + ' ' + articleUrl;
    const xPayload = postToX(tweetText);

    // Step 7: Assert X payload contains the captured headline and slug-derived URL
    expect(xPayload.method).toBe('POST');
    expect(xPayload.body.text).toContain(capturedBody.title_text);
    expect(xPayload.body.text).toContain(capturedBody.slug);
  });

  // -------------------------------------------------------------------------
  // Test 8.3 — Alert write (Chain 1) payload → Newsletter (Chain 6) subject line
  // -------------------------------------------------------------------------
  test('8.3 — Alert write payload (insertToSupabase) ticker appears in newsletter subject line', async () => {
    const alert = makeScoredAlert();

    // Step 1–2: Spy on Supabase write
    const supabaseFetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{ id: 'sup_002' }],
      text: async () => '',
    });
    const supabaseOpts = {
      fetchFn: supabaseFetchFn,
      env: {
        SUPABASE_URL: BASE_ENV.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-000',
      },
    };

    await insertToSupabase(alert, supabaseOpts);

    // Step 3: Capture the POST body
    const capturedBody = JSON.parse(supabaseFetchFn.mock.calls[0][1].body);

    // Step 4: Assert Chain 6 required fields are present
    expect(capturedBody.ticker).toBe('NVDA');
    expect(capturedBody.significance_score).toBe(9);

    // Step 5–6: Feed captured alert into newsletter generateSummaries as a topAlert
    const newsletterContent = {
      topAlerts: [{ ticker: capturedBody.ticker, significance_score: capturedBody.significance_score }],
      articles: [],
      performance: [],
      upcomingEarnings: [],
    };

    const summaries = generateSummaries(newsletterContent);

    // Step 7: Assert newsletter subject line contains the captured ticker
    expect(summaries.subjectLine).toContain('NVDA');
    // Alert digest acknowledges the 1 high-significance alert from the captured payload
    expect(summaries.alertDigest).toBe('This week saw 1 significant insider transactions.');
  });

  // -------------------------------------------------------------------------
  // Test 8.4 — Article write (Chain 2) payload → Newsletter (Chain 6) article teasers
  // -------------------------------------------------------------------------
  test('8.4 — Article write payload (writeArticle) title_text and slug appear in newsletter article teasers', async () => {
    const article = makeArticle();
    const keyword = { ticker: 'NVDA', blog: 'earlyinsider', keyword: 'NVDA insider buying' };

    // Step 1–2: Spy on NocoDB POST to capture writeArticle body
    const nocodbFetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ Id: 42 }),
      text: async () => '',
    });

    await writeArticle(article, keyword, makeNocodbOpts(nocodbFetchFn));

    // Step 3: Capture the POST body
    const articlesCall = nocodbFetchFn.mock.calls.find(([url]) => url.includes('/Articles'));
    const capturedBody = JSON.parse(articlesCall[1].body);

    // Step 4: Assert title_text and slug are present in the write payload
    expect(capturedBody.title_text).toBe(article.title);
    expect(capturedBody.slug).toBe(article.slug);

    // Step 5–6: Feed captured article into newsletter generateSummaries.
    // NOTE: writeArticle persists 'title_text'; generateSummaries reads 'title'.
    // The integration layer maps title_text -> title. We verify the data survives this mapping.
    const newsletterContent = {
      topAlerts: [],
      articles: [{
        title: capturedBody.title_text,       // integration layer field mapping
        slug: capturedBody.slug,
        meta_description: capturedBody.meta_description,
        ticker: capturedBody.ticker,
        verdict_type: capturedBody.verdict_type,
      }],
      performance: [],
      upcomingEarnings: [],
    };

    const summaries = generateSummaries(newsletterContent);

    // Step 7: Assert article teasers contain the captured title and slug
    expect(summaries.articleTeasers).toHaveLength(1);
    expect(summaries.articleTeasers[0].title).toBe(capturedBody.title_text);
    expect(summaries.articleTeasers[0].slug).toBe(capturedBody.slug);
    expect(summaries.articleTeasers[0].ticker).toBe('NVDA');
    expect(summaries.articleTeasers[0].teaser).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Test 8.5 — Report (Chain 5) buildReportRecord returns 'delivered' status
  // -------------------------------------------------------------------------
  test('8.5 — buildReportRecord returns status: delivered (not published) with correct IDs', () => {
    // Step 1: Construct a report record with known IDs
    const userId = 'user_test_123';
    const reportType = 'deep-dive';
    const pdfUrl = 'https://r2.example.com/reports/nvda-deep-dive-2026-03.pdf';
    const paymentId = 'pay_test_456';

    const record = buildReportRecord(userId, reportType, pdfUrl, paymentId);

    // Step 2–3: Assert status is 'delivered'
    // DEVIATION from spec: spec describes 'published' but production uses 'delivered'.
    // Any downstream consumer reading this record (e.g., Chain 6 newsletter) must
    // use 'delivered' as the expected status value, not 'published'.
    expect(record.status).toBe('delivered');

    // Step 4–5: Assert correct IDs are preserved in the record
    expect(record.user_id).toBe(userId);
    expect(record.pdf_url).toBe(pdfUrl);
    expect(record.payment_id).toBe(paymentId);
    expect(record.report_type).toBe(reportType);
    expect(typeof record.generated_at).toBe('string');
    // Fake timers frozen at 2026-03-01T12:00:00Z — generated_at must be that date
    expect(record.generated_at).toContain('2026-03-01');
    expect(record.created_at).toContain('2026-03-01');
  });

});
