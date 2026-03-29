# Section 01 Code Review Interview

## Auto-fixes Applied

### Fix A1: Factor 5 second tier — explicit `historicalCount >= 2` guard added
- Added `&& historicalCount >= 2` to the second tier condition: `else if (historicalAvgReturn > 10 && historicalCount >= 2)`
- **Why**: The outer guard already protects both branches, but the spec explicitly states the count requirement per tier. Making it explicit prevents silent regression if the outer guard is ever relaxed.

### Fix A2: Factor 1 — added inline comment explaining `> 0` guard intent
- Added comment: `// Guard: negative/zero treated as missing data — skip factor without penalty`
- **Why**: The intent of guarding on `> 0` vs `!= null` was not documented. Future editors would not understand why negative values are skipped silently rather than penalized.

### Fix A3: Fixture bounds tightened
- Fixture 6: `<= 8` → `<= 7` (actual output: 6.7)
- Fixture 8: `<= 7` → `<= 6` (actual output: 5.8)
- Fixture 10: `<= 6` → `<= 5` (actual output: 4.5)
- **Why**: Overly wide bounds cannot catch score regressions. Tightened to match formula arithmetic.

## Decisions Let Go

### I1: Mega-cap threshold $100B vs spec text $200B
- Reviewer flagged: spec TEXT says `>= $200B` for mega-cap; implementation uses `>= $100B`.
- **Decision: Let go.** The spec TEST explicitly says `$100_000_000_000 (mega-cap) → +0.6`. When spec text and spec test conflict, the test is authoritative — it represents the intended behavior. Using $100B is correct per the test contract. The text description contains a typo.

### I2: S sale scoring same as P purchase
- The formula does not distinguish transaction direction (S vs P). Sales score the same as buys of equal value.
- **Decision: Let go.** The spec does not distinguish direction in the base score; Fixture 4 explicitly verifies this. Direction-based adjustment is reserved for AI refinement (Section 02).
