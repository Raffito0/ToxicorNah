# Section 08: End-to-End Integration Test (Dry Run)

## Overview

This section adds a `--dry-run` flag to `main.py` that enables safe full-pipeline validation without writing to Airtable or actually posting to social platforms. It is the final integration gate that validates every prior section working together: env config, delivery logic, post retry, Telegram monitoring, stock checks, always-on lifecycle, and multi-proxy routing.

**Dependencies**: Requires sections 01 through 07 to be complete.

**Test runner**: `pytest phone-bot/tests/test_dry_run.py -v`

---

## What Dry-Run Does and Doesn't Do

**DOES**:
- Calls `get_next_video()` and `download_video()` (read-only Airtable operations)
- Sends real Telegram notifications (verifies monitoring end-to-end)
- Opens the app via ADB and scrolls (shortened to 30s)
- Opens the post screen and verifies the video is selectable

**DOES NOT**:
- Call `mark_posted()`, `mark_draft()`, or `mark_skipped()` (no Airtable writes)
- Actually tap the Post / Share button
- Call the proxy rotation API (simulated/logged only)

---

## Tests First

Create `phone-bot/tests/test_dry_run.py` before touching `main.py` or `executor.py`.

```python
# phone-bot/tests/test_dry_run.py

# Test: --dry-run flag is accepted by main.py CLI without raising SystemExit
#   → build_arg_parser().parse_args(['--dry-run', '--phone', '1'])
#   → assert args.dry_run is True

# Test: in dry-run mode, mark_posted() is never called
#   → mock delivery.mark_posted, mark_draft, mark_skipped
#   → run executor._execute_normal(session, dry_run=True) with mocked bot + delivery
#   → assert all three mocks have call_count == 0

# Test: in dry-run mode, get_next_video() IS called (read-only allowed)
#   → same setup, assert mock_get_next_video.call_count >= 1

# Test: in dry-run mode, download_video() IS called (read-only allowed)
#   → assert mock_download_video.call_count >= 1

# Test: in dry-run mode, Telegram notifications ARE sent
#   → mock urllib.request.urlopen to capture HTTP calls
#   → run _execute_normal with dry_run=True
#   → assert at least one call to api.telegram.org (session_start or session_result)

# Test: in dry-run mode, scroll duration is shortened to 30s (0.5 fractional minutes)
#   → capture pre_activity_minutes / post_activity_minutes passed to browse session
#   → assert each <= 0.5

# Test: delivery module mark_posted() returns early when dry_run=True
#   → from delivery.status import mark_posted
#   → with patch('delivery.status._patch_airtable') as mock_patch:
#          mark_posted(record_id='recXXX', platform='tiktok', dry_run=True)
#   → assert mock_patch.call_count == 0

# Test: delivery module mark_draft() returns early when dry_run=True
#   (same pattern as above)

# Test: delivery module mark_skipped() returns early when dry_run=True
#   (same pattern as above)

# Test: proxy rotation is simulated but rotation API is not called in dry-run mode
#   → mock ProxyQueue.rotate()
#   → run session with dry_run=True
#   → assert rotate() NOT called
#   → assert log output contains "DRY RUN: skipping proxy rotation"
```

---

## Implementation Details

### 1. `phone-bot/main.py` — Add `--dry-run` CLI flag

Add `--dry-run` as a boolean flag to the argument parser. It is orthogonal to all existing flags (`--phone`, `--test`, `--forever`) and can be combined with any of them.

```python
def build_arg_parser() -> argparse.ArgumentParser:
    """Build and return the CLI argument parser."""
    ...
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run full pipeline with Airtable writes suppressed, proxy rotation "
             "skipped, scroll shortened to 30s, post screen opened but Post not tapped."
    )
    ...
```

Thread `dry_run=args.dry_run` into `executor.run_today()` (and `run_forever()` if needed).

---

### 2. `phone-bot/planner/executor.py` — Thread `dry_run` through all delivery calls

Add `dry_run: bool = False` to these functions:

```python
def run_today(self, plan, dry_run: bool = False) -> None:
    """Run all sessions for today. dry_run is threaded to every session execution call."""
    ...

def _execute_normal(self, session, dry_run: bool = False) -> str:
    """Execute a normal session (scroll + optional post).

    In dry_run mode:
    - scroll duration capped at 30s
    - proxy rotation skipped (logged instead)
    - post screen opened but Post button not tapped
    - mark_posted/draft/skipped not called
    """
    ...

def _post_with_retry(self, bot, path: str, caption: str, dry_run: bool = False) -> str:
    """In dry_run mode: opens post screen, verifies video selectable,
    backs out without tapping Post. Returns "dry_run_skipped"."""
    ...
```

Proxy rotation call site:
```python
if dry_run:
    logger.info("DRY RUN: skipping proxy rotation for %s", session.account)
else:
    proxy_queue.rotate(...)
```

Scroll duration shortening:
```python
pre_mins = min(session.pre_activity_minutes, 0.5) if dry_run else session.pre_activity_minutes
post_mins = min(session.post_activity_minutes, 0.5) if dry_run else session.post_activity_minutes
```

---

### 3. Delivery module status functions — `delivery/status.py`

Add `dry_run: bool = False` parameter to each status-updating function. When `True`, log the call and return immediately without making a PATCH request.

```python
def mark_posted(record_id: str, platform: str, dry_run: bool = False) -> None:
    """In dry_run mode, logs the call and returns without writing to Airtable."""
    if dry_run:
        logger.info("DRY RUN: would mark_posted %s [%s]", record_id, platform)
        return
    # existing PATCH logic
    ...

def mark_draft(record_id: str, platform: str, dry_run: bool = False) -> None:
    """In dry_run mode, logs the call and returns without writing to Airtable."""
    if dry_run:
        logger.info("DRY RUN: would mark_draft %s [%s]", record_id, platform)
        return
    ...

def mark_skipped(record_id: str, platform: str, dry_run: bool = False) -> None:
    """In dry_run mode, logs the call and returns without writing to Airtable."""
    if dry_run:
        logger.info("DRY RUN: would mark_skipped %s [%s]", record_id, platform)
        return
    ...
```

The `dry_run=False` default means all existing call sites work unchanged — no regressions.

---

## Manual E2E Validation Protocol

After all automated tests pass, perform this manual validation. It requires live ADB hardware and cannot be automated.

**Prerequisites**:
- Phone 1 or 2 connected via USB
- `.env` file configured with `PHONEBOT_TEST=0`
- At least 1 pending video in Content Library for the target phone
- TikTok app installed and logged in on target phone

**Run**:
```bash
cd "C:\Users\rafca\OneDrive\Desktop\Toxic or Nah"
python phone-bot/main.py --dry-run --phone 1
```

**Expected duration**: ~5-10 minutes (shortened scroll, all sessions)

**Verification checklist**:
- [ ] ADB connects to phone (log shows `Connected to <serial>`)
- [ ] TikTok app opens via ADB (`am start -n`)
- [ ] Scroll happens for ~30s (not 8-15 min)
- [ ] `get_next_video()` log shows video record found from Airtable
- [ ] `download_video()` log shows file downloaded to temp path
- [ ] Post screen opens, video thumbnail visible
- [ ] Post button NOT tapped — bot backs out of post screen
- [ ] `mark_posted` NOT called (check log for absence of "Marking posted")
- [ ] Telegram message received with session start/end notifications
- [ ] Airtable Content Library shows **no status changes** after run

**Troubleshooting**:
- ADB not connecting: run `adb devices`, verify serial in `.env`
- App not opening: verify `APP_ACTIVITIES` in `config.py` has correct TikTok activity
- Gemini errors: verify `GEMINI_API_KEY` in `.env`
- Telegram not sending: verify `PHONEBOT_TELEGRAM_TOKEN` and `PHONEBOT_TELEGRAM_CHAT` in `.env`

---

## File Summary

| File | Action | Notes |
|------|--------|-------|
| `phone-bot/main.py` | Modify | Add `--dry-run` flag, thread into executor |
| `phone-bot/planner/executor.py` | Modify | Add `dry_run` param to `run_today()`, `_execute_normal()`, `_post_with_retry()`, proxy call site |
| `phone-bot/delivery/status.py` | Modify | Add `dry_run=False` param to `mark_posted()`, `mark_draft()`, `mark_skipped()` |
| `phone-bot/tests/test_dry_run.py` | Create | All test stubs above (write first) |

No new modules created. Changes are purely additive — `dry_run=False` default means no existing callers break.

---

## Acceptance Criteria

- [ ] `pytest phone-bot/tests/test_dry_run.py -v` — all 10 tests pass
- [ ] Manual E2E validation checklist complete on real hardware
- [ ] Airtable Content Library shows no changes after dry-run
- [ ] Telegram shows session start + result messages for each session
- [ ] `python main.py --dry-run --phone 1` completes in under 10 minutes
