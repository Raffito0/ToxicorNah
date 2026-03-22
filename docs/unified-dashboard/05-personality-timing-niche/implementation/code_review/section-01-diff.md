diff --git a/insta-phone-SAAS-sneder/app/__init__.py b/insta-phone-SAAS-sneder/app/__init__.py
index dd7afd6..7422011 100644
--- a/insta-phone-SAAS-sneder/app/__init__.py
+++ b/insta-phone-SAAS-sneder/app/__init__.py
@@ -44,6 +44,8 @@ def ensure_columns(db):
         # BotAccount table new columns (section-02)
         "ALTER TABLE bot_account ADD COLUMN platform VARCHAR(20) DEFAULT 'instagram'",
         "ALTER TABLE bot_account ADD COLUMN personality_json JSON",
+        "ALTER TABLE bot_account ADD COLUMN personality_history_json JSON",
+        "ALTER TABLE bot_account ADD COLUMN personality_locked_traits JSON",
         "ALTER TABLE bot_account ADD COLUMN warmup_json JSON",
         "ALTER TABLE bot_account ADD COLUMN niche_json JSON",
         "ALTER TABLE bot_account ADD COLUMN notify_before_post BOOLEAN DEFAULT 1",
@@ -132,10 +134,12 @@ def create_app():
     from .analysis_routes import analysis
     from .proxy_routes import proxy_bp
     from .planner_routes import planner_bp
+    from .personality_routes import personality_bp
     app.register_blueprint(auth)
     app.register_blueprint(analysis)
     app.register_blueprint(proxy_bp)
     app.register_blueprint(planner_bp)
+    app.register_blueprint(personality_bp)
 
     # Start proxy health-check thread (skip in tests)
     if not app.config.get('TESTING'):
diff --git a/insta-phone-SAAS-sneder/app/models.py b/insta-phone-SAAS-sneder/app/models.py
index efab013..fbd5625 100644
--- a/insta-phone-SAAS-sneder/app/models.py
+++ b/insta-phone-SAAS-sneder/app/models.py
@@ -267,6 +267,8 @@ class BotAccount(db.Model):
     # ─── New fields (section-02) ───────────────────────────────────
     platform = db.Column(db.String(20), default='instagram')
     personality_json = db.Column(db.JSON, nullable=True)
+    personality_history_json = db.Column(db.JSON, nullable=True)
+    personality_locked_traits = db.Column(db.JSON, nullable=True)
     warmup_json = db.Column(db.JSON, nullable=True)
     niche_json = db.Column(db.JSON, nullable=True)
     notify_before_post = db.Column(db.Boolean, default=True)
diff --git a/insta-phone-SAAS-sneder/app/personality_routes.py b/insta-phone-SAAS-sneder/app/personality_routes.py
new file mode 100644
index 0000000..3ec0fee
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/personality_routes.py
@@ -0,0 +1,195 @@
+"""Personality API routes (section-01).
+
+Blueprint `personality_bp` with CRUD for per-account personality traits,
+lock toggles, randomize, reset, and 30-session history.
+"""
+import random
+from datetime import datetime, timezone
+
+from flask import Blueprint, request, jsonify
+from flask_login import login_required, current_user
+from sqlalchemy.orm.attributes import flag_modified
+
+from . import db
+from .models import BotAccount, Bot
+
+personality_bp = Blueprint('personality', __name__)
+
+PERSONALITY_RANGES = {
+    "reels_preference": (0.20, 0.80),
+    "story_affinity": (0.05, 0.50),
+    "double_tap_habit": (0.25, 0.90),
+    "explore_curiosity": (0.03, 0.20),
+    "boredom_rate": (0.06, 0.18),
+    "boredom_relief": (0.25, 0.55),
+    "switch_threshold": (0.55, 0.85),
+    "comment_sociality": (0.15, 0.75),
+}
+
+MAX_HISTORY = 30
+
+
+def _get_defaults():
+    """Return midpoint defaults for all traits."""
+    return {k: round((lo + hi) / 2, 3) for k, (lo, hi) in PERSONALITY_RANGES.items()}
+
+
+def _clamp_traits(traits: dict) -> dict:
+    """Clamp trait values to their defined ranges."""
+    clamped = {}
+    for k, v in traits.items():
+        if k in PERSONALITY_RANGES:
+            lo, hi = PERSONALITY_RANGES[k]
+            clamped[k] = round(max(lo, min(hi, float(v))), 3)
+    return clamped
+
+
+def _get_account_or_404(account_id: int):
+    """Get BotAccount with ownership check. Returns (account, error_response)."""
+    account = db.session.get(BotAccount, account_id)
+    if not account:
+        return None, (jsonify({'error': 'Account not found'}), 404)
+    bot = db.session.get(Bot, account.bot_id)
+    if not bot or bot.user_id != current_user.id:
+        return None, (jsonify({'error': 'Unauthorized'}), 403)
+    return account, None
+
+
+def _get_traits(account):
+    """Get current traits, falling back to defaults if NULL."""
+    if account.personality_json and isinstance(account.personality_json, dict):
+        defaults = _get_defaults()
+        defaults.update(account.personality_json)
+        return defaults
+    return _get_defaults()
+
+
+def _get_locked(account):
+    """Get locked traits list."""
+    if account.personality_locked_traits and isinstance(account.personality_locked_traits, list):
+        return account.personality_locked_traits
+    return []
+
+
+def _get_history(account):
+    """Get history entries."""
+    if account.personality_history_json and isinstance(account.personality_history_json, list):
+        return account.personality_history_json
+    return []
+
+
+@personality_bp.route('/api/accounts/<int:account_id>/personality', methods=['GET'])
+@login_required
+def get_personality(account_id):
+    account, err = _get_account_or_404(account_id)
+    if err:
+        return err
+
+    traits = _get_traits(account)
+    locked = _get_locked(account)
+    history = _get_history(account)
+
+    return jsonify({
+        'traits': traits,
+        'locked_traits': locked,
+        'history': history,
+        'sessions_count': len(history),
+    })
+
+
+@personality_bp.route('/api/accounts/<int:account_id>/personality', methods=['PUT'])
+@login_required
+def update_personality(account_id):
+    account, err = _get_account_or_404(account_id)
+    if err:
+        return err
+
+    data = request.get_json(silent=True) or {}
+    new_traits = data.get('traits', {})
+    record_history = data.get('record_history', False)
+
+    current_traits = _get_traits(account)
+    clamped = _clamp_traits(new_traits)
+    current_traits.update(clamped)
+
+    account.personality_json = current_traits
+    flag_modified(account, 'personality_json')
+
+    if record_history:
+        history = _get_history(account)
+        entry = {
+            'traits': dict(current_traits),
+            'timestamp': datetime.now(timezone.utc).isoformat(),
+        }
+        history.append(entry)
+        if len(history) > MAX_HISTORY:
+            history = history[-MAX_HISTORY:]
+        account.personality_history_json = history
+        flag_modified(account, 'personality_history_json')
+
+    db.session.commit()
+    return jsonify({'traits': current_traits})
+
+
+@personality_bp.route('/api/accounts/<int:account_id>/personality/randomize', methods=['POST'])
+@login_required
+def randomize_personality(account_id):
+    account, err = _get_account_or_404(account_id)
+    if err:
+        return err
+
+    locked = _get_locked(account)
+    current_traits = _get_traits(account)
+
+    for key, (lo, hi) in PERSONALITY_RANGES.items():
+        if key not in locked:
+            current_traits[key] = round(random.uniform(lo, hi), 3)
+
+    account.personality_json = current_traits
+    flag_modified(account, 'personality_json')
+    db.session.commit()
+
+    return jsonify({'traits': current_traits})
+
+
+@personality_bp.route('/api/accounts/<int:account_id>/personality/reset', methods=['POST'])
+@login_required
+def reset_personality(account_id):
+    account, err = _get_account_or_404(account_id)
+    if err:
+        return err
+
+    account.personality_json = _get_defaults()
+    account.personality_locked_traits = []
+    flag_modified(account, 'personality_json')
+    flag_modified(account, 'personality_locked_traits')
+    db.session.commit()
+
+    return jsonify({'traits': _get_defaults(), 'locked_traits': []})
+
+
+@personality_bp.route('/api/accounts/<int:account_id>/personality/lock', methods=['PUT'])
+@login_required
+def toggle_lock(account_id):
+    account, err = _get_account_or_404(account_id)
+    if err:
+        return err
+
+    data = request.get_json(silent=True) or {}
+    trait = data.get('trait')
+    locked = data.get('locked', True)
+
+    if not trait or trait not in PERSONALITY_RANGES:
+        return jsonify({'error': 'Invalid trait'}), 400
+
+    current_locked = _get_locked(account)
+    if locked and trait not in current_locked:
+        current_locked.append(trait)
+    elif not locked and trait in current_locked:
+        current_locked.remove(trait)
+
+    account.personality_locked_traits = current_locked
+    flag_modified(account, 'personality_locked_traits')
+    db.session.commit()
+
+    return jsonify({'locked_traits': current_locked})
diff --git a/insta-phone-SAAS-sneder/tests/test_personality_api.py b/insta-phone-SAAS-sneder/tests/test_personality_api.py
new file mode 100644
index 0000000..dd89061
--- /dev/null
+++ b/insta-phone-SAAS-sneder/tests/test_personality_api.py
@@ -0,0 +1,186 @@
+"""Tests for Personality API (section-01)."""
+import pytest
+import os
+import sys
+
+sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
+
+from app import create_app, db as _db
+from app.models import User, Bot, BotAccount
+
+PERSONALITY_RANGES = {
+    "reels_preference": (0.20, 0.80),
+    "story_affinity": (0.05, 0.50),
+    "double_tap_habit": (0.25, 0.90),
+    "explore_curiosity": (0.03, 0.20),
+    "boredom_rate": (0.06, 0.18),
+    "boredom_relief": (0.25, 0.55),
+    "switch_threshold": (0.55, 0.85),
+    "comment_sociality": (0.15, 0.75),
+}
+
+
+@pytest.fixture
+def app(tmp_path):
+    """Create a Flask app with a temp SQLite DB."""
+    os.environ['TESTING'] = '1'
+    db_file = str(tmp_path / 'test.db')
+    application = create_app()
+    application.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_file}'
+    application.config['TESTING'] = True
+    application.config['WTF_CSRF_ENABLED'] = False
+    application.config['SECRET_KEY'] = 'test-secret'
+
+    with application.app_context():
+        _db.create_all()
+        yield application
+        _db.session.remove()
+        _db.drop_all()
+
+
+@pytest.fixture
+def client(app):
+    return app.test_client()
+
+
+def _create_test_data():
+    """Create user + bot + account for testing."""
+    from werkzeug.security import generate_password_hash
+    user = User(username='testuser', email='test@test.com',
+                password=generate_password_hash('password'))
+    _db.session.add(user)
+    _db.session.flush()
+
+    bot = Bot(user_id=user.id, phone_id='1', name='TestBot', platform='tiktok')
+    _db.session.add(bot)
+    _db.session.flush()
+
+    account = BotAccount(bot_id=bot.id, clone_id='clone1',
+                         username='tiktok_user', password='pass',
+                         platform='tiktok')
+    _db.session.add(account)
+    _db.session.commit()
+    return user, bot, account
+
+
+@pytest.fixture
+def auth_client(app, client):
+    """Create user, bot, account and log in."""
+    with app.app_context():
+        user, bot, account = _create_test_data()
+        # Log in via session
+        with client.session_transaction() as sess:
+            sess['_user_id'] = str(user.id)
+        return client, account.id, bot.id
+
+
+class TestGetPersonality:
+    def test_get_returns_traits_and_metadata(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert resp.status_code == 200
+        data = resp.get_json()
+        assert 'traits' in data
+        assert 'locked_traits' in data
+        assert 'history' in data
+        assert 'sessions_count' in data
+
+    def test_get_null_personality_returns_defaults(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        data = resp.get_json()
+        traits = data['traits']
+        for key, (lo, hi) in PERSONALITY_RANGES.items():
+            assert key in traits
+            expected_mid = round((lo + hi) / 2, 3)
+            assert abs(traits[key] - expected_mid) < 0.01
+
+    def test_get_requires_login(self, client):
+        resp = client.get('/api/accounts/1/personality')
+        assert resp.status_code in (302, 401)
+
+
+class TestPutPersonality:
+    def test_put_updates_specific_traits(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.put(f'/api/accounts/{account_id}/personality',
+                          json={'traits': {'reels_preference': 0.70}})
+        assert resp.status_code == 200
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert resp.get_json()['traits']['reels_preference'] == 0.70
+
+    def test_put_clamps_to_range(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.put(f'/api/accounts/{account_id}/personality',
+                          json={'traits': {'reels_preference': 99.0}})
+        assert resp.status_code == 200
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert resp.get_json()['traits']['reels_preference'] == 0.80
+
+
+class TestRandomize:
+    def test_randomize_within_bounds(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.post(f'/api/accounts/{account_id}/personality/randomize')
+        assert resp.status_code == 200
+        data = resp.get_json()
+        for key, (lo, hi) in PERSONALITY_RANGES.items():
+            assert lo <= data['traits'][key] <= hi
+
+    def test_randomize_skips_locked(self, auth_client):
+        client, account_id, _ = auth_client
+        client.put(f'/api/accounts/{account_id}/personality',
+                   json={'traits': {'reels_preference': 0.50}})
+        client.put(f'/api/accounts/{account_id}/personality/lock',
+                   json={'trait': 'reels_preference', 'locked': True})
+        resp = client.post(f'/api/accounts/{account_id}/personality/randomize')
+        data = resp.get_json()
+        assert data['traits']['reels_preference'] == 0.50
+
+
+class TestReset:
+    def test_reset_restores_midpoints(self, auth_client):
+        client, account_id, _ = auth_client
+        client.put(f'/api/accounts/{account_id}/personality',
+                   json={'traits': {'reels_preference': 0.75}})
+        resp = client.post(f'/api/accounts/{account_id}/personality/reset')
+        assert resp.status_code == 200
+        data = resp.get_json()
+        for key, (lo, hi) in PERSONALITY_RANGES.items():
+            expected_mid = round((lo + hi) / 2, 3)
+            assert abs(data['traits'][key] - expected_mid) < 0.01
+
+    def test_reset_clears_locks(self, auth_client):
+        client, account_id, _ = auth_client
+        client.put(f'/api/accounts/{account_id}/personality/lock',
+                   json={'trait': 'reels_preference', 'locked': True})
+        client.post(f'/api/accounts/{account_id}/personality/reset')
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert resp.get_json()['locked_traits'] == []
+
+
+class TestLock:
+    def test_lock_toggles_trait(self, auth_client):
+        client, account_id, _ = auth_client
+        resp = client.put(f'/api/accounts/{account_id}/personality/lock',
+                          json={'trait': 'reels_preference', 'locked': True})
+        assert resp.status_code == 200
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert 'reels_preference' in resp.get_json()['locked_traits']
+
+        resp = client.put(f'/api/accounts/{account_id}/personality/lock',
+                          json={'trait': 'reels_preference', 'locked': False})
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        assert 'reels_preference' not in resp.get_json()['locked_traits']
+
+
+class TestHistory:
+    def test_history_limited_to_30(self, auth_client):
+        client, account_id, _ = auth_client
+        for i in range(35):
+            client.put(f'/api/accounts/{account_id}/personality',
+                       json={'traits': {'reels_preference': 0.20 + i * 0.01},
+                             'record_history': True})
+        resp = client.get(f'/api/accounts/{account_id}/personality')
+        history = resp.get_json()['history']
+        assert len(history) <= 30
