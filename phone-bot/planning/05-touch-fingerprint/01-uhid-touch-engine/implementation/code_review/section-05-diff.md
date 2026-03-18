diff --git a/phone-bot/actions/tiktok.py b/phone-bot/actions/tiktok.py
index e555d0f..7718f2a 100644
--- a/phone-bot/actions/tiktok.py
+++ b/phone-bot/actions/tiktok.py
@@ -1293,6 +1293,11 @@ class TikTokBot:
             self.go_to_fyp()
             return False
 
+        # UHID touch server health check
+        if hasattr(self.adb, '_touch_health_check'):
+            if not self.adb._touch_health_check():
+                log.warning("UHID health check failed")
+
         # Pixel overlay check (free, <5ms)
         screenshot, fp = self.guardian.take_fingerprint()
         if fp and self.guardian._last_clean_fp:
diff --git a/phone-bot/planner/executor.py b/phone-bot/planner/executor.py
index cb828f6..74300c2 100644
--- a/phone-bot/planner/executor.py
+++ b/phone-bot/planner/executor.py
@@ -268,6 +268,17 @@ class SessionExecutor:
         human.start_session(hour=now.hour, weekday=now.weekday(),
                             duration_minutes=total_duration)
 
+        # --- UHID Touch Server Start ---
+        phone_name = config.PHONES.get(phone_id, {}).get("name", f"Phone {phone_id}")
+        uhid_ok = adb.start_touch_server()
+        if not uhid_ok:
+            log.warning("UHID failed on %s -- running in degraded mode (deviceId=-1)", phone_name)
+            tg_alert(phone_id, account, f"UHID failed on {phone_name}")
+        else:
+            log.info("UHID touch server started on %s", phone_name)
+        self._monitor_event(phone_id, account, session_id, "uhid_start",
+                            metadata={"success": uhid_ok})
+
         # Hard session timeout: duration * 1.5 + 5 min grace
         timeout_seconds = total_duration * 60 * 1.5 + 300
 
@@ -278,7 +289,7 @@ class SessionExecutor:
             )
 
         except asyncio.TimeoutError:
-            log.critical("SESSION TIMEOUT: %s exceeded %.0fs limit — forcing cleanup",
+            log.critical("SESSION TIMEOUT: %s exceeded %.0fs limit -- forcing cleanup",
                          account, timeout_seconds)
             self._monitor_event(phone_id, account, session_id, "error",
                                 human=human, success=False,
@@ -293,7 +304,7 @@ class SessionExecutor:
             return "timeout"
 
         except DeviceLostError as e:
-            log.error("DEVICE LOST during session %s (Phone %d): %s — skipping remaining sessions for this phone",
+            log.error("DEVICE LOST during session %s (Phone %d): %s -- skipping remaining sessions for this phone",
                       account, phone_id, e)
             self._monitor_event(phone_id, account, session_id, "device_lost",
                                 human=human, success=False,
@@ -303,6 +314,14 @@ class SessionExecutor:
             human.end_session()
             return "device_lost"
 
+        finally:
+            # --- UHID Touch Server Stop (always runs) ---
+            try:
+                adb.stop_touch_server()
+                self._monitor_event(phone_id, account, session_id, "uhid_stop")
+            except Exception as e:
+                log.debug("Touch server stop failed (expected if device lost): %s", e)
+
         self._monitor_event(phone_id, account, session_id, "session_end",
                             human=human, metadata={"result": "ok"})
         human.end_session()
@@ -978,6 +997,16 @@ class SessionExecutor:
         # Initialize Telegram alerts (warns if env vars missing)
         init_alerts()
 
+        # --- UHID JAR deployment check (once per day, before any sessions) ---
+        for pid, adb in self.controllers.items():
+            phone_name = config.PHONES.get(pid, {}).get("name", f"Phone {pid}")
+            try:
+                jar_check = adb.shell("ls /data/local/tmp/touchserver.jar").strip()
+                if "/data/local/tmp/touchserver.jar" not in jar_check:
+                    log.warning("touchserver.jar missing on %s -- push it first", phone_name)
+            except Exception as e:
+                log.debug("JAR check failed for %s: %s", phone_name, e)
+
         # Track phones that lost USB connection (shared across phases)
         dead_phones = set()
 
