<!-- PROJECT_CONFIG
runtime: python-pip
test_command: python -m pytest phone-bot/tests/ -v
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-env-config
section-02-cross-platform
section-03-post-retry
section-04-telegram-monitor
section-05-stock-monitor
section-06-always-on
section-07-multi-proxy
section-08-e2e-test
END_MANIFEST -->

# Implementation Sections Index

Sections are ordered by implementation dependency (matches plan's recommended order: Plan §1 → §5 → §2 → §3 → §4 → §6 → §7 → §8).

## Dependency Graph

| Section | Plan Section | Depends On | Blocks | Parallelizable |
|---------|-------------|------------|--------|----------------|
| section-01-env-config | §1 | — | all | No |
| section-02-cross-platform | §5 | 01 | 03 | No |
| section-03-post-retry | §2 | 02 | 04 | No |
| section-04-telegram-monitor | §3 | 03 | 05 | No |
| section-05-stock-monitor | §4 | 04 | 06 | No |
| section-06-always-on | §6 | 05 | 07, 08 | No |
| section-07-multi-proxy | §7 | 06 | 08 | No |
| section-08-e2e-test | §8 | 06, 07 | — | No |

## Execution Order

1. **section-01-env-config** — no dependencies, must be first
2. **section-02-cross-platform** — verifies delivery logic before adding retry
3. **section-03-post-retry** — core posting reliability
4. **section-04-telegram-monitor** — monitoring infrastructure
5. **section-05-stock-monitor** — uses Telegram monitor from section-04
6. **section-06-always-on** — service lifecycle (requires all monitoring in place)
7. **section-07-multi-proxy** — scaling infrastructure
8. **section-08-e2e-test** — validates everything end-to-end

## Section Summaries

### section-01-env-config
Remove unused `push_to_phone` from executor imports. Create `.env.template` with all required variables (including R2 credentials). Create `setup_env.py` validator that checks all env vars, tests ADB connections, tests Airtable connectivity, and tests proxy reachability before first production run.

**Tests**: `test_setup_env.py` — validate env var presence, missing var error messages, push_to_phone removed from executor imports.

### section-02-cross-platform
Write `phone-bot/tests/test_cross_platform_posting.py` — integration tests against real Airtable verifying that: (a) TikTok and IG sessions get the same video record, (b) marking TikTok posted doesn't affect IG's pending query, (c) after both platforms posted, the next query returns the next record. No code changes to executor; this section is pure verification.

**Tests**: The tests ARE the deliverable for this section.

### section-03-post-retry
Add `_post_with_retry()` to `executor.py` with app-reset (force-stop + reopen) between retries. Update `post_video()` and `post_reel()` to return result codes (`"success"` | `"retryable"` | `"banned"` | `"media_error"`) instead of bare booleans. Add `save_as_draft()` to both `TikTokBot` and `InstagramBot`.

**Tests**: `test_post_retry.py` — all retry flow paths, app reset sequence, draft fallback, permanent failure types.

### section-04-telegram-monitor
Create `phone-bot/core/telegram_monitor.py` — singleton with HTML parse mode (not MarkdownV2), `_html_escape()` helper, 429 retry handling, and methods: `session_start()`, `session_result()`, `post_failure()`, `stock_alert()`, `daily_summary()`. Wire into `executor.py` at session start/end/error. Add `TELEGRAM` config section to `config.py`.

**Tests**: `test_telegram_monitor.py` — message construction, HTML escaping, 429 handling, no-op when token missing.

### section-05-stock-monitor
Add `check_content_stock()` to executor — queries Airtable pending count per phone at start of `run_today()`. Implement warmup-only mode: when stock=0, session opens app and scrolls normally but skips the post phase entirely (account stays active). Send `stock_alert()` for < 14 videos, critical alert for 0.

**Tests**: `test_stock_monitor.py` — correct pending counts, warmup-only session execution, alert thresholds, graceful Airtable failure.

### section-06-always-on
Add `run_forever()` to `main.py` — daily loop that loads/generates plan, runs today, waits for midnight. Implement atomic control file writes (`os.replace()`) for race-condition-free dashboard communication. Add `check_new_phones()` to executor for dynamic phone addition at day start.

**Tests**: `test_run_forever.py` — stops on control file, doesn't interrupt session, atomic writes.

### section-07-multi-proxy
Change `config.PROXY` to `config.PROXIES` list. Add `proxy_id` field to each account in `config.ACCOUNTS`. Update `proxy.py`'s `ProxyQueue.switch_to_phone()` to look up proxy by account's `proxy_id`.

**Tests**: `test_multi_proxy.py` — correct proxy selection by id, error on missing proxy_id, config validation.

### section-08-e2e-test
Add `--dry-run` flag to `main.py` CLI. Thread `dry_run=True` through executor to all delivery module calls. Make `mark_posted/draft/skipped()` no-ops when `dry_run=True`. Shorten scroll duration in dry-run mode. Full manual E2E validation: run `python main.py --dry-run --phone 1`, verify ADB connects, app opens, scroll happens, no post tapped, Telegram message received, Airtable unchanged.

**Tests**: `test_dry_run.py` — dry-run flag accepted, mark_* never called, get_next_video/download_video still called, Telegram still sends.
