'use strict';

const { makeFetchSeq, expectFetchCalledTimes } = require('./helpers');

const {
  generateReportSection,
  reviewBearCaseAuthenticity,
  buildReportRecord,
  buildReportHTML,
  REPORT_SECTIONS,
} = require('../../../n8n/code/insiderbuying/generate-report');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Mock Anthropic response shape expected by claudeTextCall (content[0].text)
function makeClaudeResponse(text) {
  return {
    id: 'msg_test_report',
    model: 'claude-opus-4-6',
    usage: { input_tokens: 300, output_tokens: 100 },
    content: [{ type: 'text', text: text }],
  };
}

// Generate N-word mock text (passes word-count gate for a given target)
function makeText(wordCount) {
  return 'word '.repeat(wordCount).trim();
}

// 400-word text — passes catalysts_timeline and investment_thesis (400 target, range 320-480)
const TEXT_400 = makeText(400);
// 500-word text — passes bear_case (500 target, range 400-600) and company_overview (600, range 480-720)
const TEXT_500 = makeText(500);
// 700-word text — passes insider_intelligence (800, range 640-960) and financial_analysis (700, range 560-840)
const TEXT_700 = makeText(700);

// Report data fixture
const MOCK_DATA = {
  ticker: 'NVDA',
  companyName: 'NVIDIA Corporation',
  insider_name: 'Jensen Huang',
  total_value: 5000000,
  significance_score: 9,
  transactions: [],
  statistics: { count: 5, avgReturn30d: 12.5, avgReturn60d: 18.2, avgReturn90d: 22.4, hitRate30d: 80 },
  topPerformers: [],
};

// ---------------------------------------------------------------------------
// Pre-check: REPORT_SECTIONS has expected sections
// ---------------------------------------------------------------------------
describe('REPORT_SECTIONS fixture pre-check', () => {
  it('REPORT_SECTIONS contains all 9 expected section ids including bear_case', () => {
    const ids = REPORT_SECTIONS.map((s) => s.id);
    expect(ids).toContain('company_overview');
    expect(ids).toContain('bear_case');
    expect(ids).toContain('investment_thesis');
    expect(REPORT_SECTIONS).toHaveLength(9);
    const bearCase = REPORT_SECTIONS.find((s) => s.id === 'bear_case');
    expect(bearCase).toBeDefined();
    expect(bearCase.wordTarget).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Report Pipeline E2E (Chain 5)', () => {

  // -------------------------------------------------------------------------
  // Test 5.1 — Sequential context threading via generateReportSection
  // -------------------------------------------------------------------------
  describe('Test 5.1 - sequential context accumulation', () => {
    it('first generateReportSection call has no prior_sections in prompt body', async () => {
      const fetchFn = makeFetchSeq(makeClaudeResponse(TEXT_500));
      const completedSections = [];

      await generateReportSection('company_overview', 600, completedSections, MOCK_DATA, fetchFn);

      expectFetchCalledTimes(fetchFn, 1, 'company_overview first call');
      const callBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      // No prior sections in first call — completedSections was empty
      expect(callBody.messages[0].content).not.toContain('<prior_sections>');
    });

    it('second generateReportSection call contains the first section in prior_sections XML', async () => {
      const fetchFn = makeFetchSeq(
        makeClaudeResponse(TEXT_500),  // company_overview (500 words, range 480-720 ✓)
        makeClaudeResponse(TEXT_700),  // insider_intelligence (700 words, range 640-960 ✓)
      );
      const completedSections = [];

      // First section — empty context
      const firstText = await generateReportSection('company_overview', 600, completedSections, MOCK_DATA, fetchFn);
      completedSections.push({ id: 'company_overview', wordTarget: 600, text: firstText });

      // Second section — company_overview in context
      await generateReportSection('insider_intelligence', 800, completedSections, MOCK_DATA, fetchFn);

      expectFetchCalledTimes(fetchFn, 2, 'two-section context threading');
      const secondCallBody = JSON.parse(fetchFn.mock.calls[1][1].body);
      // Prior section XML must be present in second call
      expect(secondCallBody.messages[0].content).toContain('<prior_sections>');
      expect(secondCallBody.messages[0].content).toContain('company_overview');
    });

    it('third call contains both prior sections in accumulated context', async () => {
      const fetchFn = makeFetchSeq(
        makeClaudeResponse(TEXT_500),  // company_overview
        makeClaudeResponse(TEXT_700),  // insider_intelligence
        makeClaudeResponse(TEXT_700),  // financial_analysis (700, range 560-840 ✓)
      );
      const completedSections = [];

      const t1 = await generateReportSection('company_overview', 600, completedSections, MOCK_DATA, fetchFn);
      completedSections.push({ id: 'company_overview', wordTarget: 600, text: t1 });

      const t2 = await generateReportSection('insider_intelligence', 800, completedSections, MOCK_DATA, fetchFn);
      completedSections.push({ id: 'insider_intelligence', wordTarget: 800, text: t2 });

      await generateReportSection('financial_analysis', 700, completedSections, MOCK_DATA, fetchFn);

      expectFetchCalledTimes(fetchFn, 3, 'three-section context threading');
      const thirdCallBody = JSON.parse(fetchFn.mock.calls[2][1].body);
      expect(thirdCallBody.messages[0].content).toContain('company_overview');
      expect(thirdCallBody.messages[0].content).toContain('insider_intelligence');
    });
  });

  // -------------------------------------------------------------------------
  // Test 5.2 — Bear case authenticity retry
  // -------------------------------------------------------------------------
  describe('Test 5.2 - bear case authenticity retry', () => {
    it('reviewBearCaseAuthenticity returns low score (< 7) for generic text', async () => {
      const lowScoreJson = '{"score": 4, "reasoning": "Generic risks, no historical precedent, no downside target"}';
      const fetchFn = makeFetchSeq(makeClaudeResponse(lowScoreJson));

      const result = await reviewBearCaseAuthenticity('Some generic bear case text.', fetchFn);

      expect(result.score).toBe(4);
      expect(result.score).toBeLessThan(7);
      expect(typeof result.reasoning).toBe('string');
    });

    it('reviewBearCaseAuthenticity returns high score (>= 7) for specific text', async () => {
      const highScoreJson = '{"score": 8, "reasoning": "Specific risks, historical precedent cited, downside target stated"}';
      const fetchFn = makeFetchSeq(makeClaudeResponse(highScoreJson));

      const result = await reviewBearCaseAuthenticity('Specific bear case with precedent and $80 target.', fetchFn);

      expect(result.score).toBe(8);
      expect(result.score).toBeGreaterThanOrEqual(7);
    });

    it('bear_case section retries when authenticity score is below 7 — 3 fetch calls total', async () => {
      // TEXT_500 = 500 words, passes bear_case range [400, 600]
      const lowScoreJson = '{"score": 4, "reasoning": "Too generic — no historical precedent, no specific downside target"}';

      // Sequence: section (call 1) → review (call 2) → retry section (call 3)
      const fetchFn = makeFetchSeq(
        makeClaudeResponse(TEXT_500),     // bear_case first attempt
        makeClaudeResponse(lowScoreJson), // reviewBearCaseAuthenticity → score 4
        makeClaudeResponse(TEXT_500),     // bear_case retry
      );

      const completedSections = [];

      // Simulate the generateReport bear_case path
      const firstText = await generateReportSection('bear_case', 500, completedSections, MOCK_DATA, fetchFn);
      const review = await reviewBearCaseAuthenticity(firstText, fetchFn);

      expect(review.score).toBeLessThan(7);

      // Retry (as generateReport does when score < 7)
      const retryText = await generateReportSection('bear_case', 500, completedSections, MOCK_DATA, fetchFn);

      expectFetchCalledTimes(fetchFn, 3, 'bear_case retry');
      expect(typeof retryText).toBe('string');
      expect(retryText.length).toBeGreaterThan(0);
    });

    it('bear_case generateReportSection uses BEAR_CASE_SYSTEM_PROMPT (adversarial short seller prompt)', async () => {
      // H3: verify the bear_case branch selects the adversarial system prompt
      const fetchFn = makeFetchSeq(makeClaudeResponse(TEXT_500));
      await generateReportSection('bear_case', 500, [], MOCK_DATA, fetchFn);

      const callBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      // BEAR_CASE_SYSTEM_PROMPT contains 'short seller' — verify branch was taken
      expect(callBody.system).toContain('short seller');
    });

    it('reviewBearCaseAuthenticity returns parse-failure fallback (score: 5) for non-JSON response', async () => {
      // H2: parse failure fallback keeps score < 7 (still triggers bear_case retry in generateReport)
      const fetchFn = makeFetchSeq(makeClaudeResponse('not valid json at all'));
      const result = await reviewBearCaseAuthenticity('some bear case', fetchFn);

      expect(result.score).toBe(5);
      expect(result.reasoning).toBe('Parse failed');
      expect(result.score).toBeLessThan(7); // fallback still triggers retry
    });
  });

  // -------------------------------------------------------------------------
  // Test 5.3 — Report record shape and status
  // -------------------------------------------------------------------------
  describe('Test 5.3 - report record and HTML shape', () => {
    it('buildReportRecord returns all required fields with status: delivered', () => {
      const result = buildReportRecord(
        'user-uuid-abc123',
        'deep-dive',
        'https://r2.example.com/reports/nvda-report.pdf',
        'pi_stripe_123456789',
      );

      expect(result.status).toBe('delivered');
      expect(result.user_id).toBe('user-uuid-abc123');
      expect(result.report_type).toBe('deep-dive');
      expect(result.pdf_url).toBe('https://r2.example.com/reports/nvda-report.pdf');
      expect(result.payment_id).toBe('pi_stripe_123456789');
      // ISO date validity is verified in the dedicated date test below
      expect(result.generated_at).toBeTruthy();
      expect(result.created_at).toBeTruthy();
    });

    it('buildReportHTML (legacy mode) returns valid HTML with the report title', () => {
      const html = buildReportHTML(
        '## Executive Summary\n\nNVDA insider buying cluster signal detected.',
        'NVDA Insider Intelligence Report',
        '2026-03-01',
      );

      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('NVDA Insider Intelligence Report');
      expect(html.length).toBeGreaterThan(500);
    });

    it('buildReportRecord generated_at and created_at are ISO date strings', () => {
      const result = buildReportRecord('uid', 'sector', 'https://r2.example.com/s.pdf', 'pi_000');

      // ISO date strings can be parsed without throwing
      const generatedDate = new Date(result.generated_at);
      const createdDate = new Date(result.created_at);
      expect(isNaN(generatedDate.getTime())).toBe(false);
      expect(isNaN(createdDate.getTime())).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // M5 — generateReportSection word-count retry path
  // -------------------------------------------------------------------------
  describe('generateReportSection word-count retry', () => {
    it('retries once with explicit rewrite instruction when first response is out of range', async () => {
      // TEXT_400 (200 words) is below the 480-word minimum for a 600-word target
      // company_overview: target 600, range [480, 720]; 200 < 480 → retry fires
      const shortText = makeText(200);
      const fetchFn = makeFetchSeq(
        makeClaudeResponse(shortText),  // first attempt: 200 words, out of range for 600 target
        makeClaudeResponse(TEXT_500),   // retry: 500 words, in range [480, 720] ✓
      );

      const result = await generateReportSection('company_overview', 600, [], MOCK_DATA, fetchFn);

      // Two calls: first attempt + retry
      expectFetchCalledTimes(fetchFn, 2, 'word-count retry');
      // Retry prompt must contain the explicit rewrite instruction
      const retryCallBody = JSON.parse(fetchFn.mock.calls[1][1].body);
      expect(retryCallBody.messages[0].content).toContain('Rewrite to hit the target');
      // Final result is the in-range retry response
      expect(result).toBe(TEXT_500);
    });
  });

  // -------------------------------------------------------------------------
  // H1 — generateReport full orchestration: all sections + exec_summary
  // -------------------------------------------------------------------------
  describe('generateReport full orchestration', () => {
    it('returns completedSections array with all 9 sections plus exec_summary', async () => {
      // 9 sections + 1 bear_case review (score >= 7 = no retry) + 1 exec_summary = 11 calls
      // Word counts must pass each section's [0.8*wt, 1.2*wt] range gate:
      //   company_overview 600 → TEXT_500 (500, range 480-720) ✓
      //   insider_intelligence 800 → TEXT_700 (700, range 640-960) ✓
      //   financial_analysis 700 → TEXT_700 (700, range 560-840) ✓
      //   valuation_analysis 600 → TEXT_500 (500, range 480-720) ✓
      //   bull_case 500 → TEXT_500 (500, range 400-600) ✓
      //   bear_case 500 → TEXT_500 (500, range 400-600) ✓
      //   [bear_case review: score 8 → no retry]
      //   peer_comparison 600 → TEXT_500 (500, range 480-720) ✓
      //   catalysts_timeline 400 → TEXT_400 (400, range 320-480) ✓
      //   investment_thesis 400 → TEXT_400 (400, range 320-480) ✓
      //   exec_summary: no word-count gate ✓
      const highScoreReview = '{"score": 8, "reasoning": "Specific risks with historical precedent"}';
      const fetchFn = makeFetchSeq(
        makeClaudeResponse(TEXT_500),          // company_overview
        makeClaudeResponse(TEXT_700),          // insider_intelligence
        makeClaudeResponse(TEXT_700),          // financial_analysis
        makeClaudeResponse(TEXT_500),          // valuation_analysis
        makeClaudeResponse(TEXT_500),          // bull_case
        makeClaudeResponse(TEXT_500),          // bear_case first attempt
        makeClaudeResponse(highScoreReview),   // reviewBearCaseAuthenticity → score 8, no retry
        makeClaudeResponse(TEXT_500),          // peer_comparison
        makeClaudeResponse(TEXT_400),          // catalysts_timeline
        makeClaudeResponse(TEXT_400),          // investment_thesis
        makeClaudeResponse(TEXT_500),          // exec_summary (no word gate)
      );

      const { generateReport } = require('../../../n8n/code/insiderbuying/generate-report');
      const result = await generateReport(MOCK_DATA, fetchFn);

      // All 9 sections plus exec_summary
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(10);

      const ids = result.map((s) => s.id);
      expect(ids).toContain('company_overview');
      expect(ids).toContain('bear_case');
      expect(ids).toContain('investment_thesis');
      expect(ids).toContain('exec_summary');
      expect(ids[ids.length - 1]).toBe('exec_summary');

      expectFetchCalledTimes(fetchFn, 11, 'generateReport full run');
    });
  });

});
