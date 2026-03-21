# Section 01 Diff: Environment Configuration & Delivery Path Reconciliation

## Changes Made

### 1. `phone-bot/planner/executor.py` — Remove `push_to_phone` from delivery import

```diff
- from delivery import get_next_video, download_video, push_to_phone, mark_posted, mark_draft, mark_skipped
+ from delivery import get_next_video, download_video, mark_posted, mark_draft, mark_skipped

  except ImportError:
-     get_next_video = download_video = push_to_phone = mark_posted = mark_draft = mark_skipped = None
+     get_next_video = download_video = mark_posted = mark_draft = mark_skipped = None
```

**Why**: `push_to_phone()` is imported but never called. The executor uses `adb.push_file()` directly via the already-connected ADB controller. The delivery module's real role is: get_next_video (Airtable query) + download_video (R2 download) + mark_posted/draft/skipped (status updates). Removing the dead import clarifies the architecture.

### 2. `phone-bot/.env.template` — NEW FILE

Documents all required environment variables with inline comments explaining each one's purpose. 13 required vars + 3 optional ADB serial vars.

### 3. `phone-bot/setup_env.py` — NEW FILE

Pre-production validator that:
- `validate_env()`: checks all 13 required vars are set, raises `ValueError(missing_var_name)` if any absent, warns for optional ADB serials
- `check_adb_connections()`: runs `adb devices`, non-fatal if none found or adb not installed
- `check_airtable(api_key)`: GET /v0/meta/bases to validate API key
- `check_proxy(host, port)`: TCP connect to sinister.services:20002
- `check_gemini(api_key)`: GET generativelanguage.googleapis.com/v1beta/models
- `run_setup_checks()`: orchestrates all checks, returns True only if all required checks pass
- `__main__`: loads `.env` file if present, calls `run_setup_checks()`, exits 0/1

### 4. `phone-bot/tests/test_setup_env.py` — NEW FILE

5 tests:
- `test_validate_env_passes_when_all_required_set` — no exception with all vars
- `test_validate_env_raises_with_var_name_when_missing` — ValueError with var name in message
- `test_run_setup_checks_passes_when_all_mocked` — returns True with mocked connectivity
- `test_validate_env_does_not_fail_when_optional_vars_missing` — optional vars missing = no exception
- `test_env_template_contains_all_required_vars` — all 13 required vars in .env.template

### 5. `phone-bot/tests/test_executor_imports.py` — NEW FILE

4 tests:
- `test_push_to_phone_not_in_executor_source` — no reference to push_to_phone in source
- `test_delivery_import_line_does_not_include_push_to_phone` — import line clean
- `test_executor_imports_valid_delivery_functions` — get_next_video/download_video/mark_posted still present
- `test_importerror_stub_does_not_assign_push_to_phone` — stub doesn't assign push_to_phone=None

## Test Results

```
9 passed, 4 warnings in 0.11s
```
All tests pass.
