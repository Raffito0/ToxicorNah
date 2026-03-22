# TDD Plan -- 05 Personality + Timing + Niche

## Testing Approach
Framework: pytest. Location: `insta-phone-SAAS-sneder/tests/`

## 2. Personality API
```python
# Test: GET /api/accounts/<id>/personality returns traits + history
# Test: PUT /api/accounts/<id>/personality updates specific traits
# Test: PUT /api/accounts/<id>/personality validates range bounds
# Test: POST /api/accounts/<id>/personality/randomize generates new traits within bounds
# Test: POST /api/accounts/<id>/personality/reset restores defaults
# Test: PUT /api/accounts/<id>/personality/lock toggles trait lock
# Test: locked traits not modified on randomize
# Test: history limited to 30 entries (rolling window)
# Test: all routes require @login_required
```

## 3. Timing API
```python
# Test: GET /api/timing/presets returns 4 default presets
# Test: GET /api/bots/<id>/timing returns preset + overrides
# Test: PUT /api/bots/<id>/timing/preset changes bot's preset
# Test: POST /api/bots/<id>/timing/override creates/updates override
# Test: DELETE /api/bots/<id>/timing/override/<param> removes override
# Test: DELETE /api/bots/<id>/timing/overrides clears all
# Test: POST /api/timing/presets creates custom preset
# Test: override values persist and merge with preset
```

## 4. Niche API
```python
# Test: GET /api/accounts/<id>/niche returns config
# Test: PUT /api/accounts/<id>/niche updates description + keywords + threshold
# Test: threshold clamped to 40-70 range
# Test: keywords stored as array in niche_json
```

## 5-7. Frontend (visual verification)
```
# Verify: 7 trait sliders positioned with correct ranges
# Verify: Chart.js evolution graph renders with mock data
# Verify: lock toggle changes icon and prevents slider edit
# Verify: timing editor groups 72 params into 7 categories
# Verify: distribution preview shows 5 sample dots
# Verify: override badge appears when param differs from preset
# Verify: niche keywords render as removable tags
# Verify: phase display shows 5 colored segments
```
