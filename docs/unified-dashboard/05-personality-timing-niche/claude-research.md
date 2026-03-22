# Research -- 05 Personality + Timing Presets + Niche Config

## Personality System
- 7 numeric traits + 2 categorical (dominant_hand, comment_style) in `Personality` dataclass
- Stored in `BotAccount.personality_json` and `phone-bot/data/memory_*.json`
- Drift: `PERSONALITY_DRIFT = 0.015` (max 1.5% per session based on actual behavior)
- Ranges defined in `config.PERSONALITY_RANGES`
- `Personality.generate()` creates fresh random, `drift(session_stats)` evolves

## Timing Parameters (72 total)
- Format: `(median, sigma, min, max)` log-normal tuples in `config.HUMAN`
- Sampling: `_lognormal(median, sigma, min, max)` via `HumanEngine.timing(name)`
- Categories: core behavior (9), inline action (44), touch physics (4), legacy (15)
- 4 presets seeded: Normal (1.0x), Cautious (1.3x), Aggressive (0.7x), Stealth (1.5x action)

## DB Models (already exist)
- `TimingPreset`: name, description, params_json, is_default
- `TimingOverride`: bot_id + param_name (unique), median/sigma/min/max
- `BotAccount`: personality_json, niche_json, warmup_json
- `Bot.timing_preset_id` FK to TimingPreset

## Config Translation (`tiktok_config.py`)
- `build_timing_config(preset, overrides)`: merge preset + overrides
- `apply_config_to_module()`: monkey-patches phone-bot config at runtime

## Niche Config
- `NICHE_DESCRIPTION`, `NICHE_KEYWORDS_POOL` (21 keywords), `NICHE_FOLLOW_THRESHOLD` (55)
- Stored in `BotAccount.niche_json`
- Session samples 6-10 keywords per session
- Threshold formula: `base - social*10 + fatigue*5, clamped [40,70]`

## Session Phases
- 5 phases: Arrival, Warmup, Peak, Fatigue, Exit in `config.SESSION_PHASES`
- Fixed weights per phase, not yet exposed to DB

## API Pattern
- All endpoints: `@login_required`, return `{success, message, data}`
- CRUD: GET list, POST create, PUT update, DELETE
- Existing: `/api/bots/<id>/accounts/<id>/settings`

## Testing
- No pytest framework in Flask app
- Phone-bot has test files but no formal framework
- Manual validation via scripts
