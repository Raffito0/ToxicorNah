# Section 03: Post Retry Logic

## Overview

This section adds retry logic around the posting phase in `executor.py`. Currently, if `post_video()` or `post_reel()` returns `False`, the executor silently continues without retry, leaving the video "pending" in Airtable. This section introduces structured result codes, a retry wrapper with app-reset between attempts, a draft-save fallback, and permanent failure handling.

**Dependencies**: section-02-cross-platform must be complete (delivery logic verified before adding retry on top of it).

**Blocks**: section-04-telegram-monitor (the monitor needs `_post_with_retry()` to exist so it can log retry events).

---

## Tests First

Write `phone-bot/tests/test_post_retry.py` and `phone-bot/tests/test_save_as_draft.py` **before** modifying any source files.

```python
# phone-bot/tests/test_post_retry.py

# Test: _post_with_retry returns "posted" when post_video() returns "success" on first attempt
# Test: _post_with_retry force-stops app and reopens before second attempt when first returns "retryable"
# Test: _post_with_retry returns "posted" when post_video() returns "success" on second attempt
# Test: _post_with_retry calls save_as_draft() after two "retryable" failures
# Test: _post_with_retry returns "draft" when save_as_draft() succeeds after retry exhaustion
# Test: _post_with_retry returns "failed" and sends Telegram alert when save_as_draft() also fails
# Test: _post_with_retry returns "failed_permanent" immediately on "banned" result (no retry, no draft)
# Test: _post_with_retry returns "failed_permanent" immediately on "media_error" result (no retry)
# Test: DeviceLostError propagates up (not caught by retry loop)
# Test: retry attempts include correct wait between force-stop and reopen (mocked adb)
```

```python
# phone-bot/tests/test_save_as_draft.py

# Test: TikTokBot.save_as_draft opens post screen, fills caption, taps Save Draft
#   → mock adb, verify sequence of taps matches draft-save flow
# Test: InstagramBot.save_as_draft same pattern for IG draft
```

### Test fixture requirements

Add these fixtures to `phone-bot/tests/conftest.py` if they do not already exist:

```python
@pytest.fixture
def mock_adb():
    """Mocked ADBController — use unittest.mock.MagicMock."""
    ...

@pytest.fixture
def mock_human():
    """Mocked HumanEngine — timing() returns 0.01, jitter_tap returns input coords."""
    ...

@pytest.fixture
def mock_tiktok_bot(mock_adb, mock_human):
    """TikTokBot with mocked dependencies."""
    ...
```

---

## Background

### Why UI automation post failures require app-reset between retries

Failed posts in UI automation almost never fail for network reasons. They fail because the app wedged into an unexpected state: a pop-up appeared over the Post button, the upload screen got stuck, or the app navigated somewhere unexpected mid-flow. Simply calling `post_video()` again in the same app state will reproduce the same failure.

The correct retry strategy:
1. Detect failure (result code, not bare boolean)
2. Force-stop the app (`am force-stop <pkg>`)
3. Wait ~3 seconds for Android to fully clean up the process
4. Reopen the app (`am start -n <pkg>/<activity>`)
5. Wait for load
6. Retry from a known-clean state

### Result codes replace bare booleans

The current `post_video()` / `post_reel()` return `True`/`False`. The caller cannot distinguish between:
- Transient UI failure worth retrying after app-reset
- Account restriction (retrying would make things worse)
- Media rejection (video format/size is wrong — retrying will fail again)

Updating the return type to a string result code makes the retry logic in executor.py clean without adding try/except chains inside the posting functions.

### Draft save is the fallback, not the default

The draft fallback exists to guarantee the video is not lost when two post attempts both fail. A draft in TikTok/Instagram means the content is saved on the device and in the app's local storage — it can be manually published later.

---

## Implementation Details

### Files to Modify

| File | Change |
|---|---|
| `phone-bot/actions/tiktok.py` | Update `post_video()` return type; add `save_as_draft()` |
| `phone-bot/actions/instagram.py` | Update `post_reel()` return type; add `save_as_draft()` |
| `phone-bot/planner/executor.py` | Add `_post_with_retry()`; replace direct `post_video()` call in `_execute_normal()` |

---

### 1. Update `post_video()` in `phone-bot/actions/tiktok.py`

**Current return type**: `bool`

**New return type**: `str` — one of `"success"` | `"retryable"` | `"banned"` | `"media_error"`

The function body stays identical up to the final return block. Replace:
- `return True` → `return "success"`
- `return False` → `return "retryable"`

Additionally:
- If the popup guardian detects a restriction/ban modal during the flow → `return "banned"`
- If the file push or media scan raises a known media-related error → `return "media_error"`

The current `post_video()` checks `get_current_app()` after tapping Post to determine success. Keep that logic — just return the string codes instead of booleans.

---

### 2. Add `save_as_draft()` to `phone-bot/actions/tiktok.py`

```python
def save_as_draft(self, video_path: str, caption: str = "") -> bool:
    """Open the post screen, fill caption, tap Save as Draft instead of Post.

    Returns True if draft was saved, False if draft save failed.
    Called by executor after all post retries are exhausted.
    """
```

Implementation sketch:
1. Push video to device (same as `post_video()` steps 1-7, same path)
2. Navigate to upload screen (create button → upload tab → select video → Next → Next editing screen)
3. Fill caption if provided
4. Instead of tapping `upload_post_btn`, tap the "Save draft" button
   - Coord key to add in `coords.py`: `"upload_save_draft_btn"`
   - Locate in the TikTok upload UI: typically a "Save draft" link below the Post button on the caption/publish screen
5. Verify: `get_current_app()` returns TikTok package (not stuck on error)
6. Delete local video file from device (same `rm` command as `post_video`)
7. Return `True` on success, `False` on failure

---

### 3. Update `post_reel()` in `phone-bot/actions/instagram.py`

Same pattern as TikTok:
- `return True` → `return "success"`
- `return False` → `return "retryable"`
- Account restriction detected → `return "banned"`
- Media format/size rejected → `return "media_error"`

---

### 4. Add `save_as_draft()` to `phone-bot/actions/instagram.py`

```python
def save_as_draft(self, video_path: str, caption: str = "") -> bool:
    """Open the reel upload screen, fill caption, tap Save draft instead of Share.

    Returns True if draft was saved, False if draft save failed.
    """
```

Instagram's draft button appears when navigating away from the share screen — tap the Back button and confirm "Save Draft" in the dialog that appears. Use `get_current_app()` to verify success.

---

### 5. Add `_post_with_retry()` to `phone-bot/planner/executor.py`

```python
async def _post_with_retry(
    self,
    bot,                  # TikTokBot | InstagramBot
    platform: str,
    video_path: str,
    caption: str,
    phone_id: int,
    record_id: str,
    dry_run: bool = False,
) -> str:
    """Try to post, reset app and retry once on retryable failure, fall back to draft.

    Returns one of: "posted" | "draft" | "failed" | "failed_permanent"

    Retry flow:
        Attempt 1: post_video/post_reel
          → "success":     mark_posted, return "posted"
          → "retryable":   force-stop app, wait 3s, reopen app, wait for load
          → "banned":      return "failed_permanent" (no retry, no draft)
          → "media_error": return "failed_permanent" (no retry, no draft)
        Attempt 2: post_video/post_reel
          → "success":     mark_posted, return "posted"
          → any failure:   fall through to draft save
        Draft save: bot.save_as_draft
          → True:   mark_draft in Airtable, return "draft"
          → False:  send critical Telegram alert, return "failed"

    DeviceLostError propagates up (not caught here).
    """
```

**App reset between attempts** (between attempt 1 "retryable" and attempt 2):

```python
pkg = "com.zhiliaoapp.musically" if platform == "tiktok" else "com.instagram.android"
adb.shell(f"am force-stop {pkg}")
await asyncio.sleep(3.0)
bot.open_app()
await asyncio.sleep(bot.human.timing("t_app_load"))
```

Use package constants already defined in `tiktok.py` and `instagram.py` rather than hardcoding strings.

---

### 6. Wire `_post_with_retry()` into `_execute_normal()` in `executor.py`

There are two approaches for calling the retry wrapper from `_execute_normal()`:

**Option A** (minimal change): Add a `post_result_callback` parameter to `browse_session()`. The executor passes `_post_with_retry()` as the callback. `browse_session()` calls it at the post phase instead of calling `post_video()` directly.

**Option B** (recommended, cleaner): Move the `post_video()`/`post_reel()` call out of `browse_session()` entirely. `_execute_normal()` calls `_post_with_retry()` directly at the post phase. `browse_session()` handles only the scroll/engagement phases.

Evaluate the current `browse_session()` structure in `tiktok.py` and `instagram.py` to confirm feasibility before choosing. Option B keeps posting logic in the executor (which owns retry/delivery concerns) and keeps bot classes focused on UI interactions.

---

## Coordinate Requirements

Add to `phone-bot/core/coords.py` if not already present:
- `tiktok` → `"upload_save_draft_btn"` — Save Draft button/link on TikTok's publish screen
- `instagram` → `"upload_back_btn"` — if needed to trigger "Save as draft" dialog via Back

Use proportional coordinates (percentage of screen dimensions) per the universality rule. Verify on actual app UI before setting values.

---

## FORGE v2 Validation

After implementing and unit-testing:

1. Run FORGE Phase 1 (Analyze) before any edits.
2. Implement the changes.
3. Run FORGE Phase 2 (Predict).
4. Test: temporarily make `post_video()` return `"retryable"` on first call. Verify via scrcpy:
   - App is force-stopped
   - App reopens cleanly
   - Second attempt proceeds without crash
   - Draft is saved when second attempt also fails
5. Run FORGE Phase 3 (Verify).
6. Pass 3/3 before moving to section-04.

---

## Risk Notes

- **DeviceLostError must propagate**: The retry loop must NOT catch `DeviceLostError`. That exception propagates to `execute_session()` which adds the phone to `dead_phones` and skips remaining sessions.
- **mark_posted idempotency**: If `mark_posted()` throws after a successful post, the video stays "pending" and may be reposted next session. The idempotency check by scenario_name + date (from the risk mitigation table) prevents this.
- **save_as_draft coord accuracy**: The "Save draft" button location varies by app version. Verify on real devices before deploying.

---

## Acceptance Criteria

- [ ] `pytest phone-bot/tests/test_post_retry.py -v` — all tests pass
- [ ] `pytest phone-bot/tests/test_save_as_draft.py -v` — all tests pass
- [ ] `post_video()` returns string result code on all paths (no bare `True`/`False`)
- [ ] `post_reel()` returns string result code on all paths
- [ ] FORGE v2: app-reset between retries verified on real hardware (3/3 PASS)
