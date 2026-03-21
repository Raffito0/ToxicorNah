"""Update Content Library record status in Airtable."""
import json
import logging
import urllib.request

from .config import AIRTABLE_API, AIRTABLE_TOKEN

log = logging.getLogger(__name__)


def _airtable_patch(record_id: str, fields: dict) -> dict:
    """PATCH a single record in Content Library."""
    url = f"{AIRTABLE_API}/{record_id}"
    body = json.dumps({"fields": fields}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "Authorization": f"Bearer {AIRTABLE_TOKEN}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def mark_posted(record_id: str, platform: str, dry_run: bool = False) -> dict | None:
    """Mark a video as posted for a specific platform.

    In dry_run mode, logs the call and returns without writing to Airtable.
    """
    if dry_run:
        log.info("DRY RUN: would mark_posted %s [%s]", record_id, platform)
        return None
    return _airtable_patch(record_id, {
        f"platform_status_{platform}": "posted",
    })


def mark_draft(record_id: str, platform: str, dry_run: bool = False) -> dict | None:
    """Mark a video as saved to drafts (Rule R14 draft error).

    In dry_run mode, logs the call and returns without writing to Airtable.
    """
    if dry_run:
        log.info("DRY RUN: would mark_draft %s [%s]", record_id, platform)
        return None
    return _airtable_patch(record_id, {
        f"platform_status_{platform}": "draft",
    })


def mark_skipped(record_id: str, platform: str, dry_run: bool = False) -> dict | None:
    """Mark a video as skipped (Rule R14 changed mind).

    In dry_run mode, logs the call and returns without writing to Airtable.
    """
    if dry_run:
        log.info("DRY RUN: would mark_skipped %s [%s]", record_id, platform)
        return None
    return _airtable_patch(record_id, {
        f"platform_status_{platform}": "skipped",
    })
