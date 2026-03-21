# Section 02: Cross-Platform Posting Verification

## Overview

This section is **pure verification** — no executor code changes. The deliverable is a test file that confirms the delivery module's status-isolation logic works correctly end-to-end with real Airtable before retry logic is layered on top in section-03.

**Dependency**: section-01-env-config must be complete (`.env` with `AIRTABLE_API_KEY` present).

**Blocks**: section-03-post-retry (retry logic must not be built on top of unverified delivery behavior).

---

## Background: The Cross-Platform Flow

The documented posting flow is:

1. TikTok session: `get_next_video(phone_id, "tiktok")` → download → push to phone → post → `mark_posted(record_id, "tiktok")`
2. IG session (same phone, later in the day): `get_next_video(phone_id, "instagram")` → download → push to phone → post → `mark_posted(record_id, "instagram")`

Each session independently calls `download_video()` (the double-download is intentional — R2 downloads take <2s for a 10MB video, and keeping sessions independent is architecturally clean).

The critical question is whether Airtable's status fields behave in isolation the way the code assumes:

- `get_next_video(phone_id, "tiktok")` queries `platform_status_tiktok='pending'`
- `get_next_video(phone_id, "instagram")` queries `platform_status_instagram='pending'`
- Both fields start as `'pending'` on new records
- `mark_posted(record_id, "tiktok")` only sets `platform_status_tiktok = 'posted'`, leaving `platform_status_instagram` untouched
- After TikTok marks a record posted, IG's query should still return that same record (IG status still pending)
- Only after both platforms mark it posted does the record disappear from all queries

If this isolation breaks, the entire delivery pipeline silently misses posts. This test catches that before it hits production.

---

## Delivery Module: Relevant Functions

These functions live in `Weekly & Daily Plan/delivery/` and are used by the executor:

**`get_next_video(phone_id: int, platform: str) -> dict | None`**
- Located: `Weekly & Daily Plan/delivery/content_library.py`
- Queries Airtable Content Library with formula: `AND(FIND('Phone N', {content_label}), {platform_status_PLATFORM}='pending')`
- Returns `{"record_id", "video_url", "caption", "scenario_name"}` or `None`

**`mark_posted(record_id: str, platform: str) -> dict`**
- Located: `Weekly & Daily Plan/delivery/status.py`
- PATCHes `platform_status_{platform} = 'posted'` on a single record
- Only touches that one field — the other platform's field is not in the request body

**`mark_draft(record_id: str, platform: str) -> dict`** and **`mark_skipped(record_id: str, platform: str) -> dict`** follow the same isolation pattern.

**`get_pending_count(phone_id: int, platform: str) -> int`**
- Same formula as `get_next_video` but returns the count of all matching records (used by stock monitor in section-05)

---

## Tests to Write First

**File to create**: `phone-bot/tests/test_cross_platform_posting.py`

These are **integration tests** that run against real Airtable. They require `AIRTABLE_API_KEY` to be set in the environment. Mark them with a pytest marker so they can be skipped in CI without credentials.

```python
# phone-bot/tests/test_cross_platform_posting.py
"""
Integration tests for cross-platform delivery status isolation.

REQUIRES: Real Airtable credentials (AIRTABLE_API_KEY env var).
REQUIRES: At least one Content Library record with phone_id=TEST_PHONE_ID,
          platform_status_tiktok='pending', platform_status_instagram='pending'.

Run with: pytest phone-bot/tests/test_cross_platform_posting.py -v -m integration

IMPORTANT: These tests PATCH real Airtable records. They reset the record
back to 'pending' in teardown, but if a test crashes mid-run the record
may be left in a non-pending state. Use a dedicated test record.
"""

import pytest
import os
import sys

# Path setup — delivery module is outside phone-bot/
DELIVERY_PATH = r"C:\Users\rafca\OneDrive\Desktop\Toxic or Nah\Weekly & Daily Plan"
sys.path.insert(0, DELIVERY_PATH)

pytestmark = pytest.mark.integration  # skip with: pytest -m "not integration"

TEST_PHONE_ID = ...   # set to a phone_id that has at least 2 pending records
TEST_PLATFORM_A = "tiktok"
TEST_PLATFORM_B = "instagram"


@pytest.fixture
def pending_record():
    """
    Provides a real Airtable record_id known to be pending on both platforms.
    Resets the record back to 'pending' on both platforms after the test.
    """
    # setup: get a pending record
    # yield: record dict
    # teardown: reset both platform statuses back to 'pending'
    ...


def test_same_record_returned_for_both_platforms(pending_record):
    """
    get_next_video for TikTok and Instagram should return the SAME record
    when a video is pending on both platforms.
    """
    ...


def test_tiktok_mark_does_not_affect_instagram_query(pending_record):
    """
    After mark_posted(record_id, "tiktok"), get_next_video for Instagram
    should STILL return that same record (IG status is still pending).
    """
    ...


def test_tiktok_mark_removes_record_from_tiktok_query(pending_record):
    """
    After mark_posted(record_id, "tiktok"), get_next_video for TikTok
    should NOT return that record anymore.
    """
    ...


def test_instagram_mark_removes_record_from_instagram_query(pending_record):
    """
    After mark_posted(record_id, "instagram"), get_next_video for Instagram
    should NOT return that record anymore.
    """
    ...


def test_both_marked_returns_next_record():
    """
    After both platforms mark record A posted, get_next_video should return
    record B (the next pending record), not record A.

    Requires at least 2 pending records for the test phone.
    """
    ...


def test_mark_draft_isolates_correctly(pending_record):
    """
    mark_draft for TikTok should not change Instagram's status.
    After mark_draft(record_id, "tiktok"):
    - get_next_video(phone, "tiktok") should NOT return the record (status='draft', not 'pending')
    - get_next_video(phone, "instagram") SHOULD still return the record
    """
    ...


def test_mark_skipped_isolates_correctly(pending_record):
    """
    mark_skipped for Instagram should not change TikTok's status.
    """
    ...
```

### Test Infrastructure

Create a `phone-bot/tests/conftest.py` if it does not already exist. It should configure the pytest integration marker:

```python
# phone-bot/tests/conftest.py

import pytest

def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as requiring real external services (Airtable, ADB, etc.)"
    )
```

A `phone-bot/tests/__init__.py` (empty) is also needed to make `tests/` a proper Python package.

---

## Implementation Notes

### Path Setup

The delivery module lives at `Weekly & Daily Plan/delivery/`, outside the `phone-bot/` directory. The test file must add that path to `sys.path` before importing. The absolute path on this machine is `C:\Users\rafca\OneDrive\Desktop\Toxic or Nah\Weekly & Daily Plan`.

Alternatively, add the delivery module path to `pytest.ini` or `setup.cfg` via `pythonpath`. Either approach is acceptable.

### Using a Dedicated Test Record

The tests PATCH real Airtable records. To avoid interfering with production content, create a dedicated test record in the Content Library Airtable table with:
- `content_label` = `"Phone {TEST_PHONE_ID}"` (same label format as real records)
- `platform_status_tiktok` = `"pending"`
- `platform_status_instagram` = `"pending"`
- `scenario_name` = `"__TEST_DO_NOT_POST__"` (clearly labeled)

The `pending_record` fixture must reset both statuses back to `'pending'` in its teardown so tests are repeatable.

### Airtable Read-After-Write Latency

The CLAUDE.md notes: "Airtable read-after-write: PATCH then GET immediate may return old data." If the post-PATCH queries return stale data, add a short sleep (0.5–1s) before the verification GET inside the test. This is a known Airtable consistency issue, not a bug in the delivery code.

### What Counts as a Pass

All 7 tests must pass against real Airtable before this section is considered done. A section-02 PASS means the delivery isolation logic is confirmed correct and section-03 (retry logic) can be built on top of it with confidence.

---

## Files to Create

| File | Purpose |
|------|---------|
| `phone-bot/tests/__init__.py` | Makes tests/ a Python package |
| `phone-bot/tests/conftest.py` | Registers `integration` pytest marker |
| `phone-bot/tests/test_cross_platform_posting.py` | All 7 integration tests |

No existing files are modified in this section.

---

## Acceptance Criteria

- [ ] `pytest phone-bot/tests/test_cross_platform_posting.py -v -m integration` — all 7 tests pass against real Airtable
- [ ] Test record resets correctly to `'pending'` after each test run
- [ ] Confirm `mark_posted(record_id, "tiktok")` does NOT touch `platform_status_instagram` field
