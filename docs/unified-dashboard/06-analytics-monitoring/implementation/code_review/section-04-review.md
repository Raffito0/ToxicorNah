# Section 04 Code Review

## Issues Found & Fixed During Development
1. **`urllib.request.urlencode`** — wrong module, fixed to `urllib.parse.urlencode`
2. **Cache dict rebinding** — `_stock_cache = {...}` created a new dict, breaking test imports. Fixed to mutate in place: `_stock_cache["data"] = ...`

## Verified
- 6/6 tests pass
- Cache TTL works correctly
- Stale fallback returns `cache_stale: True`
- `videos_per_day=0` returns `None` for days
- Blueprint registered in `__init__.py`
