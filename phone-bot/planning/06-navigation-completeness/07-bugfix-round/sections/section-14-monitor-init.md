<!--forge
forge:
  risk_level: medium
  autonomy_gate: continue
  solutions_md_checked: []
  solutions_md_match: []
  solution_selected:
    approach: "TBD -- filled by forge_planner analysis"
    score: 0
  test_protocol:
    type: "physical_device"
    pre_condition: "FYP must be visible on phone"
    commands:
      - "scrcpy --record tmp_forge_{section}.mkv"
      - "python phone-bot/main.py --test {mode} --phone 3"
    frame_extraction: "ffmpeg -y -i {mkv} -vf fps=0.5,scale=720:-2 {frames}/f_%03d.jpg"
    pass_threshold: "3"
    scenarios:
      - "FYP"
      - "Following"
      - "Explore"
      - "Shop"
    gemini_analysis: true
  regression_scope: []
  cross_section_deps: []
  attempt_count: 0
forge-->

# Section 14 — Monitor Not Initialized in Test Mode

## Overview

Every `--test` run in `main.py` pollutes the logs with repeated `"Monitor not initialized, event dropped: action"` warnings because `init_monitor()` is called by the production executor (`planner/executor.py`) but never called by any of the test harness functions. The fix is to call `init_monitor()` at the start of each test function, pointing it at a temporary directory.

**Priority**: LOW. No device needed. No scrcpy recording needed. Log inspection only.

---

## Files Modified

- `phone-bot/main.py` — primary: add `init_monitor()` call to every test function
- `phone-bot/core/monitor.py` — optional: add `test_mode=True` convenience param (Option B)

---

## Test (Before Implementing)

```
Before fix: grep log output for "Monitor not initialized, event dropped"
  → appears once per bot action (could be dozens per test run)

After fix: ZERO "Monitor not initialized" messages in log output
  → event log file created at temp path
  → structured events recorded normally
```

Verification steps:
1. Run any existing test mode (e.g. `--scroll-only --phone 4`)
2. Observe logs — count occurrences of `"Monitor not initialized, event dropped"`
3. Apply fix
4. Run the same test mode again
5. Confirm zero occurrences of that warning
6. Confirm a `.jsonl` event file was created under the temp events directory

---

## Implementation Details

### Background

`core/monitor.py` exposes a module-level `init_monitor(events_dir, screenshots_dir)` function that creates the global `EventLogger` instance. The `log_event()` function — called throughout `actions/tiktok.py` on every action — checks for `_default_logger is None`:

```python
# core/monitor.py
def log_event(event: BotEvent, screenshot_bytes: bytes | None = None):
    if _default_logger is None:
        log.warning("Monitor not initialized, event dropped: %s", event.event_type)
        return
```

### Two Implementation Options

**Option A — Pass temp directories (simpler, no monitor.py changes):**

```python
from .core.monitor import init_monitor
import os, tempfile

_test_base = os.path.join(tempfile.gettempdir(), "phone_bot_test")
init_monitor(
    events_dir=os.path.join(_test_base, "events"),
    screenshots_dir=os.path.join(_test_base, "screenshots"),
)
```

**Option B — Add `test_mode=True` param to `init_monitor()` (cleaner call site):**

Modify `core/monitor.py`:

```python
def init_monitor(events_dir=None, screenshots_dir=None, test_mode=False, **kwargs):
    """
    Initialize the global event logger.
    If test_mode=True, uses temp directories automatically.
    """
```

When `test_mode=True`, auto-compute temp dirs using `tempfile.mkdtemp()`, so each call from `main.py` is simply:

```python
from .core.monitor import init_monitor
init_monitor(test_mode=True)
```

Either option is acceptable. Option B is slightly cleaner for `main.py` callers.

### Test Functions That Need the Call

Every function in `main.py` that creates a `TikTokBot` needs `init_monitor()` called before the `TikTokBot(adb, human)` line:

| Function | Needs Monitor Call? |
|---|---|
| `run_scroll_only()` | Yes |
| `run_like_test()` | Yes |
| `run_browse_test()` | Yes |
| `run_scroll_test()` | Yes |
| `run_tap_test()` | Yes |
| `run_action_test()` | Yes |
| `test_devices()` | No (no `TikTokBot` created) |

New test functions added by other sections in this bugfix round also need the call.

### Placement Within Each Function

Insert the `init_monitor()` call after `HumanEngine` is created but before `TikTokBot(adb, human)`:

```python
async def run_scroll_only(controllers, phone_id, duration_min=5):
    if phone_id not in controllers:
        ...
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(...)

    from .core.monitor import init_monitor  # or add to file-level imports
    init_monitor(test_mode=True)            # Option B

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)
    ...
```

The import can be moved to file-level imports at the top of `main.py` — no circular import risk since `core/monitor.py` does not import from `main.py`.

### Windows Path Note

On Windows, `tempfile.gettempdir()` returns `C:\Users\<user>\AppData\Local\Temp` — works correctly. If using Option A explicitly, always use `tempfile.gettempdir()` rather than `/tmp/`. Option B handles this automatically via `tempfile.mkdtemp()`.

---

## Dependencies

None. This section is fully independent.

Other sections in this bugfix round reference `init_monitor(test_mode=True)` as a prerequisite for their own test functions. This section must be completed before those test functions are run, but can be implemented in any order relative to the other code fixes.

---

## Verification

Run any existing test mode after applying the fix:

```bash
python main.py --scroll-only --phone 4 --duration 2
```

Check log output:
- BEFORE fix: `"Monitor not initialized, event dropped: action"` appears multiple times
- AFTER fix: zero occurrences of that string
- AFTER fix: a `.jsonl` file exists under the temp events directory with structured event records
