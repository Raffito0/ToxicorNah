# Interview -- 05 Personality + Timing Presets + Niche Config

## Note
User was unavailable for interview. Decisions made based on the detailed spec file and existing codebase patterns. All architectural choices follow the patterns established in previous sections (01-04).

## Implicit Decisions (from spec + codebase)

### Q1: Where do personality edits go?
**A:** Phone-settings page, inside a TikTok-specific tab per account. Consistent with warmup panel placement (section 06 of spec 04).

### Q2: Should personality history be stored for evolution graphs?
**A:** Add `personality_history_json` to BotAccount -- array of {session_num, date, traits} snapshots. Max 30 entries (rolling window). Written by the executor after each session's drift.

### Q3: Chart.js or custom canvas?
**A:** Chart.js via CDN (lightweight, well-documented, dark theme support).

### Q4: Timing editor -- same page or separate?
**A:** Separate page `/timing-editor` (72 params is too much for a modal). Link from phone settings.

### Q5: How to handle timing preset application?
**A:** Preset fills all params. Per-bot overrides saved to TimingOverride table. Override badge shows count of modified params.

### Q6: Niche config location?
**A:** Same phone-settings page, below personality section. Simple text fields + tag input.

### Q7: Session phase weights -- editable?
**A:** Display-only for now (spec says editable but the complexity of validating weight sums + the fact that phases are hardcoded in config.py makes it better as read-only v1).
