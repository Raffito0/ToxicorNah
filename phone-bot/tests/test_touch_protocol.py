"""
Tests for the Touch Server command protocol.

Tests the protocol contract (what Python sends/receives), coordinate mapping,
and pressure mapping. Does not test Java internals — those are validated
on-device.
"""

import struct


# --- Mirror of TouchServer.java mapping functions ---

def map_coord(pixel: int, screen_dim: int) -> int:
    """Map pixel coordinate to HID space (0-4095)."""
    if screen_dim <= 0:
        return 0
    return min(4095, max(0, int(pixel / screen_dim * 4095.0)))


def map_pressure(pressure: float) -> int:
    """Map float pressure (0.0-1.0) to HID pressure (0-255)."""
    return min(255, max(0, int(pressure * 255.0)))


def format_tap_command(x: int, y: int, pressure: float, area: int, hold_ms: int) -> str:
    """Format a TAP command string."""
    return f"TAP {x} {y} {pressure} {area} {hold_ms}\n"


def format_swipe_command(x1: int, y1: int, x2: int, y2: int,
                         dur_ms: int, pressure: float) -> str:
    """Format a SWIPE command string."""
    return f"SWIPE {x1} {y1} {x2} {y2} {dur_ms} {pressure}\n"


def format_down_command(x: int, y: int, pressure: float, area: int) -> str:
    """Format a DOWN command string."""
    return f"DOWN {x} {y} {pressure} {area}\n"


def format_move_command(x: int, y: int, pressure: float, area: int) -> str:
    """Format a MOVE command string."""
    return f"MOVE {x} {y} {pressure} {area}\n"


# ===== Coordinate Mapping Tests =====

class TestCoordinateMapping:

    def test_pixel_origin_maps_to_hid_origin(self):
        assert map_coord(0, 1080) == 0
        assert map_coord(0, 2220) == 0

    def test_pixel_max_maps_to_hid_max(self):
        # pixel == screen_dim maps to 4095
        assert map_coord(1080, 1080) == 4095
        assert map_coord(2220, 2220) == 4095

    def test_pixel_center_maps_to_hid_center(self):
        x = map_coord(540, 1080)
        y = map_coord(1110, 2220)
        # Should be approximately 2048
        assert 2040 <= x <= 2055
        assert 2040 <= y <= 2055

    def test_pixel_clamps_to_4095(self):
        # Beyond screen bounds
        assert map_coord(2000, 1080) == 4095

    def test_pixel_clamps_to_zero(self):
        assert map_coord(-10, 1080) == 0

    def test_zero_screen_dim_returns_zero(self):
        assert map_coord(500, 0) == 0

    def test_samsung_s9_dimensions(self):
        # Samsung S9: 1080x2220
        x = map_coord(540, 1080)
        y = map_coord(1110, 2220)
        assert 2040 <= x <= 2055
        assert 2040 <= y <= 2055

    def test_samsung_s22_dimensions(self):
        # Samsung S22: 1080x2340
        x = map_coord(540, 1080)
        y = map_coord(1170, 2340)
        assert 2040 <= x <= 2055
        assert 2040 <= y <= 2055


# ===== Pressure Mapping Tests =====

class TestPressureMapping:

    def test_zero_pressure_maps_to_zero(self):
        assert map_pressure(0.0) == 0

    def test_full_pressure_maps_to_255(self):
        assert map_pressure(1.0) == 255

    def test_mid_pressure(self):
        p = map_pressure(0.55)
        assert 138 <= p <= 142  # 0.55 * 255 = 140.25

    def test_pressure_clamps_high(self):
        assert map_pressure(1.5) == 255

    def test_pressure_clamps_low(self):
        assert map_pressure(-0.1) == 0


# ===== Command Format Tests =====

class TestCommandFormat:

    def test_tap_command_format(self):
        cmd = format_tap_command(540, 1110, 0.55, 48, 80)
        assert cmd == "TAP 540 1110 0.55 48 80\n"

    def test_swipe_command_format(self):
        cmd = format_swipe_command(540, 2000, 540, 500, 300, 0.6)
        assert cmd == "SWIPE 540 2000 540 500 300 0.6\n"

    def test_down_command_format(self):
        cmd = format_down_command(540, 1110, 0.55, 48)
        assert cmd == "DOWN 540 1110 0.55 48\n"

    def test_move_command_format(self):
        cmd = format_move_command(540, 1110, 0.55, 48)
        assert cmd == "MOVE 540 1110 0.55 48\n"

    def test_ping_is_simple_newline_terminated(self):
        cmd = "PING\n"
        assert cmd.strip() == "PING"
        assert cmd.endswith("\n")
        assert len(cmd.strip().split()) == 1  # no parameters

    def test_destroy_is_simple_newline_terminated(self):
        cmd = "DESTROY\n"
        assert cmd.strip() == "DESTROY"
        assert cmd.endswith("\n")

    def test_up_is_simple_newline_terminated(self):
        cmd = "UP\n"
        assert cmd.strip() == "UP"
        assert cmd.endswith("\n")

    def test_commands_are_newline_terminated(self):
        for cmd in [
            format_tap_command(0, 0, 0.5, 30, 50),
            format_swipe_command(0, 0, 100, 100, 200, 0.5),
            format_down_command(0, 0, 0.5, 30),
            format_move_command(0, 0, 0.5, 30),
            "PING\n",
            "DESTROY\n",
            "UP\n",
        ]:
            assert cmd.endswith("\n"), f"Command does not end with newline: {cmd!r}"


# ===== Response Parsing Tests =====

class TestResponseParsing:

    def test_pong_response(self):
        response = "PONG"
        assert response == "PONG"

    def test_ok_response_tap(self):
        response = "OK 85"
        parts = response.split()
        assert parts[0] == "OK"
        assert int(parts[1]) > 0  # actual_ms

    def test_ok_response_simple(self):
        response = "OK"
        assert response.startswith("OK")

    def test_err_response_is_parseable(self):
        """ERR responses start with 'ERR ' followed by a description."""
        for err in [
            "ERR unknown command: FOOBAR",
            "ERR TAP requires: x y pressure area hold_ms",
            "ERR invalid number: abc",
        ]:
            assert err.startswith("ERR")
            assert len(err) > 4  # has a message after ERR


# ===== UHID_GET_REPORT_REPLY Struct Tests =====

class TestGetReportReply:

    def test_reply_struct_layout(self):
        """Verify UHID_GET_REPORT_REPLY struct is correctly formed."""
        # Build the reply the same way the Java server does
        request_id = 42
        buf = bytearray(14)
        struct.pack_into('<I', buf, 0, 10)   # type = UHID_GET_REPORT_REPLY
        struct.pack_into('<I', buf, 4, request_id)  # id
        struct.pack_into('<H', buf, 8, 0)    # err = 0
        struct.pack_into('<H', buf, 10, 2)   # size = 2
        buf[12] = 0x02  # Report ID 2
        buf[13] = 0x0A  # Contact Count Maximum = 10

        assert len(buf) == 14
        assert struct.unpack_from('<I', buf, 0)[0] == 10
        assert struct.unpack_from('<I', buf, 4)[0] == 42
        assert struct.unpack_from('<H', buf, 8)[0] == 0
        assert struct.unpack_from('<H', buf, 10)[0] == 2
        assert buf[12] == 0x02
        assert buf[13] == 0x0A
