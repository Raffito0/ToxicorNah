diff --git a/phone-bot/planner/executor.py b/phone-bot/planner/executor.py
index 03d44d4..0ba6068 100644
--- a/phone-bot/planner/executor.py
+++ b/phone-bot/planner/executor.py
@@ -230,17 +230,57 @@ class SessionExecutor:
     # --- Warmup State Persistence ------------------------------------------
 
     def _load_warmup_state(self):
-        """Load warmup state from disk."""
+        """Load warmup state — DB first (BotAccount.warmup_json), JSON file fallback."""
+        # Try DB first
+        if _db_available():
+            try:
+                conn = _get_db()
+                rows = conn.execute(
+                    "SELECT username, warmup_json FROM bot_account WHERE warmup_json IS NOT NULL"
+                ).fetchall()
+                conn.close()
+                if rows:
+                    for row in rows:
+                        username, wj = row[0], row[1]
+                        if not wj:
+                            continue
+                        state_dict = json.loads(wj) if isinstance(wj, str) else wj
+                        self.warmup_states[username] = AccountWarmupState.from_dict(state_dict)
+                    log.info("Loaded warmup state for %d accounts from DB", len(self.warmup_states))
+                    return
+            except Exception as e:
+                log.warning("Failed to load warmup state from DB: %s", e)
+
+        # Fallback to JSON file
         if os.path.exists(WARMUP_STATE_FILE):
             with open(WARMUP_STATE_FILE, "r") as f:
                 data = json.load(f)
             for name, state_dict in data.items():
                 self.warmup_states[name] = AccountWarmupState.from_dict(state_dict)
-            log.info("Loaded warmup state for %d accounts", len(self.warmup_states))
+            log.info("Loaded warmup state for %d accounts from file", len(self.warmup_states))
 
     def _save_warmup_state(self):
-        """Save warmup state to disk (atomic: write .tmp then os.replace)."""
+        """Save warmup state — DB first (BotAccount.warmup_json), JSON file fallback."""
         data = {name: state.to_dict() for name, state in self.warmup_states.items()}
+
+        # Try DB first
+        if _db_available() and self._account_db_ids:
+            try:
+                conn = _get_db()
+                for name, state_dict in data.items():
+                    db_id = self._account_db_ids.get(name)
+                    if db_id:
+                        conn.execute(
+                            "UPDATE bot_account SET warmup_json = ? WHERE id = ?",
+                            (json.dumps(state_dict), db_id)
+                        )
+                conn.commit()
+                conn.close()
+                return
+            except Exception as e:
+                log.warning("Failed to save warmup state to DB: %s", e)
+
+        # Fallback to JSON file
         tmp_path = WARMUP_STATE_FILE + ".tmp"
         with open(tmp_path, "w") as f:
             json.dump(data, f, indent=2)
diff --git a/phone-bot/tests/test_executor_db.py b/phone-bot/tests/test_executor_db.py
new file mode 100644
index 0000000..7c09c63
--- /dev/null
+++ b/phone-bot/tests/test_executor_db.py
@@ -0,0 +1,533 @@
+"""Tests for executor DB integration.
+
+Covers:
+- DB plan reading (WeeklyPlan table)
+- UTC to Eastern time conversion
+- Warmup state from DB (BotAccount.warmup_json)
+- SessionLog writing (start/end/error)
+- Backward compatibility (JSON file fallback when DB unavailable)
+
+These tests use a minimal approach: they import the standalone functions
+from executor.py by loading only the needed symbols, avoiding the full
+import chain (which requires OCR/Gemini/ADB deps not available in test env).
+"""
+import json
+import sqlite3
+import sys
+import types
+from datetime import datetime, timezone
+from unittest.mock import patch
+
+import pytest
+
+
+# ---------------------------------------------------------------------------
+# Bootstrap: register enough of the phone_bot package so executor.py
+# can import without pulling in heavy deps (OCR, Gemini, ADB hardware).
+# The conftest.py already sets up phone_bot.config, phone_bot.core.adb, etc.
+# We need to add phone_bot.planner and mock heavy sub-imports.
+# ---------------------------------------------------------------------------
+
+def _ensure_executor_importable():
+    """Register phone_bot.planner.executor in sys.modules with mocked deps."""
+    mod_name = "phone_bot.planner.executor"
+    if mod_name in sys.modules:
+        return sys.modules[mod_name]
+
+    import importlib.util
+    import os
+
+    phone_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
+    _PKG = "phone_bot"
+
+    # Ensure planner sub-package exists
+    planner_pkg_name = f"{_PKG}.planner"
+    if planner_pkg_name not in sys.modules:
+        planner_dir = os.path.join(phone_bot_dir, "planner")
+        planner_pkg = types.ModuleType(planner_pkg_name)
+        planner_pkg.__path__ = [planner_dir]
+        planner_pkg.__package__ = planner_pkg_name
+        sys.modules[planner_pkg_name] = planner_pkg
+
+    # Ensure actions sub-package with stubs
+    for subpkg in ["actions", "core"]:
+        pkg_name = f"{_PKG}.{subpkg}"
+        if pkg_name not in sys.modules:
+            sub_dir = os.path.join(phone_bot_dir, subpkg)
+            sub_mod = types.ModuleType(pkg_name)
+            sub_mod.__path__ = [sub_dir]
+            sub_mod.__package__ = pkg_name
+            sys.modules[pkg_name] = sub_mod
+
+    # Stub out heavy modules that executor imports
+    stubs = {
+        f"{_PKG}.core.human": types.ModuleType(f"{_PKG}.core.human"),
+        f"{_PKG}.core.rate_limiter": types.ModuleType(f"{_PKG}.core.rate_limiter"),
+        f"{_PKG}.core.monitor": types.ModuleType(f"{_PKG}.core.monitor"),
+        f"{_PKG}.core.telegram_alerts": types.ModuleType(f"{_PKG}.core.telegram_alerts"),
+        f"{_PKG}.core.telegram_monitor": types.ModuleType(f"{_PKG}.core.telegram_monitor"),
+        f"{_PKG}.actions.tiktok": types.ModuleType(f"{_PKG}.actions.tiktok"),
+        f"{_PKG}.actions.instagram": types.ModuleType(f"{_PKG}.actions.instagram"),
+    }
+
+    # Add required attributes to stubs
+    stubs[f"{_PKG}.core.human"].HumanEngine = type("HumanEngine", (), {})
+    stubs[f"{_PKG}.core.rate_limiter"].SessionRateLimiter = type("SessionRateLimiter", (), {})
+
+    # Monitor stubs
+    mon = stubs[f"{_PKG}.core.monitor"]
+    mon.init_monitor = lambda *a, **k: None
+    mon.log_event = lambda *a, **k: None
+    mon.BotEvent = type("BotEvent", (), {})
+    mon.get_logger = lambda *a, **k: None
+    mon.get_action_trace = lambda *a, **k: None
+
+    ta = stubs[f"{_PKG}.core.telegram_alerts"]
+    ta.init_alerts = lambda *a, **k: None
+    ta.send_alert = lambda *a, **k: None
+
+    tm = stubs[f"{_PKG}.core.telegram_monitor"]
+    tm.init_monitor = lambda *a, **k: None
+    tm.get_monitor = lambda *a, **k: types.SimpleNamespace(
+        session_start=lambda **kw: None,
+        session_end=lambda **kw: None,
+    )
+
+    # ADB stubs
+    adb_name = f"{_PKG}.core.adb"
+    if adb_name in sys.modules:
+        adb_mod = sys.modules[adb_name]
+    else:
+        adb_mod = types.ModuleType(adb_name)
+        sys.modules[adb_name] = adb_mod
+    if not hasattr(adb_mod, "ADBController"):
+        adb_mod.ADBController = type("ADBController", (), {})
+    if not hasattr(adb_mod, "DeviceLostError"):
+        adb_mod.DeviceLostError = type("DeviceLostError", (Exception,), {})
+    if not hasattr(adb_mod, "DeviceConfigError"):
+        adb_mod.DeviceConfigError = type("DeviceConfigError", (Exception,), {})
+
+    # Proxy stub
+    proxy_name = f"{_PKG}.core.proxy"
+    if proxy_name in sys.modules:
+        proxy_mod = sys.modules[proxy_name]
+    else:
+        proxy_mod = types.ModuleType(proxy_name)
+        sys.modules[proxy_name] = proxy_mod
+    if not hasattr(proxy_mod, "ProxyQueue"):
+        proxy_mod.ProxyQueue = type("ProxyQueue", (), {})
+
+    # Actions stubs
+    stubs[f"{_PKG}.actions.tiktok"].TikTokBot = type("TikTokBot", (), {})
+    stubs[f"{_PKG}.actions.instagram"].InstagramBot = type("InstagramBot", (), {})
+
+    for name, mod in stubs.items():
+        if name not in sys.modules:
+            sys.modules[name] = mod
+
+    # Now import warmup (needed by executor)
+    warmup_name = f"{_PKG}.planner.warmup"
+    if warmup_name not in sys.modules:
+        warmup_path = os.path.join(phone_bot_dir, "planner", "warmup.py")
+        warmup_spec = importlib.util.spec_from_file_location(warmup_name, warmup_path)
+        warmup_mod = importlib.util.module_from_spec(warmup_spec)
+        warmup_mod.__package__ = planner_pkg_name
+        sys.modules[warmup_name] = warmup_mod
+        warmup_spec.loader.exec_module(warmup_mod)
+
+    # Now import executor itself
+    executor_path = os.path.join(phone_bot_dir, "planner", "executor.py")
+    executor_spec = importlib.util.spec_from_file_location(mod_name, executor_path)
+    executor_mod = importlib.util.module_from_spec(executor_spec)
+    executor_mod.__package__ = planner_pkg_name
+    sys.modules[mod_name] = executor_mod
+    executor_spec.loader.exec_module(executor_mod)
+
+    return executor_mod
+
+
+# Run bootstrap once at module load
+_executor = _ensure_executor_importable()
+
+
+# ---------------------------------------------------------------------------
+# Helpers
+# ---------------------------------------------------------------------------
+
+def _create_test_db(db_path: str) -> sqlite3.Connection:
+    """Create a minimal dashboard DB with required tables."""
+    conn = sqlite3.connect(db_path)
+    conn.execute("PRAGMA journal_mode=WAL")
+    conn.row_factory = sqlite3.Row
+
+    conn.executescript("""
+        CREATE TABLE IF NOT EXISTS proxy (
+            id INTEGER PRIMARY KEY,
+            name TEXT NOT NULL
+        );
+
+        CREATE TABLE IF NOT EXISTS bot (
+            id INTEGER PRIMARY KEY,
+            name TEXT NOT NULL
+        );
+
+        CREATE TABLE IF NOT EXISTS bot_account (
+            id INTEGER PRIMARY KEY,
+            bot_id INTEGER NOT NULL REFERENCES bot(id),
+            clone_id TEXT NOT NULL,
+            username TEXT NOT NULL,
+            password TEXT DEFAULT '',
+            status TEXT DEFAULT 'active',
+            platform TEXT DEFAULT 'tiktok',
+            warmup_json TEXT,
+            personality_json TEXT,
+            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
+            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
+        );
+
+        CREATE TABLE IF NOT EXISTS weekly_plan (
+            id INTEGER PRIMARY KEY,
+            proxy_id INTEGER NOT NULL REFERENCES proxy(id),
+            week_number INTEGER NOT NULL,
+            year INTEGER NOT NULL,
+            plan_json TEXT NOT NULL,
+            generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
+            status TEXT DEFAULT 'active',
+            UNIQUE(proxy_id, week_number, year)
+        );
+
+        CREATE TABLE IF NOT EXISTS session_log (
+            id INTEGER PRIMARY KEY,
+            bot_account_id INTEGER NOT NULL,
+            session_id TEXT NOT NULL,
+            started_at TEXT NOT NULL,
+            ended_at TEXT,
+            session_type TEXT NOT NULL,
+            status TEXT NOT NULL,
+            error_message TEXT,
+            post_outcome TEXT,
+            dry_run INTEGER DEFAULT 0,
+            phase_log_json TEXT,
+            actions_json TEXT
+        );
+
+        INSERT INTO proxy (id, name) VALUES (1, 'test-proxy');
+        INSERT INTO bot (id, name) VALUES (1, 'test-bot');
+        INSERT INTO bot_account (id, bot_id, clone_id, username, platform)
+            VALUES (1, 1, 'clone1', 'ph1_tiktok', 'tiktok');
+        INSERT INTO bot_account (id, bot_id, clone_id, username, platform)
+            VALUES (2, 1, 'clone2', 'ph2_tiktok', 'tiktok');
+    """)
+    conn.commit()
+    return conn
+
+
+@pytest.fixture
+def db_path(tmp_path):
+    """Create a temporary DB and return its path."""
+    path = str(tmp_path / "app.db")
+    conn = _create_test_db(path)
+    conn.close()
+    return path
+
+
+# ---------------------------------------------------------------------------
+# Test: _utc_to_eastern
+# ---------------------------------------------------------------------------
+
+class TestUtcToEastern:
+    def test_edt_conversion(self):
+        """March 22 2026 is EDT (UTC-4): 00:45 UTC -> 20:45 ET."""
+        result = _executor._utc_to_eastern("2026-03-22T00:45:00Z")
+        assert result == "20:45"
+
+    def test_est_conversion(self):
+        """January 15 is EST (UTC-5): 23:30 UTC -> 18:30 ET."""
+        result = _executor._utc_to_eastern("2026-01-15T23:30:00+00:00")
+        assert result == "18:30"
+
+    def test_summer_conversion(self):
+        """July 15 is EDT (UTC-4): 18:00 UTC -> 14:00 ET."""
+        result = _executor._utc_to_eastern("2026-07-15T18:00:00Z")
+        assert result == "14:00"
+
+
+# ---------------------------------------------------------------------------
+# Test: DB plan loading
+# ---------------------------------------------------------------------------
+
+class TestLoadPlanFromDB:
+    def test_loads_active_plan(self, db_path):
+        now = datetime.now(timezone.utc)
+        iso_cal = now.isocalendar()
+        plan_data = {
+            "week": f"{iso_cal[0]}-W{iso_cal[1]:02d}",
+            "days": {
+                "Monday": {
+                    "sessions": [{
+                        "account": "ph1_tiktok",
+                        "start_time_utc": "2026-03-23T18:00:00Z",
+                        "end_time_utc": "2026-03-23T18:30:00Z",
+                        "session_type": "normal",
+                    }]
+                }
+            },
+        }
+        conn = sqlite3.connect(db_path)
+        conn.execute(
+            "INSERT INTO weekly_plan (proxy_id, week_number, year, plan_json, status) "
+            "VALUES (?, ?, ?, ?, 'active')",
+            (1, iso_cal[1], iso_cal[0], json.dumps(plan_data)),
+        )
+        conn.commit()
+        conn.close()
+
+        with patch.object(_executor, "_DB_PATH", db_path):
+            result = _executor._load_plan_from_db(proxy_id=1)
+
+        assert result is not None
+        session = result["days"]["Monday"]["sessions"][0]
+        assert "start_time" in session
+
+    def test_returns_none_when_no_plan(self, db_path):
+        with patch.object(_executor, "_DB_PATH", db_path):
+            result = _executor._load_plan_from_db(proxy_id=1)
+        assert result is None
+
+    def test_returns_none_when_db_missing(self, tmp_path):
+        with patch.object(_executor, "_DB_PATH", str(tmp_path / "nonexistent.db")):
+            result = _executor._load_plan_from_db(proxy_id=1)
+        assert result is None
+
+    def test_converts_utc_to_eastern(self, db_path):
+        now = datetime.now(timezone.utc)
+        iso_cal = now.isocalendar()
+        plan_data = {
+            "days": {
+                "Monday": {
+                    "sessions": [{
+                        "start_time_utc": "2026-01-15T23:30:00Z",
+                        "end_time_utc": "2026-01-16T00:00:00Z",
+                    }]
+                }
+            },
+        }
+        conn = sqlite3.connect(db_path)
+        conn.execute(
+            "INSERT INTO weekly_plan (proxy_id, week_number, year, plan_json, status) "
+            "VALUES (?, ?, ?, ?, 'active')",
+            (1, iso_cal[1], iso_cal[0], json.dumps(plan_data)),
+        )
+        conn.commit()
+        conn.close()
+
+        with patch.object(_executor, "_DB_PATH", db_path):
+            result = _executor._load_plan_from_db(proxy_id=1)
+
+        session = result["days"]["Monday"]["sessions"][0]
+        assert session["start_time"] == "18:30"
+        assert session["end_time"] == "19:00"
+
+
+# ---------------------------------------------------------------------------
+# Test: Warmup state from DB
+# ---------------------------------------------------------------------------
+
+class TestWarmupStateDB:
+    def _make_executor(self):
+        """Create a bare SessionExecutor without __init__."""
+        obj = _executor.SessionExecutor.__new__(_executor.SessionExecutor)
+        obj.warmup_states = {}
+        obj._account_db_ids = {}
+        return obj
+
+    def test_load_warmup_from_db(self, db_path):
+        """load_warmup_state reads from BotAccount.warmup_json."""
+        warmup_data = {
+            "account_name": "ph1_tiktok",
+            "platform": "tiktok",
+            "phone_id": 1,
+            "start_date": "2026-03-20",
+            "current_day": 3,
+            "total_days": 7,
+            "completed": False,
+            "plan": {"1": {"type": "dead"}, "2": {"type": "normal"}},
+            "niche_keywords": ["toxic"],
+            "profile_pic_day": 4,
+            "bio_day": 5,
+        }
+        conn = sqlite3.connect(db_path)
+        conn.execute(
+            "UPDATE bot_account SET warmup_json = ? WHERE username = ?",
+            (json.dumps(warmup_data), "ph1_tiktok"),
+        )
+        conn.commit()
+        conn.close()
+
+        with patch.object(_executor, "_DB_PATH", db_path), \
+             patch.object(_executor, "WARMUP_STATE_FILE", db_path + ".nonexistent"):
+            executor = self._make_executor()
+            executor._load_warmup_state()
+
+        assert "ph1_tiktok" in executor.warmup_states
+        assert executor.warmup_states["ph1_tiktok"].current_day == 3
+
+    def test_save_warmup_to_db(self, db_path):
+        """save_warmup_state writes to BotAccount.warmup_json."""
+        AccountWarmupState = _executor.AccountWarmupState if hasattr(_executor, "AccountWarmupState") else \
+            sys.modules["phone_bot.planner.warmup"].AccountWarmupState
+
+        state = AccountWarmupState(
+            account_name="ph1_tiktok",
+            platform="tiktok",
+            phone_id=1,
+            start_date="2026-03-20",
+            current_day=4,
+        )
+        state.total_days = 7
+        state.completed = False
+
+        with patch.object(_executor, "_DB_PATH", db_path):
+            executor = self._make_executor()
+            executor.warmup_states = {"ph1_tiktok": state}
+            executor._account_db_ids = {"ph1_tiktok": 1}
+            executor._save_warmup_state()
+
+        conn = sqlite3.connect(db_path)
+        row = conn.execute("SELECT warmup_json FROM bot_account WHERE id = 1").fetchone()
+        conn.close()
+
+        assert row is not None
+        data = json.loads(row[0]) if isinstance(row[0], str) else row[0]
+        assert data["current_day"] == 4
+
+    def test_db_preferred_over_json_file(self, db_path, tmp_path):
+        """When DB has warmup data, JSON file is NOT used."""
+        warmup_data = {
+            "account_name": "ph1_tiktok",
+            "platform": "tiktok",
+            "phone_id": 1,
+            "start_date": "2026-03-20",
+            "current_day": 2,
+            "total_days": 6,
+            "completed": False,
+            "plan": {},
+            "niche_keywords": [],
+            "profile_pic_day": 3,
+            "bio_day": 4,
+        }
+        conn = sqlite3.connect(db_path)
+        conn.execute(
+            "UPDATE bot_account SET warmup_json = ? WHERE username = ?",
+            (json.dumps(warmup_data), "ph1_tiktok"),
+        )
+        conn.commit()
+        conn.close()
+
+        # JSON file has different data
+        json_file = str(tmp_path / "warmup_state.json")
+        AccountWarmupState = sys.modules["phone_bot.planner.warmup"].AccountWarmupState
+        fake_state = AccountWarmupState(
+            account_name="ph1_tiktok", platform="tiktok",
+            phone_id=1, start_date="2026-03-20", current_day=99,
+        )
+        with open(json_file, "w") as f:
+            json.dump({"ph1_tiktok": fake_state.to_dict()}, f)
+
+        with patch.object(_executor, "_DB_PATH", db_path), \
+             patch.object(_executor, "WARMUP_STATE_FILE", json_file):
+            executor = self._make_executor()
+            executor._load_warmup_state()
+
+        # Should use DB (day 2), not JSON (day 99)
+        assert executor.warmup_states["ph1_tiktok"].current_day == 2
+
+    def test_falls_back_to_json_when_db_unavailable(self, tmp_path):
+        """When DB is missing, falls back to JSON file."""
+        AccountWarmupState = sys.modules["phone_bot.planner.warmup"].AccountWarmupState
+        state = AccountWarmupState(
+            account_name="ph2_tiktok", platform="tiktok",
+            phone_id=2, start_date="2026-03-20", current_day=5,
+        )
+        state.total_days = 8
+
+        json_file = str(tmp_path / "warmup_state.json")
+        with open(json_file, "w") as f:
+            json.dump({"ph2_tiktok": state.to_dict()}, f)
+
+        with patch.object(_executor, "_DB_PATH", str(tmp_path / "nonexistent.db")), \
+             patch.object(_executor, "WARMUP_STATE_FILE", json_file):
+            executor = self._make_executor()
+            executor._load_warmup_state()
+
+        assert "ph2_tiktok" in executor.warmup_states
+        assert executor.warmup_states["ph2_tiktok"].current_day == 5
+
+
+# ---------------------------------------------------------------------------
+# Test: SessionLog writing
+# ---------------------------------------------------------------------------
+
+class TestSessionLogDB:
+    def test_writes_session_start(self, db_path):
+        with patch.object(_executor, "_DB_PATH", db_path):
+            _executor._log_session_start_db("2026-03-22_ph1_tiktok_1", 1, "normal")
+
+        conn = sqlite3.connect(db_path)
+        conn.row_factory = sqlite3.Row
+        row = conn.execute(
+            "SELECT * FROM session_log WHERE session_id = ?",
+            ("2026-03-22_ph1_tiktok_1",),
+        ).fetchone()
+        conn.close()
+
+        assert row is not None
+        assert row["started_at"] is not None
+        assert row["status"] == "running"
+
+    def test_updates_session_end_success(self, db_path):
+        with patch.object(_executor, "_DB_PATH", db_path):
+            _executor._log_session_start_db("sess_1", 1, "normal")
+            _executor._log_session_end_db("sess_1", success=True, post_outcome="posted")
+
+        conn = sqlite3.connect(db_path)
+        conn.row_factory = sqlite3.Row
+        row = conn.execute("SELECT * FROM session_log WHERE session_id = 'sess_1'").fetchone()
+        conn.close()
+
+        assert row["status"] == "success"
+        assert row["ended_at"] is not None
+        assert row["post_outcome"] == "posted"
+
+    def test_writes_error_on_failure(self, db_path):
+        with patch.object(_executor, "_DB_PATH", db_path):
+            _executor._log_session_start_db("sess_err", 1, "normal")
+            _executor._log_session_end_db("sess_err", success=False, error_message="device lost")
+
+        conn = sqlite3.connect(db_path)
+        conn.row_factory = sqlite3.Row
+        row = conn.execute("SELECT * FROM session_log WHERE session_id = 'sess_err'").fetchone()
+        conn.close()
+
+        assert row["status"] == "error"
+        assert row["error_message"] == "device lost"
+
+    def test_deterministic_session_id(self, db_path):
+        det_id = "2026-03-22_ph2_tiktok_1"
+        with patch.object(_executor, "_DB_PATH", db_path):
+            _executor._log_session_start_db(det_id, 2, "warmup")
+
+        conn = sqlite3.connect(db_path)
+        row = conn.execute(
+            "SELECT session_id, session_type FROM session_log WHERE session_id = ?",
+            (det_id,),
+        ).fetchone()
+        conn.close()
+
+        assert row[0] == det_id
+        assert row[1] == "warmup"
+
+    def test_no_crash_when_db_missing(self, tmp_path):
+        with patch.object(_executor, "_DB_PATH", str(tmp_path / "nonexistent.db")):
+            _executor._log_session_start_db("sess_x", 1, "normal")
+            _executor._log_session_end_db("sess_x", success=True)
