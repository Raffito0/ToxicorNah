# Section 01 Code Review Interview

## Asked user:
- **Unknown trait validation**: User chose strict validation (400 for unknown traits). Applied.

## Auto-fixed:
- **Test imports PERSONALITY_RANGES from source** instead of duplicating.
- **GET clamps values from DB** via _clamp_traits() to prevent out-of-range display.
- **PUT returns 400 for unknown trait keys** with descriptive error message.
- **Added test for unknown trait rejection**.

## Let go:
- Reset clears locks: matches plan spec exactly.
- History on randomize/reset: not in spec, add later if chart needs it.
- `categorical` field omitted: not defined in plan's implementation section.
