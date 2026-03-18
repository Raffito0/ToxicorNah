package touchserver;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import android.net.LocalServerSocket;
import android.net.LocalSocket;

/**
 * UHID Touch Server — runs on phone via app_process.
 *
 * Creates a virtual touchscreen device via /dev/uhid and accepts commands
 * over a LocalServerSocket (abstract Unix domain socket).
 *
 * Usage: app_process / touchserver.TouchServer <screen_width> <screen_height>
 */
public class TouchServer {

    private static final String SOCKET_NAME = "phonebot-touch";
    private static final String UHID_PATH = "/dev/uhid";

    // UHID event types we need to read
    private static final int UHID_GET_REPORT = 9;
    private static final int UHID_GET_REPORT_REPLY = 10;

    private final int screenW;
    private final int screenH;
    private FileOutputStream uhidOut;
    private FileInputStream uhidIn;
    private volatile boolean running = true;

    public TouchServer(int screenW, int screenH) {
        this.screenW = screenW;
        this.screenH = screenH;
    }

    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: TouchServer <screen_width> <screen_height>");
            System.exit(1);
        }

        int w = Integer.parseInt(args[0]);
        int h = Integer.parseInt(args[1]);
        System.out.println("TouchServer starting: " + w + "x" + h);

        TouchServer server = new TouchServer(w, h);
        try {
            server.run();
        } catch (Exception e) {
            System.err.println("TouchServer fatal: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    private void run() throws Exception {
        // 1. Open /dev/uhid
        RandomAccessFile uhidFile = new RandomAccessFile(UHID_PATH, "rw");
        uhidOut = new FileOutputStream(uhidFile.getFD());
        uhidIn = new FileInputStream(uhidFile.getFD());

        // 2. Create UHID device
        byte[] create2 = HidDescriptor.buildCreate2();
        uhidOut.write(create2);
        uhidOut.flush();
        System.out.println("UHID device created: " + HidDescriptor.DEVICE_NAME);

        // 3. Wait for kernel to register device
        Thread.sleep(1000);

        // 4. Start UHID reader thread (handles GET_REPORT)
        Thread readerThread = new Thread(this::uhidReaderLoop, "uhid-reader");
        readerThread.setDaemon(true);
        readerThread.start();

        // 5. Start server socket and accept connection
        System.out.println("Listening on socket: " + SOCKET_NAME);
        LocalServerSocket serverSocket = new LocalServerSocket(SOCKET_NAME);
        LocalSocket client = serverSocket.accept();
        System.out.println("Client connected");

        BufferedReader reader = new BufferedReader(
            new InputStreamReader(client.getInputStream()));
        PrintWriter writer = new PrintWriter(client.getOutputStream(), true);

        // 6. Command loop
        try {
            String line;
            while (running && (line = reader.readLine()) != null) {
                String response = handleCommand(line.trim());
                writer.println(response);
                if ("DESTROY".equals(line.trim().split("\\s+")[0])) {
                    break;
                }
            }
        } finally {
            // Cleanup: destroy device, close streams, unblock reader thread
            System.out.println("Shutting down...");
            destroy();
            try { uhidIn.close(); } catch (IOException e) { /* unblock reader thread */ }
            try { readerThread.join(2000); } catch (InterruptedException e) { /* timeout ok */ }
            client.close();
            serverSocket.close();
            uhidFile.close();
        }
    }

    private String handleCommand(String line) {
        String[] parts = line.split("\\s+");
        if (parts.length == 0) return "ERR empty command";

        String cmd = parts[0].toUpperCase();
        try {
            switch (cmd) {
                case "PING":
                    return "PONG";

                case "TAP":
                    return handleTap(parts);

                case "SWIPE":
                    return handleSwipe(parts);

                case "DOWN":
                    return handleDown(parts);

                case "MOVE":
                    return handleMove(parts);

                case "UP":
                    return handleUp();

                case "DESTROY":
                    return "OK";

                default:
                    return "ERR unknown command: " + cmd;
            }
        } catch (NumberFormatException e) {
            return "ERR invalid number: " + e.getMessage();
        } catch (Exception e) {
            return "ERR " + e.getMessage();
        }
    }

    // TAP x y pressure area hold_ms
    private String handleTap(String[] parts) throws Exception {
        if (parts.length < 6) return "ERR TAP requires: x y pressure area hold_ms";

        int x = Integer.parseInt(parts[1]);
        int y = Integer.parseInt(parts[2]);
        float pressure = Float.parseFloat(parts[3]);
        int area = Integer.parseInt(parts[4]);
        int holdMs = Integer.parseInt(parts[5]);

        TouchPhysics.TouchReport[] reports = TouchPhysics.generateTap(x, y, pressure, area, holdMs);
        long start = System.currentTimeMillis();
        executeReports(reports);
        long elapsed = System.currentTimeMillis() - start;

        return "OK " + elapsed;
    }

    // SWIPE x1 y1 x2 y2 dur_ms pressure
    private String handleSwipe(String[] parts) throws Exception {
        if (parts.length < 7) return "ERR SWIPE requires: x1 y1 x2 y2 dur_ms pressure";

        int x1 = Integer.parseInt(parts[1]);
        int y1 = Integer.parseInt(parts[2]);
        int x2 = Integer.parseInt(parts[3]);
        int y2 = Integer.parseInt(parts[4]);
        int durMs = Integer.parseInt(parts[5]);
        float pressure = Float.parseFloat(parts[6]);

        TouchPhysics.TouchReport[] reports = TouchPhysics.generateSwipe(x1, y1, x2, y2, durMs, pressure);
        long start = System.currentTimeMillis();
        executeReports(reports);
        long elapsed = System.currentTimeMillis() - start;

        return "OK " + elapsed;
    }

    // DOWN x y pressure area
    private String handleDown(String[] parts) throws Exception {
        if (parts.length < 5) return "ERR DOWN requires: x y pressure area";

        int x = Integer.parseInt(parts[1]);
        int y = Integer.parseInt(parts[2]);
        float pressure = Float.parseFloat(parts[3]);
        int area = Integer.parseInt(parts[4]);

        sendTouchReport(true, x, y, pressure, area);
        return "OK";
    }

    // MOVE x y pressure area
    private String handleMove(String[] parts) throws Exception {
        if (parts.length < 5) return "ERR MOVE requires: x y pressure area";

        int x = Integer.parseInt(parts[1]);
        int y = Integer.parseInt(parts[2]);
        float pressure = Float.parseFloat(parts[3]);
        int area = Integer.parseInt(parts[4]);

        sendTouchReport(true, x, y, pressure, area);
        return "OK";
    }

    private String handleUp() throws Exception {
        sendTouchReport(false, 0, 0, 0, 0);
        return "OK";
    }

    /**
     * Execute a sequence of TouchReport objects, sleeping between each.
     */
    private void executeReports(TouchPhysics.TouchReport[] reports) throws Exception {
        for (TouchPhysics.TouchReport r : reports) {
            sendTouchReport(r.tipSwitch, r.x, r.y, r.pressure, r.area);
            if (r.sleepMs > 0) {
                Thread.sleep(r.sleepMs);
            }
        }
    }

    /**
     * Send a single HID touch report via /dev/uhid.
     *
     * Converts pixel coordinates to HID space (0-4095), float pressure to u8 (0-255).
     */
    private void sendTouchReport(boolean tipSwitch, int pixelX, int pixelY,
                                  float pressure, int area) throws IOException {
        int hidX = mapCoord(pixelX, screenW);
        int hidY = mapCoord(pixelY, screenH);
        int hidPressure = Math.min(255, Math.max(0, (int)(pressure * 255.0f)));
        int hidArea = Math.min(255, Math.max(0, area));
        int contactCount = tipSwitch ? 1 : 0;

        byte[] input2 = HidDescriptor.buildInput2(
            tipSwitch, 0, hidX, hidY, hidPressure, hidArea, contactCount);

        synchronized (uhidOut) {
            uhidOut.write(input2);
            uhidOut.flush();
        }
    }

    /**
     * Map pixel coordinate to HID space (0-4095).
     */
    static int mapCoord(int pixel, int screenDim) {
        if (screenDim <= 0) return 0;
        return Math.min(4095, Math.max(0, (int)(pixel / (double) screenDim * 4095.0)));
    }

    /**
     * Map float pressure (0.0-1.0) to HID pressure (0-255).
     */
    static int mapPressure(float pressure) {
        return Math.min(255, Math.max(0, (int)(pressure * 255.0f)));
    }

    /**
     * Write UHID_DESTROY to clean up the virtual device.
     */
    private void destroy() {
        running = false;
        try {
            byte[] destroyBuf = HidDescriptor.buildDestroy();
            synchronized (uhidOut) {
                uhidOut.write(destroyBuf);
                uhidOut.flush();
            }
            System.out.println("UHID device destroyed");
        } catch (IOException e) {
            System.err.println("Error destroying UHID device: " + e.getMessage());
        }
    }

    /**
     * Background thread that reads from /dev/uhid and handles GET_REPORT requests.
     */
    private void uhidReaderLoop() {
        byte[] buf = new byte[4380]; // max uhid_event size
        try {
            while (running) {
                int bytesRead = uhidIn.read(buf);
                if (bytesRead < 4) continue;

                int type = ByteBuffer.wrap(buf, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();

                if (type == UHID_GET_REPORT && bytesRead >= 12) {
                    // Extract request id (u32 at offset 4) and rnum (u8 at offset 8)
                    int requestId = ByteBuffer.wrap(buf, 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
                    int rnum = buf[8] & 0xFF;

                    if (rnum == 2) {
                        // Feature Report ID 2: Contact Count Maximum
                        sendGetReportReply(requestId);
                    }
                }
                // Ignore UHID_START(2), UHID_STOP(3), UHID_OPEN(4), UHID_CLOSE(5)
            }
        } catch (IOException e) {
            if (running) {
                System.err.println("UHID reader error: " + e.getMessage());
            }
        }
    }

    /**
     * Send UHID_GET_REPORT_REPLY for Feature Report (Contact Count Maximum).
     *
     * Struct:
     *   0-3:   type = 10 (UHID_GET_REPORT_REPLY)
     *   4-7:   id = request id
     *   8-9:   err = 0 (success)
     *   10-11: size = 2
     *   12-13: data = [0x02, 0x0A] (Report ID 2, Contact Count Max 10)
     */
    private void sendGetReportReply(int requestId) throws IOException {
        ByteBuffer reply = ByteBuffer.allocate(14);
        reply.order(ByteOrder.LITTLE_ENDIAN);
        reply.putInt(UHID_GET_REPORT_REPLY); // type = 10
        reply.putInt(requestId);              // id
        reply.putShort((short) 0);            // err = 0
        reply.putShort((short) 2);            // size = 2
        reply.put((byte) 0x02);               // Report ID 2
        reply.put((byte) 0x0A);               // Contact Count Maximum = 10

        synchronized (uhidOut) {
            uhidOut.write(reply.array());
            uhidOut.flush();
        }
    }
}
