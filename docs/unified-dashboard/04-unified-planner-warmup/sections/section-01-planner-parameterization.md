# Section 01: Planner Parameterization

## Goal

Refactor the planner module (`Weekly & Daily Plan/planner/`) so that `scheduler.py`, `rules_engine.py`, and `personality.py` accept an `accounts` list as a parameter instead of reading the hardcoded `config.ACCOUNTS` and `config.PHONES`. Also remove file I/O for personality state from `personality.py` (the caller will be responsible for loading/saving state). After this section, the planner can generate plans for any arbitrary set of accounts passed in at runtime.

## Background

Currently, the planner has a hardcoded list of 6 accounts in `config.py`:

```python
ACCOUNTS = [
    {"name": "ph1_tiktok",    "phone_id": 1, "platform": "tiktok"},
    {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    # ... 4 more
]
PHONES = [1, 2, 3]
```

Every function that iterates over accounts reads `config.ACCOUNTS` directly. Every function that iterates over phones reads `config.PHONES`. The personality module reads/writes state to `state/account_state.json` via `load_state()` / `save_state()`.

This must change so the dashboard service layer can pass in accounts queried from the database, and personality state managed through DB columns rather than flat files.

## Files to Modify

All files are under `Weekly & Daily Plan/planner/`:

| File | What Changes |
|------|-------------|
| `scheduler.py` | `generate_weekly_plan()`, `_assign_weekly_special_days()`, `generate_daily_plan()` accept `accounts` param; derive phones from accounts |
| `rules_engine.py` | `randomize_phone_order()`, `validate_cross_phone()`, `assign_two_day_break()` accept accounts/phones as params instead of reading config |
| `personality.py` | `initialize_all_accounts()` accepts account name list; `load_state()` / `save_state()` removed (state passed in/out) |
| `models.py` | Add `engagement_caps: dict | None = None` field to `Session` dataclass and its `to_dict()` method |
| `config.py` | `ACCOUNTS` and `PHONES` kept as defaults for backward compatibility but no longer imported by scheduler/rules/personality |

## Tests (Write First)

Test file: `Weekly & Daily Plan/tests/test_parameterization.py`

```python
"""Tests for planner parameterization -- accounts as parameter."""
import pytest
from datetime import date


@pytest.fixture
def two_accounts():
    """Minimal account list: 1 phone, 2 accounts."""
    return [
        {"name": "ph1_tiktok", "phone_id": 1, "platform": "tiktok"},
        {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    ]

@pytest.fixture
def eight_accounts():
    """Larger account list: 4 phones, 8 accounts."""
    accounts = []
    for phone_id in range(1, 5):
        accounts.append({"name": f"ph{phone_id}_tiktok", "phone_id": phone_id, "platform": "tiktok"})
        accounts.append({"name": f"ph{phone_id}_instagram", "phone_id": phone_id, "platform": "instagram"})
    return accounts

@pytest.fixture
def six_accounts():
    """Standard 3-phone, 6-account list (matches original config)."""
    accounts = []
    for phone_id in range(1, 4):
        accounts.append({"name": f"ph{phone_id}_tiktok", "phone_id": phone_id, "platform": "tiktok"})
        accounts.append({"name": f"ph{phone_id}_instagram", "phone_id": phone_id, "platform": "instagram"})
    return accounts


# Test: generate_weekly_plan accepts accounts list and produces valid plan
# Test: generate_weekly_plan with 2 accounts (1 phone) produces valid plan
# Test: generate_weekly_plan with 8 accounts (4 phones) produces valid plan
# Test: PHONES list derived correctly from accounts param
# Test: _assign_weekly_special_days works with dynamic accounts
# Test: generate_daily_plan works with dynamic accounts
# Test: validate_cross_phone works with dynamic phone list param
# Test: randomize_phone_order works with accounts param, not config.PHONES
# Test: personality state passed in via param, updated state returned (no file I/O)
# Test: initialize_all_accounts accepts account name list, not config.ACCOUNTS
# Test: config.ACCOUNTS is not referenced during generate_weekly_plan call path
# Test: Session dataclass has engagement_caps field, defaults to None
# Test: Session.to_dict() includes engagement_caps key
```

## Implementation Details

### 1. `models.py` -- Add `engagement_caps` to Session

Add the field to the `Session` dataclass:

```python
@dataclass
class Session:
    # ... existing fields ...
    engagement_caps: dict | None = None  # None for regular sessions
```

Add to `to_dict()`:

```python
def to_dict(self):
    return {
        # ... existing keys ...
        "engagement_caps": self.engagement_caps,
    }
```

### 2. `personality.py` -- Remove file I/O, accept params

**Remove** `load_state()` and `save_state()` functions entirely.

**Modify** `initialize_all_accounts()`:

New signature:
```python
def initialize_all_accounts(state, current_date, account_names: list[str]):
    """Ensure all accounts have state and refresh personalities if needed."""
    for name in account_names:
        acc_state = get_account_state(state, name)
        maybe_refresh_personality(acc_state, current_date)
    return state
```

Remove `from . import config` if it was only used for `config.ACCOUNTS`. Keep if `config.RULES` is still needed.

### 3. `rules_engine.py` -- Accept accounts/phones as params

Three functions to update:

**`randomize_phone_order(accounts, phones)`** -- accepts accounts and phones as params instead of reading config.

**`validate_cross_phone(day_date, account_activity, accounts)`** -- accepts accounts list.

**`assign_two_day_break(phone_id, week_dates, state, other_phone_breaks, accounts)`** -- accepts accounts for filtering.

After these changes, `rules_engine.py` should no longer import `config.ACCOUNTS` or `config.PHONES`.

### 4. `scheduler.py` -- Accept accounts param throughout

**`generate_weekly_plan(accounts, start_date=None, state=None)`**:
- Derive phones: `phones = sorted(set(a['phone_id'] for a in accounts))`
- Use `state` parameter instead of calling `load_state()`
- Call `initialize_all_accounts(state, start_date, [a['name'] for a in accounts])`
- Pass `accounts` and `phones` to all internal functions
- Do NOT call `save_state()` -- caller saves

**`_assign_weekly_special_days(state, week_dates, accounts, phones)`** -- replace config references.

**`generate_daily_plan(day_date, state, weekly_assignments, accounts, phones)`** -- replace config references.

**`_build_session()`** -- already receives individual account dict. No signature change needed.

### 5. Backward Compatibility for CLI

`main.py` should pass `config.ACCOUNTS` explicitly:
```python
plan = generate_weekly_plan(accounts=config.ACCOUNTS)
```

## Summary of All References to Update

| File | Current | Change To |
|------|---------|-----------|
| `scheduler.py` (7 refs) | `config.ACCOUNTS` / `config.PHONES` | `accounts` / `phones` params |
| `personality.py` (1 ref) | `config.ACCOUNTS` in `initialize_all_accounts` | `account_names` param |
| `rules_engine.py` (5 refs) | `config.ACCOUNTS` / `config.PHONES` | `accounts` / `phones` params |

Total: 13 references across 3 files.

## Verification Checklist

1. All tests in `test_parameterization.py` pass
2. Existing `validate.py` still passes when called with `config.ACCOUNTS` explicitly
3. `stress_test.py` still passes (20 runs, 100% pass rate)
4. `grep -rn "config\.ACCOUNTS\|config\.PHONES" scheduler.py rules_engine.py personality.py` returns zero matches
5. `personality.py` has no `open()`, `os.path.exists()`, or `json.dump()`/`json.load()` calls
