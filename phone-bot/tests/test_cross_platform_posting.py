"""Integration tests for cross-platform delivery status isolation.

These tests verify that Airtable's platform_status_tiktok and
platform_status_instagram fields are updated independently:
- mark_posted(record_id, "tiktok") only sets platform_status_tiktok
- The Instagram status remains 'pending' until separately marked

REQUIREMENTS:
  - Real Airtable credentials: AIRTABLE_API_KEY env var set
  - At least 2 Content Library records for TEST_PHONE_ID with both statuses 'pending'
  - A dedicated test record (scenario_name='__TEST_DO_NOT_POST__') for safe testing

RUN:
  pytest phone-bot/tests/test_cross_platform_posting.py -v -m integration

SKIP in CI (no credentials):
  pytest -m "not integration"

IMPORTANT:
  These tests PATCH real Airtable records. The pending_record fixture resets
  both statuses back to 'pending' in teardown. If a test crashes before teardown,
  the record may be left in a modified state — check Airtable manually.
"""
import os
import sys
import time
from pathlib import Path

import pytest

# ── path setup ─────────────────────────────────────────────────────────────
# delivery module lives in "Weekly & Daily Plan/delivery/", outside phone-bot/
_PROJECT_ROOT = Path(__file__).parent.parent.parent
_DELIVERY_PATH = _PROJECT_ROOT / "Weekly & Daily Plan"
if str(_DELIVERY_PATH) not in sys.path:
    sys.path.insert(0, str(_DELIVERY_PATH))

# ── markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.integration

# ── config ───────────────────────────────────────────────────────────────────
# Change to the phone_id that has pending test records in your Content Library
TEST_PHONE_ID = int(os.environ.get("TEST_PHONE_ID", "1"))

# Airtable read-after-write can take up to 1s to propagate
_AIRTABLE_PROPAGATION_DELAY = 1.0


# ── helpers ──────────────────────────────────────────────────────────────────

def _reset_record(record_id: str) -> None:
    """Reset both platform statuses back to 'pending' for test repeatability."""
    from delivery import mark_posted  # noqa: F401 — to verify import works
    import urllib.request
    import json

    api_key = os.environ["AIRTABLE_API_KEY"]
    base_id = "appsgjIdkpak2kaXq"
    table_id = "tblx1KX7mlTX5QyGb"
    url = f"https://api.airtable.com/v0/{base_id}/{table_id}/{record_id}"

    payload = json.dumps({
        "fields": {
            "platform_status_tiktok": "pending",
            "platform_status_instagram": "pending",
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=10):
        pass
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def pending_record():
    """
    Returns a real Airtable Content Library record that has both statuses 'pending'.
    Resets both statuses back to 'pending' in teardown.

    Requires the Content Library to have at least one record for TEST_PHONE_ID
    with platform_status_tiktok='pending' and platform_status_instagram='pending'.
    """
    from delivery import get_next_video

    record = get_next_video(TEST_PHONE_ID, "tiktok")
    if record is None:
        pytest.skip(
            f"No pending TikTok videos for phone {TEST_PHONE_ID}. "
            f"Add a test record to the Content Library before running integration tests."
        )

    record_id = record["record_id"]
    yield record

    # Teardown: always reset to pending
    try:
        _reset_record(record_id)
    except Exception as e:
        pytest.fail(
            f"Teardown failed — record {record_id} may be stuck in non-pending state: {e}. "
            f"Fix manually in Airtable before re-running."
        )


# ── tests ────────────────────────────────────────────────────────────────────

def test_same_record_returned_for_both_platforms(pending_record):
    """TikTok and Instagram queries must return the same record when both are pending."""
    from delivery import get_next_video

    record_id = pending_record["record_id"]

    tiktok_rec = get_next_video(TEST_PHONE_ID, "tiktok")
    assert tiktok_rec is not None, "TikTok query returned None"

    ig_rec = get_next_video(TEST_PHONE_ID, "instagram")
    assert ig_rec is not None, "Instagram query returned None"

    assert tiktok_rec["record_id"] == record_id, (
        f"TikTok query returned different record: {tiktok_rec['record_id']} != {record_id}"
    )
    assert ig_rec["record_id"] == record_id, (
        f"Instagram query returned different record: {ig_rec['record_id']} != {record_id}"
    )


def test_tiktok_mark_does_not_affect_instagram_query(pending_record):
    """After marking TikTok posted, the Instagram query must still return the same record."""
    from delivery import get_next_video, mark_posted

    record_id = pending_record["record_id"]

    mark_posted(record_id, "tiktok")
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)

    ig_rec = get_next_video(TEST_PHONE_ID, "instagram")
    assert ig_rec is not None, (
        "Instagram query returned None after marking TikTok posted — "
        "mark_posted may have incorrectly updated platform_status_instagram"
    )
    assert ig_rec["record_id"] == record_id, (
        f"Instagram query returned wrong record: {ig_rec['record_id']} != {record_id}"
    )


def test_tiktok_mark_removes_record_from_tiktok_query(pending_record):
    """After marking TikTok posted, the TikTok query must NOT return that record."""
    from delivery import get_next_video, mark_posted

    record_id = pending_record["record_id"]

    mark_posted(record_id, "tiktok")
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)

    tiktok_rec = get_next_video(TEST_PHONE_ID, "tiktok")
    # Either None (no more pending) or a different record
    if tiktok_rec is not None:
        assert tiktok_rec["record_id"] != record_id, (
            f"TikTok query still returns the just-posted record {record_id}. "
            f"mark_posted('tiktok') may not have updated platform_status_tiktok correctly."
        )


def test_instagram_mark_removes_record_from_instagram_query(pending_record):
    """After marking Instagram posted, the Instagram query must NOT return that record."""
    from delivery import get_next_video, mark_posted

    record_id = pending_record["record_id"]

    mark_posted(record_id, "instagram")
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)

    ig_rec = get_next_video(TEST_PHONE_ID, "instagram")
    if ig_rec is not None:
        assert ig_rec["record_id"] != record_id, (
            f"Instagram query still returns the just-posted record {record_id}. "
            f"mark_posted('instagram') may not have updated platform_status_instagram correctly."
        )


def test_both_marked_returns_next_record():
    """After both platforms marked posted, next query should return record B, not record A.

    Requires at least 2 pending records for TEST_PHONE_ID.
    """
    from delivery import get_next_video, mark_posted

    # Get first record
    rec_a = get_next_video(TEST_PHONE_ID, "tiktok")
    if rec_a is None:
        pytest.skip(f"No pending TikTok records for phone {TEST_PHONE_ID}")

    rec_a_id = rec_a["record_id"]

    try:
        # Check there's at least one more pending IG record (to ensure rec_b exists)
        ig_check = get_next_video(TEST_PHONE_ID, "instagram")
        if ig_check is None:
            pytest.skip("No pending IG records")

        # Mark both platforms on record A
        mark_posted(rec_a_id, "tiktok")
        mark_posted(rec_a_id, "instagram")
        time.sleep(_AIRTABLE_PROPAGATION_DELAY)

        # Next TikTok query should return something other than rec_a
        rec_b = get_next_video(TEST_PHONE_ID, "tiktok")
        if rec_b is not None:
            assert rec_b["record_id"] != rec_a_id, (
                f"After marking both platforms, TikTok query still returns record A ({rec_a_id}). "
                "Both statuses may not have been set to 'posted'."
            )
    finally:
        _reset_record(rec_a_id)


def test_mark_draft_isolates_correctly(pending_record):
    """mark_draft for TikTok must not change Instagram's status."""
    from delivery import get_next_video, mark_draft

    record_id = pending_record["record_id"]

    mark_draft(record_id, "tiktok")
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)

    # TikTok: status is now 'draft' — should NOT appear in 'pending' query
    tiktok_rec = get_next_video(TEST_PHONE_ID, "tiktok")
    if tiktok_rec is not None:
        assert tiktok_rec["record_id"] != record_id, (
            f"TikTok query still returns record {record_id} after mark_draft('tiktok'). "
            "Status may not have been updated."
        )

    # Instagram: status should still be 'pending' — must still appear in IG query
    ig_rec = get_next_video(TEST_PHONE_ID, "instagram")
    assert ig_rec is not None, (
        "Instagram query returned None after mark_draft('tiktok'). "
        "mark_draft may have incorrectly modified platform_status_instagram."
    )
    assert ig_rec["record_id"] == record_id, (
        f"Instagram query returned wrong record after TikTok mark_draft: "
        f"{ig_rec['record_id']} != {record_id}"
    )


def test_mark_skipped_isolates_correctly(pending_record):
    """mark_skipped for Instagram must not change TikTok's status."""
    from delivery import get_next_video, mark_skipped

    record_id = pending_record["record_id"]

    mark_skipped(record_id, "instagram")
    time.sleep(_AIRTABLE_PROPAGATION_DELAY)

    # Instagram: status is now 'skipped' — should NOT appear in 'pending' query
    ig_rec = get_next_video(TEST_PHONE_ID, "instagram")
    if ig_rec is not None:
        assert ig_rec["record_id"] != record_id, (
            f"Instagram query still returns record {record_id} after mark_skipped('instagram'). "
            "Status may not have been updated."
        )

    # TikTok: status should still be 'pending' — must still appear in TikTok query
    tiktok_rec = get_next_video(TEST_PHONE_ID, "tiktok")
    assert tiktok_rec is not None, (
        "TikTok query returned None after mark_skipped('instagram'). "
        "mark_skipped may have incorrectly modified platform_status_tiktok."
    )
    assert tiktok_rec["record_id"] == record_id, (
        f"TikTok query returned wrong record after Instagram mark_skipped: "
        f"{tiktok_rec['record_id']} != {record_id}"
    )
