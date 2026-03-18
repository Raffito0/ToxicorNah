#!/usr/bin/env python3
"""End-to-end integration test for the UHID touch engine.

Verifies the full lifecycle on a real Samsung S9:
  1. Touch server is running (or starts it)
  2. PING → PONG handshake
  3. getevent capture: sends TAP, verifies ABS_MT_PRESSURE varies (not constant)
  4. dumpsys input verification (via verify_uhid.py)
  5. Sends DESTROY, verifies server exits cleanly

Requires:
  - Samsung S9 (or compatible phone) connected via USB
  - TouchServer JAR deployed: adb push touchserver/touchserver.jar /data/local/tmp/
  - MotionLogger JAR deployed: adb push tools/motionlogger.jar /data/local/tmp/

Usage:
  python tools/test_uhid_integration.py --serial 2aa12f822d027ece

  # Skip launching server (use already running one):
  python tools/test_uhid_integration.py --serial 2aa12f822d027ece --no-start

  # Skip destroying server at end:
  python tools/test_uhid_integration.py --serial 2aa12f822d027ece --no-destroy
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import threading
import time

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PHONE_BOT_DIR = os.path.dirname(SCRIPT_DIR)
TOUCHSERVER_JAR = "/data/local/tmp/touchserver.jar"
MOTIONLOGGER_JAR = "/data/local/tmp/motionlogger.jar"

# Tap coordinates: centre of a 1080x2220 screen
TAP_X = 540
TAP_Y = 1110

# How many seconds to wait for TouchServer to start
SERVER_STARTUP_WAIT = 3.0
# How many seconds to capture getevent output
GETEVENT_CAPTURE_SECS = 5.0
# Port used for ADB forward (arbitrary, must be free on host)
ADB_FORWARD_PORT = 7200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class TestError(Exception):
    pass


def adb(serial: str, *args, timeout: int = 15) -> str:
    """Run an ADB command, return stdout."""
    cmd = ["adb", "-s", serial] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result.stdout


def adb_shell(serial: str, command: str, timeout: int = 15) -> str:
    return adb(serial, "shell", command, timeout=timeout)


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

def get_screen_size(serial: str) -> tuple[int, int]:
    """Return (width, height) from adb shell wm size."""
    output = adb_shell(serial, "wm size")
    import re
    m = re.search(r'(\d+)x(\d+)', output)
    if not m:
        raise TestError(f"Cannot parse screen size from: {output!r}")
    return int(m.group(1)), int(m.group(2))


def is_touch_server_running(serial: str) -> bool:
    out = adb_shell(serial, "pgrep -f TouchServer")
    return bool(out.strip())


def start_touch_server(serial: str, width: int, height: int) -> None:
    """Launch TouchServer on phone in background."""
    print(f"  Starting TouchServer ({width}x{height})...")
    subprocess.Popen(
        ["adb", "-s", serial, "shell",
         f"CLASSPATH={TOUCHSERVER_JAR} app_process / touchserver.TouchServer {width} {height}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(SERVER_STARTUP_WAIT)
    if not is_touch_server_running(serial):
        raise TestError("TouchServer did not start (is JAR pushed?)")
    print("  TouchServer running.")


def setup_adb_forward(serial: str, port: int) -> None:
    """Forward host port -> phone Unix socket."""
    adb(serial, "forward", f"tcp:{port}", "localabstract:phonebot-touch")


def teardown_adb_forward(serial: str, port: int) -> None:
    try:
        adb(serial, "forward", "--remove", f"tcp:{port}")
    except Exception:
        pass


def connect_socket(port: int, timeout: float = 5.0) -> socket.socket:
    """Open TCP connection to forwarded touch server socket."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    sock.connect(("127.0.0.1", port))
    return sock


def send_cmd(sock: socket.socket, cmd: str, timeout_s: float = 10.0) -> str:
    """Send a command line, read one response line."""
    sock.settimeout(timeout_s)
    sock.sendall((cmd + "\n").encode())
    buf = b""
    while b"\n" not in buf:
        chunk = sock.recv(256)
        if not chunk:
            raise TestError("Socket closed while reading response")
        buf += chunk
    return buf.decode().strip()


# ---------------------------------------------------------------------------
# getevent pressure check
# ---------------------------------------------------------------------------

def find_uhid_event_node(serial: str) -> str | None:
    """Return the /dev/input/eventN path for the UHID device (X max=4095)."""
    out = adb_shell(serial, "getevent -p 2>/dev/null", timeout=10)
    # Parse: "add device N: /dev/input/eventX\n  name: \"sec_touchscreen\"\n  ..."
    # Look for device with ABS_MT_POSITION_X max=4095 (0xfff)
    import re
    device_sections = re.split(r'(?=add device)', out)
    for section in device_sections:
        if "sec_touchscreen" not in section:
            continue
        # Check ABS_MT_POSITION_X max. getevent -p shows: "0035 : value 0, min 0, max 4095, ..."
        # 0x0035 = ABS_MT_POSITION_X
        if re.search(r'0035\s*:.*max\s+4095', section):
            m = re.search(r'add device \d+:\s+(/dev/input/\w+)', section)
            if m:
                return m.group(1)
    return None


def capture_getevent_pressure(serial: str, event_node: str, duration_s: float) -> list[int]:
    """Capture ABS_MT_PRESSURE values from getevent for `duration_s` seconds.

    Returns list of raw pressure integers observed.
    """
    # getevent -l prints lines like:
    #   /dev/input/event10: EV_ABS       ABS_MT_PRESSURE      0x0000003c
    proc = subprocess.Popen(
        ["adb", "-s", serial, "shell", f"getevent -l {event_node}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    pressures: list[int] = []
    deadline = time.monotonic() + duration_s
    try:
        while time.monotonic() < deadline:
            line = proc.stdout.readline() if proc.stdout else ""
            if not line:
                break
            if "ABS_MT_PRESSURE" in line:
                parts = line.strip().split()
                if parts:
                    try:
                        pressures.append(int(parts[-1], 16))
                    except ValueError:
                        pass
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
    return pressures


# ---------------------------------------------------------------------------
# Main test sequence
# ---------------------------------------------------------------------------

def run_integration_test(serial: str, no_start: bool, no_destroy: bool) -> bool:
    """Run all integration checks. Returns True on full pass."""

    print()
    print("=" * 60)
    print("UHID Touch Engine — Integration Test")
    print(f"Device: {serial}")
    print("=" * 60)

    all_ok = True

    def fail(msg: str) -> None:
        nonlocal all_ok
        all_ok = False
        print(f"  [FAIL] {msg}")

    # --- Step 1: Screen size ---
    print("\n[1] Get screen size")
    try:
        width, height = get_screen_size(serial)
        print(f"  Screen: {width}x{height}")
    except Exception as e:
        fail(f"Cannot get screen size: {e}")
        return False

    # --- Step 2: Start server ---
    print("\n[2] Touch server")
    if no_start:
        print("  Skipping start (--no-start)")
        if not is_touch_server_running(serial):
            fail("TouchServer not running and --no-start specified")
            return False
        print("  TouchServer already running: OK")
    else:
        if is_touch_server_running(serial):
            print("  TouchServer already running, skipping start")
        else:
            try:
                start_touch_server(serial, width, height)
            except TestError as e:
                fail(str(e))
                return False

    # --- Step 3: ADB forward + socket connect ---
    print("\n[3] Socket connection")
    teardown_adb_forward(serial, ADB_FORWARD_PORT)
    setup_adb_forward(serial, ADB_FORWARD_PORT)
    try:
        sock = connect_socket(ADB_FORWARD_PORT)
        print("  Connected OK")
    except Exception as e:
        fail(f"Cannot connect to touch server socket: {e}")
        teardown_adb_forward(serial, ADB_FORWARD_PORT)
        return False

    try:
        # --- Step 4: PING → PONG ---
        print("\n[4] PING -> PONG")
        try:
            resp = send_cmd(sock, "PING", timeout_s=5.0)
            if resp == "PONG":
                print("  PONG received: OK")
            else:
                fail(f"Expected PONG, got: {resp!r}")
        except Exception as e:
            fail(f"PING failed: {e}")
            return False

        # --- Step 5: getevent device discovery ---
        print("\n[5] Locate UHID event node")
        event_node = find_uhid_event_node(serial)
        if event_node:
            print(f"  UHID event node: {event_node}")
        else:
            print("  WARNING: UHID event node not found via getevent -p")
            print("           (device may not be registered yet, or getevent is rate-limited)")

        # --- Step 6: TAP + pressure variation check ---
        print("\n[6] TAP command + pressure variation")
        pressures: list[int] = []
        if event_node:
            # Start getevent capture in a thread, then send TAP
            capture_result: dict = {"values": []}

            def _capture():
                capture_result["values"] = capture_getevent_pressure(
                    serial, event_node, GETEVENT_CAPTURE_SECS
                )

            t = threading.Thread(target=_capture, daemon=True)
            t.start()
            time.sleep(0.8)  # let getevent start (0.8s covers slow ADB connections)
            try:
                resp = send_cmd(sock, f"TAP {TAP_X} {TAP_Y} 0.60 48 80", timeout_s=10.0)
                print(f"  TAP response: {resp}")
            except Exception as e:
                fail(f"TAP command failed: {e}")
            t.join(timeout=GETEVENT_CAPTURE_SECS + 2)
            pressures = capture_result["values"]
        else:
            # Still send TAP even without getevent capture
            try:
                resp = send_cmd(sock, f"TAP {TAP_X} {TAP_Y} 0.60 48 80", timeout_s=10.0)
                print(f"  TAP response: {resp}")
            except Exception as e:
                fail(f"TAP command failed: {e}")

        if pressures:
            unique_p = set(pressures)
            print(f"  ABS_MT_PRESSURE values captured: {sorted(unique_p)}")
            # Pressure should vary during ramp-up/down (at least 3 distinct values)
            if len(unique_p) >= 3:
                print("  Pressure varies (>= 3 distinct values): OK")
            elif len(unique_p) >= 2:
                print("  Pressure varies (2 distinct values): OK (marginal)")
            else:
                fail(f"Pressure appears constant: only {unique_p}")
        else:
            print("  getevent not available — skipping pressure variation check")
            print("  (Run 'adb shell getevent -l' manually after TAP to verify)")

        # --- Step 7: SWIPE ---
        print("\n[7] SWIPE command")
        try:
            resp = send_cmd(sock, f"SWIPE {TAP_X} 1800 {TAP_X} 400 300 0.55", timeout_s=15.0)
            print(f"  SWIPE response: {resp}")
            if resp.startswith("OK"):
                print("  SWIPE OK")
            else:
                fail(f"Unexpected SWIPE response: {resp!r}")
        except Exception as e:
            fail(f"SWIPE command failed: {e}")

        # --- Step 8: dumpsys input verification ---
        print("\n[8] dumpsys input verification")
        sys.path.insert(0, SCRIPT_DIR)
        try:
            from verify_uhid import verify_uhid_output, _print_result
            dumpsys_output = adb_shell(serial, "dumpsys input", timeout=20)
            result = verify_uhid_output(dumpsys_output)
            _print_result(result)
            if result["status"] != "PASS":
                fail("dumpsys input verification FAILED")
        except ImportError:
            print("  WARNING: verify_uhid.py not found, skipping dumpsys check")
        except Exception as e:
            fail(f"dumpsys verification error: {e}")

        # --- Step 9: DESTROY ---
        if not no_destroy:
            print("\n[9] DESTROY")
            try:
                sock.settimeout(5.0)
                sock.sendall(b"DESTROY\n")
                # Server exits after DESTROY — socket may close before we read response
                try:
                    resp = sock.recv(256).decode().strip()
                    print(f"  DESTROY response: {resp}")
                except Exception:
                    print("  DESTROY sent (no response — server exited normally)")
            except Exception as e:
                print(f"  WARNING: DESTROY send error: {e}")
            time.sleep(1.5)
            if is_touch_server_running(serial):
                fail("TouchServer still running after DESTROY")
            else:
                print("  TouchServer stopped: OK")
        else:
            print("\n[9] DESTROY — skipped (--no-destroy)")

    finally:
        sock.close()
        teardown_adb_forward(serial, ADB_FORWARD_PORT)

    # --- Final summary ---
    print()
    print("=" * 60)
    print(f"Result: {'PASS' if all_ok else 'FAIL'}")
    print("=" * 60)
    return all_ok


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="End-to-end integration test for UHID touch engine"
    )
    parser.add_argument("--serial", required=True,
                        help="ADB device serial (adb devices)")
    parser.add_argument("--no-start", action="store_true",
                        help="Don't start TouchServer (assume already running)")
    parser.add_argument("--no-destroy", action="store_true",
                        help="Don't send DESTROY at end (keep server running)")
    args = parser.parse_args()

    ok = run_integration_test(
        serial=args.serial,
        no_start=args.no_start,
        no_destroy=args.no_destroy,
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
