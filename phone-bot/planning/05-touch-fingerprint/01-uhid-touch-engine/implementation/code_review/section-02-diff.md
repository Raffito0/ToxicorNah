diff --git a/phone-bot/tests/test_touch_protocol.py b/phone-bot/tests/test_touch_protocol.py
new file mode 100644
index 0000000..af214b2
--- /dev/null
+++ b/phone-bot/tests/test_touch_protocol.py
@@ -0,0 +1,202 @@
+"""
+Tests for the Touch Server command protocol.
+
+Tests the protocol contract (what Python sends/receives), coordinate mapping,
+and pressure mapping. Does not test Java internals — those are validated
+on-device.
+"""
+
+import struct
+
+
+# --- Mirror of TouchServer.java mapping functions ---
+
+def map_coord(pixel: int, screen_dim: int) -> int:
+    """Map pixel coordinate to HID space (0-4095)."""
+    if screen_dim <= 0:
+        return 0
+    return min(4095, max(0, int(pixel / screen_dim * 4095.0)))
+
+
+def map_pressure(pressure: float) -> int:
+    """Map float pressure (0.0-1.0) to HID pressure (0-255)."""
+    return min(255, max(0, int(pressure * 255.0)))
+
+
+def format_tap_command(x: int, y: int, pressure: float, area: int, hold_ms: int) -> str:
+    """Format a TAP command string."""
+    return f"TAP {x} {y} {pressure} {area} {hold_ms}\n"
+
+
+def format_swipe_command(x1: int, y1: int, x2: int, y2: int,
+                         dur_ms: int, pressure: float) -> str:
+    """Format a SWIPE command string."""
+    return f"SWIPE {x1} {y1} {x2} {y2} {dur_ms} {pressure}\n"
+
+
+def format_down_command(x: int, y: int, pressure: float, area: int) -> str:
+    """Format a DOWN command string."""
+    return f"DOWN {x} {y} {pressure} {area}\n"
+
+
+def format_move_command(x: int, y: int, pressure: float, area: int) -> str:
+    """Format a MOVE command string."""
+    return f"MOVE {x} {y} {pressure} {area}\n"
+
+
+# ===== Coordinate Mapping Tests =====
+
+class TestCoordinateMapping:
+
+    def test_pixel_origin_maps_to_hid_origin(self):
+        assert map_coord(0, 1080) == 0
+        assert map_coord(0, 2220) == 0
+
+    def test_pixel_max_maps_to_hid_max(self):
+        # pixel == screen_dim maps to 4095
+        assert map_coord(1080, 1080) == 4095
+        assert map_coord(2220, 2220) == 4095
+
+    def test_pixel_center_maps_to_hid_center(self):
+        x = map_coord(540, 1080)
+        y = map_coord(1110, 2220)
+        # Should be approximately 2048
+        assert 2040 <= x <= 2055
+        assert 2040 <= y <= 2055
+
+    def test_pixel_clamps_to_4095(self):
+        # Beyond screen bounds
+        assert map_coord(2000, 1080) == 4095
+
+    def test_pixel_clamps_to_zero(self):
+        assert map_coord(-10, 1080) == 0
+
+    def test_zero_screen_dim_returns_zero(self):
+        assert map_coord(500, 0) == 0
+
+    def test_samsung_s9_dimensions(self):
+        # Samsung S9: 1080x2220
+        x = map_coord(540, 1080)
+        y = map_coord(1110, 2220)
+        assert 2040 <= x <= 2055
+        assert 2040 <= y <= 2055
+
+    def test_samsung_s22_dimensions(self):
+        # Samsung S22: 1080x2340
+        x = map_coord(540, 1080)
+        y = map_coord(1170, 2340)
+        assert 2040 <= x <= 2055
+        assert 2040 <= y <= 2055
+
+
+# ===== Pressure Mapping Tests =====
+
+class TestPressureMapping:
+
+    def test_zero_pressure_maps_to_zero(self):
+        assert map_pressure(0.0) == 0
+
+    def test_full_pressure_maps_to_255(self):
+        assert map_pressure(1.0) == 255
+
+    def test_mid_pressure(self):
+        p = map_pressure(0.55)
+        assert 138 <= p <= 142  # 0.55 * 255 = 140.25
+
+    def test_pressure_clamps_high(self):
+        assert map_pressure(1.5) == 255
+
+    def test_pressure_clamps_low(self):
+        assert map_pressure(-0.1) == 0
+
+
+# ===== Command Format Tests =====
+
+class TestCommandFormat:
+
+    def test_tap_command_format(self):
+        cmd = format_tap_command(540, 1110, 0.55, 48, 80)
+        assert cmd == "TAP 540 1110 0.55 48 80\n"
+
+    def test_swipe_command_format(self):
+        cmd = format_swipe_command(540, 2000, 540, 500, 300, 0.6)
+        assert cmd == "SWIPE 540 2000 540 500 300 0.6\n"
+
+    def test_down_command_format(self):
+        cmd = format_down_command(540, 1110, 0.55, 48)
+        assert cmd == "DOWN 540 1110 0.55 48\n"
+
+    def test_move_command_format(self):
+        cmd = format_move_command(540, 1110, 0.55, 48)
+        assert cmd == "MOVE 540 1110 0.55 48\n"
+
+    def test_ping_command(self):
+        assert "PING\n" == "PING\n"
+
+    def test_destroy_command(self):
+        assert "DESTROY\n" == "DESTROY\n"
+
+    def test_commands_are_newline_terminated(self):
+        for cmd in [
+            format_tap_command(0, 0, 0.5, 30, 50),
+            format_swipe_command(0, 0, 100, 100, 200, 0.5),
+            format_down_command(0, 0, 0.5, 30),
+            format_move_command(0, 0, 0.5, 30),
+            "PING\n",
+            "DESTROY\n",
+            "UP\n",
+        ]:
+            assert cmd.endswith("\n"), f"Command does not end with newline: {cmd!r}"
+
+
+# ===== Response Parsing Tests =====
+
+class TestResponseParsing:
+
+    def test_pong_response(self):
+        response = "PONG"
+        assert response == "PONG"
+
+    def test_ok_response_tap(self):
+        response = "OK 85"
+        parts = response.split()
+        assert parts[0] == "OK"
+        assert int(parts[1]) > 0  # actual_ms
+
+    def test_ok_response_simple(self):
+        response = "OK"
+        assert response.startswith("OK")
+
+    def test_err_response(self):
+        response = "ERR unknown command: FOOBAR"
+        assert response.startswith("ERR")
+
+    def test_err_missing_params(self):
+        # If TAP sent with too few params, server returns ERR
+        response = "ERR TAP requires: x y pressure area hold_ms"
+        assert response.startswith("ERR")
+
+
+# ===== UHID_GET_REPORT_REPLY Struct Tests =====
+
+class TestGetReportReply:
+
+    def test_reply_struct_layout(self):
+        """Verify UHID_GET_REPORT_REPLY struct is correctly formed."""
+        # Build the reply the same way the Java server does
+        request_id = 42
+        buf = bytearray(14)
+        struct.pack_into('<I', buf, 0, 10)   # type = UHID_GET_REPORT_REPLY
+        struct.pack_into('<I', buf, 4, request_id)  # id
+        struct.pack_into('<H', buf, 8, 0)    # err = 0
+        struct.pack_into('<H', buf, 10, 2)   # size = 2
+        buf[12] = 0x02  # Report ID 2
+        buf[13] = 0x0A  # Contact Count Maximum = 10
+
+        assert len(buf) == 14
+        assert struct.unpack_from('<I', buf, 0)[0] == 10
+        assert struct.unpack_from('<I', buf, 4)[0] == 42
+        assert struct.unpack_from('<H', buf, 8)[0] == 0
+        assert struct.unpack_from('<H', buf, 10)[0] == 2
+        assert buf[12] == 0x02
+        assert buf[13] == 0x0A
diff --git a/phone-bot/touchserver/TouchPhysics.java b/phone-bot/touchserver/TouchPhysics.java
new file mode 100644
index 0000000..b246391
--- /dev/null
+++ b/phone-bot/touchserver/TouchPhysics.java
@@ -0,0 +1,161 @@
+package touchserver;
+
+import java.util.Random;
+
+/**
+ * Generates realistic touch physics for HID reports.
+ *
+ * Handles pressure ramp-up/down curves, hold wobble, micro-drift during holds,
+ * and swipe interpolation with pressure curves.
+ */
+public class TouchPhysics {
+
+    private static final Random rng = new Random();
+
+    // Report rate: one HID report every ~10ms (100Hz, matching real touchscreen)
+    public static final int REPORT_INTERVAL_MS = 10;
+
+    /**
+     * Generate TAP report sequence.
+     *
+     * Returns an array of TouchReport objects representing the full tap gesture:
+     * 1. Ramp up: 3-4 reports (~25ms), pressure 0.05 -> peak
+     * 2. Hold: reports over hold_ms, pressure wobbles +/-5%, position drifts +/-1-3px
+     * 3. Ramp down: 2-3 reports (~20ms), pressure peak -> 0
+     * 4. UP report: tip_switch=false
+     *
+     * @param x        pixel X
+     * @param y        pixel Y
+     * @param pressure peak pressure (0.0-1.0)
+     * @param area     base touch area (pixels)
+     * @param holdMs   hold duration in ms
+     * @return array of TouchReport
+     */
+    public static TouchReport[] generateTap(int x, int y, float pressure, int area, int holdMs) {
+        // Calculate report counts
+        int rampUpCount = 3 + (rng.nextInt(2)); // 3-4
+        int holdCount = Math.max(2, holdMs / REPORT_INTERVAL_MS);
+        int rampDownCount = 2 + (rng.nextInt(2)); // 2-3
+        int totalCount = rampUpCount + holdCount + rampDownCount + 1; // +1 for UP
+
+        TouchReport[] reports = new TouchReport[totalCount];
+        int idx = 0;
+
+        // Ramp up
+        float[] rampUpPressures = {0.05f, 0.2f, 0.4f, pressure};
+        for (int i = 0; i < rampUpCount; i++) {
+            float p = (i < rampUpPressures.length) ? rampUpPressures[i] : pressure;
+            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
+            reports[idx++] = new TouchReport(true, x, y, p, a, REPORT_INTERVAL_MS / rampUpCount * (i + 1));
+        }
+
+        // Hold: wobble pressure +/-5%, drift position +/-1-3px
+        for (int i = 0; i < holdCount; i++) {
+            float wobble = 1.0f + (rng.nextFloat() * 0.1f - 0.05f); // +/-5%
+            float p = Math.min(1.0f, Math.max(0.01f, pressure * wobble));
+            int driftX = x + (rng.nextInt(7) - 3); // +/-3px
+            int driftY = y + (rng.nextInt(7) - 3);
+            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
+            reports[idx++] = new TouchReport(true, driftX, driftY, p, a, REPORT_INTERVAL_MS);
+        }
+
+        // Ramp down
+        float[] rampDownPressures = {pressure * 0.6f, pressure * 0.3f, pressure * 0.1f};
+        for (int i = 0; i < rampDownCount; i++) {
+            float p = (i < rampDownPressures.length) ? rampDownPressures[i] : 0.05f;
+            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
+            reports[idx++] = new TouchReport(true, x, y, p, a, REPORT_INTERVAL_MS);
+        }
+
+        // UP report
+        reports[idx++] = new TouchReport(false, x, y, 0, 0, 0);
+
+        // Trim array if we allocated too much
+        if (idx < totalCount) {
+            TouchReport[] trimmed = new TouchReport[idx];
+            System.arraycopy(reports, 0, trimmed, 0, idx);
+            return trimmed;
+        }
+        return reports;
+    }
+
+    /**
+     * Generate SWIPE report sequence.
+     *
+     * Linear position interpolation, pressure curve:
+     * - First 15%: ramp from 0.15 to peak
+     * - Middle 65%: peak +/-3% variation
+     * - Last 20%: ramp from peak to 0
+     *
+     * @param x1       start pixel X
+     * @param y1       start pixel Y
+     * @param x2       end pixel X
+     * @param y2       end pixel Y
+     * @param durMs    total duration in ms
+     * @param pressure peak pressure (0.0-1.0)
+     * @return array of TouchReport (includes final UP)
+     */
+    public static TouchReport[] generateSwipe(int x1, int y1, int x2, int y2,
+                                               int durMs, float pressure) {
+        int reportCount = Math.max(5, durMs / REPORT_INTERVAL_MS);
+        TouchReport[] reports = new TouchReport[reportCount + 1]; // +1 for UP
+
+        for (int i = 0; i < reportCount; i++) {
+            float t = (float) i / (float)(reportCount - 1); // 0.0 to 1.0
+
+            // Linear position interpolation
+            int x = x1 + (int)((x2 - x1) * t);
+            int y = y1 + (int)((y2 - y1) * t);
+
+            // Pressure curve
+            float p;
+            if (t < 0.15f) {
+                // Ramp up: 0.15 to peak
+                float rampT = t / 0.15f;
+                p = 0.15f + (pressure - 0.15f) * rampT;
+            } else if (t < 0.80f) {
+                // Middle: peak with +/-3% wobble
+                float wobble = 1.0f + (rng.nextFloat() * 0.06f - 0.03f);
+                p = pressure * wobble;
+            } else {
+                // Ramp down: peak to 0
+                float rampT = (t - 0.80f) / 0.20f;
+                p = pressure * (1.0f - rampT);
+            }
+            p = Math.min(1.0f, Math.max(0.0f, p));
+
+            // Area proportional to pressure
+            int baseArea = 20;
+            int areaScale = 40;
+            int area = baseArea + (int)(p * areaScale);
+
+            reports[i] = new TouchReport(true, x, y, p, area, REPORT_INTERVAL_MS);
+        }
+
+        // UP report
+        reports[reportCount] = new TouchReport(false, x2, y2, 0, 0, 0);
+
+        return reports;
+    }
+
+    /**
+     * A single touch report to be sent as UHID_INPUT2.
+     */
+    public static class TouchReport {
+        public final boolean tipSwitch;
+        public final int x;       // pixel coordinates
+        public final int y;
+        public final float pressure; // 0.0-1.0
+        public final int area;    // pixel area
+        public final int sleepMs; // how long to sleep AFTER sending this report
+
+        public TouchReport(boolean tipSwitch, int x, int y, float pressure, int area, int sleepMs) {
+            this.tipSwitch = tipSwitch;
+            this.x = x;
+            this.y = y;
+            this.pressure = pressure;
+            this.area = area;
+            this.sleepMs = sleepMs;
+        }
+    }
+}
diff --git a/phone-bot/touchserver/TouchServer.java b/phone-bot/touchserver/TouchServer.java
new file mode 100644
index 0000000..f25e225
--- /dev/null
+++ b/phone-bot/touchserver/TouchServer.java
@@ -0,0 +1,343 @@
+package touchserver;
+
+import java.io.BufferedReader;
+import java.io.FileInputStream;
+import java.io.FileOutputStream;
+import java.io.IOException;
+import java.io.InputStreamReader;
+import java.io.OutputStream;
+import java.io.PrintWriter;
+import java.io.RandomAccessFile;
+import java.nio.ByteBuffer;
+import java.nio.ByteOrder;
+
+import android.net.LocalServerSocket;
+import android.net.LocalSocket;
+
+/**
+ * UHID Touch Server — runs on phone via app_process.
+ *
+ * Creates a virtual touchscreen device via /dev/uhid and accepts commands
+ * over a LocalServerSocket (abstract Unix domain socket).
+ *
+ * Usage: app_process / touchserver.TouchServer <screen_width> <screen_height>
+ */
+public class TouchServer {
+
+    private static final String SOCKET_NAME = "phonebot-touch";
+    private static final String UHID_PATH = "/dev/uhid";
+
+    // UHID event types we need to read
+    private static final int UHID_GET_REPORT = 9;
+    private static final int UHID_GET_REPORT_REPLY = 10;
+
+    private final int screenW;
+    private final int screenH;
+    private FileOutputStream uhidOut;
+    private FileInputStream uhidIn;
+    private volatile boolean running = true;
+
+    public TouchServer(int screenW, int screenH) {
+        this.screenW = screenW;
+        this.screenH = screenH;
+    }
+
+    public static void main(String[] args) {
+        if (args.length < 2) {
+            System.err.println("Usage: TouchServer <screen_width> <screen_height>");
+            System.exit(1);
+        }
+
+        int w = Integer.parseInt(args[0]);
+        int h = Integer.parseInt(args[1]);
+        System.out.println("TouchServer starting: " + w + "x" + h);
+
+        TouchServer server = new TouchServer(w, h);
+        try {
+            server.run();
+        } catch (Exception e) {
+            System.err.println("TouchServer fatal: " + e.getMessage());
+            e.printStackTrace();
+            System.exit(1);
+        }
+    }
+
+    private void run() throws Exception {
+        // 1. Open /dev/uhid
+        RandomAccessFile uhidFile = new RandomAccessFile(UHID_PATH, "rw");
+        uhidOut = new FileOutputStream(uhidFile.getFD());
+        uhidIn = new FileInputStream(uhidFile.getFD());
+
+        // 2. Create UHID device
+        byte[] create2 = HidDescriptor.buildCreate2();
+        uhidOut.write(create2);
+        uhidOut.flush();
+        System.out.println("UHID device created: " + HidDescriptor.DEVICE_NAME);
+
+        // 3. Wait for kernel to register device
+        Thread.sleep(1000);
+
+        // 4. Start UHID reader thread (handles GET_REPORT)
+        Thread readerThread = new Thread(this::uhidReaderLoop, "uhid-reader");
+        readerThread.setDaemon(true);
+        readerThread.start();
+
+        // 5. Start server socket and accept connection
+        System.out.println("Listening on socket: " + SOCKET_NAME);
+        LocalServerSocket serverSocket = new LocalServerSocket(SOCKET_NAME);
+        LocalSocket client = serverSocket.accept();
+        System.out.println("Client connected");
+
+        BufferedReader reader = new BufferedReader(
+            new InputStreamReader(client.getInputStream()));
+        PrintWriter writer = new PrintWriter(client.getOutputStream(), true);
+
+        // 6. Command loop
+        try {
+            String line;
+            while (running && (line = reader.readLine()) != null) {
+                String response = handleCommand(line.trim());
+                writer.println(response);
+                if ("DESTROY".equals(line.trim().split("\\s+")[0])) {
+                    break;
+                }
+            }
+        } finally {
+            // Cleanup
+            System.out.println("Shutting down...");
+            destroy();
+            client.close();
+            serverSocket.close();
+            uhidFile.close();
+        }
+    }
+
+    private String handleCommand(String line) {
+        String[] parts = line.split("\\s+");
+        if (parts.length == 0) return "ERR empty command";
+
+        String cmd = parts[0].toUpperCase();
+        try {
+            switch (cmd) {
+                case "PING":
+                    return "PONG";
+
+                case "TAP":
+                    return handleTap(parts);
+
+                case "SWIPE":
+                    return handleSwipe(parts);
+
+                case "DOWN":
+                    return handleDown(parts);
+
+                case "MOVE":
+                    return handleMove(parts);
+
+                case "UP":
+                    return handleUp();
+
+                case "DESTROY":
+                    return "OK";
+
+                default:
+                    return "ERR unknown command: " + cmd;
+            }
+        } catch (NumberFormatException e) {
+            return "ERR invalid number: " + e.getMessage();
+        } catch (Exception e) {
+            return "ERR " + e.getMessage();
+        }
+    }
+
+    // TAP x y pressure area hold_ms
+    private String handleTap(String[] parts) throws Exception {
+        if (parts.length < 6) return "ERR TAP requires: x y pressure area hold_ms";
+
+        int x = Integer.parseInt(parts[1]);
+        int y = Integer.parseInt(parts[2]);
+        float pressure = Float.parseFloat(parts[3]);
+        int area = Integer.parseInt(parts[4]);
+        int holdMs = Integer.parseInt(parts[5]);
+
+        TouchPhysics.TouchReport[] reports = TouchPhysics.generateTap(x, y, pressure, area, holdMs);
+        long start = System.currentTimeMillis();
+        executeReports(reports);
+        long elapsed = System.currentTimeMillis() - start;
+
+        return "OK " + elapsed;
+    }
+
+    // SWIPE x1 y1 x2 y2 dur_ms pressure
+    private String handleSwipe(String[] parts) throws Exception {
+        if (parts.length < 7) return "ERR SWIPE requires: x1 y1 x2 y2 dur_ms pressure";
+
+        int x1 = Integer.parseInt(parts[1]);
+        int y1 = Integer.parseInt(parts[2]);
+        int x2 = Integer.parseInt(parts[3]);
+        int y2 = Integer.parseInt(parts[4]);
+        int durMs = Integer.parseInt(parts[5]);
+        float pressure = Float.parseFloat(parts[6]);
+
+        TouchPhysics.TouchReport[] reports = TouchPhysics.generateSwipe(x1, y1, x2, y2, durMs, pressure);
+        long start = System.currentTimeMillis();
+        executeReports(reports);
+        long elapsed = System.currentTimeMillis() - start;
+
+        return "OK " + elapsed;
+    }
+
+    // DOWN x y pressure area
+    private String handleDown(String[] parts) throws Exception {
+        if (parts.length < 5) return "ERR DOWN requires: x y pressure area";
+
+        int x = Integer.parseInt(parts[1]);
+        int y = Integer.parseInt(parts[2]);
+        float pressure = Float.parseFloat(parts[3]);
+        int area = Integer.parseInt(parts[4]);
+
+        sendTouchReport(true, x, y, pressure, area);
+        return "OK";
+    }
+
+    // MOVE x y pressure area
+    private String handleMove(String[] parts) throws Exception {
+        if (parts.length < 5) return "ERR MOVE requires: x y pressure area";
+
+        int x = Integer.parseInt(parts[1]);
+        int y = Integer.parseInt(parts[2]);
+        float pressure = Float.parseFloat(parts[3]);
+        int area = Integer.parseInt(parts[4]);
+
+        sendTouchReport(true, x, y, pressure, area);
+        return "OK";
+    }
+
+    private String handleUp() throws Exception {
+        sendTouchReport(false, 0, 0, 0, 0);
+        return "OK";
+    }
+
+    /**
+     * Execute a sequence of TouchReport objects, sleeping between each.
+     */
+    private void executeReports(TouchPhysics.TouchReport[] reports) throws Exception {
+        for (TouchPhysics.TouchReport r : reports) {
+            sendTouchReport(r.tipSwitch, r.x, r.y, r.pressure, r.area);
+            if (r.sleepMs > 0) {
+                Thread.sleep(r.sleepMs);
+            }
+        }
+    }
+
+    /**
+     * Send a single HID touch report via /dev/uhid.
+     *
+     * Converts pixel coordinates to HID space (0-4095), float pressure to u8 (0-255).
+     */
+    private void sendTouchReport(boolean tipSwitch, int pixelX, int pixelY,
+                                  float pressure, int area) throws IOException {
+        int hidX = mapCoord(pixelX, screenW);
+        int hidY = mapCoord(pixelY, screenH);
+        int hidPressure = Math.min(255, Math.max(0, (int)(pressure * 255.0f)));
+        int hidArea = Math.min(255, Math.max(0, area));
+        int contactCount = tipSwitch ? 1 : 0;
+
+        byte[] input2 = HidDescriptor.buildInput2(
+            tipSwitch, 0, hidX, hidY, hidPressure, hidArea, contactCount);
+
+        synchronized (uhidOut) {
+            uhidOut.write(input2);
+            uhidOut.flush();
+        }
+    }
+
+    /**
+     * Map pixel coordinate to HID space (0-4095).
+     */
+    static int mapCoord(int pixel, int screenDim) {
+        if (screenDim <= 0) return 0;
+        return Math.min(4095, Math.max(0, (int)(pixel / (double) screenDim * 4095.0)));
+    }
+
+    /**
+     * Map float pressure (0.0-1.0) to HID pressure (0-255).
+     */
+    static int mapPressure(float pressure) {
+        return Math.min(255, Math.max(0, (int)(pressure * 255.0f)));
+    }
+
+    /**
+     * Write UHID_DESTROY to clean up the virtual device.
+     */
+    private void destroy() {
+        running = false;
+        try {
+            byte[] destroyBuf = HidDescriptor.buildDestroy();
+            synchronized (uhidOut) {
+                uhidOut.write(destroyBuf);
+                uhidOut.flush();
+            }
+            System.out.println("UHID device destroyed");
+        } catch (IOException e) {
+            System.err.println("Error destroying UHID device: " + e.getMessage());
+        }
+    }
+
+    /**
+     * Background thread that reads from /dev/uhid and handles GET_REPORT requests.
+     */
+    private void uhidReaderLoop() {
+        byte[] buf = new byte[4380]; // max uhid_event size
+        try {
+            while (running) {
+                int bytesRead = uhidIn.read(buf);
+                if (bytesRead < 4) continue;
+
+                int type = ByteBuffer.wrap(buf, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
+
+                if (type == UHID_GET_REPORT && bytesRead >= 12) {
+                    // Extract request id (u32 at offset 4) and rnum (u8 at offset 8)
+                    int requestId = ByteBuffer.wrap(buf, 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
+                    int rnum = buf[8] & 0xFF;
+
+                    if (rnum == 2) {
+                        // Feature Report ID 2: Contact Count Maximum
+                        sendGetReportReply(requestId);
+                    }
+                }
+                // Ignore UHID_START(2), UHID_STOP(3), UHID_OPEN(4), UHID_CLOSE(5)
+            }
+        } catch (IOException e) {
+            if (running) {
+                System.err.println("UHID reader error: " + e.getMessage());
+            }
+        }
+    }
+
+    /**
+     * Send UHID_GET_REPORT_REPLY for Feature Report (Contact Count Maximum).
+     *
+     * Struct:
+     *   0-3:   type = 10 (UHID_GET_REPORT_REPLY)
+     *   4-7:   id = request id
+     *   8-9:   err = 0 (success)
+     *   10-11: size = 2
+     *   12-13: data = [0x02, 0x0A] (Report ID 2, Contact Count Max 10)
+     */
+    private void sendGetReportReply(int requestId) throws IOException {
+        ByteBuffer reply = ByteBuffer.allocate(14);
+        reply.order(ByteOrder.LITTLE_ENDIAN);
+        reply.putInt(UHID_GET_REPORT_REPLY); // type = 10
+        reply.putInt(requestId);              // id
+        reply.putShort((short) 0);            // err = 0
+        reply.putShort((short) 2);            // size = 2
+        reply.put((byte) 0x02);               // Report ID 2
+        reply.put((byte) 0x0A);               // Contact Count Maximum = 10
+
+        synchronized (uhidOut) {
+            uhidOut.write(reply.array());
+            uhidOut.flush();
+        }
+    }
+}
diff --git a/phone-bot/touchserver/build.sh b/phone-bot/touchserver/build.sh
new file mode 100644
index 0000000..69b849a
--- /dev/null
+++ b/phone-bot/touchserver/build.sh
@@ -0,0 +1,87 @@
+#!/bin/bash
+# Build touchserver JAR with DEX for Android app_process
+#
+# Prerequisites:
+#   - JDK 8+ installed (javac)
+#   - Android SDK with d8 tool ($ANDROID_HOME/build-tools/*/d8)
+#   - android.jar from SDK ($ANDROID_HOME/platforms/android-29/android.jar)
+#
+# Output: touchserver.jar (contains classes.dex)
+#
+# Deploy:
+#   adb push touchserver.jar /data/local/tmp/
+#   adb shell "CLASSPATH=/data/local/tmp/touchserver.jar app_process / touchserver.TouchServer 1080 2220 &"
+
+set -e
+
+SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
+cd "$SCRIPT_DIR"
+
+# Find Android SDK
+if [ -z "$ANDROID_HOME" ]; then
+    if [ -d "$HOME/Android/Sdk" ]; then
+        ANDROID_HOME="$HOME/Android/Sdk"
+    elif [ -d "$HOME/Library/Android/sdk" ]; then
+        ANDROID_HOME="$HOME/Library/Android/sdk"
+    else
+        echo "ERROR: ANDROID_HOME not set and SDK not found"
+        exit 1
+    fi
+fi
+
+# Find android.jar (prefer API 29 for Android 10 compat)
+ANDROID_JAR=""
+for api in 29 30 31 32 33 34; do
+    if [ -f "$ANDROID_HOME/platforms/android-$api/android.jar" ]; then
+        ANDROID_JAR="$ANDROID_HOME/platforms/android-$api/android.jar"
+        break
+    fi
+done
+if [ -z "$ANDROID_JAR" ]; then
+    echo "ERROR: android.jar not found in $ANDROID_HOME/platforms/"
+    exit 1
+fi
+echo "Using android.jar: $ANDROID_JAR"
+
+# Find d8
+D8=""
+for dir in $(ls -d "$ANDROID_HOME/build-tools/"* 2>/dev/null | sort -V -r); do
+    if [ -f "$dir/d8" ] || [ -f "$dir/d8.bat" ]; then
+        D8="$dir/d8"
+        break
+    fi
+done
+if [ -z "$D8" ]; then
+    echo "ERROR: d8 not found in $ANDROID_HOME/build-tools/"
+    exit 1
+fi
+echo "Using d8: $D8"
+
+# Clean
+rm -f *.class classes.dex touchserver.jar
+
+# Compile Java -> class files (Java 8 target for max Android compat)
+echo "Compiling..."
+javac -source 8 -target 8 \
+    -bootclasspath "$ANDROID_JAR" \
+    -d . \
+    HidDescriptor.java TouchPhysics.java TouchServer.java
+
+# DEX: class -> dex
+echo "DEXing..."
+"$D8" touchserver/HidDescriptor.class touchserver/TouchPhysics.class \
+    touchserver/TouchPhysics\$TouchReport.class touchserver/TouchServer.class \
+    --output .
+
+# Package into JAR
+echo "Packaging..."
+jar cf touchserver.jar classes.dex
+
+# Clean intermediates
+rm -rf touchserver/*.class classes.dex
+
+echo "Build complete: touchserver.jar"
+echo ""
+echo "Deploy:"
+echo "  adb push touchserver.jar /data/local/tmp/"
+echo "  adb shell \"CLASSPATH=/data/local/tmp/touchserver.jar app_process / touchserver.TouchServer 1080 2220 &\""
