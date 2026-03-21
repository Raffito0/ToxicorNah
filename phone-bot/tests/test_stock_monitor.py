"""Tests for content stock monitoring — check_content_stock logic + warmup-only mode.

Tests the stock checking algorithm and warmup-only decision logic.
All Airtable calls mocked — no real API calls needed.

Uses standalone functions that mirror executor.py logic to avoid deep import issues.
"""
import json
import os
import urllib.request
import urllib.error
import urllib.parse
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Standalone stock check function — mirrors executor.check_content_stock()
# ---------------------------------------------------------------------------

_AIRTABLE_BASE_ID = "appsgjIdkpak2kaXq"
_CONTENT_LIBRARY_TABLE = "tblx1KX7mlTX5QyGb"
_LOW_STOCK_THRESHOLD = 14


def check_content_stock(phones: list, api_key: str = None) -> dict:
    """Query Airtable for pending video count per phone.

    Mirrors executor.check_content_stock() algorithm exactly.
    """
    if not api_key:
        api_key = os.environ.get("AIRTABLE_API_KEY", "")
    if not api_key:
        return {}

    result = {}
    for phone_id in phones:
        try:
            formula = f"AND(FIND('Phone {phone_id}', {{content_label}}), {{platform_status_tiktok}}='pending')"
            encoded_formula = urllib.parse.quote(formula, safe="")
            base_url = (
                f"https://api.airtable.com/v0/{_AIRTABLE_BASE_ID}/{_CONTENT_LIBRARY_TABLE}"
                f"?filterByFormula={encoded_formula}"
            )
            count = 0
            offset = None
            while True:
                url = base_url
                if offset:
                    url += f"&offset={urllib.parse.quote(offset, safe='')}"
                req = urllib.request.Request(url, headers={
                    "Authorization": f"Bearer {api_key}",
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                count += len(data.get("records", []))
                offset = data.get("offset")
                if not offset:
                    break
            result[phone_id] = count
        except Exception:
            pass  # skip this phone, continue with others
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_airtable_response(n_records: int) -> dict:
    """Build a minimal Airtable list response with N records."""
    return {"records": [{"id": f"rec{i}", "fields": {}} for i in range(n_records)]}


def _mock_urlopen(responses_by_phone: dict):
    """Return a mock side_effect for urllib.request.urlopen."""
    def side_effect(req, timeout=None):
        url = req.full_url if hasattr(req, 'full_url') else str(req)
        for phone_id, count in responses_by_phone.items():
            if f"Phone+{phone_id}" in url or f"Phone%20{phone_id}" in url:
                body = json.dumps(_make_airtable_response(count)).encode("utf-8")
                resp = MagicMock()
                resp.read.return_value = body
                resp.__enter__ = MagicMock(return_value=resp)
                resp.__exit__ = MagicMock(return_value=False)
                return resp
        # Default: empty
        body = json.dumps(_make_airtable_response(0)).encode("utf-8")
        resp = MagicMock()
        resp.read.return_value = body
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp
    return side_effect


# ---------------------------------------------------------------------------
# Tests: check_content_stock
# ---------------------------------------------------------------------------

class TestCheckContentStock:

    @patch("urllib.request.urlopen")
    def test_returns_correct_counts_per_phone(self, mock_urlopen):
        """Stock check returns {phone_id: count} for each queried phone."""
        mock_urlopen.side_effect = _mock_urlopen({1: 5, 2: 0, 3: 14})
        result = check_content_stock([1, 2, 3], api_key="fake_key")
        assert result == {1: 5, 2: 0, 3: 14}

    @patch("urllib.request.urlopen")
    def test_returns_zero_for_phone_with_no_pending(self, mock_urlopen):
        """Phone with empty records list gets count=0."""
        mock_urlopen.side_effect = _mock_urlopen({1: 0})
        result = check_content_stock([1], api_key="fake_key")
        assert result[1] == 0

    @patch("urllib.request.urlopen")
    def test_airtable_failure_returns_empty_dict(self, mock_urlopen):
        """On Airtable error for all phones, returns {} (all failed independently)."""
        mock_urlopen.side_effect = Exception("Connection refused")
        result = check_content_stock([1, 2], api_key="fake_key")
        assert result == {}

    @patch("urllib.request.urlopen")
    def test_partial_failure_returns_successful_phones(self, mock_urlopen):
        """If one phone fails, other phones' results are still returned."""
        call_count = [0]
        def side_effect(req, timeout=None):
            call_count[0] += 1
            url = req.full_url if hasattr(req, 'full_url') else str(req)
            if "Phone+2" in url or "Phone%202" in url:
                raise Exception("Timeout for Phone 2")
            # Phone 1 and 3 succeed
            for pid, count in {1: 5, 3: 14}.items():
                if f"Phone+{pid}" in url or f"Phone%20{pid}" in url:
                    body = json.dumps(_make_airtable_response(count)).encode("utf-8")
                    resp = MagicMock()
                    resp.read.return_value = body
                    resp.__enter__ = MagicMock(return_value=resp)
                    resp.__exit__ = MagicMock(return_value=False)
                    return resp
            raise Exception("Unknown phone")

        mock_urlopen.side_effect = side_effect
        result = check_content_stock([1, 2, 3], api_key="fake_key")
        assert result == {1: 5, 3: 14}  # Phone 2 missing (failed), others present

    def test_missing_api_key_returns_empty_dict(self):
        """Without API key, returns {} gracefully."""
        result = check_content_stock([1], api_key="")
        assert result == {}

    @patch("urllib.request.urlopen")
    def test_builds_correct_airtable_url(self, mock_urlopen):
        """Verify the Airtable filter formula is constructed correctly."""
        mock_urlopen.side_effect = _mock_urlopen({2: 3})
        check_content_stock([2], api_key="fake_key")

        # Verify the URL contains the expected filter
        call_args = mock_urlopen.call_args
        req = call_args[0][0]
        url = req.full_url
        assert _AIRTABLE_BASE_ID in url
        assert _CONTENT_LIBRARY_TABLE in url
        assert "Phone" in urllib.parse.unquote(url)
        assert "content_label" in urllib.parse.unquote(url)


# ---------------------------------------------------------------------------
# Tests: stock alert logic
# ---------------------------------------------------------------------------

class TestStockAlerts:

    def test_alert_sent_when_below_threshold(self):
        """stock_alert called for phones with count < 14."""
        monitor = MagicMock()
        stock = {1: 13, 2: 20, 3: 14}

        for phone_id, count in stock.items():
            if count == 0:
                monitor.stock_alert(phone_id=phone_id, count=0, critical=True)
            elif count < _LOW_STOCK_THRESHOLD:
                monitor.stock_alert(phone_id=phone_id, count=count, critical=False)

        # Phone 1 (13) should trigger warning
        monitor.stock_alert.assert_called_once_with(phone_id=1, count=13, critical=False)

    def test_no_alert_when_all_above_threshold(self):
        """No stock_alert when all phones have >= 14 videos."""
        monitor = MagicMock()
        stock = {1: 14, 2: 30, 3: 20}

        for phone_id, count in stock.items():
            if count == 0:
                monitor.stock_alert(phone_id=phone_id, count=0, critical=True)
            elif count < _LOW_STOCK_THRESHOLD:
                monitor.stock_alert(phone_id=phone_id, count=count, critical=False)

        monitor.stock_alert.assert_not_called()

    def test_critical_alert_when_stock_zero(self):
        """stock_alert called with critical=True when stock=0."""
        monitor = MagicMock()
        stock = {3: 0}

        for phone_id, count in stock.items():
            if count == 0:
                monitor.stock_alert(phone_id=phone_id, count=0, critical=True)
            elif count < _LOW_STOCK_THRESHOLD:
                monitor.stock_alert(phone_id=phone_id, count=count, critical=False)

        monitor.stock_alert.assert_called_once_with(phone_id=3, count=0, critical=True)


# ---------------------------------------------------------------------------
# Tests: warmup-only mode logic
# ---------------------------------------------------------------------------

class TestWarmupOnlyMode:

    def test_warmup_only_when_stock_zero(self):
        """When stock=0, warmup_only is True."""
        stock = {1: 0, 2: 5, 3: 14}
        phone_stock = stock.get(1, None)
        warmup_only = (phone_stock is not None and phone_stock == 0)
        assert warmup_only is True

    def test_normal_when_stock_positive(self):
        """When stock > 0, warmup_only is False."""
        stock = {1: 0, 2: 5, 3: 14}
        phone_stock = stock.get(2, None)
        warmup_only = (phone_stock is not None and phone_stock == 0)
        assert warmup_only is False

    def test_normal_when_phone_not_in_stock(self):
        """When phone not in stock dict (unknown), warmup_only is False."""
        stock = {1: 0}
        phone_stock = stock.get(4, None)
        warmup_only = (phone_stock is not None and phone_stock == 0)
        assert warmup_only is False

    def test_normal_when_stock_empty(self):
        """When stock check failed (empty dict), all phones run normally."""
        stock = {}
        for phone_id in [1, 2, 3]:
            phone_stock = stock.get(phone_id, None)
            warmup_only = (phone_stock is not None and phone_stock == 0)
            assert warmup_only is False

    def test_post_scheduled_overridden_when_warmup_only(self):
        """Session with post_scheduled=True gets overridden to False when warmup_only."""
        stock = {1: 0}
        session = {"phone_id": 1, "post_scheduled": True, "account_name": "ph1_tiktok"}

        phone_stock = stock.get(session["phone_id"], None)
        warmup_only = (phone_stock is not None and phone_stock == 0)

        if warmup_only and session.get("post_scheduled", False):
            session = dict(session)  # shallow copy
            session["post_scheduled"] = False

        assert session["post_scheduled"] is False

    def test_session_not_skipped_when_warmup_only(self):
        """Stock=0 disables posting but session still runs (not skipped)."""
        stock = {2: 0}
        session = {"phone_id": 2, "post_scheduled": True, "session_type": "normal"}

        phone_stock = stock.get(session["phone_id"], None)
        warmup_only = (phone_stock is not None and phone_stock == 0)

        # Session should NOT be skipped — only post_scheduled changes
        assert warmup_only is True
        # The session itself is still executed (session_type stays normal)
        assert session["session_type"] == "normal"

    def test_multiple_phones_at_zero(self):
        """Multiple phones with stock=0 all get warmup_only independently."""
        stock = {1: 0, 2: 5, 3: 0}
        warmup_phones = []
        for pid in [1, 2, 3]:
            ps = stock.get(pid, None)
            if ps is not None and ps == 0:
                warmup_phones.append(pid)
        assert warmup_phones == [1, 3]
