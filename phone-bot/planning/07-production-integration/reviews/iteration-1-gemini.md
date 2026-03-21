# Gemini Review

**Model:** gemini-3-pro-preview
**Generated:** 2026-03-21T17:24:49.637488

---

Here is a senior architectural review of your implementation plan. 

Overall, the plan is pragmatic and well-structured. You’ve correctly identified the missing "glue" needed to take an automation script to production. However, there are several significant architectural footguns, race conditions, and edge cases you need to address before this can run reliably 24/7.

Here is my unconstrained assessment, broken down by category.

---

### 1. Architectural & Lifecycle Issues

**The "Always-On" Python Loop is a Trap (Section 6)**
*   **Problem:** Running a `while True` loop in Python for a system that orchestrates memory-heavy tasks (Gemini Vision API, ADB image pulling, network requests) is highly susceptible to memory leaks and zombie ADB processes. 
*   **Actionable Solution:** Do not use `run_forever()`. Use the OS to your advantage. Configure **Systemd** or **Cron** to trigger `main.py` once per day at midnight. 
    *   If you need to stop it via the dashboard, the dashboard can send a `SIGINT` to the process or use systemctl.
    *   This guarantees a completely fresh memory state, fresh ADB daemon connection, and fresh environment variable loads every single day.

**Race Conditions with Control Files (Section 6)**
*   **Problem:** "Option A: Dashboard writes to `phone-bot/data/control.json`". If Flask writes to this file at the exact millisecond the bot is reading it, you will get a `JSONDecodeError`, and the bot will crash.
*   **Actionable Solution:** Use **SQLite** for dashboard-to-bot communication, or implement strict file locking (e.g., using `filelock` library). SQLite is highly recommended here as it naturally handles concurrent reads/writes and is perfect for a local Flask dashboard.

**The "Double Download" Bandwidth Waste (Section 5)**
*   **Problem:** You noted that downloading the video twice is "fine" because R2 is fast. This is a technical debt trap. What happens when video sizes increase, or you scale to 20 phones? You are wasting bandwidth and relying on the R2 pre-signed URL not expiring between the TikTok and IG sessions (which could be hours apart if TikTok retries).
*   **Actionable Solution:** Download the video *once* to a host machine cache (`phone-bot/cache/record_id.mp4`). Push from the host cache to the phone for TikTok. Delete from phone. Push from host cache to phone for IG. Delete from phone. Delete from host cache when both are done.

---

### 2. Error Handling & State Recovery

**Naive Retry Logic (Section 2)**
*   **Problem:** Waiting 5-10s and retrying `post_video()` assumes the failure was network-related. In UI automation, a failure usually means the app is in an unexpected state (e.g., a random pop-up, stuck on a loading screen, or crashed). If you just retry the post function, the Gemini vision prompt will likely fail again because the UI is wedged.
*   **Actionable Solution:** Between Attempt 1 and Attempt 2, you must **reset the app state**. 
    *   Attempt 1 fails.
    *   Action: Force stop the app (`adb shell am force-stop com.zhiliaoapp.musically`), clear cache, and reopen it.
    *   Attempt 2 runs from a clean slate.

**Boolean Returns hide context (Section 2)**
*   **Problem:** `post_video()` returning `False` is too generic. You cannot distinguish between "No internet", "Video too long", "Account banned", or "Gemini API timeout".
*   **Actionable Solution:** Raise specific exceptions (e.g., `AppWedgeError`, `BannedError`, `MediaFormatError`). Catch these in the retry loop. You shouldn't retry an upload if the account is banned or the video format is rejected.

**Airtable API Flakiness (Risk Mitigation)**
*   **Problem:** You mentioned wrapping `mark_posted` in a try/except, leaving the video as "pending" if Airtable fails. This will cause the bot to post the exact same video twice tomorrow.
*   **Actionable Solution:** Implement a local SQLite cache of `posted_record_ids`. Before pulling from Airtable, check if the ID exists in the local "successfully posted" DB. If `mark_posted` fails due to network issues, the local DB prevents duplicate uploads tomorrow, and a background sync task can update Airtable later.

---

### 3. Monitoring & Notifications

**Blocking Network Calls to Telegram (Section 3)**
*   **Problem:** If you use `requests.post()` inline, and the Telegram API is rate-limiting you or experiencing latency, your bot’s execution halts waiting for the request to resolve. This can throw off precise UI timing.
*   **Actionable Solution:** The `telegram_monitor.py` should place messages into a local `queue.Queue`. A separate lightweight background daemon/thread should consume that queue and send the HTTP requests.

**MarkdownV2 Fragility (Section 3)**
*   **Problem:** Telegram's MarkdownV2 is aggressively strict. If an Airtable record name is "Here's why...", the apostrophe or other symbols will cause a 400 Bad Request, silently dropping your critical error alerts.
*   **Actionable Solution:** Use Telegram's `HTML` parse mode instead. It is vastly more forgiving. You only need to escape `<`, `>`, and `&`.

---

### 4. Configuration & Security

**Missing R2 Credentials (Section 1)**
*   **Problem:** Your `.env` template does not include the Cloudflare R2 credentials (Access Key, Secret Key, Endpoint URL) required for `download_video()`. 

**Static Proxy Config vs Dashboard (Section 7)**
*   **Problem:** You plan to put `PROXIES = [...]` in `config.py`. However, you also state "The dashboard manages proxy assignments". A Flask dashboard cannot easily (or safely) rewrite Python code files.
*   **Actionable Solution:** Move proxy configurations and account mappings entirely into the SQLite database (or a JSON file) that Flask manages. `config.py` should only hold environmental secrets (like `.env`), while *operational state* (proxies, which phone has which account) lives in the DB.

---

### 5. Unclear/Ambiguous Requirements

**"Skip Post" Behavior (Section 4)**
*   **Ambiguity:** "If a phone has 0 [stock], mark all its posting sessions as skip-post for today." 
*   **Question:** Does "skip-post" mean skip the *entire* session, or does it mean the phone should still open TikTok, scroll for 15 minutes to keep the account/algorithm warm, and just skip the final upload phase? 
*   **Recommendation:** Implement "Warmup-Only" mode. If stock is 0, the phone should still do its daily scrolling to avoid looking like a dormant bot to TikTok's anti-spam algorithms.

**E2E Dry Run Mode (Section 8)**
*   **Footgun:** Ensure `--dry-run` explicitly mocks the Airtable update calls. You do not want a dry-run test accidentally marking real pending videos as "draft" or "posted" in your production Airtable base. Pass a `dry_run=True` flag down to the delivery module so it skips the PATCH requests entirely.

### Summary of Recommended Implementation Order Changes
Move **Section 8 (E2E Test / Dry Run)** up to run *immediately after Section 1*. You need the dry-run capability to safely test the Retry Logic (Sec 2) and Telegram Monitors (Sec 3) without actually spamming your social accounts with test videos.

1. Sec 1 (Env Config)
2. Sec 8 (E2E Dry Run infrastructure)
3. Sec 5 (Cross Platform + Host Caching instead of double-download)
4. Sec 2 (Post Retry with App-Reset logic)
5. Sec 3 & 4 (Telegram & Stock Monitors - via background thread)
6. Sec 7 (Multi-Proxy via Database, not config.py)
7. Sec 6 (Cron/Systemd scheduling + SQLite control, abandon `run_forever()`)
