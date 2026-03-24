diff --git a/Weekly & Daily Plan/planner/rules_engine.py b/Weekly & Daily Plan/planner/rules_engine.py
index e0897b8..99f2e33 100644
--- a/Weekly & Daily Plan/planner/rules_engine.py	
+++ b/Weekly & Daily Plan/planner/rules_engine.py	
@@ -6,19 +6,15 @@ from . import config
 
 
 # ─── R1: Daily Order of Accounts ─────────────────────────────────────────────
-def randomize_phone_order(accounts=None, phones=None):
+def randomize_phone_order(accounts, phones):
     """Randomize the order of phones for the day.
     Within each phone, TikTok and Instagram order is also randomized.
     Returns list of (phone_id, [account_name_1, account_name_2]).
 
     Args:
-        accounts: list of account dicts. Falls back to config.ACCOUNTS if None.
-        phones: list of phone IDs. Falls back to config.PHONES if None.
+        accounts: list of account dicts (required).
+        phones: list of phone IDs (required).
     """
-    if accounts is None:
-        accounts = config.ACCOUNTS
-    if phones is None:
-        phones = config.PHONES
     phones = list(phones)
     random.shuffle(phones)
 
@@ -188,16 +184,14 @@ def should_start_two_day_break(account_state, current_date):
     return days_since >= interval
 
 
-def assign_two_day_break(phone_id, week_dates, state, other_phone_breaks, accounts=None):
+def assign_two_day_break(phone_id, week_dates, state, other_phone_breaks, accounts):
     """Assign a 2-day break to one random account on this phone.
     Ensures no overlap with breaks on other phones.
     Returns (account_name, break_day1, break_day2) or None.
 
     Args:
-        accounts: list of account dicts. Falls back to config.ACCOUNTS if None.
+        accounts: list of account dicts (required).
     """
-    if accounts is None:
-        accounts = config.ACCOUNTS
     phone_accounts = [a for a in accounts if a["phone_id"] == phone_id]
 
     # Find which dates are already taken by other phone breaks
@@ -280,16 +274,14 @@ def apply_post_error(personality):
 
 
 # ─── R15: Cross-Phone Coordination ───────────────────────────────────────────
-def validate_cross_phone(day_date, account_activity, accounts=None):
+def validate_cross_phone(day_date, account_activity, accounts):
     """Ensure at least 1 account on at least 2 phones is active.
     account_activity: dict {account_name: bool (active or not)}
     Returns True if valid, False if violated.
 
     Args:
-        accounts: list of account dicts. Falls back to config.ACCOUNTS if None.
+        accounts: list of account dicts (required).
     """
-    if accounts is None:
-        accounts = config.ACCOUNTS
     active_phones = set()
     for acc in accounts:
         if account_activity.get(acc["name"], True):
diff --git a/Weekly & Daily Plan/planner/scheduler.py b/Weekly & Daily Plan/planner/scheduler.py
index 993bfe9..2ed31c0 100644
--- a/Weekly & Daily Plan/planner/scheduler.py	
+++ b/Weekly & Daily Plan/planner/scheduler.py	
@@ -516,7 +516,7 @@ def generate_weekly_plan(accounts=None, start_date=None, state=None):
 
     Args:
         accounts: list of account dicts with keys: name, phone_id, platform.
-                  Falls back to config.ACCOUNTS if None.
+                  Required -- no default.
         start_date: Any date within the desired week. Defaults to today.
         state: personality/scheduling state dict. If None, starts fresh.
                Mutated in place with updated state after generation.
@@ -525,7 +525,7 @@ def generate_weekly_plan(accounts=None, start_date=None, state=None):
         WeeklyPlan object with all daily plans and summaries.
     """
     if accounts is None:
-        accounts = config.ACCOUNTS
+        raise ValueError("accounts parameter is required")
     if start_date is None:
         start_date = date.today()
     if state is None:
diff --git a/Weekly & Daily Plan/tests/test_parameterization.py b/Weekly & Daily Plan/tests/test_parameterization.py
index 1bd8012..e2db65a 100644
--- a/Weekly & Daily Plan/tests/test_parameterization.py	
+++ b/Weekly & Daily Plan/tests/test_parameterization.py	
@@ -78,6 +78,49 @@ class TestAccountParameterization:
         finally:
             cfg.ACCOUNTS = original
 
+    def test_no_config_accounts_references_in_source(self):
+        """Verify scheduler, rules_engine, personality don't reference config.ACCOUNTS/PHONES."""
+        import inspect
+        from planner import scheduler, rules_engine, personality
+        for mod in [scheduler, rules_engine, personality]:
+            source = inspect.getsource(mod)
+            assert "config.ACCOUNTS" not in source, f"{mod.__name__} still references config.ACCOUNTS"
+            assert "config.PHONES" not in source, f"{mod.__name__} still references config.PHONES"
+
+    def test_randomize_phone_order_requires_params(self, six_accounts):
+        """randomize_phone_order must require accounts and phones params."""
+        from planner.rules_engine import randomize_phone_order
+        phones = [1, 2, 3]
+        result = randomize_phone_order(accounts=six_accounts, phones=phones)
+        assert len(result) == 3
+        all_names = set()
+        for pid, names in result:
+            all_names.update(names)
+        assert len(all_names) == 6
+
+    def test_validate_cross_phone_requires_accounts(self, six_accounts):
+        """validate_cross_phone must require accounts param."""
+        from planner.rules_engine import validate_cross_phone
+        activity = {a["name"]: True for a in six_accounts}
+        assert validate_cross_phone(date(2026, 3, 22), activity, accounts=six_accounts)
+
+    def test_generate_daily_plan_uses_params(self, six_accounts):
+        """generate_daily_plan accepts accounts and phones params."""
+        from planner.scheduler import generate_daily_plan
+        state = {}
+        initialize_all_accounts(state, date(2026, 3, 22), [a["name"] for a in six_accounts])
+        phones = sorted(set(a["phone_id"] for a in six_accounts))
+        # Build minimal weekly_assignments
+        weekly_assignments = {}
+        for acc in six_accounts:
+            weekly_assignments[acc["name"]] = {
+                "rest_day": None, "one_post_day": None,
+                "two_day_break": None, "rest_weekday": None, "one_post_weekday": None,
+            }
+        daily = generate_daily_plan(date(2026, 3, 22), state, weekly_assignments, six_accounts, phones)
+        assert daily.date == date(2026, 3, 22)
+        assert len(daily.sessions) > 0
+
     def test_initialize_all_accounts_accepts_names(self):
         state = {}
         names = ["test_acc_1", "test_acc_2"]
