diff --git a/insta-phone-SAAS-sneder/tests/test_planner_routes.py b/insta-phone-SAAS-sneder/tests/test_planner_routes.py
index ff1b787..0682164 100644
--- a/insta-phone-SAAS-sneder/tests/test_planner_routes.py
+++ b/insta-phone-SAAS-sneder/tests/test_planner_routes.py
@@ -236,6 +236,49 @@ def test_warmup_complete(auth_client, seed_data):
     assert resp.get_json()['completed'] is True
 
 
+# ─── POST phone-added ─────────────────────────────────────────
+
+
+@patch('app.planner_routes.planner_service.regenerate_remaining_days')
+def test_phone_added_triggers_regenerate(mock_regen, auth_client, db, seed_data):
+    _seed_active_plan(db, seed_data['proxy'].id)
+    mock_regen.return_value = {'days': {}}
+    resp = auth_client.post('/api/planner/phone-added',
+                            json={'proxy_id': 1})
+    assert resp.status_code == 200
+    mock_regen.assert_called_once()
+
+
+@patch('app.planner_routes.planner_service.regenerate_remaining_days')
+def test_phone_added_returns_updated_plan(mock_regen, auth_client, seed_data):
+    mock_regen.return_value = {'days': {'2026-03-24': {'sessions': []}}}
+    resp = auth_client.post('/api/planner/phone-added',
+                            json={'proxy_id': 1})
+    assert resp.status_code == 200
+    data = resp.get_json()
+    assert 'days' in data
+
+
+@patch('app.planner_routes.planner_service.regenerate_remaining_days')
+def test_phone_added_400_on_error(mock_regen, auth_client, seed_data):
+    mock_regen.side_effect = ValueError("No active plan")
+    resp = auth_client.post('/api/planner/phone-added',
+                            json={'proxy_id': 999})
+    assert resp.status_code == 400
+    assert 'error' in resp.get_json()
+
+
+def test_phone_added_400_no_proxy(auth_client, seed_data):
+    resp = auth_client.post('/api/planner/phone-added', json={})
+    assert resp.status_code == 400
+
+
+def test_phone_added_requires_auth(unauth_client):
+    resp = unauth_client.post('/api/planner/phone-added',
+                               json={'proxy_id': 1})
+    assert resp.status_code in (302, 401)
+
+
 # ─── GET export ──────────────────────────────────────────────────
 
 
