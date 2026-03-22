# Section 05 -- Niche Config (API + Frontend)

## Overview
Niche configuration API (GET/PUT on BotAccount.niche_json) and frontend UI in phone-settings: description textarea, keywords tag input, threshold slider, session count slider.

## Dependencies
- None (fully parallel). Uses existing BotAccount.niche_json column.

## API (in `personality_routes.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/accounts/<id>/niche` | Get niche config |
| PUT | `/api/accounts/<id>/niche` | Update niche (partial) |

### PUT Validation
- `follow_threshold`: clamp to [40, 70]
- `session_keywords_count`: clamp to [4, 12]
- `keywords`: must be array of strings
- Partial update: merge with existing niche_json
- `flag_modified(account, 'niche_json')` before commit

## Frontend (phone-settings.html + personality.js)

### HTML Section
- Niche description textarea (3 rows, dark theme)
- Keywords tag input: badges with X remove, text input for adding
- Follow-back threshold slider (40-70, step 1)
- Session keywords count slider (4-12, step 1)
- Suggested keywords dropdown (hardcoded from DEFAULT_NICHE)
- Save Niche button

### JavaScript Functions
- `loadNiche(accountId)` -- GET, populate fields
- `saveNiche(accountId)` -- collect values, PUT
- `renderKeywordTags(keywords)` -- badge elements with remove handlers
- `addKeyword(input)` -- Enter/comma adds tag
- `removeKeyword(keyword)` -- filter and re-render

## Tests (`tests/test_niche_routes.py`)
```python
# Test: GET returns niche config
# Test: GET with NULL returns defaults
# Test: PUT updates description + keywords + threshold
# Test: threshold clamped to 40-70
# Test: session_keywords_count clamped to 4-12
# Test: keywords stored as array
# Test: routes require login
```
