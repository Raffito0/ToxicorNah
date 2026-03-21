# Code Review: Section 01 — Environment Configuration

## Issues Found

1. **Docstring says "15 required vars" but REQUIRED_VARS has 13** — test docstring inherited wrong count from plan. Test assertion is correct (checks 13 vars), but docstring is misleading.

2. **setup_env.py step counter broken**: shows "[4/4]" then "[5/5]" (jumped). Should be "[1/5]...[5/5]" throughout.

3. **test_importerror_stub_does_not_assign_push_to_phone uses fragile indentation-based block detection** — works for current single-line stub but would break for multi-line blocks or trailing blank lines. Should use AST (the `ast` import is already there but unused).

4. **conftest.py lacks shared fixtures** — plan calls for `mock_env`, `mock_airtable`, `mock_adb` fixtures in conftest. Current tests define inline fixtures instead.

5. **Only AIRTABLE_API_KEY tested for missing var** — no test for middle/end vars in REQUIRED_VARS list.

6. **.env.template ADB comment still references push_to_phone** — should be "Not used by phone-bot — executor manages ADB connections internally."

7. **setup_env.py uses os.environ.setdefault** — silently ignores already-set shell vars. Production risk: stale shell env var overrides correct .env value.

## Triage

**Auto-fix**: #2 (broken counter), #6 (misleading comment), #7 (setdefault footgun)
**Defer**: #1 (docstring cosmetic), #3 (works correctly, just fragile), #4 (no shared fixtures yet — later sections will add them to conftest as needed), #5 (low regression risk for now)
