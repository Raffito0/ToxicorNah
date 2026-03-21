# TDD Plan: Production Integration

## Testing Approach

This project uses **pytest** for unit/integration tests and **FORGE v2** (scrcpy + Gemini analysis) for phone-bot behavior tests. The integration sections here are tested primarily with pytest against real Airtable (integration tests) and mocked Airtable (unit tests). Phone hardware tests use the existing FORGE v2 protocol.

**Test file locations**: `phone-bot/tests/` (new directory)
**Test runner**: `pytest phone-bot/tests/ -v`
**Fixtures**: pytest conftest.py with mock Airtable client, mock Telegram client, mock ADB

---

## Section 1: Environment Configuration & Delivery Path Reconciliation

**Write these tests BEFORE implementing `setup_env.py` and the executor import change.**

```python
# test_setup_env.py

# Test: setup_env validates all required env vars are present
# Test: setup_env raises clear error with variable name when a required var is missing
# Test: setup_env succeeds when all required vars are set (mocked ADB/Airtable/proxy checks)
# Test: setup_env reports which optional vars are missing (ADB_SERIAL_PHONE*) without failing
# Test: .env.template contains all variables listed in the implementation plan
#   → parse .env.template, check all var names exist

# test_executor_imports.py

# Test: executor imports do NOT include push_to_phone
#   → import executor module, verify push_to_phone not in its namespace
# Test: executor successfully calls get_next_video + download_video + mark_posted
#   → confirm these 3 delivery functions remain importable from executor
```

---

## Section 2: Post Retry Logic

**Write these tests BEFORE modifying executor.py and the post action files.**

```python
# test_post_retry.py

# Test: _post_with_retry returns "posted" when post_video() returns "success" on first attempt
# Test: _post_with_retry force-stops app and reopens before second attempt when first returns "retryable"
# Test: _post_with_retry returns "posted" when post_video() returns "success" on second attempt
# Test: _post_with_retry calls save_as_draft() after two "retryable" failures
# Test: _post_with_retry returns "draft" when save_as_draft() succeeds after retry exhaustion
# Test: _post_with_retry returns "failed" and sends Telegram alert when save_as_draft() also fails
# Test: _post_with_retry returns "failed_permanent" immediately on "banned" result (no retry, no draft)
# Test: _post_with_retry returns "failed_permanent" immediately on "media_error" result (no retry)
# Test: DeviceLostError propagates up (not caught by retry loop)
# Test: retry attempts include correct wait between force-stop and reopen (mocked adb)

# test_save_as_draft.py

# Test: TikTokBot.save_as_draft opens post screen, fills caption, taps Save Draft
#   → mock adb, verify sequence of taps matches draft-save flow
# Test: InstagramBot.save_as_draft same pattern for IG draft
```

---

## Section 3: Telegram Production Monitoring

**Write these tests BEFORE implementing telegram_monitor.py.**

```python
# test_telegram_monitor.py

# Test: monitor.send() constructs correct Telegram API POST request (HTML parse mode)
# Test: monitor.session_start() sends message with correct phone/platform/type/post_scheduled info
# Test: monitor.session_result() sends success message with duration and post outcome
# Test: monitor.session_result() sends error message with reason when session fails
# Test: monitor.post_failure() sends 🚨 message with retry count and draft/failed status
# Test: monitor.stock_alert() sends ⚠️ message listing all phones with stock < 14
# Test: monitor.daily_summary() sends summary with session count, post counts, error count, stock levels
# Test: monitor handles 429 rate limit by sleeping retry_after seconds and retrying once
# Test: _html_escape() escapes < > & characters correctly
# Test: _html_escape() does NOT escape apostrophes or quotes (HTML mode is lenient)
# Test: monitor does nothing when PHONEBOT_TELEGRAM_TOKEN is not set (graceful no-op)
```

---

## Section 4: Content Library Stock Monitoring

**Write these tests BEFORE implementing check_content_stock() in executor.**

```python
# test_stock_monitor.py

# Test: check_content_stock returns correct pending count per phone from Airtable
#   → mock Airtable response with known pending counts
# Test: check_content_stock returns 0 for a phone with no pending videos
# Test: run_today marks sessions as warmup-only when phone has stock=0
# Test: run_today still executes session (does not skip) when stock=0 — just skips post phase
# Test: run_today sends stock_alert when any phone has stock < 14
# Test: run_today does NOT send stock_alert when all phones have stock >= 14
# Test: run_today sends critical alert (not just warning) when stock=0
# Test: Airtable failure during stock check does not crash run_today (graceful degradation)
```

---

## Section 5: Cross-Platform Posting Verification

**Write these tests BEFORE shipping to production — these test real Airtable behavior.**

```python
# test_cross_platform_posting.py

# Integration tests — requires real Airtable credentials in env

# Test: get_next_video(phone_id, "tiktok") and get_next_video(phone_id, "instagram")
#   return the SAME record_id for the same pending video
# Test: after mark_posted(record_id, "tiktok"), get_next_video(phone_id, "tiktok") does NOT return that record
# Test: after mark_posted(record_id, "tiktok"), get_next_video(phone_id, "instagram") STILL returns that record
# Test: after mark_posted(record_id, "instagram"), get_next_video(phone_id, "instagram") does NOT return that record
# Test: after both platforms marked posted, get_next_video returns the NEXT record (record B)
#
# Note: This test requires a test record in Airtable with status "pending" for both platforms.
# Clean up: reset both statuses back to "pending" after test run.
```

---

## Section 6: Always-On Service Architecture

**Write these tests BEFORE implementing run_forever() and the control file logic.**

```python
# test_run_forever.py

# Test: run_forever() calls run_today() once per day iteration
# Test: run_forever() stops cleanly after control file contains {"action": "stop"}
# Test: run_forever() does not interrupt an in-progress session — only checks control file between sessions
# Test: atomic_write_control() writes temp file then renames (no partial reads possible)
#   → simulate concurrent read during write, verify no JSONDecodeError
# Test: run_forever() loads new phones added mid-run at the start of the next day

# Manual validation (not automated):
# - Start run_forever() in test mode, write stop action to control.json, verify clean exit
```

---

## Section 7: Multi-Proxy Support

**Write these tests BEFORE modifying proxy.py and config.py.**

```python
# test_multi_proxy.py

# Test: ProxyQueue.switch_to_phone() uses the account's proxy_id to select the correct proxy config
# Test: ProxyQueue.switch_to_phone() raises clear error when proxy_id not found in PROXIES list
# Test: ProxyQueue correctly cycles to account's assigned proxy when phone changes
# Test: config.PROXIES list parses correctly (id, host, port, username, password all present)
# Test: each account in config.ACCOUNTS has a valid proxy_id that exists in PROXIES
```

---

## Section 8: End-to-End Integration Test (Dry Run)

**Write these tests BEFORE implementing the --dry-run flag.**

```python
# test_dry_run.py

# Test: --dry-run flag is accepted by main.py CLI without error
# Test: in dry-run mode, mark_posted() is never called (mock and verify zero calls)
# Test: in dry-run mode, mark_draft() is never called
# Test: in dry-run mode, mark_skipped() is never called
# Test: in dry-run mode, get_next_video() IS called (read-only, allowed)
# Test: in dry-run mode, download_video() IS called (read-only, allowed)
# Test: in dry-run mode, Telegram notifications ARE sent (to verify monitoring works)
# Test: in dry-run mode, scroll duration is shortened (30s not 8-15min)
# Test: delivery module mark_* functions check dry_run=True parameter and return early

# Manual E2E validation (not automated):
# - Run python main.py --dry-run --phone 1
# - Verify: ADB connects, app opens, scroll happens, no post tapped, Telegram message received
# - Verify: Airtable unchanged after run
```

---

## FORGE v2 Validation

Sections that modify phone-bot behavior (Section 2: retry with app-reset) require FORGE v2 validation in addition to pytest:

- **Section 2**: After implementing `_post_with_retry()`, run the FORGE protocol with a simulated post failure to verify app force-stop + reopen sequence works correctly without crashing the session.
- **Section 4**: After implementing warmup-only mode, verify via FORGE that a session with stock=0 still browses normally and exits cleanly without attempting to open the post screen.
