"""
Unit tests for verify_uhid.py — dumpsys input parser.

Tests the pure-Python parsing logic against realistic sample output.
No ADB or phone required.
"""
import os
import sys

# Add phone-bot/tools/ to path so we can import verify_uhid directly
_tools_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
if _tools_dir not in sys.path:
    sys.path.insert(0, _tools_dir)

from verify_uhid import (
    parse_dumpsys_input,
    find_uhid_device,
    verify_uhid_output,
    count_touchscreens,
    InputDevice,
    MotionRange,
)


# ---------------------------------------------------------------------------
# Realistic dumpsys input sample with both real and UHID touchscreens
# ---------------------------------------------------------------------------

SAMPLE_DUMPSYS = """\
Input Manager State:
  Interactive: true

Input Devices:
-1: Virtual
  Generation: 0
  UniqueId:
  Sources: 0x00000101 (keyboard)

0: sec_touchscreen  /dev/input/event3
  Generation: 3
  UniqueId:
  Identifier: bus=0x0000, vendor=0x0000, product=0x0000, version=0x0000
  KeyLayoutFile: /system/usr/keylayout/sec_touchscreen.kl
  Sources: 0x00001002 (touchScreen)
  Properties: { INPUT_PROP_DIRECT }
  MotionRanges:
    X: source=0x00001002, min=0.000000, max=32767.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    Y: source=0x00001002, min=0.000000, max=32767.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    PRESSURE: source=0x00001002, min=0.000000, max=255.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    TOUCH_MAJOR: source=0x00001002, min=0.000000, max=127.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000

1: gpio-keys  /dev/input/event1
  Generation: 2
  UniqueId:
  Sources: 0x00000101 (keyboard)

10: sec_touchscreen
  Generation: 1
  UniqueId:
  Identifier: bus=0x0003, vendor=0x0000, product=0x0000, version=0x0000
  Sources: 0x00001002 (touchScreen)
  Properties: { INPUT_PROP_DIRECT }
  MotionRanges:
    X: source=0x00001002, min=0.000000, max=4095.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    Y: source=0x00001002, min=0.000000, max=4095.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    PRESSURE: source=0x00001002, min=0.000000, max=255.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    TOUCH_MAJOR: source=0x00001002, min=0.000000, max=255.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
"""

# Sample with NO UHID device (real touchscreen only)
SAMPLE_NO_UHID = """\
Input Devices:
-1: Virtual
  Generation: 0
  Sources: 0x00000101 (keyboard)

0: sec_touchscreen  /dev/input/event3
  Generation: 3
  Sources: 0x00001002 (touchScreen)
  Properties: { INPUT_PROP_DIRECT }
  MotionRanges:
    X: source=0x00001002, min=0.000000, max=32767.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    Y: source=0x00001002, min=0.000000, max=32767.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    PRESSURE: source=0x00001002, min=0.000000, max=255.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
    TOUCH_MAJOR: source=0x00001002, min=0.000000, max=127.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
"""

# Malformed / empty dumpsys output
SAMPLE_MALFORMED = "dumpsys: error - no input manager found\n"
SAMPLE_EMPTY = ""


# ---------------------------------------------------------------------------
# parse_dumpsys_input tests
# ---------------------------------------------------------------------------

class TestParseDumpsysInput:

    def test_extracts_device_names(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        names = [d.name for d in devices]
        assert "sec_touchscreen" in names

    def test_extracts_correct_device_count(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        # -1 Virtual, 0 sec_touchscreen, 1 gpio-keys, 10 sec_touchscreen
        assert len(devices) == 4

    def test_extracts_device_id(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        ids = {d.device_id for d in devices}
        assert -1 in ids
        assert 0 in ids
        assert 10 in ids

    def test_identifies_input_prop_direct(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        ts_devices = [d for d in devices if "sec_touchscreen" in d.name]
        assert all(d.has_prop_direct for d in ts_devices)

    def test_non_touchscreen_has_no_prop_direct(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        virtual = next(d for d in devices if d.device_id == -1)
        assert virtual.has_prop_direct is False

    def test_extracts_sources(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        ts = next(d for d in devices if d.device_id == 0)
        assert ts.sources == 0x00001002

    def test_extracts_abs_mt_position_x_range_real_device(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        real_ts = next(d for d in devices if d.device_id == 0)
        x_range = real_ts.motion_ranges.get("X")
        assert x_range is not None
        assert x_range.min_val == 0.0
        assert abs(x_range.max_val - 32767.0) < 1.0

    def test_extracts_abs_mt_position_x_range_uhid_device(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid_ts = next(d for d in devices if d.device_id == 10)
        x_range = uhid_ts.motion_ranges.get("X")
        assert x_range is not None
        assert x_range.min_val == 0.0
        assert abs(x_range.max_val - 4095.0) < 1.0

    def test_extracts_pressure_range(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid_ts = next(d for d in devices if d.device_id == 10)
        p_range = uhid_ts.motion_ranges.get("PRESSURE")
        assert p_range is not None
        assert abs(p_range.max_val - 255.0) < 1.0

    def test_extracts_touch_major_range(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid_ts = next(d for d in devices if d.device_id == 10)
        tm_range = uhid_ts.motion_ranges.get("TOUCH_MAJOR")
        assert tm_range is not None
        assert abs(tm_range.max_val - 255.0) < 1.0

    def test_extracts_bus_id_from_identifier_line(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid_ts = next(d for d in devices if d.device_id == 10)
        assert uhid_ts.bus_id == 0x0003

    def test_real_device_has_bus_id_zero(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        real_ts = next(d for d in devices if d.device_id == 0)
        assert real_ts.bus_id == 0x0000

    def test_handles_malformed_output_gracefully(self):
        devices = parse_dumpsys_input(SAMPLE_MALFORMED)
        assert isinstance(devices, list)
        # No touchscreen devices should be found
        ts_devices = [d for d in devices if d.is_touchscreen()]
        assert len(ts_devices) == 0

    def test_handles_empty_output_gracefully(self):
        devices = parse_dumpsys_input(SAMPLE_EMPTY)
        assert devices == []


# ---------------------------------------------------------------------------
# count_touchscreens tests
# ---------------------------------------------------------------------------

class TestCountTouchscreens:

    def test_counts_touchscreen_devices_correctly(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        count = count_touchscreens(devices)
        # Real sec_touchscreen (id=0) + UHID sec_touchscreen (id=10)
        assert count == 2

    def test_counts_zero_touchscreens_when_none(self):
        devices = parse_dumpsys_input(SAMPLE_MALFORMED)
        assert count_touchscreens(devices) == 0

    def test_counts_one_touchscreen_without_uhid(self):
        devices = parse_dumpsys_input(SAMPLE_NO_UHID)
        assert count_touchscreens(devices) == 1


# ---------------------------------------------------------------------------
# find_uhid_device tests
# ---------------------------------------------------------------------------

class TestFindUhidDevice:

    def test_finds_uhid_device_when_present(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid = find_uhid_device(devices)
        assert uhid is not None

    def test_uhid_device_has_correct_id(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid = find_uhid_device(devices)
        assert uhid.device_id == 10

    def test_uhid_device_has_x_max_4095(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid = find_uhid_device(devices)
        x_range = uhid.motion_ranges.get("X")
        assert abs(x_range.max_val - 4095.0) < 1.0

    def test_uhid_device_has_bus_0x0003(self):
        devices = parse_dumpsys_input(SAMPLE_DUMPSYS)
        uhid = find_uhid_device(devices)
        assert uhid.bus_id == 0x0003

    def test_returns_none_when_no_uhid_device(self):
        devices = parse_dumpsys_input(SAMPLE_NO_UHID)
        uhid = find_uhid_device(devices)
        assert uhid is None

    def test_returns_none_for_empty_device_list(self):
        assert find_uhid_device([]) is None

    def test_tiebreaker_returns_highest_device_id(self):
        """When multiple UHID candidates exist, highest device_id wins."""
        # Two devices with bus=0x0003 and X max=4095: IDs 5 and 10
        text = """\
5: sec_touchscreen
  Identifier: bus=0x0003, vendor=0x0000, product=0x0000, version=0x0000
  Sources: 0x00001002 (touchScreen)
  Properties: { INPUT_PROP_DIRECT }
  MotionRanges:
    X: source=0x00001002, min=0.000000, max=4095.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000

10: sec_touchscreen
  Identifier: bus=0x0003, vendor=0x0000, product=0x0000, version=0x0000
  Sources: 0x00001002 (touchScreen)
  Properties: { INPUT_PROP_DIRECT }
  MotionRanges:
    X: source=0x00001002, min=0.000000, max=4095.000000, flat=0.000000, fuzz=0.000000, resolution=0.000000
"""
        devices = parse_dumpsys_input(text)
        uhid = find_uhid_device(devices)
        assert uhid is not None
        assert uhid.device_id == 10


# ---------------------------------------------------------------------------
# verify_uhid_output tests
# ---------------------------------------------------------------------------

class TestVerifyUhidOutput:

    def test_returns_pass_when_uhid_device_present_with_correct_props(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        assert result["status"] == "PASS"

    def test_returns_fail_when_no_uhid_device_found(self):
        result = verify_uhid_output(SAMPLE_NO_UHID)
        assert result["status"] == "FAIL"

    def test_returns_fail_for_malformed_output(self):
        result = verify_uhid_output(SAMPLE_MALFORMED)
        assert result["status"] == "FAIL"

    def test_total_touchscreens_correct(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        assert result["total_touchscreens"] == 2

    def test_uhid_device_field_populated_on_pass(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        assert result["uhid_device"] is not None
        assert result["uhid_device"].device_id == 10

    def test_uhid_device_field_none_on_fail(self):
        result = verify_uhid_output(SAMPLE_NO_UHID)
        assert result["uhid_device"] is None

    def test_checks_list_populated(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        assert len(result["checks"]) >= 3

    def test_all_checks_pass_on_good_sample(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        failed = [c for c in result["checks"] if not c["passed"]]
        assert failed == [], f"Failed checks: {failed}"

    def test_at_least_one_check_fails_on_no_uhid(self):
        result = verify_uhid_output(SAMPLE_NO_UHID)
        failed = [c for c in result["checks"] if not c["passed"]]
        assert len(failed) >= 1

    def test_devices_list_populated(self):
        result = verify_uhid_output(SAMPLE_DUMPSYS)
        assert len(result["devices"]) == 4
