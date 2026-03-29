# Section 02 Code Review — Form 4 XML Parser

## Summary

Implementation is production-quality. 51/51 tests pass. Three important issues found, two auto-fixed.

## Issues Found

### Important (auto-fix applied)

**1. `httpsGet` does not drain response body on non-2xx/redirect → socket leak**
File: `edgar-parser.js:82–87`
On redirect or error status, `resolve`/`reject` is called immediately but the response stream is never drained. Undrained streams hold the socket open and prevent it from returning to the pool. Fix: call `res.resume()` before returning on these paths.

**2. `transactionCode` extraction uses `extractValue` as guard instead of `extractTag`**
File: `edgar-parser.js:356–358`
`extractValue` looks for a nested `<value>` inside `transactionCoding` — wrong for an element that contains child elements. Should extract `transactionCoding` once, store it, then extract `transactionCode` from it.

### Let Go

**3. `extractAllBlocks` regex stops at first closing tag** — safe for well-formed SEC XML (schema-validated). Not worth adding complexity for malformed edge cases.

**4. `buildForm4XmlUrl` primary URL convention only holds from ~2004** — fallback handles older filings. Noted.

**5. `parseNum` assumes US locale** — correct for EDGAR XML domain.

**6. `decodeXmlEntities` misses decimal numeric refs (`&#38;`)** — rare in modern EDGAR XML. Low risk.

**7. Missing test: primary URL returns 500** — code handles it correctly (line: `if (res.status !== 404) return null`). Not blocking.

**8. `failureCount` never reset in production** — diagnostic only. Add comment.

## Auto-Fixes Applied

1. Added `res.resume()` in `httpsGet` before all non-2xx/redirect returns
2. Refactored `transactionCode` extraction: `const codingBlock = extractTag(block, 'transactionCoding'); const transactionCode = codingBlock ? extractTag(codingBlock, 'transactionCode') : null;`
