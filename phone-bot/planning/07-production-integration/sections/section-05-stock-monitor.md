# Section 05: Content Library Stock Monitor

## Overview

This section adds stock awareness to the executor so the bot never blindly attempts to post when no videos are available. At the start of each day, the bot queries Airtable for each phone's pending video count, sends alerts when stock is low, and switches affected phones to **warmup-only mode** (browse + scroll, no post attempt) when stock hits zero.

**Dependencies**: section-04-telegram-monitor must be complete — the `stock_alert()` method on `TelegramMonitor` must already exist before wiring this section.

**Blocks**: section-06-always-on depends on this section being stable.

---

## Background

The Content Library (`tblx1KX7mlTX5QyGb` in Airtable) tracks videos per phone with two independent status fields: `platform_status_tiktok` and `platform_status_instagram`. Videos start as `pending` and move to `posted`/`draft`/`skipped` after delivery. At production levels (2 posts/day per platform), a phone with only 3 videos runs dry in less than 2 days.

**Critical behaviour**: stock=0 does NOT mean skip the session. The phone still opens TikTok/Instagram, scrolls for the full pre-activity duration, and engages normally. Only the post phase is skipped. This keeps the account algorithmically active and prevents it from looking dormant.

**Decision matrix**:
- Stock >= 14 → normal posting
- Stock 1–13 → post normally, but send Telegram warning
- Stock 0 → warmup-only mode for all of this phone's sessions today + send critical Telegram alert

The threshold of 14 represents a 7-day buffer at 2 posts/day, matching the n8n Hook Generator's buffer logic.

---

## Tests (write first)

File: `phone-bot/tests/test_stock_monitor.py`

```python
# phone-bot/tests/test_stock_monitor.py

# Test: check_content_stock returns correct pending count per phone from Airtable
#   → mock Airtable response for Phone 1 (5 pending), Phone 2 (0 pending), Phone 3 (14 pending)
#   → assert return is {1: 5, 2: 0, 3: 14}

# Test: check_content_stock returns 0 for a phone with no pending videos
#   → mock Airtable response with empty records list
#   → assert phone count is 0, no exception raised

# Test: run_today marks sessions as warmup-only when phone has stock=0
#   → mock stock = {1: 0}
#   → run run_today with Phone 1 sessions
#   → assert post phase never called (mock post_video, verify call_count == 0)

# Test: run_today still executes the session (does not skip) when stock=0
#   → mock stock = {2: 0}
#   → assert session is entered, scroll/browse happens (browse_session mock called)
#   → assert post_video NOT called

# Test: run_today sends stock_alert when any phone has stock < 14
#   → mock stock = {1: 13, 2: 20, 3: 14}  (Phone 1 is below threshold)
#   → verify monitor.stock_alert() called once with phone_id=1, count=13

# Test: run_today does NOT send stock_alert when all phones have stock >= 14
#   → mock stock = {1: 14, 2: 30, 3: 20}
#   → verify monitor.stock_alert() never called

# Test: run_today sends critical alert (not just warning) when stock=0
#   → mock stock = {3: 0}
#   → verify monitor.stock_alert() called with critical=True for Phone 3

# Test: Airtable failure during stock check does not crash run_today
#   → mock check_content_stock to raise requests.ConnectionError
#   → assert run_today does NOT raise
#   → assert all sessions proceed as normal (no warmup-only mode assumed)
#   → assert a warning is logged
```

Run tests with: `pytest phone-bot/tests/test_stock_monitor.py -v`

---

## Implementation

### 1. Add `check_content_stock()` to `phone-bot/planner/executor.py`

```python
def check_content_stock(phones: list[int]) -> dict[int, int]:
    """
    Query Airtable for pending video count per phone.

    Uses the same Airtable pattern as delivery.content_library:
    filter formula: AND(FIND('Phone N', {content_label}), {platform_status_tiktok}='pending')

    Returns {phone_id: count} for each phone in the input list.
    On any Airtable error, logs a warning and returns {} (caller treats as unknown stock).
    """
```

Implementation notes:
- Use `AIRTABLE_API_KEY` from `os.environ` and Content Library table ID `tblx1KX7mlTX5QyGb`.
- Query formula per phone: `AND(FIND('Phone {n}', {{content_label}}), {{platform_status_tiktok}}='pending')`.
- Use `len(response_json["records"])` count — do NOT use a `COUNT` formula (Airtable doesn't support aggregate formulas in filter context).
- Wrap entire function body in `try/except Exception` — log the error and return `{}` so callers treat it as unknown stock.
- Airtable base ID: `appsgjIdkpak2kaXq`
- Table ID: `tblx1KX7mlTX5QyGb` (Content Library)
- Auth header: `Authorization: Bearer {AIRTABLE_API_KEY}`
- Endpoint: `GET https://api.airtable.com/v0/{baseId}/{tableId}?filterByFormula=...`

### 2. Call stock check at the start of `run_today()`

At the very top of `run_today()`, before the session loop:

```python
phone_ids = list({s.phone for s in today_sessions})
stock = check_content_stock(phone_ids)

for phone_id, count in stock.items():
    if count == 0:
        monitor.stock_alert(phone_id=phone_id, count=0, critical=True)
    elif count < 14:
        monitor.stock_alert(phone_id=phone_id, count=count, critical=False)
```

If `check_content_stock()` returned `{}` (Airtable failure), the loop does nothing — no alerts, no mode changes. All sessions proceed as normal.

### 3. Implement warmup-only mode in the session loop

Before calling `_execute_normal()` for any session, check whether the phone's stock is 0:

```python
phone_stock = stock.get(session.phone, None)
warmup_only = (phone_stock is not None and phone_stock == 0)

if warmup_only and session.post_scheduled:
    # Override: treat as scroll-only (account must stay active)
    _execute_scroll_only(session, bot)
else:
    _execute_normal(session, bot)
```

The `_execute_scroll_only()` path must:
1. Open the app.
2. Run pre-activity scroll for the scheduled `pre_activity_minutes`.
3. Skip the post phase entirely (no call to `_post_with_retry()`).
4. Run post-activity scroll for `post_activity_minutes`.
5. Close the app naturally.

If `_execute_scroll_only()` already exists (from warmup logic), reuse it. If not, add it now. It is functionally equivalent to a `post_scheduled=False` normal session.

---

## Edge Cases

**Airtable timeout**: Wrap in `try/except`, return `{}`. All sessions run normally — better to over-post than to incorrectly block an account.

**Phone not in stock dict**: If `stock.get(phone_id)` returns `None` (Airtable failed or phone was added after the check), treat as normal (not warmup-only). The `phone_stock is not None` guard handles this.

**Stock drops to 0 mid-day**: The stock check only runs once at the start of `run_today()`. If stock depletes during the day (unlikely at current scale), the next day's check will catch it. Mid-day protection is out of scope for this section.

**Multiple phones at 0**: Each phone is evaluated independently. If both Phone 1 and Phone 3 have 0 stock, both get critical alerts and both run scroll-only all day.

---

## FORGE v2 Validation

After implementing warmup-only mode, run a FORGE v2 test with `stock=0` mocked for one phone to verify:
1. The session opens the app normally.
2. Browse/scroll happens for the full pre-activity duration.
3. The post screen is never opened.
4. The app closes cleanly.
5. No errors in the log.

---

## Files Modified (Actual)

| File | Change |
|------|--------|
| `phone-bot/planner/executor.py` | Added `check_content_stock()` with Airtable pagination + per-phone error handling. Added stock check + alert dispatch in `run_today()` Phase 2. Added warmup-only override (sets `post_scheduled=False` via shallow copy). Added `urllib.request`, `urllib.error`, `urllib.parse` imports. |
| `phone-bot/core/telegram_monitor.py` | No changes needed — `stock_alert()` was fully implemented in section-04 already |
| `phone-bot/tests/test_stock_monitor.py` | New test file — 16 tests covering stock check, pagination, partial failure, alerts, warmup-only logic |

### Deviations from Plan

1. **Pagination**: Plan did not mention Airtable pagination. Added pagination loop following `offset` to handle >100 records correctly (code review fix).
2. **Per-phone error handling**: Plan wrapped entire stock check in single try/except. Changed to per-phone try/except so partial results are returned when one phone's query fails (code review fix).
3. **telegram_monitor.py unchanged**: Plan said `stock_alert()` would be "fully implemented here", but it was already complete in section-04.
4. **No `_execute_scroll_only()` needed**: Warmup-only mode achieved by overriding `post_scheduled=False` in the session dict before `execute_session()`, which reuses the existing normal session flow with no-post behavior.
5. **16 tests instead of 8**: Added tests for pagination, partial failure, URL construction, multiple phones at zero.

---

## Acceptance Criteria

- [x] `pytest phone-bot/tests/test_stock_monitor.py -v` — all 16 tests pass
- [ ] When `AIRTABLE_API_KEY` is valid, `check_content_stock()` returns real counts from Airtable
- [ ] FORGE v2: warmup-only mode verified on real hardware — session runs, no post attempted
- [x] When Airtable fails, `run_today()` continues normally (no crash, no incorrect warmup mode)
