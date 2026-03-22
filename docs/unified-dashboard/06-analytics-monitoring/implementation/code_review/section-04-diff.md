diff --git a/insta-phone-SAAS-sneder/app/__init__.py b/insta-phone-SAAS-sneder/app/__init__.py
index d50949c..0bbd8ee 100644
--- a/insta-phone-SAAS-sneder/app/__init__.py
+++ b/insta-phone-SAAS-sneder/app/__init__.py
@@ -136,12 +136,14 @@ def create_app():
     from .planner_routes import planner_bp
     from .personality_routes import personality_bp
     from .timing_routes import timing_bp_api
+    from .content_routes import content_bp
     app.register_blueprint(auth)
     app.register_blueprint(analysis)
     app.register_blueprint(proxy_bp)
     app.register_blueprint(planner_bp)
     app.register_blueprint(personality_bp)
     app.register_blueprint(timing_bp_api)
+    app.register_blueprint(content_bp)
 
     # Start proxy health-check thread (skip in tests)
     if not app.config.get('TESTING'):
diff --git a/insta-phone-SAAS-sneder/app/content_routes.py b/insta-phone-SAAS-sneder/app/content_routes.py
new file mode 100644
index 0000000..f0901a0
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/content_routes.py
@@ -0,0 +1,27 @@
+"""Content stock API routes."""
+
+from flask import Blueprint, jsonify
+from flask_login import login_required
+from .content_service import get_content_stock
+
+content_bp = Blueprint('content', __name__)
+
+
+@content_bp.route('/api/content/stock', methods=['GET'])
+@login_required
+def get_stock():
+    try:
+        data = get_content_stock()
+        return jsonify(data)
+    except Exception as e:
+        return jsonify({"error": str(e)}), 500
+
+
+@content_bp.route('/api/content/stock/refresh', methods=['POST'])
+@login_required
+def refresh_stock():
+    try:
+        data = get_content_stock(force_refresh=True)
+        return jsonify(data)
+    except Exception as e:
+        return jsonify({"error": str(e)}), 500
diff --git a/insta-phone-SAAS-sneder/app/content_service.py b/insta-phone-SAAS-sneder/app/content_service.py
new file mode 100644
index 0000000..8ea3d7c
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/content_service.py
@@ -0,0 +1,93 @@
+"""Content Library stock service — queries Airtable for pending video counts."""
+
+import json
+import os
+import time
+import urllib.request
+import urllib.parse
+from datetime import datetime, timezone
+
+AIRTABLE_BASE_ID = "appsgjIdkpak2kaXq"
+CONTENT_LIBRARY_TABLE = "tblx1KX7mlTX5QyGb"
+PHONES_TABLE = "tblCvT47GpZv29jz9"
+CACHE_TTL = 300  # 5 minutes
+
+_stock_cache = {"data": None, "timestamp": 0}
+
+
+def _airtable_get(table_id, params=None):
+    token = os.environ.get("AIRTABLE_TOKEN", "")
+    if not token:
+        raise RuntimeError("AIRTABLE_TOKEN env var not set")
+
+    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table_id}"
+    if params:
+        qs = urllib.parse.urlencode(params)
+        url = f"{url}?{qs}"
+
+    req = urllib.request.Request(url, headers={
+        "Authorization": f"Bearer {token}",
+        "Content-Type": "application/json",
+    })
+    with urllib.request.urlopen(req, timeout=10) as resp:
+        return json.loads(resp.read().decode())
+
+
+def _fetch_phones():
+    data = _airtable_get(PHONES_TABLE)
+    phones = []
+    for rec in data.get("records", []):
+        fields = rec.get("fields", {})
+        phones.append({
+            "phone_id": fields.get("phone_id", 0),
+            "name": fields.get("name", "Unknown"),
+            "videos_per_day": fields.get("videos_per_day", 2),
+        })
+    return phones
+
+
+def _fetch_pending_count(phone_name, platform):
+    formula = f"AND(FIND('{phone_name}', {{content_label}}), {{platform_status_{platform}}}='pending')"
+    data = _airtable_get(CONTENT_LIBRARY_TABLE, {
+        "filterByFormula": formula,
+    })
+    return len(data.get("records", []))
+
+
+def get_content_stock(force_refresh=False):
+    now = time.time()
+    if not force_refresh and _stock_cache["data"] and (now - _stock_cache["timestamp"]) < CACHE_TTL:
+        return _stock_cache["data"]
+
+    try:
+        phones = _fetch_phones()
+        result_phones = []
+        for phone in phones:
+            tk_pending = _fetch_pending_count(phone["name"], "tiktok")
+            ig_pending = _fetch_pending_count(phone["name"], "instagram")
+            vpd = phone["videos_per_day"]
+            result_phones.append({
+                "phone_id": phone["phone_id"],
+                "name": phone["name"],
+                "tiktok_pending": tk_pending,
+                "instagram_pending": ig_pending,
+                "tiktok_days": round(tk_pending / vpd, 1) if vpd else None,
+                "instagram_days": round(ig_pending / vpd, 1) if vpd else None,
+                "videos_per_day": vpd,
+            })
+
+        result = {
+            "phones": result_phones,
+            "last_refresh": datetime.now(timezone.utc).isoformat(),
+            "cache_stale": False,
+        }
+        _stock_cache["data"] = result
+        _stock_cache["timestamp"] = now
+        return result
+
+    except Exception:
+        if _stock_cache["data"]:
+            stale = dict(_stock_cache["data"])
+            stale["cache_stale"] = True
+            return stale
+        raise
diff --git a/insta-phone-SAAS-sneder/tests/test_content_stock.py b/insta-phone-SAAS-sneder/tests/test_content_stock.py
new file mode 100644
index 0000000..fdad803
--- /dev/null
+++ b/insta-phone-SAAS-sneder/tests/test_content_stock.py
@@ -0,0 +1,132 @@
+"""Tests for content stock API + service."""
+
+import json
+import time
+from unittest.mock import patch, MagicMock
+
+import pytest
+
+from app.content_service import get_content_stock, _stock_cache, CACHE_TTL
+
+
+# ── Fixtures ──
+
+MOCK_PHONES = {
+    "records": [
+        {"fields": {"phone_id": 1, "name": "Phone 1", "videos_per_day": 2}},
+        {"fields": {"phone_id": 2, "name": "Phone 2", "videos_per_day": 3}},
+    ]
+}
+
+
+def _mock_pending(count):
+    return {"records": [{"id": f"rec{i}"} for i in range(count)]}
+
+
+def _mock_airtable(table_id, params=None):
+    from app.content_service import PHONES_TABLE
+    if table_id == PHONES_TABLE:
+        return MOCK_PHONES
+    # Content library queries — return 3 records
+    return _mock_pending(3)
+
+
+# ── Tests ──
+
+@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
+def test_stock_returns_structure(mock_at):
+    """Stock endpoint returns correct shape with phones list."""
+    _stock_cache["data"] = None
+    _stock_cache["timestamp"] = 0
+
+    result = get_content_stock(force_refresh=True)
+
+    assert "phones" in result
+    assert "last_refresh" in result
+    assert result["cache_stale"] is False
+    assert len(result["phones"]) == 2
+    phone1 = result["phones"][0]
+    assert phone1["phone_id"] == 1
+    assert phone1["tiktok_pending"] == 3
+    assert phone1["instagram_pending"] == 3
+
+
+@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
+def test_stock_uses_cache(mock_at):
+    """Second call within TTL uses cache, no extra Airtable calls."""
+    _stock_cache["data"] = None
+    _stock_cache["timestamp"] = 0
+
+    get_content_stock(force_refresh=True)
+    call_count_after_first = mock_at.call_count
+
+    get_content_stock()  # should use cache
+    assert mock_at.call_count == call_count_after_first
+
+
+@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
+def test_refresh_invalidates_cache(mock_at):
+    """POST refresh triggers a new Airtable fetch."""
+    _stock_cache["data"] = None
+    _stock_cache["timestamp"] = 0
+
+    get_content_stock(force_refresh=True)
+    first_count = mock_at.call_count
+
+    get_content_stock(force_refresh=True)
+    assert mock_at.call_count > first_count
+
+
+@patch("app.content_service._airtable_get")
+def test_airtable_error_returns_stale_cache(mock_at):
+    """On Airtable error, returns stale data with cache_stale=True."""
+    stale_data = {
+        "phones": [{"phone_id": 1, "name": "Phone 1", "tiktok_pending": 5,
+                     "instagram_pending": 5, "tiktok_days": 2.5,
+                     "instagram_days": 2.5, "videos_per_day": 2}],
+        "last_refresh": "2026-03-22T10:00:00Z",
+        "cache_stale": False,
+    }
+    _stock_cache["data"] = stale_data
+    _stock_cache["timestamp"] = time.time() - CACHE_TTL - 1  # expired
+
+    mock_at.side_effect = Exception("Airtable down")
+    result = get_content_stock()
+
+    assert result["cache_stale"] is True
+    assert result["phones"][0]["tiktok_pending"] == 5
+
+
+@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
+def test_days_calculation_correct(mock_at):
+    """3 pending / 2 per day = 1.5 days."""
+    _stock_cache["data"] = None
+    _stock_cache["timestamp"] = 0
+
+    result = get_content_stock(force_refresh=True)
+    phone1 = result["phones"][0]
+    assert phone1["tiktok_days"] == 1.5  # 3 / 2
+    assert phone1["instagram_days"] == 1.5
+
+
+@patch("app.content_service._airtable_get", side_effect=_mock_airtable)
+def test_days_null_when_zero_vpd(mock_at):
+    """videos_per_day=0 produces days=None."""
+    _stock_cache["data"] = None
+    _stock_cache["timestamp"] = 0
+
+    mock_phones = {
+        "records": [
+            {"fields": {"phone_id": 1, "name": "Phone 1", "videos_per_day": 0}},
+        ]
+    }
+
+    def custom_airtable(table_id, params=None):
+        from app.content_service import PHONES_TABLE
+        if table_id == PHONES_TABLE:
+            return mock_phones
+        return _mock_pending(3)
+
+    mock_at.side_effect = custom_airtable
+    result = get_content_stock(force_refresh=True)
+    assert result["phones"][0]["tiktok_days"] is None
