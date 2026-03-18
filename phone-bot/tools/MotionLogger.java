package com.phonebot;

import android.os.Looper;
import android.view.InputDevice;
import android.view.MotionEvent;

/**
 * UHID Device Verifier — runs via app_process.
 *
 * Lists all input devices at the Android framework level and verifies that the
 * UHID virtual touchscreen is registered with the correct properties:
 *   - Positive deviceId (not -1, confirming proper kernel/framework handshake)
 *   - SOURCE_TOUCHSCREEN (0x00001002)
 *   - X axis raw max ~4095 (matching our HID descriptor)
 *   - Y axis raw max ~4095
 *   - PRESSURE range reported (normalized 0-1 by framework)
 *   - TOUCH_MAJOR range reported
 *
 * NOTE: This tool verifies device REGISTRATION at framework level. To verify
 * per-event pressure variation, use the getevent-based check in
 * test_uhid_integration.py (kernel-level ABS_MT_PRESSURE logs).
 *
 * Build:
 *   See tools/build_tools.sh
 *
 * Deploy and launch:
 *   adb push motionlogger.jar /data/local/tmp/
 *   adb shell "CLASSPATH=/data/local/tmp/motionlogger.jar app_process / com.phonebot.MotionLogger"
 *
 * Stop:
 *   Ctrl+C  or  adb shell pkill -f MotionLogger
 */
public class MotionLogger {

    private static final int SOURCE_TOUCHSCREEN = 0x00001002;
    private static final String UHID_DEVICE_NAME = "sec_touchscreen";
    private static final float UHID_AXIS_MAX = 4095.0f;
    // Tolerance for floating-point axis range comparisons
    private static final float AXIS_TOLERANCE = 1.0f;

    public static void main(String[] args) throws Exception {
        // Looper is required before accessing Android framework services
        Looper.prepare();

        System.out.println("=== MotionEvent Logger (UHID Verification) ===");
        System.out.println("Listing input devices at Android framework level...");
        System.out.println();

        int[] deviceIds = InputDevice.getDeviceIds();
        if (deviceIds == null || deviceIds.length == 0) {
            System.out.println("ERROR: No input devices found (InputManager unavailable?)");
            System.exit(1);
        }

        int touchscreenCount = 0;
        boolean uhidFound = false;

        for (int id : deviceIds) {
            InputDevice dev = InputDevice.getDevice(id);
            if (dev == null) continue;

            boolean isTouchscreen = (dev.getSources() & SOURCE_TOUCHSCREEN) == SOURCE_TOUCHSCREEN;
            if (!isTouchscreen) continue;

            touchscreenCount++;
            printDevice(dev);

            // Identify UHID device by X axis raw max == 4095
            InputDevice.MotionRange xRange = dev.getMotionRange(
                    MotionEvent.AXIS_X, InputDevice.SOURCE_TOUCHSCREEN);
            if (xRange != null && Math.abs(xRange.getMax() - UHID_AXIS_MAX) < AXIS_TOLERANCE) {
                System.out.println("  >>> UHID DEVICE DETECTED <<<");
                verifyUhidDevice(dev, xRange);
                uhidFound = true;
            }
            System.out.println();
        }

        System.out.println("---");
        System.out.println("Total touchscreen devices: " + touchscreenCount);
        System.out.println("UHID device found:         " + (uhidFound ? "YES" : "NO"));
        System.out.println();

        if (uhidFound && touchscreenCount >= 2) {
            System.out.println("Status: PASS");
            System.exit(0);
        } else if (!uhidFound) {
            System.out.println("Status: FAIL — UHID device (sec_touchscreen, X max=4095) not found");
            System.out.println("Hint: is TouchServer running? Try: adb shell pgrep -f TouchServer");
            System.exit(1);
        } else {
            System.out.println("Status: FAIL — expected >= 2 touchscreens, found " + touchscreenCount);
            System.exit(1);
        }
    }

    private static void printDevice(InputDevice dev) {
        System.out.println("Device ID=" + dev.getId() + "  name=\"" + dev.getName() + "\"");
        System.out.printf("  Sources:    0x%08x%n", dev.getSources());
        printAxis(dev, "AXIS_X",          MotionEvent.AXIS_X);
        printAxis(dev, "AXIS_Y",          MotionEvent.AXIS_Y);
        printAxis(dev, "AXIS_PRESSURE",   MotionEvent.AXIS_PRESSURE);
        printAxis(dev, "AXIS_TOUCH_MAJOR",MotionEvent.AXIS_TOUCH_MAJOR);
    }

    private static void printAxis(InputDevice dev, String label, int axis) {
        InputDevice.MotionRange r = dev.getMotionRange(axis, InputDevice.SOURCE_TOUCHSCREEN);
        if (r != null) {
            System.out.printf("  %-20s min=%.3f  max=%.3f%n", label + ":", r.getMin(), r.getMax());
        }
    }

    private static void verifyUhidDevice(InputDevice dev, InputDevice.MotionRange xRange) {
        System.out.println("  Verifying UHID properties:");

        // deviceId must be positive (negative = virtual/injected, not a real device)
        boolean idOk = dev.getId() > 0;
        System.out.println("    [" + (idOk ? "OK  " : "FAIL") + "] deviceId > 0"
                + "  (id=" + dev.getId() + ")");

        // SOURCE_TOUCHSCREEN must be set
        boolean srcOk = (dev.getSources() & SOURCE_TOUCHSCREEN) == SOURCE_TOUCHSCREEN;
        System.out.println("    [" + (srcOk ? "OK  " : "FAIL") + "] SOURCE_TOUCHSCREEN");

        // X axis raw max should be ~4095 (HID descriptor range)
        boolean xOk = Math.abs(xRange.getMin()) < 0.1f
                   && Math.abs(xRange.getMax() - UHID_AXIS_MAX) < AXIS_TOLERANCE;
        System.out.printf("    [%s] X raw range 0-4095  (min=%.0f max=%.0f)%n",
                xOk ? "OK  " : "FAIL", xRange.getMin(), xRange.getMax());

        // Y axis raw max should be ~4095
        InputDevice.MotionRange yRange = dev.getMotionRange(
                MotionEvent.AXIS_Y, InputDevice.SOURCE_TOUCHSCREEN);
        boolean yOk = yRange != null
                   && Math.abs(yRange.getMin()) < 0.1f
                   && Math.abs(yRange.getMax() - UHID_AXIS_MAX) < AXIS_TOLERANCE;
        if (yRange != null) {
            System.out.printf("    [%s] Y raw range 0-4095  (min=%.0f max=%.0f)%n",
                    yOk ? "OK  " : "FAIL", yRange.getMin(), yRange.getMax());
        } else {
            System.out.println("    [FAIL] Y raw range 0-4095  (axis not found)");
        }

        // PRESSURE: Android always normalizes to 0-1 regardless of HID range.
        // A max of ~1.0 is expected and correct — variable pressure per-event
        // is verified separately via getevent -l (kernel-level ABS_MT_PRESSURE).
        InputDevice.MotionRange pRange = dev.getMotionRange(
                MotionEvent.AXIS_PRESSURE, InputDevice.SOURCE_TOUCHSCREEN);
        boolean pOk = pRange != null && pRange.getMax() > 0.0f;
        if (pRange != null) {
            System.out.printf("    [%s] PRESSURE reported  (max=%.3f, framework-normalized)%n",
                    pOk ? "OK  " : "FAIL", pRange.getMax());
        } else {
            System.out.println("    [FAIL] PRESSURE axis not found");
        }

        // TOUCH_MAJOR
        InputDevice.MotionRange tmRange = dev.getMotionRange(
                MotionEvent.AXIS_TOUCH_MAJOR, InputDevice.SOURCE_TOUCHSCREEN);
        boolean tmOk = tmRange != null && tmRange.getMax() > 0.0f;
        if (tmRange != null) {
            System.out.printf("    [%s] TOUCH_MAJOR reported  (max=%.0f)%n",
                    tmOk ? "OK  " : "FAIL", tmRange.getMax());
        } else {
            System.out.println("    [FAIL] TOUCH_MAJOR axis not found");
        }
    }
}
