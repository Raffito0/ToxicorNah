# Section 06: Always-On Service Architecture

## Overview

This section adds `run_forever()` to `main.py` so the bot runs 24/7 without manual restarts, implements atomic control-file writes for safe dashboard communication, and adds `check_new_phones()` to the executor for dynamic phone addition at day boundaries.

**Dependencies**: Sections 01-05 must be complete. All monitoring infrastructure (`telegram_monitor.py`), stock checking, and post retry logic must be in place before this section, since `run_forever()` calls `run_today()` which uses all of those.

**Blocks**: Sections 07 (multi-proxy) and 08 (E2E test) depend on this section.

---

## Tests First

Create `phone-bot/tests/test_run_forever.py` before implementing anything.

```python
# phone-bot/tests/test_run_forever.py

# Test: run_forever() calls run_today() once per day iteration
#   → mock run_today, mock wait_until_midnight (returns immediately), run 3 iterations via side_effect
#   → assert run_today call count == 3

# Test: run_forever() stops cleanly after control file contains {"action": "stop"}
#   → write control.json with {"action": "stop"} before starting
#   → assert run_today never called (stop detected before first iteration)
#   OR → set stop after first run_today call, assert run_today called exactly once

# Test: run_forever() does not interrupt an in-progress session — only checks between sessions
#   → control file is checked AFTER run_today() returns, not inside it
#   → mock: run_today takes 0s, control file written during run_today's execution
#   → assert that run_today completes before checking control file

# Test: atomic_write_control() writes a temp file then renames (no partial reads possible)
#   → call atomic_write_control({"action": "stop"})
#   → verify control.json exists and is valid JSON
#   → simulate: mock os.replace to capture temp path, verify temp file content before rename

# Test: run_forever() loads new phones added mid-run at the start of the next day
#   → mock check_new_phones() to add phone on second iteration
#   → assert check_new_phones() called at start of each run_today() cycle
```

Run with: `pytest phone-bot/tests/test_run_forever.py -v`

---

## Background and Context

The bot currently runs as a one-shot script: `python main.py` executes today's sessions and exits. For unattended 24/7 operation:

1. The process must survive between calendar days.
2. The next day's plan must be loaded/generated automatically at midnight.
3. A Flask dashboard (planned) needs to stop the bot without killing the process mid-session.
4. New phones added via dashboard must be picked up without a manual restart.

The solution is a `run_forever()` loop in `main.py` with a control file for external signals. This is deliberately simple — no FastAPI, no background threads, no IPC. The dashboard writes a JSON file; the bot reads it between sessions.

**Memory accumulation**: Each day's `run_today()` creates fresh bot instances per phone. This bounds memory growth to one day's worth of state. If memory issues arise, the Task Scheduler restart-on-failure (already planned) recovers automatically.

---

## Implementation

### `phone-bot/main.py` — Add three new functions and `--forever` CLI flag

**`run_forever()`**:

```python
def run_forever():
    """
    Daily loop: load/generate plan → run today → wait for midnight → repeat.
    Checks phone-bot/data/control.json between days for {"action": "stop"}.
    Gracefully finishes the current day before stopping.
    """
```

Loop logic:
1. Read `control.json`. If `{"action": "stop"}` → log and exit.
2. Call `load_or_generate_today_plan()`.
3. Call `run_today(plan)`.
4. Call `monitor.daily_summary()` (from Section 04).
5. Read `control.json` again (stop signal may have arrived during the day's run).
6. If stop → exit. Otherwise call `wait_until_midnight()` and loop.

**`wait_until_midnight()`**:

```python
def wait_until_midnight():
    """
    Sleeps until 00:05 the next calendar day (5-minute buffer after midnight
    to avoid plan-generation race with a midnight cron job).
    Uses time.sleep() in 60-second intervals to remain interruptible.
    """
```

Sleep in 60-second intervals rather than one long `time.sleep()` so a `KeyboardInterrupt` during the overnight wait terminates immediately. The 5-minute buffer (00:05 rather than 00:00) prevents a race condition where `run_forever()` wakes up at midnight and `load_or_generate_today_plan()` generates a plan for the wrong day.

**`atomic_write_control(data: dict)`**:

```python
def atomic_write_control(data: dict):
    """
    Writes data as JSON to phone-bot/data/control.json atomically.
    Uses os.replace() (atomic on Windows NTFS) to avoid partial reads.
    """
```

Write to a temp file in the same directory (`control.json.tmp`), then `os.replace(tmp, target)`. The same-directory requirement is critical — `os.replace()` is only atomic if source and destination are on the same filesystem/volume.

**`read_control() -> dict`**:

```python
def read_control() -> dict:
    """
    Reads phone-bot/data/control.json. Returns {} if file missing or invalid JSON.
    Never raises — a missing/corrupt control file is treated as "no command".
    """
```

**CLI flag**: Add `--forever` to the `argparse` block in `main.py`. When set, call `run_forever()` instead of `run_today()`.

```
python main.py --forever          # 24/7 mode
python main.py                    # existing one-shot mode (unchanged)
python main.py --dry-run          # from Section 08
```

---

### `phone-bot/data/control.json`

Create this file with default content:

```json
{"action": "none"}
```

The directory `phone-bot/data/` must exist. Create it with a `.gitkeep` if needed. Add `phone-bot/data/control.json` to `.gitignore` so production state is not committed.

Valid action values:
- `"none"` — continue normally
- `"stop"` — finish current day then exit

---

### `phone-bot/planner/executor.py` — Add `check_new_phones()`

```python
def check_new_phones():
    """
    Checks config.ACCOUNTS for phone IDs not present in warmup_state.json.
    Any new phone ID found is auto-enrolled into warmup phase.
    Warmup enrollment = write initial entry to warmup_state.json with
    start_date = today, warmup_days = random.randint(5, 8).
    Logs discovery of new phones at INFO level.
    """
```

Call site: at the very beginning of `run_today()`, before stock check and before iterating sessions. This ensures a phone added overnight is enrolled in warmup before any sessions run that day.

**`load_or_generate_today_plan()` wrapper**:

```python
def load_or_generate_today_plan() -> WeeklyPlan:
    """
    Loads today's plan from output/weekly_plan_YYYY-WNN.json if it exists.
    If the file is missing or today's date is not in the loaded plan,
    generates a fresh weekly plan and saves it.
    Returns the DailyPlan for today.
    """
```

This is the function `run_forever()` calls at the top of each daily iteration. Centralizes plan-loading logic so `main.py` doesn't need to know about plan file paths.

---

## Data Directory

```
phone-bot/data/
    control.json          # dashboard control file (gitignored)
    .gitkeep              # keeps directory in git
```

Add to `phone-bot/.gitignore`:
```
data/control.json
```

---

## Control File Protocol

The dashboard (Flask, planned) writes to `control.json` using `atomic_write_control()`. The bot reads it in two places:

1. **At the start of each daily loop iteration** (before `run_today()`).
2. **After `run_today()` completes** (before sleeping until midnight).

The bot does NOT check `control.json` during a session — interrupting a session mid-post is more dangerous than finishing cleanly.

---

## Sequence Diagram

```
main.py --forever
  └── run_forever()
        ├── read_control() → "none"
        ├── load_or_generate_today_plan()
        ├── executor.run_today(plan)
        │     ├── check_new_phones()
        │     ├── check_content_stock()        [Section 05]
        │     ├── for each session:
        │     │     ├── monitor.session_start() [Section 04]
        │     │     ├── ... proxy, scroll, post ...
        │     │     └── monitor.session_result()[Section 04]
        │     └── (returns)
        ├── monitor.daily_summary()             [Section 04]
        ├── read_control() → "none"
        ├── wait_until_midnight()
        └── (loop)
```

---

## Manual Validation

After implementation, validate the control file stop sequence:

```bash
# Terminal 1: start forever mode in test environment
PHONEBOT_TEST=1 python phone-bot/main.py --forever

# Terminal 2: write stop command atomically
python -c "
import json, os
with open('phone-bot/data/control.json.tmp', 'w') as f:
    json.dump({'action': 'stop'}, f)
os.replace('phone-bot/data/control.json.tmp', 'phone-bot/data/control.json')
print('stop written')
"

# Verify: Terminal 1 exits cleanly after current day completes
```

---

## Files Modified/Created (Actual)

| Action | File | Change |
|--------|------|--------|
| Modify | `phone-bot/main.py` | Added `run_forever()`, `wait_until_midnight()`, `atomic_write_control()`, `read_control()`, `--forever` CLI flag. `_CONTROL_PATH` uses `DATA_DIR`. |
| Modify | `phone-bot/planner/executor.py` | Added `check_new_phones()` on SessionExecutor, wired into `run_today()` before warmup phase. |
| Create | `phone-bot/tests/test_run_forever.py` | 17 tests covering control file, loop behavior, check_new_phones logic, time calculations. |

### Deviations from Plan

1. **`load_or_generate_today_plan()` not created** — `run_today()` already calls `load_weekly_plan()` internally. A separate wrapper would duplicate logic. `run_forever()` creates a fresh `SessionExecutor` each day which handles plan loading.
2. **`daily_summary()` not called in run_forever** — Requires session count accumulation infrastructure not yet built. TelegramMonitor.daily_summary() exists (section-04) but DailySummary data aggregation is deferred.
3. **No `data/control.json` default file** — `read_control()` handles missing file gracefully (returns {}). No `.gitkeep` needed since data/ already exists.
4. **`wait_until_midnight()` improved** — Recomputes remaining time each 60s iteration (no drift). Uses `<=` for 00:05 edge case.
5. **`check_new_phones()` called in both paths** — Wired into `run_today()` (always runs) and additionally in `run_forever()` before each day.
6. **17 tests instead of 5** — Added tests for check_new_phones logic, daily_summary call tracking, missing control file, and edge cases.

---

## Acceptance Criteria

- [x] `pytest phone-bot/tests/test_run_forever.py -v` — all 17 tests pass
- [ ] `python main.py --forever` runs daily loop without error in TEST_MODE
- [ ] Writing `{"action": "stop"}` to `control.json` causes clean exit after current day
- [ ] `KeyboardInterrupt` during `wait_until_midnight()` terminates immediately
- [x] New phone added to `config.ACCOUNTS` is auto-enrolled in warmup at next day start
