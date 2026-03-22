# TDD Plan -- 04 Unified Planner + Warmup

## Testing Approach

**Framework:** pytest (recommended for Python Flask projects)
**Location:** `insta-phone-SAAS-sneder/tests/` for service/route tests, `Weekly & Daily Plan/tests/` for planner tests
**Naming:** `test_{module}.py`
**Fixtures:** conftest.py per test directory
**Run:** `pytest tests/` from respective project root

The existing planner has `validate.py` (21 rule checks) and `stress_test.py` (20 runs). These remain as integration/validation tools. New tests use pytest for unit testing.

---

## 2. Planner Refactoring

### 2.1 Account Parameterization

```python
# Test: generate_weekly_plan accepts accounts list and produces valid plan
# Test: generate_weekly_plan with 2 accounts (1 phone) produces valid plan
# Test: generate_weekly_plan with 8 accounts (4 phones) produces valid plan
# Test: PHONES list derived correctly from accounts param
# Test: _assign_weekly_special_days works with dynamic accounts
# Test: generate_daily_plan works with dynamic accounts
# Test: validate_cross_phone works with dynamic phone list
# Test: personality state passed in, updated, and returned (no file I/O)
# Test: config.ACCOUNTS is not imported in scheduler.py call path
```

### 2.2 Warmup Session Interleaving

```python
# Test: warmup account (day 1) gets session_type='warmup' with scroll_only=True caps
# Test: warmup account (day 3) gets engagement_caps with likes=(0,10)
# Test: warmup account (dead day) returns None from _build_session
# Test: warmup account (lazy day) gets session_type='warmup_lazy', duration 3-5 min
# Test: warmup account gets max 1 session/day (never 2)
# Test: warmup account never gets aborted/extended session types
# Test: mixed plan with 3 warmup + 3 regular accounts has correct session types
# Test: engagement_caps key present in warmup session dict, None in regular session dict
# Test: warmup sessions get normal time slot assignment (no special weighting)
```

### 2.4 Mid-Week Regeneration

```python
# Test: regenerate_from_date preserves Mon-Tue sessions when regenerating from Wednesday
# Test: regenerate_from_date produces new sessions for Wed-Sun
# Test: account summaries recalculated from all days (old + new)
# Test: new phone added mid-week appears in regenerated days only
```

---

## 3. Service Layer

### 3.1 Planner Service

```python
# Test: generate_weekly_plan queries accounts by proxy_id from DB
# Test: generate_weekly_plan stores plan in WeeklyPlan table
# Test: generate_weekly_plan UPSERTS (updates existing row, no constraint violation)
# Test: generate_weekly_plan converts Eastern times to UTC in plan_json
# Test: get_today_sessions returns sessions for current date with execution_status
# Test: get_today_sessions returns empty list when no plan exists
# Test: get_current_plan returns active plan for proxy group
# Test: field name mapping: planner "account" -> API "account_name"
# Test: field name mapping: planner "type" -> API "session_type"
# Test: personality state read from BotAccount.personality_json
# Test: personality state written back after generation
```

### 3.2 Session Status Enrichment

```python
# Test: session_id format is "{date}_{account}_{session_num}"
# Test: session with matching SessionLog entry gets status='completed'
# Test: session with started_at but no ended_at gets status='running'
# Test: session with no SessionLog entry gets status='planned'
# Test: session with error status in SessionLog gets status='failed'
```

### Warmup Service

```python
# Test: get_warmup_status reads from BotAccount.warmup_json
# Test: update_warmup reset sets current_day=0, regenerates plan
# Test: update_warmup skip advances to target_day
# Test: update_warmup complete sets completed=True
# Test: warmup state persisted to BotAccount.warmup_json after update
```

---

## 4. API Routes

```python
# Test: GET /api/planner/weekly-plan returns plan JSON
# Test: GET /api/planner/weekly-plan returns 404 when no plan exists
# Test: POST /api/planner/weekly-plan/generate returns 201 with plan
# Test: POST /api/planner/weekly-plan/generate returns 400 on planner error
# Test: POST /api/planner/weekly-plan/regenerate returns updated plan
# Test: GET /api/planner/today-sessions returns sessions list
# Test: GET /api/planner/warmup/<account> returns warmup status
# Test: POST /api/planner/warmup/<account>/reset returns updated status
# Test: GET /api/planner/weekly-plan/export returns downloadable JSON
# Test: all routes require @login_required (401 without auth)
```

---

## 5. Frontend

### 5.1 Timeline Rendering (manual/visual testing)

```
# Verify: session blocks positioned proportionally by start/end time
# Verify: TikTok sessions are blue (#25F4EE), Instagram sessions are pink (#E1306C)
# Verify: warmup sessions have dashed border
# Verify: clicking a block opens detail modal with correct data
# Verify: current time marker (red line) updates position
# Verify: completed sessions show green checkmark
# Verify: running sessions show pulse animation
# Verify: failed sessions show red X
```

### 5.2 Polling

```javascript
// Test: pollLoop calls /api/planner/today-sessions
// Test: pollLoop uses setTimeout (not setInterval) for next call
// Test: updateSessionStatuses updates DOM status indicators
// Test: polling pauses when tab is not visible (optional optimization)
```

### 5.3 Week Overview

```
# Verify: 7 columns for Mon-Sun
# Verify: rest days highlighted orange
# Verify: Generate button calls POST /api/planner/weekly-plan/generate
# Verify: week navigation updates displayed week
```

---

## 6. Executor Modifications

### 6.1 DB Plan Reading

```python
# Test: executor loads plan from WeeklyPlan table (not JSON file)
# Test: executor converts UTC times to Eastern for scheduling
# Test: executor parses ISO 8601 datetime strings correctly
# Test: executor handles missing plan gracefully (no crash)
```

### 6.2 Warmup State from DB

```python
# Test: load_warmup_state reads from BotAccount.warmup_json
# Test: save_warmup_state writes to BotAccount.warmup_json
# Test: advance_warmup_day increments current_day and updates caps
# Test: warmup_state.json is not read or written
```

### 6.3 SessionLog Writing

```python
# Test: executor writes session_id to SessionLog on start
# Test: executor updates SessionLog with ended_at and status on completion
# Test: executor writes error_message on failure
# Test: SessionLog.session_id matches plan's deterministic ID
```

---

## 7. Database

```python
# Test: WeeklyPlan UPSERT works (insert first, update second call)
# Test: WeeklyPlan unique constraint on (proxy_id, week_number, year)
# Test: BotAccount.warmup_json round-trips AccountWarmupState correctly
# Test: BotAccount.personality_json round-trips personality dict correctly
# Test: SQLite WAL mode is enabled at startup
```

---

## 8. Integration Tests

```python
# Test: full flow -- generate plan, read today sessions, verify structure
# Test: full flow -- generate plan, regenerate from mid-week, verify preservation
# Test: full flow -- warmup account in plan has correct caps, advance day, regenerate
# Test: existing validate.py passes on generated plan (21 rule checks)
# Test: timezone round-trip -- Eastern -> UTC -> Eastern produces same time
```
