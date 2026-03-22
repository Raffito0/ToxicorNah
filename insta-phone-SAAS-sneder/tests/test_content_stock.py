"""Tests for content stock API + service."""

import json
import time
from unittest.mock import patch, MagicMock

import pytest

from app.content_service import get_content_stock, _stock_cache, CACHE_TTL


# ── Fixtures ──

MOCK_PHONES = {
    "records": [
        {"fields": {"phone_id": 1, "name": "Phone 1", "videos_per_day": 2}},
        {"fields": {"phone_id": 2, "name": "Phone 2", "videos_per_day": 3}},
    ]
}


def _mock_pending(count):
    return {"records": [{"id": f"rec{i}"} for i in range(count)]}


def _mock_airtable(table_id, params=None):
    from app.content_service import PHONES_TABLE
    if table_id == PHONES_TABLE:
        return MOCK_PHONES
    # Content library queries — return 3 records
    return _mock_pending(3)


# ── Tests ──

@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
def test_stock_returns_structure(mock_at):
    """Stock endpoint returns correct shape with phones list."""
    _stock_cache["data"] = None
    _stock_cache["timestamp"] = 0

    result = get_content_stock(force_refresh=True)

    assert "phones" in result
    assert "last_refresh" in result
    assert result["cache_stale"] is False
    assert len(result["phones"]) == 2
    phone1 = result["phones"][0]
    assert phone1["phone_id"] == 1
    assert phone1["tiktok_pending"] == 3
    assert phone1["instagram_pending"] == 3


@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
def test_stock_uses_cache(mock_at):
    """Second call within TTL uses cache, no extra Airtable calls."""
    _stock_cache["data"] = None
    _stock_cache["timestamp"] = 0

    get_content_stock(force_refresh=True)
    call_count_after_first = mock_at.call_count

    get_content_stock()  # should use cache
    assert mock_at.call_count == call_count_after_first


@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
def test_refresh_invalidates_cache(mock_at):
    """POST refresh triggers a new Airtable fetch."""
    _stock_cache["data"] = None
    _stock_cache["timestamp"] = 0

    get_content_stock(force_refresh=True)
    first_count = mock_at.call_count

    get_content_stock(force_refresh=True)
    assert mock_at.call_count > first_count


@patch("app.content_service._airtable_get")
def test_airtable_error_returns_stale_cache(mock_at):
    """On Airtable error, returns stale data with cache_stale=True."""
    stale_data = {
        "phones": [{"phone_id": 1, "name": "Phone 1", "tiktok_pending": 5,
                     "instagram_pending": 5, "tiktok_days": 2.5,
                     "instagram_days": 2.5, "videos_per_day": 2}],
        "last_refresh": "2026-03-22T10:00:00Z",
        "cache_stale": False,
    }
    _stock_cache["data"] = stale_data
    _stock_cache["timestamp"] = time.time() - CACHE_TTL - 1  # expired

    mock_at.side_effect = Exception("Airtable down")
    result = get_content_stock()

    assert result["cache_stale"] is True
    assert result["phones"][0]["tiktok_pending"] == 5


@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
def test_days_calculation_correct(mock_at):
    """3 pending / 2 per day = 1.5 days."""
    _stock_cache["data"] = None
    _stock_cache["timestamp"] = 0

    result = get_content_stock(force_refresh=True)
    phone1 = result["phones"][0]
    assert phone1["tiktok_days"] == 1.5  # 3 / 2
    assert phone1["instagram_days"] == 1.5


@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
def test_days_null_when_zero_vpd(mock_at):
    """videos_per_day=0 produces days=None."""
    _stock_cache["data"] = None
    _stock_cache["timestamp"] = 0

    mock_phones = {
        "records": [
            {"fields": {"phone_id": 1, "name": "Phone 1", "videos_per_day": 0}},
        ]
    }

    def custom_airtable(table_id, params=None):
        from app.content_service import PHONES_TABLE
        if table_id == PHONES_TABLE:
            return mock_phones
        return _mock_pending(3)

    mock_at.side_effect = custom_airtable
    result = get_content_stock(force_refresh=True)
    assert result["phones"][0]["tiktok_days"] is None
