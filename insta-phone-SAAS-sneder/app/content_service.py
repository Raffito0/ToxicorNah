"""Content Library stock service — queries Airtable for pending video counts."""

import json
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

AIRTABLE_BASE_ID = "appsgjIdkpak2kaXq"
CONTENT_LIBRARY_TABLE = "tblx1KX7mlTX5QyGb"
PHONES_TABLE = "tblCvT47GpZv29jz9"
CACHE_TTL = 300  # 5 minutes

_stock_cache = {"data": None, "timestamp": 0}


def _airtable_get(table_id, params=None):
    token = os.environ.get("AIRTABLE_TOKEN", "")
    if not token:
        raise RuntimeError("AIRTABLE_TOKEN env var not set")

    url = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table_id}"
    if params:
        qs = urllib.parse.urlencode(params)
        url = f"{url}?{qs}"

    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _fetch_phones():
    data = _airtable_get(PHONES_TABLE)
    phones = []
    for rec in data.get("records", []):
        fields = rec.get("fields", {})
        phones.append({
            "phone_id": fields.get("phone_id", 0),
            "name": fields.get("name", "Unknown"),
            "videos_per_day": fields.get("videos_per_day", 2),
        })
    return phones


def _fetch_pending_count(phone_name, platform):
    formula = f"AND(FIND('{phone_name}', {{content_label}}), {{platform_status_{platform}}}='pending')"
    data = _airtable_get(CONTENT_LIBRARY_TABLE, {
        "filterByFormula": formula,
    })
    return len(data.get("records", []))


def get_content_stock(force_refresh=False):
    now = time.time()
    if not force_refresh and _stock_cache["data"] and (now - _stock_cache["timestamp"]) < CACHE_TTL:
        return _stock_cache["data"]

    try:
        phones = _fetch_phones()
        result_phones = []
        for phone in phones:
            tk_pending = _fetch_pending_count(phone["name"], "tiktok")
            ig_pending = _fetch_pending_count(phone["name"], "instagram")
            vpd = phone["videos_per_day"]
            result_phones.append({
                "phone_id": phone["phone_id"],
                "name": phone["name"],
                "tiktok_pending": tk_pending,
                "instagram_pending": ig_pending,
                "tiktok_days": round(tk_pending / vpd, 1) if vpd else None,
                "instagram_days": round(ig_pending / vpd, 1) if vpd else None,
                "videos_per_day": vpd,
            })

        result = {
            "phones": result_phones,
            "last_refresh": datetime.now(timezone.utc).isoformat(),
            "cache_stale": False,
        }
        _stock_cache["data"] = result
        _stock_cache["timestamp"] = now
        return result

    except Exception:
        if _stock_cache["data"]:
            stale = dict(_stock_cache["data"])
            stale["cache_stale"] = True
            return stale
        raise
