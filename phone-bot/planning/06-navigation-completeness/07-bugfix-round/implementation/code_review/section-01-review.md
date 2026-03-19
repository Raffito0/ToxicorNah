# Code Review: section-01-story-exit

## Summary

3-layer Story fix is structurally correct and matches the spec.

## Issues Found and Resolution

### CRITICAL (fixed): `discover_devices()` ran before coord-audit dispatch
**Problem**: The static `--test story-coord-audit` (no phone needed) was placed AFTER `discover_devices()` + `sys.exit(1)`, making it impossible to run without a connected phone.
**Fix**: Moved `story-coord-audit` dispatch BEFORE `discover_devices()`.

### False alarm from reviewer: "3 of 4 story coords missing"
**Reviewer claimed**: `story_tap_next`, `story_tap_prev`, `story_close` don't exist in coords.py.
**Verified false**: All 4 coords exist at lines 47, 65-67 of `coords.py`. Reviewer did not read the actual file.

### LOW (fixed): Verbose logging not enabled for `--test story-exit`
**Fix**: Added `args.test` to the verbose logging condition.

### MEDIUM (accepted): `async def run_story_exit_test` is consistent with codebase
Reviewer flagged this as unnecessary. However ALL other phone test functions in main.py are `async def` called via `asyncio.run()`. This is the established pattern.

### LOW (accepted): Non-story path has implicit fallthrough
When `classification != 'story'` on `attempt == 1`, code hits `break` then falls through to `return False`. This is correct and the pre-existing code pattern.

### LOW (accepted): Invariant guard silent failure path
When `sy >= 0.80 * screen_h`: logs CRITICAL, skips tap, still calls `_exit_story_safely()`. Behavior is correct — we're confirmed in Story, can't tap safely, so we BACK out.

## Final Verdict

All critical issues resolved. Implementation matches spec. Ready to commit.
