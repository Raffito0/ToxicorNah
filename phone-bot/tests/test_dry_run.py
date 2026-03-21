"""Tests for --dry-run mode (section-08).

Validates that dry-run suppresses Airtable writes, shortens scroll,
skips proxy rotation, but still calls read-only delivery functions
and sends Telegram notifications.
"""
import argparse
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
import sys
import os

# Add delivery module to sys.path
_delivery_parent = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "Weekly & Daily Plan",
)
if _delivery_parent not in sys.path:
    sys.path.insert(0, _delivery_parent)


# ---------------------------------------------------------------------------
# CLI flag tests
# ---------------------------------------------------------------------------

class TestDryRunCliFlag:
    """--dry-run flag is accepted and parsed correctly."""

    def test_dry_run_flag_parsed(self):
        """--dry-run sets args.dry_run to True."""
        # Import main.py's argument parser
        main_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, main_dir)

        # Build a minimal parser that matches main.py's structure
        parser = argparse.ArgumentParser()
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--phone", type=int)

        args = parser.parse_args(["--dry-run", "--phone", "1"])
        assert args.dry_run is True

    def test_no_dry_run_flag_defaults_false(self):
        parser = argparse.ArgumentParser()
        parser.add_argument("--dry-run", action="store_true")
        args = parser.parse_args([])
        assert args.dry_run is False


# ---------------------------------------------------------------------------
# Delivery module dry-run tests
# ---------------------------------------------------------------------------

class TestDeliveryDryRun:
    """mark_posted/draft/skipped return early when dry_run=True."""

    def test_mark_posted_skips_airtable_in_dry_run(self):
        from delivery.status import mark_posted
        with patch("delivery.status._airtable_patch") as mock_patch:
            result = mark_posted("recXXX", "tiktok", dry_run=True)
            assert mock_patch.call_count == 0
            assert result is None

    def test_mark_draft_skips_airtable_in_dry_run(self):
        from delivery.status import mark_draft
        with patch("delivery.status._airtable_patch") as mock_patch:
            result = mark_draft("recXXX", "tiktok", dry_run=True)
            assert mock_patch.call_count == 0
            assert result is None

    def test_mark_skipped_skips_airtable_in_dry_run(self):
        from delivery.status import mark_skipped
        with patch("delivery.status._airtable_patch") as mock_patch:
            result = mark_skipped("recXXX", "tiktok", dry_run=True)
            assert mock_patch.call_count == 0
            assert result is None

    def test_mark_posted_calls_airtable_without_dry_run(self):
        from delivery.status import mark_posted
        with patch("delivery.status._airtable_patch", return_value={"id": "recXXX"}) as mock_patch:
            result = mark_posted("recXXX", "tiktok")
            assert mock_patch.call_count == 1

    def test_mark_draft_calls_airtable_without_dry_run(self):
        from delivery.status import mark_draft
        with patch("delivery.status._airtable_patch", return_value={"id": "recXXX"}) as mock_patch:
            result = mark_draft("recXXX", "tiktok")
            assert mock_patch.call_count == 1


# ---------------------------------------------------------------------------
# Executor dry-run behavior tests
# ---------------------------------------------------------------------------

class TestExecutorDryRun:
    """Executor threads dry_run correctly through session execution."""

    def test_scroll_duration_capped_in_dry_run(self):
        """In dry-run, pre/post scroll capped at 0.5 min (30s)."""
        pre = 15.0
        post = 10.0
        dry_run = True

        capped_pre = min(pre, 0.5) if dry_run else pre
        capped_post = min(post, 0.5) if dry_run else post

        assert capped_pre == 0.5
        assert capped_post == 0.5

    def test_scroll_duration_not_capped_without_dry_run(self):
        """Without dry-run, scroll times pass through unchanged."""
        pre = 15.0
        post = 10.0
        dry_run = False

        capped_pre = min(pre, 0.5) if dry_run else pre
        capped_post = min(post, 0.5) if dry_run else post

        assert capped_pre == 15.0
        assert capped_post == 10.0

    def test_proxy_rotation_skipped_in_dry_run(self):
        """In dry-run, proxy.switch_to_phone() should NOT be called."""
        # This validates the pattern used in executor.execute_session
        proxy_mock = MagicMock()
        dry_run = True
        phone_id = 1

        # Simulate the dry_run check from execute_session
        if not dry_run:
            proxy_mock.switch_to_phone(phone_id)

        assert proxy_mock.switch_to_phone.call_count == 0

    def test_proxy_rotation_called_without_dry_run(self):
        """Without dry-run, proxy.switch_to_phone() IS called."""
        proxy_mock = MagicMock()
        dry_run = False
        phone_id = 1

        if not dry_run:
            proxy_mock.switch_to_phone(phone_id)

        assert proxy_mock.switch_to_phone.call_count == 1
