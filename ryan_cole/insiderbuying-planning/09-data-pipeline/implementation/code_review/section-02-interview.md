# Section 02 Interview — Form 4 XML Parser

## Triage Decisions

No user interview required — all items were either auto-fixes or let-go.

## Auto-Fixes Applied

**Fix 1: `httpsGet` socket drain**
- Added `res.resume()` before all non-2xx/redirect returns in `httpsGet`
- Prevents socket exhaustion under load

**Fix 2: `transactionCode` extraction refactored**
- `extractValue(block, 'transactionCoding')` was wrong guard (looks for nested `<value>`, not present in transactionCoding)
- Replaced with: `const codingBlock = extractTag(block, 'transactionCoding'); const transactionCode = codingBlock ? extractTag(codingBlock, 'transactionCode') : null;`
- Cleaner, one fewer regex call, correct intent

## Tests After Fixes

51/51 pass. No regressions.
