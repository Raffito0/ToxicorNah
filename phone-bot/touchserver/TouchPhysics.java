package touchserver;

import java.util.Random;

/**
 * Generates realistic touch physics for HID reports.
 *
 * Handles pressure ramp-up/down curves, hold wobble, micro-drift during holds,
 * and swipe interpolation with pressure curves.
 */
public class TouchPhysics {

    private static final Random rng = new Random();

    // Report rate: one HID report every ~10ms (100Hz, matching real touchscreen)
    public static final int REPORT_INTERVAL_MS = 10;

    /**
     * Generate TAP report sequence.
     *
     * Returns an array of TouchReport objects representing the full tap gesture:
     * 1. Ramp up: 3-4 reports (~25ms), pressure 0.05 -> peak
     * 2. Hold: reports over hold_ms, pressure wobbles +/-5%, position drifts +/-1-3px
     * 3. Ramp down: 2-3 reports (~20ms), pressure peak -> 0
     * 4. UP report: tip_switch=false
     *
     * @param x        pixel X
     * @param y        pixel Y
     * @param pressure peak pressure (0.0-1.0)
     * @param area     base touch area (pixels)
     * @param holdMs   hold duration in ms
     * @return array of TouchReport
     */
    public static TouchReport[] generateTap(int x, int y, float pressure, int area, int holdMs) {
        // Calculate report counts
        int rampUpCount = 3 + (rng.nextInt(2)); // 3-4
        int holdCount = Math.max(2, holdMs / REPORT_INTERVAL_MS);
        int rampDownCount = 2 + (rng.nextInt(2)); // 2-3
        int totalCount = rampUpCount + holdCount + rampDownCount + 1; // +1 for UP

        TouchReport[] reports = new TouchReport[totalCount];
        int idx = 0;

        // Ramp up (~8ms per report, matching real 100Hz touchscreen rate)
        float[] rampUpPressures = {0.05f, 0.2f, 0.4f, pressure};
        for (int i = 0; i < rampUpCount; i++) {
            float p = (i < rampUpPressures.length) ? rampUpPressures[i] : pressure;
            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
            reports[idx++] = new TouchReport(true, x, y, p, a, 8);
        }

        // Hold: wobble pressure +/-5%, drift position +/-1-3px
        int lastDriftX = x;
        int lastDriftY = y;
        for (int i = 0; i < holdCount; i++) {
            float wobble = 1.0f + (rng.nextFloat() * 0.1f - 0.05f); // +/-5%
            float p = Math.min(1.0f, Math.max(0.01f, pressure * wobble));
            lastDriftX = x + (rng.nextInt(7) - 3); // +/-3px
            lastDriftY = y + (rng.nextInt(7) - 3);
            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
            reports[idx++] = new TouchReport(true, lastDriftX, lastDriftY, p, a, REPORT_INTERVAL_MS);
        }

        // Ramp down: lift from last drifted position (not original)
        float[] rampDownPressures = {pressure * 0.6f, pressure * 0.3f, pressure * 0.1f};
        for (int i = 0; i < rampDownCount; i++) {
            float p = (i < rampDownPressures.length) ? rampDownPressures[i] : 0.05f;
            int a = Math.max(1, (int)(area * p / Math.max(0.01f, pressure)));
            reports[idx++] = new TouchReport(true, lastDriftX, lastDriftY, p, a, REPORT_INTERVAL_MS);
        }

        // UP report from last position
        reports[idx++] = new TouchReport(false, lastDriftX, lastDriftY, 0, 0, 0);

        // Trim array if we allocated too much
        if (idx < totalCount) {
            TouchReport[] trimmed = new TouchReport[idx];
            System.arraycopy(reports, 0, trimmed, 0, idx);
            return trimmed;
        }
        return reports;
    }

    /**
     * Generate SWIPE report sequence.
     *
     * Linear position interpolation, pressure curve:
     * - First 15%: ramp from 0.15 to peak
     * - Middle 65%: peak +/-3% variation
     * - Last 20%: ramp from peak to 0
     *
     * @param x1       start pixel X
     * @param y1       start pixel Y
     * @param x2       end pixel X
     * @param y2       end pixel Y
     * @param durMs    total duration in ms
     * @param pressure peak pressure (0.0-1.0)
     * @return array of TouchReport (includes final UP)
     */
    public static TouchReport[] generateSwipe(int x1, int y1, int x2, int y2,
                                               int durMs, float pressure) {
        int reportCount = Math.max(5, durMs / REPORT_INTERVAL_MS);
        TouchReport[] reports = new TouchReport[reportCount + 1]; // +1 for UP

        for (int i = 0; i < reportCount; i++) {
            float t = (float) i / (float)(reportCount - 1); // 0.0 to 1.0

            // Linear position interpolation
            int x = x1 + (int)((x2 - x1) * t);
            int y = y1 + (int)((y2 - y1) * t);

            // Pressure curve
            float p;
            if (t < 0.15f) {
                // Ramp up: 0.15 to peak
                float rampT = t / 0.15f;
                p = 0.15f + (pressure - 0.15f) * rampT;
            } else if (t < 0.80f) {
                // Middle: peak with +/-3% wobble
                float wobble = 1.0f + (rng.nextFloat() * 0.06f - 0.03f);
                p = pressure * wobble;
            } else {
                // Ramp down: peak to 0
                float rampT = (t - 0.80f) / 0.20f;
                p = pressure * (1.0f - rampT);
            }
            p = Math.min(1.0f, Math.max(0.0f, p));

            // Area proportional to pressure
            int baseArea = 20;
            int areaScale = 40;
            int area = baseArea + (int)(p * areaScale);

            reports[i] = new TouchReport(true, x, y, p, area, REPORT_INTERVAL_MS);
        }

        // UP report
        reports[reportCount] = new TouchReport(false, x2, y2, 0, 0, 0);

        return reports;
    }

    /**
     * A single touch report to be sent as UHID_INPUT2.
     */
    public static class TouchReport {
        public final boolean tipSwitch;
        public final int x;       // pixel coordinates
        public final int y;
        public final float pressure; // 0.0-1.0
        public final int area;    // pixel area
        public final int sleepMs; // how long to sleep AFTER sending this report

        public TouchReport(boolean tipSwitch, int x, int y, float pressure, int area, int sleepMs) {
            this.tipSwitch = tipSwitch;
            this.x = x;
            this.y = y;
            this.pressure = pressure;
            this.area = area;
            this.sleepMs = sleepMs;
        }
    }
}
