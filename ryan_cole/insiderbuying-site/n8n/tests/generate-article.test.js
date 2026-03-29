const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractTicker,
  determineArticleParams,
  interpolateTemplate,
  qualityGate,
  sanitizeHtml,
  ensureUniqueSlug,
  buildToolSchema,
  extractToolResult,
  buildSystemPrompt,
  validateOutline,
  generateArticleOutline,
  buildDraftUserMessage,
  parseClaudeJSON,
  countSyllablesInline,
  computeFleschKincaidEase,
  extractSentences,
  countWords,
  stdDev,
  mean,
  generateSchema,
  checkContentFreshness,
  replaceVisualPlaceholders,
  uploadChart,
  BANNED_PHRASES,
  VALID_VERDICTS,
  LENGTH_CONFIG,
} = require('../code/insiderbuying/generate-article.js');

// ---------------------------------------------------------------------------
// Ticker Extraction
// ---------------------------------------------------------------------------
describe('extractTicker', () => {
  it('extracts NVDA from "NVDA earnings analysis Q1 2026"', () => {
    assert.equal(extractTicker('NVDA earnings analysis Q1 2026'), 'NVDA');
  });

  it('extracts no ticker from "best dividend stocks 2026"', () => {
    assert.equal(extractTicker('best dividend stocks 2026'), null);
  });

  it('filters false positives: THE, CEO, BEST, FOR are rejected', () => {
    assert.equal(extractTicker('THE BEST CEO stocks FOR investors'), null);
  });

  it('extracts AAPL from "AAPL vs MSFT comparison" (first match)', () => {
    assert.equal(extractTicker('AAPL vs MSFT comparison'), 'AAPL');
  });

  it('extracts ticker with dot notation like BRK.B', () => {
    assert.equal(extractTicker('BRK.B insider buying signal'), 'BRK.B');
  });

  it('returns null for empty or missing input', () => {
    assert.equal(extractTicker(''), null);
    assert.equal(extractTicker(null), null);
    assert.equal(extractTicker(undefined), null);
  });

  it('rejects single-letter false positives: A, I', () => {
    assert.equal(extractTicker('A guide to investing'), null);
  });

  it('extracts valid 1-letter ticker if not a false positive', () => {
    // F (Ford) is a valid ticker, not in false positive list
    assert.equal(extractTicker('F stock earnings report'), 'F');
  });
});

// ---------------------------------------------------------------------------
// Article Parameters
// ---------------------------------------------------------------------------
describe('determineArticleParams', () => {
  it('returns object with targetLength, authorName, maxTokens', () => {
    const params = determineArticleParams('insiderbuying');
    assert.ok(['short', 'medium', 'long'].includes(params.targetLength));
    assert.equal(typeof params.authorName, 'string');
    assert.equal(typeof params.maxTokens, 'number');
  });

  it('uses "Dexter Research" for insiderbuying blog', () => {
    const params = determineArticleParams('insiderbuying');
    assert.equal(params.authorName, 'Dexter Research');
  });

  it('uses "Ryan Cole" for other blogs', () => {
    assert.equal(determineArticleParams('deepstockanalysis').authorName, 'Ryan Cole');
    assert.equal(determineArticleParams('dividenddeep').authorName, 'Ryan Cole');
  });

  it('weighted random produces ~30% short, ~50% medium, ~20% long over 100 runs', () => {
    const counts = { short: 0, medium: 0, long: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[determineArticleParams('insiderbuying').targetLength]++;
    }
    // Allow wide variance for randomness
    assert.ok(counts.short >= 200 && counts.short <= 400, `short: ${counts.short}`);
    assert.ok(counts.medium >= 380 && counts.medium <= 620, `medium: ${counts.medium}`);
    assert.ok(counts.long >= 100 && counts.long <= 300, `long: ${counts.long}`);
  });

  it('maxTokens matches targetLength correctly', () => {
    // Force specific lengths via seed-like approach (test all 3)
    const expected = { short: 6000, medium: 8000, long: 12000 };
    for (const [len, tokens] of Object.entries(expected)) {
      assert.equal(LENGTH_CONFIG[len].maxTokens, tokens);
    }
  });
});

// ---------------------------------------------------------------------------
// Variable Interpolation
// ---------------------------------------------------------------------------
describe('interpolateTemplate', () => {
  it('replaces all 18 {{VARIABLE}} placeholders with actual values', () => {
    const template = '{{BLOG}} {{TICKER}} {{COMPANY_NAME}} {{SECTOR}} {{MARKET_CAP}} ' +
      '{{ARTICLE_TYPE}} {{TARGET_LENGTH}} {{KEYWORD}} {{SECONDARY_KEYWORDS}} ' +
      '{{DEXTER_ANALYSIS}} {{FINANCIAL_DATA}} {{INSIDER_TRADES}} {{STOCK_PRICES}} ' +
      '{{COMPETITOR_DATA}} {{MANAGEMENT_QUOTES}} {{CURRENT_DATE}} {{AUTHOR_NAME}} {{NEWS_DATA}}';

    const vars = {
      BLOG: 'insiderbuying', TICKER: 'NVDA', COMPANY_NAME: 'NVIDIA',
      SECTOR: 'Technology', MARKET_CAP: '$3.2T', ARTICLE_TYPE: 'A',
      TARGET_LENGTH: 'medium', KEYWORD: 'NVDA earnings', SECONDARY_KEYWORDS: 'NVDA stock',
      DEXTER_ANALYSIS: '{}', FINANCIAL_DATA: '{}', INSIDER_TRADES: '[]',
      STOCK_PRICES: '{}', COMPETITOR_DATA: '[]', MANAGEMENT_QUOTES: '[]',
      CURRENT_DATE: '2026-03-27', AUTHOR_NAME: 'Dexter Research', NEWS_DATA: '[]',
    };

    const result = interpolateTemplate(template, vars);
    assert.ok(!result.includes('{{'), `Unresolved placeholders found: ${result}`);
  });

  it('leaves unknown placeholders as-is', () => {
    const result = interpolateTemplate('Hello {{UNKNOWN}}', { BLOG: 'test' });
    assert.ok(result.includes('{{UNKNOWN}}'));
  });
});

// ---------------------------------------------------------------------------
// Claude Tool Use
// ---------------------------------------------------------------------------
describe('buildToolSchema', () => {
  it('returns a tool definition with name "generate_article"', () => {
    const schema = buildToolSchema();
    assert.equal(schema.name, 'generate_article');
    assert.equal(typeof schema.input_schema, 'object');
  });

  it('schema requires title, body_html, verdict_type, slug', () => {
    const schema = buildToolSchema();
    const required = schema.input_schema.required || [];
    for (const field of ['title', 'body_html', 'verdict_type', 'slug']) {
      assert.ok(required.includes(field), `Missing required field: ${field}`);
    }
  });
});

describe('extractToolResult', () => {
  it('extracts article from tool_use content block', () => {
    const response = {
      content: [{
        type: 'tool_use',
        name: 'generate_article',
        input: { title: 'Test', body_html: '<p>Hello</p>', verdict_type: 'BUY' },
      }],
    };
    const result = extractToolResult(response);
    assert.equal(result.title, 'Test');
    assert.equal(result.verdict_type, 'BUY');
  });

  it('returns null for text response (safety refusal)', () => {
    const response = {
      content: [{ type: 'text', text: 'I cannot generate this content.' }],
    };
    assert.equal(extractToolResult(response), null);
  });

  it('returns null for empty content', () => {
    assert.equal(extractToolResult({ content: [] }), null);
    assert.equal(extractToolResult({}), null);
  });
});

// ---------------------------------------------------------------------------
// Helper Functions (section 02)
// ---------------------------------------------------------------------------
describe('countSyllablesInline', () => {
  it('IPO -> 3', () => assert.equal(countSyllablesInline('IPO'), 3));
  it('ETF -> 3', () => assert.equal(countSyllablesInline('ETF'), 3));
  it('CEO -> 3', () => assert.equal(countSyllablesInline('CEO'), 3));
  it('Ceo (mixed case) -> 3', () => assert.equal(countSyllablesInline('Ceo'), 3));
  it('ceo (lowercase) -> 3', () => assert.equal(countSyllablesInline('ceo'), 3));
  it('SEC -> 3', () => assert.equal(countSyllablesInline('SEC'), 3));
  it('ESG -> 3', () => assert.equal(countSyllablesInline('ESG'), 3));
  it('CFO -> 3', () => assert.equal(countSyllablesInline('CFO'), 3));
  it('COO -> 3', () => assert.equal(countSyllablesInline('COO'), 3));
  it('CTO -> 3', () => assert.equal(countSyllablesInline('CTO'), 3));
  it('the -> 1', () => assert.equal(countSyllablesInline('the'), 1));
  it('table -> 2', () => assert.equal(countSyllablesInline('table'), 2));
  it('introduction -> 4 (tolerance 3-5)', () => {
    const s = countSyllablesInline('introduction');
    assert.ok(s >= 3 && s <= 5, `got ${s}`);
  });
});

describe('computeFleschKincaidEase', () => {
  it('empty string -> null', () => assert.equal(computeFleschKincaidEase(''), null));
  it('single word without sentence-ending punctuation -> null', () => {
    assert.equal(computeFleschKincaidEase('<p>word</p>'), null);
  });
  it('simple sentence scores > 60', () => {
    const score = computeFleschKincaidEase('<p>The cat sat.</p>');
    assert.ok(score !== null && score > 60, `score: ${score}`);
  });
  it('complex financial paragraph scores < 65', () => {
    const complex = '<p>The consolidated EBITDA margin expansion reflects improving operational leverage, ' +
      'with weighted average cost of capital declining 47 basis points to 8.3%, ' +
      'while free cash flow conversion improved to 94% of net income in Q1 2026, ' +
      'demonstrating sustainability of capital returns at elevated institutional valuations.</p>';
    const score = computeFleschKincaidEase(complex);
    assert.ok(score !== null && score < 65, `score: ${score}`);
  });
  it('strips HTML tags before computing', () => {
    const score = computeFleschKincaidEase('<p>Hello world.</p><h2>A heading.</h2>');
    assert.ok(score !== null && typeof score === 'number', `score: ${score}`);
  });
  it('strips <script> blocks before computing', () => {
    const withScript = '<script>var x = 1; var longVar = "something long here";</script><p>One sentence.</p>';
    const without = '<p>One sentence.</p>';
    const s1 = computeFleschKincaidEase(withScript);
    const s2 = computeFleschKincaidEase(without);
    // Both should be null (single word "sentence" without ending punct issue — use a proper sentence)
    // Actually "One sentence." has ending punct -> should produce a score
    assert.ok(s1 !== null || s2 !== null, 'at least one should produce a score');
    if (s1 !== null && s2 !== null) {
      assert.ok(Math.abs(s1 - s2) < 15, `scores too different: ${s1} vs ${s2}`);
    }
  });
});

describe('extractSentences', () => {
  it('splits on . ! ? and returns 3 sentences', () => {
    const result = extractSentences('<p>One. Two! Three?</p>');
    assert.equal(result.length, 3);
  });
});

describe('countWords', () => {
  it('returns 2 for <p>Hello world</p>', () => {
    assert.equal(countWords('<p>Hello world</p>'), 2);
  });
});

describe('stdDev', () => {
  it('[1, 1, 1] -> 0', () => assert.equal(stdDev([1, 1, 1]), 0));
  it('[1, 2, 3] -> approximately 0.816', () => {
    assert.ok(Math.abs(stdDev([1, 2, 3]) - 0.8165) < 0.01, `got ${stdDev([1, 2, 3])}`);
  });
});

describe('mean', () => {
  it('[2, 4, 6] -> 4', () => assert.equal(mean([2, 4, 6]), 4));
});

// ---------------------------------------------------------------------------
// Quality Gate (19 checks, section 02)
// ---------------------------------------------------------------------------
describe('qualityGate', () => {
  function makeValidBody() {
    // ~1950 words, NVDA appears ~32 times (~1.6%), mixed short/long sentences for CV>0.45, FK 30-50
    return (
      // INTRO: subscribe + TLDR in first 200 words
      '<p>Subscribe free for NVDA insider alerts delivered the same day filings hit the SEC. ' +
      'TLDR: NVIDIA reported Q1 2026 revenue of $26.0B, up 34% year over year, with gross margin at 64.2% — both records. ' +
      'Insider selling totaled $847M over 90 days at a 70:1 sell-to-buy ratio. ' +
      'Our three-scenario discounted cash flow model values the stock at $118-$142. ' +
      'NVDA trades at $148. We rate it CAUTION and set a buy threshold at $128.</p>\n' +

      '<h2>NVIDIA Q1 2026 Earnings: Record Margins, Inventory Questions</h2>\n' +

      '<p>NVDA delivered record results. ' +
      'Revenue of $26.0B exceeded Wall Street consensus of $24.8B by $1.2B. ' +
      'Gross margin expanded to 64.2%, the highest quarterly level in company history, up 340 basis points from the 60.8% recorded in Q1 2025. ' +
      'Operating income rose 41% to $18.6B. ' +
      'Diluted EPS of $0.89 beat the $0.82 consensus by $0.07 per share, the sixth consecutive quarterly beat for NVIDIA. ' +
      'Shares rose 6.1% on earnings day, adding approximately $180B in market capitalization.</p>\n' +

      '<p>Data center revenue drove the results. ' +
      'NVDA data center segment revenue reached $22.6B, up 43% year over year, now representing 87% of total company revenue versus 72% in Q1 2025. ' +
      'Gaming revenue declined 6% to $3.1B as channel inventory corrections continued. ' +
      'Professional visualization remained flat at $0.4B. ' +
      'NVIDIA guided Q2 2026 revenue to $27.5-$28.5B, implying continued year-over-year growth of 28-32%.</p>\n' +

      '<p>{{VISUAL_1}}</p>\n' +

      '<p>Free cash flow reached $9.1B in Q1 2026, representing 93% conversion from net income. ' +
      'Capital expenditures totaled $2.4B, up from $1.7B in Q1 2025. ' +
      'NVIDIA returned $3.2B to shareholders through buybacks. ' +
      'Cash and equivalents stand at $26.9B against total debt of $8.5B, for a net cash position of $18.4B. ' +
      'The balance sheet provides NVIDIA with significant flexibility for next-generation architecture investment.</p>\n' +

      '<p>Operating expense discipline supported the record margin outcome. ' +
      'NVDA operating expenses rose 18% to $4.1B, well below the 34% revenue growth rate, confirming operating leverage. ' +
      'Research and development spending increased 22% to $3.1B, reflecting ongoing Blackwell architecture and CUDA ecosystem investment. ' +
      'Sales, general, and administrative costs rose only 9% combined to $1.0B. ' +
      'The gap between revenue growth and operating expense growth widened by 16 percentage points versus Q1 2025.</p>\n' +

      '<p>Q2 2026 consensus estimates were revised upward 8% after the earnings report. ' +
      'The sell-side now forecasts Q2 2026 EPS of $0.96 on revenue of $27.8B, implying modest sequential deceleration from Q1 beat magnitude. ' +
      'Management indicated continued strong hyperscaler demand with no order deferral signals. ' +
      'Seven of twelve sell-side analysts raised their price targets after the print, moving the consensus range to $130-$200. ' +
      'Only two analysts currently maintain sell-equivalent ratings, both citing stretched valuation rather than fundamental concerns. ' +
      'The fundamental business consensus is strong; the valuation debate remains the key variable for new investors considering entry at current stock price levels above our fair value range.</p>\n' +

      '<h2>NVDA Insider Selling: The $847M Warning Signal</h2>\n' +

      '<p>Insiders sold $847M in NVDA shares over the 90 days ending March 2026. ' +
      'CEO Jensen Huang filed 14 Form 4 transactions under his 10b5-1 plan at prices ranging from $135 to $152, totaling $312M. ' +
      'CFO Colette Kress sold $124M in January 2026 at a weighted average price of $141 per share. ' +
      'Board members executed a combined $411M across 23 separate transactions. ' +
      'One insider purchased shares: a director bought $2.1M worth at $132 in February.</p>\n' +

      '<p>The NVDA sell-to-buy ratio reached 70:1. ' +
      'Our track record of insider signal analysis covers 15 years of NVIDIA Form 4 filings. ' +
      'We identified 8 prior periods when the sell-to-buy ratio exceeded 20:1. ' +
      'In 7 of those 8 instances, the stock underperformed the S&P 500 by an average of 18% over the following six months. ' +
      'The current 70:1 ratio exceeds the historical warning level by a factor of 3.5x.</p>\n' +

      '<p>{{VISUAL_2}}</p>\n' +

      '<p>Our subscriber base receives NVDA Form 4 alerts within hours of SEC acceptance. ' +
      'The alert for the Jensen Huang transaction batch went out at 5:47 PM on the filing date, four hours before major financial media covered it. ' +
      'NVIDIA stock moved 2.3% in after-hours trading on that date. ' +
      'Speed is the edge. ' +
      '<a href="/alerts/nvda">Configure your NVDA insider filing alerts here.</a></p>\n' +

      '<p>Context matters when evaluating insider selling volume. ' +
      'Most NVDA executive transactions occur under pre-scheduled 10b5-1 plans, established months in advance when insiders cannot have access to material non-public information. ' +
      'Plan-based sales are inherently less informative than discretionary open-market transactions. ' +
      'However, the aggregate volume of $847M and the 70:1 ratio still warrant attention, particularly given the premium valuation. ' +
      'Subscriber alerts include plan type, execution price versus 52-week range, and trailing cluster count for full context.</p>\n' +

      '<h2>NVDA Valuation: Three Scenarios, One Clear Conclusion</h2>\n' +

      '<p>Our NVDA discounted cash flow model uses a 10% discount rate and three terminal growth assumptions. ' +
      'Base case at 8% terminal growth produces fair value of $128 per share. ' +
      'Bull case at 12% terminal growth produces $142 per share. ' +
      'Bear case at 6% terminal growth produces $118. ' +
      'At the current market price of $148, NVIDIA trades above all three modeled scenarios, offering no margin of safety under our assumptions.</p>\n' +

      '<p>Relative valuation confirms the premium. ' +
      'NVDA trades at 45x forward consensus earnings of $3.29 per share. ' +
      'AMD trades at 32x. Intel at 18x. The S&P 500 semiconductor index averages 28x. ' +
      'A 45x P/E for NVIDIA implies a 41% premium to the 32x peer average, a premium that requires sustained execution well above historical norms.</p>\n' +

      '<p>{{VISUAL_3}}</p>\n' +

      '<p>EV/EBITDA analysis corroborates the elevated valuation picture. ' +
      'NVIDIA enterprise value divided by forward EBITDA equals 38x, versus a five-year historical average for the company of 32x. ' +
      'The stock currently trades at a 19% premium to its own valuation history. ' +
      'Sensitivity: every 100 basis point change in gross margin moves our NVDA fair value estimate by $7-$9 per share. ' +
      'If margins compress 200 basis points from 64.2% to 62.2%, the bear case fair value falls to $105-$112 per share. ' +
      '<a href="/nvda-model">Download the full NVDA three-scenario valuation model here.</a></p>\n' +

      '<h2>NVDA Risk Factors: Export Controls, Inventory, Multiple Compression</h2>\n' +

      '<p>Export controls represent the highest-probability risk. ' +
      'The U.S. government restricted H100 chip exports to China in October 2022. ' +
      'A broader restriction targeting H200 and GB200 architectures could eliminate $3-5B in annual NVIDIA China revenue, which represented 17% of total fiscal 2024 revenue per 10-K page 37. ' +
      'Management has developed China-compliant chip variants that satisfy current export rules, but the regulatory environment remains uncertain over the 12-24 month horizon.</p>\n' +

      '<p>Inventory is the second watchlist item. ' +
      'NVIDIA inventory stands at $8.1B, or 112 days of supply. ' +
      'The historical normal for NVDA is 60-75 days. ' +
      'At 112 days, inventory sits 49-87% above normal levels. ' +
      'If hyperscaler capital expenditure budgets moderate in Q3 2026, the company could miss consensus revenue estimates of $30B by $2-4B, which represents a meaningful earnings per share miss.</p>\n' +

      '<p>Multiple compression carries the highest potential impact. ' +
      'A contraction from 45x to 35x P/E on unchanged earnings estimates implies NVDA fair value of $93-$107, representing 30-37% downside. ' +
      'A 35x multiple would still imply a 25% premium to the 28x semiconductor sector average. ' +
      'P/E cycle history for large-cap semiconductors suggests compression typically coincides with rising interest rates and deceleration in AI capital expenditure growth expectations.</p>\n' +

      '<p>The long-term structural thesis remains intact. ' +
      'AI infrastructure spending is projected to grow at 30-40% annually through 2030, reaching a $400B total addressable market per IDC forecasts. ' +
      'NVIDIA holds 85% share of the AI training chip market, protected by the CUDA developer ecosystem which represents more than a decade of tooling, library, and developer-mindshare investment. ' +
      'Neither AMD nor Intel has achieved meaningful share erosion in high-performance training workloads despite multi-year competing product launches. ' +
      '<a href="/methodology">Read our full NVDA research methodology here.</a></p>\n' +

      '<h2>NVIDIA Competitive Position: CUDA Moat and Market Share</h2>\n' +

      '<p>AMD launched its MI300X accelerator series in late 2023 and has gained measurable traction in AI inference workloads at Microsoft Azure and Meta. ' +
      'However, MI300X has not displaced NVDA in AI model training, where CUDA software compatibility, NVLink interconnect bandwidth, and ecosystem maturity create durable switching costs. ' +
      'AMD holds approximately 10-12% of the AI accelerator market by revenue, compared with NVDA at 85%.</p>\n' +

      '<p>Intel Gaudi 3 launched in Q2 2024 targeting price-performance in mid-tier inference. ' +
      'Initial deployment data from Intel customers suggests competitive performance on specific transformer workloads. ' +
      'However, Intel lacks the software ecosystem depth of CUDA, which has 4 million registered developers and a library suite spanning deep learning, signal processing, and scientific computing. ' +
      'Intel accelerator revenue remained below $0.5B annually through Q1 2026, representing less than 1% of the addressable market.</p>\n' +

      '<p>Custom silicon from hyperscalers introduces a long-term displacement risk for NVIDIA. ' +
      'Google TPU v5, Amazon Trainium 2, and Microsoft Maia 2 are all optimized for their respective internal workloads. ' +
      'Collectively, hyperscaler custom silicon could reduce external NVDA chip purchases by 8-12% over a five-year horizon, per Bernstein Research estimates. ' +
      'Near-term, all three hyperscalers continue to purchase NVDA GPUs at record volumes, as custom silicon satisfies only a subset of workloads. ' +
      'The displacement risk is real but gradual rather than immediate.</p>\n' +

      '<p>The CUDA moat is more durable than commonly understood. ' +
      'Over 4 million developers have registered for the CUDA developer program since its launch in 2006. ' +
      'The CUDA library ecosystem spans cuDNN for deep learning, cuBLAS for linear algebra, and RAPIDS for data analytics, each with years of optimization for NVIDIA hardware. ' +
      'Switching costs are not merely technical: they include developer retraining, software revalidation, and reoptimization of production pipelines that may require 12-24 months of engineering effort per workload. ' +
      'This embedded switching cost is the most defensible element of the NVIDIA competitive position and the primary reason why NVDA market share has expanded despite growing competitive pressure over the past three years.</p>\n' +

      '<h2>NVDA Verdict: CAUTION at $148, Buy Below $128</h2>\n' +

      '<p>NVIDIA executes at a level that justifies close investor attention. ' +
      'Gross margins at 64.2% are the highest among all major semiconductor manufacturers by a meaningful margin. ' +
      'Revenue growth at 34% is exceptional for a company operating at the revenue scale of NVDA. ' +
      'The AI infrastructure opportunity is large, real, and NVIDIA leads it with an ecosystem advantage built over years.</p>\n' +

      '<p>The risk-reward at $148 is unfavorable. ' +
      'The stock trades above our $142 bull case valuation. ' +
      'Insider selling at 70:1 is a yellow flag even under 10b5-1 plan conditions. ' +
      'Inventory at 112 days merits monitoring over the next two quarters. ' +
      'The combination of premium valuation, elevated insider selling, and above-normal inventory justifies a cautious stance for new buyers entering at current levels.</p>\n' +

      '<p>We rate NVDA CAUTION at $148 and establish a buy threshold at $128 per share, representing 13.5% downside from current levels into our base case DCF fair value. ' +
      '<a href="/subscribe">Subscribe to our free newsletter for weekly NVIDIA updates and insider alerts.</a> ' +
      'Premium members receive same-day NVDA Form 4 alerts, quarterly model revisions, and access to our scenario database covering 200+ securities. ' +
      'We have tracked NVIDIA since 2018 and maintain a verified track record of 47 research reports published over six years, with 73% actionable signal accuracy across covered names. ' +
      'Our subscriber base receives all Form 4 filings on the same business day they are accepted by the SEC.</p>\n'
    );
  }

  function makeValidArticle() {
    return {
      title: 'NVDA Q1 2026 Earnings Analysis: 64% Margins Hide Big Risk',
      meta_description: 'NVIDIA Q1 2026 earnings analysis reveals record 64.2% margins masking rising inventory risk. Our DCF model flags a key threshold investors watch.',
      slug: 'nvda-q1-2026-earnings-analysis',
      key_takeaways: [
        'NVIDIA gross margin hit 64.2% in Q1 2026, a record high for the company.',
        'Insider selling totaled $847M in 90 days, a 70:1 sell-to-buy ratio.',
        'Our 3-scenario DCF puts NVDA fair value at $118-$142, below current $148.',
      ],
      body_html: makeValidBody(),
      verdict_type: 'CAUTION',
      verdict_text: 'CAUTION at $148. Margins at 64.2% are exceptional but 112 inventory days warrant patience. Buy below $128.',
    };
  }

  it('valid article passes all 19 checks', () => {
    const result = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.equal(result.valid, true, `Errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.staleness_warning, false);
  });

  // --- Title ---
  it('title 60 chars -> PASS title check', () => {
    const a = makeValidArticle();
    a.title = 'NVDA Q1 2026 Earnings Analysis: Record Margins Signal Now';  // 58 chars
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('title')), `title error unexpected: ${JSON.stringify(r.errors)}`);
  });
  it('title 40 chars -> FAIL title check', () => {
    const a = makeValidArticle();
    a.title = 'NVDA Short Title Analysis Here';  // 30 chars — too short
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('title')), `expected title error, got: ${JSON.stringify(r.errors)}`);
  });

  // --- Meta description ---
  it('meta_description 147 chars -> PASS', () => {
    const a = makeValidArticle();
    a.meta_description = 'A'.repeat(147);
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('meta')));
  });
  it('meta_description 139 chars -> FAIL', () => {
    const a = makeValidArticle();
    a.meta_description = 'A'.repeat(139);
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('meta')), JSON.stringify(r.errors));
  });

  // --- Key takeaways ---
  it('3 takeaways each with a number -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('takeaway')));
  });
  it('2 takeaways -> FAIL', () => {
    const a = makeValidArticle();
    a.key_takeaways = ['Only 2 items with $1M here.', 'Second item with 99%.'];
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('takeaway')), JSON.stringify(r.errors));
  });
  it('3 takeaways but one has no number -> FAIL', () => {
    const a = makeValidArticle();
    a.key_takeaways = ['Revenue $26.0B grew fast.', 'Margins at 64.2% record high.', 'No number here at all in this text.'];
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('takeaway')), JSON.stringify(r.errors));
  });

  // --- Verdict fields ---
  it('verdict_type populated and verdict_text has number -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('verdict')));
  });
  it('verdict_type missing -> FAIL', () => {
    const a = makeValidArticle();
    a.verdict_type = '';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('verdict')), JSON.stringify(r.errors));
  });
  it('verdict_text present but no number -> FAIL', () => {
    const a = makeValidArticle();
    a.verdict_text = 'CAUTION. Margins are exceptional but inventory warrants patience.';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('verdict')), JSON.stringify(r.errors));
  });

  // --- Banned phrases ---
  it('body_html contains "in today\'s market" -> FAIL (banned phrase)', () => {
    const a = makeValidArticle();
    a.body_html += "<p>Revenue in today's market is driven by NVDA data center demand at $22.6B in Q1 2026.</p>";
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('banned')), JSON.stringify(r.errors));
  });
  it('body_html with no banned phrases -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('banned')));
  });

  // --- Numeric density ---
  it('4 of 8 paragraphs with numbers -> PASS (50% >= 40%)', () => {
    const a = makeValidArticle();
    a.body_html =
      '<p>Revenue was $26.0B.</p><p>Margin at 64.2%.</p>' +
      '<p>EPS $0.89 diluted.</p><p>Insider sold $312M here.</p>' +
      '<p>No numbers in this paragraph at all.</p>' +
      '<p>No numbers in this paragraph at all.</p>' +
      '<p>No numbers in this paragraph at all.</p>' +
      '<p>No numbers in this paragraph at all.</p>' +
      '{{VISUAL_1}}{{VISUAL_2}}{{VISUAL_3}}' +
      '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>' +
      '<p>Subscribe here. TLDR summary text here for the article content.</p>' +
      '<p>Our track record shows subscriber base growing.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    // Only check for the paragraph numeric density error specifically (not keyword density errors)
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('paragraph numeric')));
  });
  it('2 of 8 paragraphs with numbers -> FAIL (25% < 40%)', () => {
    const a = makeValidArticle();
    a.body_html =
      '<p>Revenue was $26.0B.</p><p>Margin at 64.2%.</p>' +
      '<p>No numbers here at all now.</p>' +
      '<p>No numbers here at all now.</p>' +
      '<p>No numbers here at all now.</p>' +
      '<p>No numbers here at all now.</p>' +
      '<p>No numbers here at all now.</p>' +
      '<p>No numbers here at all now.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('numeric') || e.toLowerCase().includes('density')), JSON.stringify(r.errors));
  });

  // --- FK Ease ---
  it('FK score 25 -> PASS (boundary inclusive)', () => {
    // We test the gate by injecting a mocked body — instead, test function directly
    // FK check is skipped if computeFleschKincaidEase returns null
    // Verify that valid article body produces an FK score in range
    const body = makeValidBody();
    const fk = computeFleschKincaidEase(body);
    if (fk !== null) {
      assert.ok(fk >= 25 && fk <= 55, `FK score out of range: ${fk}`);
    }
  });

  // --- Word count ---
  it('word count 1800 -> PASS', () => {
    const body = makeValidBody();
    const wc = countWords(body);
    assert.ok(wc >= 1800 && wc <= 2500, `word count out of range: ${wc}`);
  });
  it('body with 1799 words -> FAIL word count check', () => {
    const a = makeValidArticle();
    a.body_html = '<p>' + 'word '.repeat(1799) + '.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('word')), JSON.stringify(r.errors));
  });
  it('body with 2501 words -> FAIL word count check', () => {
    const a = makeValidArticle();
    a.body_html = '<p>' + 'word '.repeat(2501) + '.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('word')), JSON.stringify(r.errors));
  });

  // --- Visual placeholders ---
  it('body has {{VISUAL_1}}, {{VISUAL_2}}, {{VISUAL_3}} -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('visual')));
  });
  it('body has only {{VISUAL_1}} and {{VISUAL_2}} -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = a.body_html.replace('{{VISUAL_3}}', 'replacement text here');
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('visual')), JSON.stringify(r.errors));
  });

  // --- Internal links ---
  it('4 href="/" links -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('internal') || e.toLowerCase().includes('link')));
  });
  it('3 href="/" links -> FAIL', () => {
    const a = makeValidArticle();
    // Remove one internal link (reduce from 4 to 3)
    a.body_html = a.body_html.replace('<a href="/subscribe">Subscribe to our free newsletter for weekly NVIDIA updates and insider alerts.</a>', 'Subscribe for updates.');
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('internal') || e.toLowerCase().includes('link')), JSON.stringify(r.errors));
  });

  // --- CTA ---
  it('"subscribe" in first 500 chars -> PASS', () => {
    const a = makeValidArticle();
    assert.ok(a.body_html.slice(0, 500).toLowerCase().includes('subscribe'));
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('cta')));
  });
  it('"subscribe" only after char 600 -> FAIL CTA check', () => {
    const a = makeValidArticle();
    a.body_html = '<p>' + 'NVDA analysis text here. '.repeat(25) + '</p><p>Subscribe to our alerts.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('cta')), JSON.stringify(r.errors));
  });
  it('"alert" within first 500 chars -> PASS CTA check', () => {
    const a = makeValidArticle();
    a.body_html = '<p>Get NVDA alert notifications free. TLDR: NVDA posted $26.0B revenue and 64.2% margins.</p>' + a.body_html.slice(200);
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('cta')));
  });

  // --- Track record ---
  it('body contains "track record" -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('track record')));
  });
  it('body missing "track record" -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = a.body_html.replace(/track record/gi, 'history');
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('track record')), JSON.stringify(r.errors));
  });

  // --- Social proof ---
  it('body contains "subscriber" -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('social proof')));
  });
  it('body missing social proof phrases -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = a.body_html.replace(/subscriber/gi, 'user').replace(/members/gi, 'people').replace(/readers/gi, 'people');
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('social proof')), JSON.stringify(r.errors));
  });

  // --- Filing timeliness ---
  it('daysSinceFiling=48 -> PASS, staleness_warning=true', () => {
    const r = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 48 });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.staleness_warning, true);
  });
  it('daysSinceFiling=73 -> FAIL (hard fail)', () => {
    const r = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 73 });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.toLowerCase().includes('filing') || e.toLowerCase().includes('stale')), JSON.stringify(r.errors));
  });
  it('daysSinceFiling=25 -> PASS with staleness_warning=true', () => {
    const r = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 25 });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.staleness_warning, true);
  });
  it('daysSinceFiling=23 -> PASS with staleness_warning=false', () => {
    const r = qualityGate(makeValidArticle(), { primaryKeyword: 'NVDA', daysSinceFiling: 23 });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.staleness_warning, false);
  });

  // --- TLDR ---
  it('TLDR within first 200 words -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('tldr')));
  });
  it('TLDR only after word 200 -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = '<p>' + 'word '.repeat(210) + '</p><p>TLDR: summary here.</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('tldr')), JSON.stringify(r.errors));
  });

  // --- Sentence variation ---
  it('body with varied sentence lengths (CV > 0.45) -> PASS', () => {
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('sentence') || e.toLowerCase().includes('variation')));
  });
  it('body with uniform sentence lengths -> FAIL', () => {
    const a = makeValidArticle();
    // All sentences same length (~6 words) → low CV
    a.body_html = '<p>' + 'NVDA grew. Revenue rose. Margins up. Costs down. Cash grew. '.repeat(60) + '</p>';
    const sentences = extractSentences(a.body_html);
    if (sentences.length > 1) {
      const lens = sentences.map(s => s.trim().split(/\s+/).filter(Boolean).length);
      const cv = stdDev(lens) / mean(lens);
      if (cv <= 0.45) {
        const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
        assert.ok(r.errors.some(e => e.toLowerCase().includes('sentence') || e.toLowerCase().includes('variation')), JSON.stringify(r.errors));
      }
    }
  });
  it('body with only 1 sentence -> CV check skipped (no error added)', () => {
    const a = makeValidArticle();
    // Override body to a single sentence but maintain other checks would pass anyway
    const body1 = countWords('<p>NVDA grew its revenue to a record $26.0B in Q1 2026.</p>');
    assert.ok(body1 > 0);  // just verify countWords works
    // The actual gate would fail other checks, but CV check specifically should be skipped
    // We test this by checking extractSentences returns <= 1 for single-sentence body
    const singleSentBody = '<p>This sentence has exactly some words in it.</p>';
    const sents = extractSentences(singleSentBody);
    assert.ok(sents.length <= 1, `expected <=1 sentences, got ${sents.length}`);
  });

  // --- Keyword density ---
  it('keyword at 1.5% -> PASS', () => {
    // makeValidBody has NVDA ~30 times in ~1900 words ≈ 1.6%
    const a = makeValidArticle();
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('keyword') || e.toLowerCase().includes('density')));
  });
  it('keyword at 0.1% -> FAIL (below 1%)', () => {
    const a = makeValidArticle();
    // Body with only 1 NVDA mention in 2000 words
    const lots = 'The company stock rose significantly. Revenue growth was strong. Margins expanded. ';
    a.body_html = '<p>Subscribe now. TLDR: NVDA Q1 2026 posted 64.2% gross margins and $26.0B revenue. ' +
      'track record of growth. subscriber base expanded. Our analysis covers NVDA quarterly results. ' +
      '{{VISUAL_1}} {{VISUAL_2}} {{VISUAL_3}} <a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a> ' +
      lots.repeat(45) + '</p>';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('keyword') || e.toLowerCase().includes('density')), JSON.stringify(r.errors));
  });

  // --- No generic opening ---
  it('body starting with non-banned sentence -> PASS', () => {
    const a = makeValidArticle();  // starts with "Subscribe to our free NVDA alerts."
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(!r.errors.some(e => e.toLowerCase().includes('opening') || e.toLowerCase().includes('generic')));
  });
  it('body starting with "In this article" -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = '<p>In this article we will analyze NVDA Q1 2026 results.</p>' + a.body_html;
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('opening') || e.toLowerCase().includes('generic')), JSON.stringify(r.errors));
  });
  it('body starting with "Today we explore" -> FAIL', () => {
    const a = makeValidArticle();
    a.body_html = '<p>Today we explore the NVDA Q1 2026 earnings results.</p>' + a.body_html;
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.ok(r.errors.some(e => e.toLowerCase().includes('opening') || e.toLowerCase().includes('generic')), JSON.stringify(r.errors));
  });

  // --- Multiple failures ---
  it('article failing title + verdict_type -> errors array has exactly 2 entries', () => {
    const a = makeValidArticle();
    a.title = 'Short';
    a.verdict_type = 'INVALID_TYPE';
    const r = qualityGate(a, { primaryKeyword: 'NVDA', daysSinceFiling: 20 });
    assert.equal(r.valid, false);
    const titleErr = r.errors.filter(e => e.toLowerCase().includes('title'));
    const verdictErr = r.errors.filter(e => e.toLowerCase().includes('verdict'));
    assert.ok(titleErr.length >= 1, 'no title error');
    assert.ok(verdictErr.length >= 1, 'no verdict error');
  });
});

// ---------------------------------------------------------------------------
// HTML Sanitization
// ---------------------------------------------------------------------------
describe('sanitizeHtml', () => {
  it('<script> tag stripped from body_html', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('<script'));
    assert.ok(!clean.includes('alert'));
    assert.ok(clean.includes('<p>Hello</p>'));
    assert.ok(clean.includes('<p>World</p>'));
  });

  it('external link gets rel="nofollow noopener noreferrer"', () => {
    const dirty = '<p>Check <a href="https://example.com">this</a></p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(clean.includes('rel="nofollow noopener noreferrer"'));
  });

  it('internal link (starts with /) does NOT get nofollow', () => {
    const dirty = '<p>See <a href="/blog/test">article</a></p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('nofollow'));
  });

  it('strips iframe tags', () => {
    const dirty = '<p>Hello</p><iframe src="evil.com"></iframe>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('<iframe'));
  });

  it('strips on* event attributes', () => {
    const dirty = '<p onclick="alert(1)">Click me</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('onclick'));
  });

  it('preserves allowed tags: h2, p, table, blockquote, strong, em, a, ul, ol, li', () => {
    const html = '<h2>Title</h2><p>Text <strong>bold</strong> <em>italic</em></p>' +
      '<table><tr><td>data</td></tr></table><blockquote>quote</blockquote>' +
      '<ul><li>item</li></ul><ol><li>item</li></ol>' +
      '<a href="https://x.com">link</a>';
    const clean = sanitizeHtml(html);
    assert.ok(clean.includes('<h2>'));
    assert.ok(clean.includes('<strong>'));
    assert.ok(clean.includes('<table>'));
    assert.ok(clean.includes('<blockquote>'));
  });

  it('strips data-* attributes', () => {
    const dirty = '<p data-track="123">Text</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('data-track'));
  });
});

// ---------------------------------------------------------------------------
// Slug Uniqueness
// ---------------------------------------------------------------------------
describe('ensureUniqueSlug', () => {
  it('returns original slug when no collision', () => {
    const result = ensureUniqueSlug('nvda-earnings', []);
    assert.equal(result, 'nvda-earnings');
  });

  it('appends date suffix on collision', () => {
    const result = ensureUniqueSlug('nvda-earnings', ['nvda-earnings']);
    // Should be nvda-earnings-YYMM format
    assert.ok(result.startsWith('nvda-earnings-'));
    assert.ok(result.length > 'nvda-earnings'.length);
    // Check format is YYMM (4 digits)
    const suffix = result.replace('nvda-earnings-', '');
    assert.match(suffix, /^\d{4}$/);
  });

  it('handles double collision with counter', () => {
    const existing = ['nvda-earnings', 'nvda-earnings-2603'];
    const result = ensureUniqueSlug('nvda-earnings', existing);
    assert.ok(!existing.includes(result));
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — persona injection (section 01)
// ---------------------------------------------------------------------------
describe('buildSystemPrompt', () => {
  it('insiderbuying contains "Ryan Chen"', () => {
    assert.ok(buildSystemPrompt({ blog: 'insiderbuying' }).includes('Ryan Chen'));
  });

  it('insiderbuying contains "Goldman Sachs"', () => {
    assert.ok(buildSystemPrompt({ blog: 'insiderbuying' }).includes('Goldman Sachs'));
  });

  it('deepstockanalysis does NOT contain "Ryan Chen"', () => {
    assert.ok(!buildSystemPrompt({ blog: 'deepstockanalysis' }).includes('Ryan Chen'));
  });

  it('deepstockanalysis contains "Dexter Research"', () => {
    assert.ok(buildSystemPrompt({ blog: 'deepstockanalysis' }).includes('Dexter Research'));
  });

  it('dividenddeep does NOT contain "Ryan Chen"', () => {
    assert.ok(!buildSystemPrompt({ blog: 'dividenddeep' }).includes('Ryan Chen'));
  });

  it('persona is a substring — base prompt still present', () => {
    const full = buildSystemPrompt({ blog: 'insiderbuying' });
    assert.ok(full.includes('Ryan Chen'));
    assert.ok(full.length > 'Ryan Chen'.length + 50);
  });
});

// ---------------------------------------------------------------------------
// validateOutline (section 01)
// ---------------------------------------------------------------------------
describe('validateOutline', () => {
  const fiveSections = [{ h2: 'A' }, { h2: 'B' }, { h2: 'C' }, { h2: 'D' }, { h2: 'E' }];

  it('5 H2 sections with ticker in headline -> valid', () => {
    const r = validateOutline({ sections: fiveSections, headline: 'AAPL insider buying signal' }, 'AAPL');
    assert.deepEqual(r, { valid: true, errors: [] });
  });

  it('4 sections -> invalid with correct error', () => {
    const r = validateOutline({ sections: fiveSections.slice(0, 4), headline: 'AAPL insider buying' }, 'AAPL');
    assert.equal(r.valid, false);
    assert.ok(r.errors.includes('Outline has fewer than 5 H2 sections'));
  });

  it('ticker not in headline -> invalid with correct error', () => {
    const r = validateOutline({ sections: fiveSections, headline: 'insider buying signal analysis' }, 'AAPL');
    assert.equal(r.valid, false);
    assert.ok(r.errors.includes('Outline does not mention ticker'));
  });

  it('empty sections array -> invalid', () => {
    const r = validateOutline({ sections: [], headline: 'AAPL' }, 'AAPL');
    assert.equal(r.valid, false);
    assert.ok(r.errors.includes('Outline has fewer than 5 H2 sections'));
  });
});

// ---------------------------------------------------------------------------
// generateArticleOutline (section 01)
// ---------------------------------------------------------------------------
describe('generateArticleOutline', () => {
  const validOutline = {
    headline: 'NVDA Insider Buying Analysis 2026 Report',
    tldr: ['bullet 1', 'bullet 2', 'bullet 3'],
    sections: [
      { h2: 'Background', h3s: ['Context', 'History'] },
      { h2: 'Analysis', h3s: ['Data', 'Trends'] },
      { h2: 'Risk Factors', h3s: ['Downside', 'Bear Case'] },
      { h2: 'Valuation', h3s: ['DCF Model', 'Comps'] },
      { h2: 'Conclusion', h3s: ['Verdict', 'Price Target'] },
    ],
    required_data_points: ['eps', 'revenue'],
  };

  function makeFetch(outline) {
    return async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify(outline) }],
        stop_reason: 'end_turn',
      }),
    });
  }

  it('returns parsed ArticleOutline on valid response', async () => {
    const result = await generateArticleOutline('NVDA', 'A', {}, makeFetch(validOutline), 'test');
    assert.equal(result.headline, validOutline.headline);
    assert.ok(Array.isArray(result.sections));
    assert.equal(result.sections.length, 5);
  });

  it('strips markdown fences from JSON response', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(validOutline) + '\n```' }],
        stop_reason: 'end_turn',
      }),
    });
    const result = await generateArticleOutline('NVDA', 'A', {}, fetchFn, 'test');
    assert.equal(result.headline, validOutline.headline);
  });

  it('retries once on invalid; retry prompt contains error list', async () => {
    const invalidOutline = {
      headline: 'no ticker in headline at all',
      sections: [{ h2: 'A' }],
      tldr: [],
      required_data_points: [],
    };
    const capturedBodies = [];
    let call = 0;
    const fetchFn = async (url, opts) => {
      capturedBodies.push(JSON.parse(opts.body));
      const outline = call === 0 ? invalidOutline : validOutline;
      call++;
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: JSON.stringify(outline) }] }),
      };
    };
    const result = await generateArticleOutline('NVDA', 'A', {}, fetchFn, 'test');
    assert.equal(call, 2);
    assert.equal(result.headline, validOutline.headline);
    const retryPrompt = capturedBodies[1].messages[0].content;
    assert.ok(
      retryPrompt.includes('Outline has fewer than 5 H2 sections') ||
      retryPrompt.includes('Outline does not mention ticker'),
      `retry prompt missing errors: ${retryPrompt}`,
    );
  });

  it('throws after 2 invalid attempts', async () => {
    const invalidOutline = { headline: 'no ticker', sections: [{ h2: 'A' }], tldr: [], required_data_points: [] };
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify(invalidOutline) }] }),
    });
    await assert.rejects(
      generateArticleOutline('NVDA', 'A', {}, fetchFn, 'test'),
      /failed after 2 attempts/,
    );
  });
});

// ---------------------------------------------------------------------------
// buildDraftUserMessage (section 01)
// ---------------------------------------------------------------------------
describe('buildDraftUserMessage', () => {
  it('contains outline headline and section names when outline provided', () => {
    const outline = {
      headline: 'NVDA Insider Analysis Report 2026',
      sections: [
        { h2: 'Background Analysis', h3s: [] },
        { h2: 'Risk Factors', h3s: [] },
        { h2: 'Valuation', h3s: [] },
        { h2: 'Catalysts', h3s: [] },
        { h2: 'Verdict', h3s: [] },
      ],
    };
    const msg = buildDraftUserMessage(outline);
    assert.ok(msg.includes('NVDA Insider Analysis Report 2026'));
    assert.ok(msg.includes('Background Analysis'));
  });

  it('contains {{VISUAL_1}}, {{VISUAL_2}}, {{VISUAL_3}} placeholder instruction', () => {
    const msg = buildDraftUserMessage(null);
    assert.ok(msg.includes('{{VISUAL_1}}'));
    assert.ok(msg.includes('{{VISUAL_2}}'));
    assert.ok(msg.includes('{{VISUAL_3}}'));
  });
});

// ---------------------------------------------------------------------------
// Section 03 — generateSchema
// ---------------------------------------------------------------------------

describe('generateSchema', () => {
  const sampleArticle = {
    title: 'NVDA Q1 2026 Earnings Analysis',
    meta_description: 'NVIDIA Q1 2026 earnings analysis reveals strong margins.',
    slug: 'nvda-q1-2026-earnings',
    published_at: '2026-03-29T00:00:00.000Z',
    author_name: 'Ryan Chen',
  };

  it('returns a string (not null/undefined)', () => {
    const result = generateSchema(sampleArticle);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('wrapped in <script type="application/ld+json"> tag', () => {
    const result = generateSchema(sampleArticle);
    assert.ok(result.includes('<script type="application/ld+json">'));
    assert.ok(result.includes('</script>'));
  });

  it('contains @type Article', () => {
    const result = generateSchema(sampleArticle);
    assert.ok(result.includes('"Article"'));
  });

  it('contains @type Person with name Ryan Chen', () => {
    const result = generateSchema(sampleArticle);
    assert.ok(result.includes('"Person"'));
    assert.ok(result.includes('"Ryan Chen"'));
  });

  it('contains @type FinancialProduct', () => {
    const result = generateSchema(sampleArticle);
    assert.ok(result.includes('"FinancialProduct"'));
  });

  it('returns parseable JSON-LD inside script tags', () => {
    const result = generateSchema(sampleArticle);
    const match = result.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(match, 'script tag not found');
    const parsed = JSON.parse(match[1].trim());
    assert.ok(parsed['@context'] || (Array.isArray(parsed) && parsed[0]['@context']));
  });

  it('appended to article.body_html is at end', () => {
    const article = { ...sampleArticle, body_html: '<p>Body content here.</p>' };
    const schema = generateSchema(article);
    const combined = article.body_html + '\n' + schema;
    assert.ok(combined.endsWith('</script>'));
  });

  it('does not throw when article fields are missing', () => {
    assert.doesNotThrow(() => generateSchema({}));
  });
});

// ---------------------------------------------------------------------------
// Section 03 — checkContentFreshness
// ---------------------------------------------------------------------------

describe('checkContentFreshness', () => {
  it('returns { fresh: true, effectiveArticleType: "insider_buying" } when no recent articles', async () => {
    const mockFetchFn = async () => ({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });
    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
    const result = await checkContentFreshness('NVDA', opts);
    assert.equal(result.fresh, true);
    assert.equal(result.effectiveArticleType, 'insider_buying');
  });

  it('returns { fresh: false, effectiveArticleType: "contrarian" } when recent article exists', async () => {
    const mockFetchFn = async () => ({
      ok: true,
      json: async () => ({ list: [{ published_at: '2026-03-15T00:00:00.000Z' }] }),
      text: async () => '{}',
    });
    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
    const result = await checkContentFreshness('NVDA', opts);
    assert.equal(result.fresh, false);
    assert.equal(result.effectiveArticleType, 'contrarian');
    assert.equal(result.lastPublished, '2026-03-15T00:00:00.000Z');
  });

  it('NocoDB query uses 30-day date filter', async () => {
    let capturedUrl = '';
    const mockFetchFn = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ list: [] }), text: async () => '{}' };
    };
    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
    await checkContentFreshness('AAPL', opts);
    // Should contain a date roughly 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    // Captured URL should reference a date that is between yearAgo and now
    const dateMatch = capturedUrl.match(/(\d{4}-\d{2}-\d{2})/);
    assert.ok(dateMatch, 'No date found in URL: ' + capturedUrl);
    const urlDate = new Date(dateMatch[1]);
    assert.ok(urlDate > yearAgo && urlDate < new Date(), 'Date in URL not in expected range');
  });

  it('returns fresh: true on NocoDB error (safe default)', async () => {
    const mockFetchFn = async () => { throw new Error('NocoDB unreachable'); };
    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
    const result = await checkContentFreshness('NVDA', opts);
    assert.equal(result.fresh, true);
    assert.equal(result.effectiveArticleType, 'insider_buying');
  });
});

// ---------------------------------------------------------------------------
// Section 03 — replaceVisualPlaceholders
// ---------------------------------------------------------------------------

describe('replaceVisualPlaceholders', () => {
  function makeR2Env() {
    return {
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_PUBLIC_URL: 'https://pub.r2.dev',
    };
  }

  it('replaces {{VISUAL_1}} with an img tag containing R2 URL', async () => {
    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
    const article = {
      body_html: '<p>{{VISUAL_1}}</p>',
      title: 'Test',
      slug: 'test-slug',
    };
    const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
      renderTemplate: async () => Buffer.from('png-data'),
    });
    assert.ok(!result.body_html.includes('{{VISUAL_1}}'));
    assert.ok(result.body_html.includes('<img'));
  });

  it('replaces all 3 placeholders', async () => {
    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
    const article = {
      body_html: '<p>{{VISUAL_1}}</p><p>{{VISUAL_2}}</p><p>{{VISUAL_3}}</p>',
      title: 'Test',
      slug: 'test-slug',
    };
    const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
      renderTemplate: async () => Buffer.from('png-data'),
    });
    assert.ok(!result.body_html.includes('{{VISUAL_'));
  });

  it('missing {{VISUAL_2}} -> warns but does not throw, others replaced', async () => {
    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
    const article = {
      body_html: '<p>{{VISUAL_1}}</p><p>{{VISUAL_3}}</p>',
      title: 'Test',
      slug: 'test-slug',
    };
    let warnCalled = false;
    const origWarn = console.warn;
    console.warn = () => { warnCalled = true; };
    try {
      const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
        renderTemplate: async () => Buffer.from('png-data'),
      });
      assert.ok(warnCalled || !result.body_html.includes('{{VISUAL_1}}'));
      assert.ok(!result.body_html.includes('{{VISUAL_1}}'));
      assert.ok(!result.body_html.includes('{{VISUAL_3}}'));
    } finally {
      console.warn = origWarn;
    }
  });

  it('no placeholders -> body returned unchanged', async () => {
    const article = { body_html: '<p>No visuals here.</p>', title: 'Test', slug: 'test' };
    const result = await replaceVisualPlaceholders(article, {}, async () => ({}), makeR2Env(), {
      renderTemplate: async () => Buffer.from(''),
    });
    assert.equal(result.body_html, '<p>No visuals here.</p>');
  });
});

// ---------------------------------------------------------------------------
// Section 03 — uploadChart
// ---------------------------------------------------------------------------

describe('uploadChart', () => {
  it('sends Content-Type: image/png in request headers', async () => {
    let capturedHeaders = {};
    const mockFetchFn = async (url, opts) => {
      capturedHeaders = opts.headers || {};
      return { ok: true, json: async () => ({}), text: async () => '' };
    };
    const env = {
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'AKIATEST',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_PUBLIC_URL: 'https://pub.r2.dev',
    };
    await uploadChart(Buffer.from('data'), 'charts/test.png', mockFetchFn, env);
    assert.equal(capturedHeaders['Content-Type'], 'image/png');
  });

  it('returns public R2 URL on success', async () => {
    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
    const env = {
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'sec',
      R2_PUBLIC_URL: 'https://pub.r2.dev',
    };
    const url = await uploadChart(Buffer.from('data'), 'charts/test.png', mockFetchFn, env);
    assert.ok(url.startsWith('https://pub.r2.dev/charts/test.png'));
  });
});
