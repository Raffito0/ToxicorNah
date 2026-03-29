'use strict';

const {
  buildEdgarRssUrl,
  fetchRecentFilings,
  deduplicateFilings,
  _resetFailureCount,
  _getFailureCount,
  buildForm4XmlUrl,
  fetchForm4Xml,
  parseForm4Xml,
} = require('../../n8n/code/insiderbuying/edgar-parser');

// ─── Fixtures (Section 02) ────────────────────────────────────────────────────

const FIXTURE_STANDARD_BUY = `
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2025-04-15</periodOfReport>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001278495</rptOwnerCik>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isOfficer>1</isOfficer>
      <officerTitle>President and CEO</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>100000</value></transactionShares>
        <transactionPricePerShare><value>145.23</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>1000000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

const FIXTURE_AMENDMENT = `
<ownershipDocument>
  <documentType>4/A</documentType>
  <periodOfReport>2025-04-15</periodOfReport>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001278495</rptOwnerCik>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
</ownershipDocument>`;

const FIXTURE_GIFT_NO_PRICE = `
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2025-04-15</periodOfReport>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001278495</rptOwnerCik>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>G</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>5000</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>995000</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

const FIXTURE_OPTION_EXERCISE = `
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2025-04-15</periodOfReport>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001278495</rptOwnerCik>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
  <derivativeTable>
    <derivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>50000</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>0</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>`;

const FIXTURE_MULTI_TRANSACTION = `
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2025-04-15</periodOfReport>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001278495</rptOwnerCik>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>2000</value></transactionShares>
        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>3000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2025-04-15</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>3000</value></transactionShares>
        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>6000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

// ─── buildEdgarRssUrl ──────────────────────────────────────────────────────────

describe('buildEdgarRssUrl()', () => {
  test('URL host is efts.sec.gov', () => {
    const url = buildEdgarRssUrl({ hours: 6 });
    expect(url).toContain('efts.sec.gov');
  });

  test('URL includes forms=4, dateRange=custom, size=2000', () => {
    const url = buildEdgarRssUrl({ hours: 6 });
    expect(url).toContain('forms=4');
    expect(url).toContain('dateRange=custom');
    expect(url).toContain('size=2000');
  });

  test('startdt is approximately now minus hours (within 30s tolerance)', () => {
    const before = Date.now();
    const url = buildEdgarRssUrl({ hours: 6 });
    const after = Date.now();

    const params = new URL(url).searchParams;
    // Append 'Z' to treat as UTC (the implementation outputs UTC without Z marker)
    const startdt = new Date(params.get('startdt') + 'Z').getTime();
    const expected = before - 6 * 60 * 60 * 1000;
    const tolerance = 30000; // 30 seconds

    expect(startdt).toBeGreaterThanOrEqual(expected - tolerance);
    expect(startdt).toBeLessThanOrEqual(after - 6 * 60 * 60 * 1000 + tolerance);
  });

  test('defaults hours to 6 when not specified', () => {
    const url = buildEdgarRssUrl({});
    const params = new URL(url).searchParams;
    // Append 'Z' to treat as UTC
    const startdt = new Date(params.get('startdt') + 'Z').getTime();
    const enddt = new Date(params.get('enddt') + 'Z').getTime();
    const diffHours = (enddt - startdt) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(6, 0);
  });
});

// ─── fetchRecentFilings ────────────────────────────────────────────────────────

const EFTS_TWO_HITS = {
  hits: {
    total: { value: 2 },
    hits: [
      {
        _source: {
          file_num: '0001045810-25-000001',
          file_date: '2025-04-15',
          entity_name: 'NVIDIA CORP',
          display_names: ['Jensen Huang (NVDA) (CIK 0001045810)'],
        },
      },
      {
        _source: {
          file_num: '0000732834-25-000002',
          file_date: '2025-04-15',
          entity_name: 'Vanguard 500 Index Fund',
          display_names: ['Vanguard Advisers Inc (CIK 0000732834)'],
        },
      },
    ],
  },
};

function makeFetch(body) {
  return jest.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

describe('fetchRecentFilings()', () => {
  test('2 valid hits → returns array of length 2 with correct fields', async () => {
    const fetch = makeFetch(EFTS_TWO_HITS);
    const results = await fetchRecentFilings(6, fetch);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      accessionNumber: '0001045810-25-000001',
      filedAt: '2025-04-15',
      issuerName: 'NVIDIA CORP',
      ticker: 'NVDA',
      issuerCik: '0001045810',
    });
  });

  test('display_names without ticker (fund/trust) → ticker=null, CIK extracted', async () => {
    const fetch = makeFetch(EFTS_TWO_HITS);
    const results = await fetchRecentFilings(6, fetch);

    expect(results[1].ticker).toBeNull();
    expect(results[1].issuerCik).toBe('0000732834');
  });

  test('EFTS returns empty hits array → returns []', async () => {
    const fetch = makeFetch({ hits: { total: { value: 0 }, hits: [] } });
    const results = await fetchRecentFilings(6, fetch);
    expect(results).toEqual([]);
  });

  test('fetchFn rejects → returns [], failureCount incremented', async () => {
    _resetFailureCount();
    const fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const results = await fetchRecentFilings(6, fetch);
    expect(results).toEqual([]);
    expect(_getFailureCount()).toBe(1);
  });

  test('EFTS returns unexpected shape (missing hits key) → returns [], no throw', async () => {
    const fetch = makeFetch({ unexpected: 'structure' });
    await expect(fetchRecentFilings(6, fetch)).resolves.toEqual([]);
  });
});

// ─── deduplicateFilings ────────────────────────────────────────────────────────

describe('deduplicateFilings()', () => {
  const FILINGS = [
    { filedAt: '2025-04-14', accessionNumber: 'A' },
    { filedAt: '2025-04-15', accessionNumber: 'B' },
    { filedAt: '2025-04-16', accessionNumber: 'C' },
  ];

  test('filedAt <= lastCheckTimestamp → filing excluded (boundary excluded)', () => {
    const result = deduplicateFilings(FILINGS, '2025-04-15');
    expect(result.map((f) => f.accessionNumber)).toEqual(['C']);
  });

  test('filedAt > lastCheckTimestamp → filing included', () => {
    const result = deduplicateFilings(FILINGS, '2025-04-13');
    expect(result).toHaveLength(3);
  });

  test('lastCheckTimestamp is null → all filings returned unchanged', () => {
    const result = deduplicateFilings(FILINGS, null);
    expect(result).toHaveLength(3);
  });

  test('lastCheckTimestamp is undefined → all filings returned unchanged', () => {
    const result = deduplicateFilings(FILINGS, undefined);
    expect(result).toHaveLength(3);
  });

  test('empty filings array → empty array returned', () => {
    const result = deduplicateFilings([], '2025-04-15');
    expect(result).toEqual([]);
  });
});

// ─── buildForm4XmlUrl ─────────────────────────────────────────────────────────

describe('buildForm4XmlUrl()', () => {
  const CIK = '0000320193';
  const ACC = '0001193125-25-123456';
  const ACC_NO_DASH = '000119312525123456';

  test('primaryUrl strips dashes from accession and uses correct path', () => {
    const { primaryUrl } = buildForm4XmlUrl(CIK, ACC);
    expect(primaryUrl).toBe(
      `https://www.sec.gov/Archives/edgar/data/${CIK}/${ACC_NO_DASH}/${ACC_NO_DASH}.xml`
    );
  });

  test('indexUrl points to index.json', () => {
    const { indexUrl } = buildForm4XmlUrl(CIK, ACC);
    expect(indexUrl).toBe(
      `https://www.sec.gov/Archives/edgar/data/${CIK}/${ACC_NO_DASH}/index.json`
    );
  });

  test('returned object has both primaryUrl and indexUrl', () => {
    const result = buildForm4XmlUrl(CIK, ACC);
    expect(result).toHaveProperty('primaryUrl');
    expect(result).toHaveProperty('indexUrl');
  });
});

// ─── fetchForm4Xml ────────────────────────────────────────────────────────────

const PRIMARY_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/000119312525123456.xml';
const INDEX_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/index.json';
const INDEX_XML_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/form4.xml';
const SAMPLE_XML = '<ownershipDocument><documentType>4</documentType></ownershipDocument>';
const SAMPLE_INDEX = JSON.stringify({
  directory: {
    item: [{ name: 'form4.xml', type: '4' }],
  },
});

function makeRouteFetch(routes) {
  return jest.fn((url) => {
    if (routes[url]) return Promise.resolve(routes[url]);
    return Promise.reject(new Error(`No route for ${url}`));
  });
}

describe('fetchForm4Xml()', () => {
  test('primary URL returns 200 → returns XML string, index.json not called', async () => {
    const fetch = makeRouteFetch({
      [PRIMARY_URL]: { status: 200, text: async () => SAMPLE_XML },
    });
    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
    expect(result).toBe(SAMPLE_XML);
    // index.json should NOT have been called
    expect(fetch.mock.calls.map((c) => c[0])).not.toContain(INDEX_URL);
  });

  test('primary URL returns 404 → index.json fetched, XML URL from index returned', async () => {
    const fetch = makeRouteFetch({
      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
      [INDEX_URL]: { status: 200, text: async () => SAMPLE_INDEX },
      [INDEX_XML_URL]: { status: 200, text: async () => SAMPLE_XML },
    });
    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
    expect(result).toBe(SAMPLE_XML);
  });

  test('primary URL returns 404, index.json has no .xml item → returns null', async () => {
    const emptyIndex = JSON.stringify({ directory: { item: [{ name: 'readme.txt', type: '' }] } });
    const fetch = makeRouteFetch({
      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
      [INDEX_URL]: { status: 200, text: async () => emptyIndex },
    });
    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
    expect(result).toBeNull();
  });

  test('primary URL returns 404, index.json fetch fails → returns null, no throw', async () => {
    const fetch = makeRouteFetch({
      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
      // INDEX_URL not in routes → fetch rejects
    });
    await expect(fetchForm4Xml('0000320193', '0001193125-25-123456', fetch)).resolves.toBeNull();
  });

  test('both fetches fail → returns null, no throw', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    await expect(fetchForm4Xml('0000320193', '0001193125-25-123456', fetch)).resolves.toBeNull();
  });

  test('User-Agent header present on requests', async () => {
    const fetch = jest.fn((url, opts) =>
      Promise.resolve({ status: 200, text: async () => SAMPLE_XML })
    );
    await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
    const headers = fetch.mock.calls[0][1] || {};
    expect(headers['User-Agent']).toBe('EarlyInsider/1.0 (contact@earlyinsider.com)');
  });
});

// ─── parseForm4Xml ────────────────────────────────────────────────────────────

describe('parseForm4Xml() — fixture 1: standard buy', () => {
  let result;
  beforeAll(() => { result = parseForm4Xml(FIXTURE_STANDARD_BUY); });

  test('documentType is "4"', () => { expect(result.documentType).toBe('4'); });
  test('isAmendment is false', () => { expect(result.isAmendment).toBe(false); });
  test('issuer.ticker is NVDA', () => { expect(result.issuer.ticker).toBe('NVDA'); });
  test('issuer.name is NVIDIA CORP', () => { expect(result.issuer.name).toBe('NVIDIA CORP'); });
  test('owner.name is Jensen Huang', () => { expect(result.owner.name).toBe('Jensen Huang'); });
  test('owner.isOfficer is true', () => { expect(result.owner.isOfficer).toBe(true); });
  test('owner.officerTitle is President and CEO', () => {
    expect(result.owner.officerTitle).toBe('President and CEO');
  });
  test('nonDerivativeTransactions has length 1', () => {
    expect(result.nonDerivativeTransactions).toHaveLength(1);
  });
  test('transaction[0].transactionCode is P', () => {
    expect(result.nonDerivativeTransactions[0].transactionCode).toBe('P');
  });
  test('transaction[0].shares is 100000', () => {
    expect(result.nonDerivativeTransactions[0].shares).toBe(100000);
  });
  test('transaction[0].pricePerShare is 145.23 (number, not null)', () => {
    expect(result.nonDerivativeTransactions[0].pricePerShare).toBe(145.23);
  });
  test('transaction[0].acquiredDisposed is A', () => {
    expect(result.nonDerivativeTransactions[0].acquiredDisposed).toBe('A');
  });
  test('transaction[0].directOwnership is D', () => {
    expect(result.nonDerivativeTransactions[0].directOwnership).toBe('D');
  });
  test('derivativeTransactions is empty array', () => {
    expect(result.derivativeTransactions).toEqual([]);
  });
});

describe('parseForm4Xml() — fixture 2: amendment', () => {
  test('documentType is 4/A', () => {
    const result = parseForm4Xml(FIXTURE_AMENDMENT);
    expect(result.documentType).toBe('4/A');
  });
  test('isAmendment is true', () => {
    const result = parseForm4Xml(FIXTURE_AMENDMENT);
    expect(result.isAmendment).toBe(true);
  });
});

describe('parseForm4Xml() — fixture 3: gift (no pricePerShare element)', () => {
  test('transactionCode is G', () => {
    const result = parseForm4Xml(FIXTURE_GIFT_NO_PRICE);
    expect(result.nonDerivativeTransactions[0].transactionCode).toBe('G');
  });
  test('pricePerShare is null — NOT 0, NOT NaN (element absent from XML)', () => {
    const result = parseForm4Xml(FIXTURE_GIFT_NO_PRICE);
    expect(result.nonDerivativeTransactions[0].pricePerShare).toBeNull();
  });
});

describe('parseForm4Xml() — fixture 4: option exercise (derivative)', () => {
  test('derivativeTransactions has 1 item', () => {
    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
    expect(result.derivativeTransactions).toHaveLength(1);
  });
  test('derivativeTransactions[0].transactionCode is M', () => {
    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
    expect(result.derivativeTransactions[0].transactionCode).toBe('M');
  });
  test('nonDerivativeTransactions is empty', () => {
    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
    expect(result.nonDerivativeTransactions).toEqual([]);
  });
});

describe('parseForm4Xml() — fixture 5: multi-transaction', () => {
  test('nonDerivativeTransactions.length === 3', () => {
    const result = parseForm4Xml(FIXTURE_MULTI_TRANSACTION);
    expect(result.nonDerivativeTransactions).toHaveLength(3);
  });
});

describe('parseForm4Xml() — edge cases', () => {
  test('entity encoding: AT&amp;T INC decoded to AT&T INC', () => {
    const xml = FIXTURE_STANDARD_BUY.replace('NVIDIA CORP', 'AT&amp;T INC');
    const result = parseForm4Xml(xml);
    expect(result.issuer.name).toBe('AT&T INC');
  });

  test('namespace prefix: transactionDate still extracted correctly', () => {
    const xml = FIXTURE_STANDARD_BUY.replace(
      '<transactionDate><value>2025-04-15</value></transactionDate>',
      '<edgar:transactionDate><value>2025-04-15</value></edgar:transactionDate>'
    );
    const result = parseForm4Xml(xml);
    expect(result.nonDerivativeTransactions[0].transactionDate).toBe('2025-04-15');
  });

  test('missing issuerTradingSymbol → returns null', () => {
    const xml = FIXTURE_STANDARD_BUY.replace(
      '<issuerTradingSymbol>NVDA</issuerTradingSymbol>', ''
    );
    const result = parseForm4Xml(xml);
    expect(result).toBeNull();
  });

  test('malformed XML (empty string) → returns null, no throw', () => {
    expect(parseForm4Xml('')).toBeNull();
  });

  test('malformed XML (truncated mid-tag) → returns null, no throw', () => {
    expect(parseForm4Xml('<ownershipDocument><documentType>4</doc')).toBeNull();
  });

  test('comma-formatted share count parsed correctly (1,000 → 1000)', () => {
    const xml = FIXTURE_STANDARD_BUY.replace(
      '<transactionShares><value>100000</value></transactionShares>',
      '<transactionShares><value>1,000</value></transactionShares>'
    );
    const result = parseForm4Xml(xml);
    expect(result.nonDerivativeTransactions[0].shares).toBe(1000);
  });
});

// ─── Section 3: Transaction Classification ────────────────────────────────────

const {
  classifyTransaction,
  classifyInsiderRole,
  filterScorable,
  calculate10b5Plan,
} = require('../../n8n/code/insiderbuying/edgar-parser');

describe('classifyTransaction', () => {
  test.each([
    [{ transactionCode: 'P' }, 'purchase'],
    [{ transactionCode: 'S' }, 'sale'],
    [{ transactionCode: 'G' }, 'gift'],
    [{ transactionCode: 'F' }, 'tax_withholding'],
    [{ transactionCode: 'M' }, 'option_exercise'],
    [{ transactionCode: 'X' }, 'option_exercise'],
    [{ transactionCode: 'A' }, 'award'],
    [{ transactionCode: 'D' }, 'disposition'],
    [{ transactionCode: 'J' }, 'other'],
    [{ transactionCode: '?' }, 'other'],
  ])('code %s → %s', (tx, expected) => {
    expect(classifyTransaction(tx)).toBe(expected);
  });
});

describe('classifyInsiderRole', () => {
  test.each([
    ['Chief Executive Officer', 'CEO'],
    ['Principal Executive Officer', 'CEO'],
    ['CEO', 'CEO'],
    ['Chief Financial Officer', 'CFO'],
    ['Principal Financial Officer', 'CFO'],
    ['CFO', 'CFO'],
    ['President', 'President'],
    ['Co-President', 'President'],
    ['Chief Operating Officer', 'COO'],
    ['COO', 'COO'],
    ['Director', 'Director'],
    ['Board Member', 'Director'],
    ['Independent Director', 'Director'],
    ['Non-Executive Director', 'Director'],
    ['Vice President', 'VP'],
    ['VP', 'VP'],
    ['Senior Vice President', 'VP'],
    ['SVP', 'VP'],
    ['EVP', 'VP'],
    ['Executive Vice President', 'VP'],
    ['Treasurer', 'Other'],
  ])('%s → %s', (title, expected) => {
    expect(classifyInsiderRole(title)).toBe(expected);
  });

  test('null input → Other', () => {
    expect(classifyInsiderRole(null)).toBe('Other');
  });

  test('undefined input → Other', () => {
    expect(classifyInsiderRole(undefined)).toBe('Other');
  });
});

describe('filterScorable', () => {
  const makeTx = (code) => ({ transactionCode: code, shares: 100, pricePerShare: 10 });

  test('whitelist: only P and S pass through', () => {
    const txs = ['P', 'S', 'G', 'F', 'M', 'X', 'A', 'D'].map(makeTx);
    const result = filterScorable(txs);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.transactionCode)).toEqual(['P', 'S']);
  });

  test('empty array → empty array', () => {
    expect(filterScorable([])).toEqual([]);
  });

  test('all non-scorable codes → empty array', () => {
    const txs = ['G', 'F'].map(makeTx);
    expect(filterScorable(txs)).toEqual([]);
  });

  test('unknown future code Z is excluded (whitelist, not blacklist)', () => {
    const txs = [makeTx('Z'), makeTx('P')];
    const result = filterScorable(txs);
    expect(result).toHaveLength(1);
    expect(result[0].transactionCode).toBe('P');
  });
});

describe('calculate10b5Plan', () => {
  test('legacy element with value 1 → true', () => {
    const xml = '<nonDerivativeTransaction><rule10b5One><value>1</value></rule10b5One></nonDerivativeTransaction>';
    expect(calculate10b5Plan(xml)).toBe(true);
  });

  test('modern element with value true → true', () => {
    const xml = '<nonDerivativeTransaction><rule10b51Transaction><value>true</value></rule10b51Transaction></nonDerivativeTransaction>';
    expect(calculate10b5Plan(xml)).toBe(true);
  });

  test('modern element with value 1 (numeric form) → true', () => {
    const xml = '<nonDerivativeTransaction><rule10b51Transaction><value>1</value></rule10b51Transaction></nonDerivativeTransaction>';
    expect(calculate10b5Plan(xml)).toBe(true);
  });

  test('neither element present → false', () => {
    const xml = '<nonDerivativeTransaction><transactionDate><value>2025-01-01</value></transactionDate></nonDerivativeTransaction>';
    expect(calculate10b5Plan(xml)).toBe(false);
  });

  test('element present but value is 0 → false', () => {
    const xml = '<nonDerivativeTransaction><rule10b51Transaction><value>0</value></rule10b51Transaction></nonDerivativeTransaction>';
    expect(calculate10b5Plan(xml)).toBe(false);
  });
});
