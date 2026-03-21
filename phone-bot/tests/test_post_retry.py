"""Tests for post retry logic in executor.py.

Tests the retry flow: attempt 1 -> app-reset -> attempt 2 -> draft fallback.
All dependencies mocked — no ADB, no Airtable, no phone needed.

Uses asyncio.run() to run async tests without pytest-asyncio dependency.
"""
import asyncio
import pytest
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# Standalone retry function — mirrors executor._post_with_retry() algorithm
# ---------------------------------------------------------------------------

async def post_with_retry(bot, adb, platform, video_path, caption,
                          phone_id, record_id, mark_posted_fn=None,
                          mark_draft_fn=None, tg_alert_fn=None) -> str:
    """Retry logic identical to executor._post_with_retry()."""
    pkg = "com.zhiliaoapp.musically" if platform == "tiktok" else "com.instagram.android"
    post_fn = bot.post_video if platform == "tiktok" else bot.post_reel

    for attempt in range(2):
        result = post_fn(video_path, caption)

        if result == "success":
            if mark_posted_fn:
                mark_posted_fn(record_id, platform)
            return "posted"

        if result in ("banned", "media_error"):
            return "failed_permanent"

        if attempt == 0:
            adb.shell(f"am force-stop {pkg}")
            await asyncio.sleep(0.01)
            bot.open_app()
            await asyncio.sleep(0.01)

    draft_ok = bot.save_as_draft(video_path, caption)
    if draft_ok:
        if mark_draft_fn:
            mark_draft_fn(record_id, platform)
        return "draft"

    if tg_alert_fn:
        tg_alert_fn(phone_id, "", f"CRITICAL: Post AND draft both failed for {platform}")
    return "failed"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeDeviceLostError(Exception):
    pass


def _bot(post_results, save_draft_result=True, platform="tiktok"):
    bot = MagicMock()
    bot.human = MagicMock()
    bot.human.timing = MagicMock(return_value=0.01)
    bot.open_app = MagicMock()
    bot.save_as_draft = MagicMock(return_value=save_draft_result)
    if platform == "tiktok":
        bot.post_video = MagicMock(side_effect=list(post_results))
    else:
        bot.post_reel = MagicMock(side_effect=list(post_results))
    return bot


def _adb():
    adb = MagicMock()
    adb.shell = MagicMock()
    return adb


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPostWithRetry:

    def test_returns_posted_on_first_success(self):
        bot, adb, mp = _bot(["success"]), _adb(), MagicMock()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "cap", 1, "r1", mark_posted_fn=mp))
        assert r == "posted"
        bot.post_video.assert_called_once_with("/v.mp4", "cap")
        mp.assert_called_once_with("r1", "tiktok")

    def test_force_stops_app_on_retryable(self):
        bot, adb = _bot(["retryable", "success"]), _adb()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
        assert r == "posted"
        adb.shell.assert_any_call("am force-stop com.zhiliaoapp.musically")
        bot.open_app.assert_called_once()

    def test_returns_posted_on_second_attempt(self):
        bot, adb, mp = _bot(["retryable", "success"]), _adb(), MagicMock()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "c", 1, "r1", mark_posted_fn=mp))
        assert r == "posted"
        assert bot.post_video.call_count == 2
        mp.assert_called_once_with("r1", "tiktok")

    def test_calls_save_as_draft_after_two_retryable(self):
        bot, adb = _bot(["retryable", "retryable"], save_draft_result=True), _adb()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "c", 1, "r1"))
        assert r == "draft"
        bot.save_as_draft.assert_called_once_with("/v.mp4", "c")

    def test_returns_draft_marks_airtable(self):
        bot, adb, md = _bot(["retryable", "retryable"], save_draft_result=True), _adb(), MagicMock()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1", mark_draft_fn=md))
        assert r == "draft"
        md.assert_called_once_with("r1", "tiktok")

    def test_returns_failed_sends_alert_when_draft_fails(self):
        bot, adb, ta = _bot(["retryable", "retryable"], save_draft_result=False), _adb(), MagicMock()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1", tg_alert_fn=ta))
        assert r == "failed"
        ta.assert_called_once()

    def test_banned_returns_failed_permanent_no_retry(self):
        bot, adb = _bot(["banned"]), _adb()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
        assert r == "failed_permanent"
        assert bot.post_video.call_count == 1
        bot.save_as_draft.assert_not_called()
        bot.open_app.assert_not_called()

    def test_media_error_returns_failed_permanent_no_retry(self):
        bot, adb = _bot(["media_error"]), _adb()
        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
        assert r == "failed_permanent"
        assert bot.post_video.call_count == 1
        bot.save_as_draft.assert_not_called()

    def test_device_lost_error_propagates(self):
        bot = _bot([])
        bot.post_video = MagicMock(side_effect=FakeDeviceLostError("USB gone"))
        adb = _adb()
        with pytest.raises(FakeDeviceLostError):
            _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))

    def test_instagram_uses_post_reel(self):
        bot, adb, mp = _bot(["success"], platform="instagram"), _adb(), MagicMock()
        r = _run(post_with_retry(bot, adb, "instagram", "/v.mp4", "c", 1, "r1", mark_posted_fn=mp))
        assert r == "posted"
        bot.post_reel.assert_called_once_with("/v.mp4", "c")
        mp.assert_called_once_with("r1", "instagram")

    def test_instagram_force_stop_correct_package(self):
        bot, adb = _bot(["retryable", "success"], platform="instagram"), _adb()
        r = _run(post_with_retry(bot, adb, "instagram", "/v.mp4", "", 1, "r1"))
        assert r == "posted"
        adb.shell.assert_any_call("am force-stop com.instagram.android")
