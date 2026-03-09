"""Query Content Library (Airtable) for pending videos."""
import json
import urllib.request
import urllib.parse

from .config import AIRTABLE_API, AIRTABLE_TOKEN, PHONE_LABELS


def _airtable_get(params: dict) -> dict:
    """GET request to Airtable Content Library."""
    qs = urllib.parse.urlencode(params)
    url = f"{AIRTABLE_API}?{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {AIRTABLE_TOKEN}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def get_next_video(phone_id: int, platform: str) -> dict | None:
    """Get the next pending video for a phone+platform combo.

    Returns dict with keys: record_id, video_url, caption, scenario_name
    or None if no pending videos.
    """
    label = PHONE_LABELS.get(phone_id, f"Phone {phone_id}")
    platform_field = f"platform_status_{platform}"

    formula = f"AND(FIND('{label}', {{content_label}}), {{{platform_field}}}='pending')"

    data = _airtable_get({
        "filterByFormula": formula,
        "maxRecords": 1,
    })

    records = data.get("records", [])
    if not records:
        return None

    rec = records[0]
    fields = rec.get("fields", {})

    return {
        "record_id": rec["id"],
        "video_url": fields.get("video_url", ""),
        "caption": fields.get("social_caption", ""),
        "scenario_name": fields.get("scenario_name", ""),
    }


def get_pending_count(phone_id: int, platform: str) -> int:
    """Count pending videos for a phone+platform combo."""
    label = PHONE_LABELS.get(phone_id, f"Phone {phone_id}")
    platform_field = f"platform_status_{platform}"

    formula = f"AND(FIND('{label}', {{content_label}}), {{{platform_field}}}='pending')"

    data = _airtable_get({
        "filterByFormula": formula,
    })

    return len(data.get("records", []))
