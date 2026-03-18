#!/usr/bin/env python3
"""UHID Verification Tool.

Parses 'adb shell dumpsys input' output to verify that the UHID virtual
touchscreen is correctly registered with the expected properties:

  - Device named 'sec_touchscreen' (matches HidDescriptor.java)
  - Identifier bus=0x0003 (USB — how UHID registers vs real HW bus=0x0000)
  - SOURCE_TOUCHSCREEN (0x1002)
  - INPUT_PROP_DIRECT
  - ABS_MT_POSITION_X: 0-4095  (raw HID coordinate space)
  - ABS_MT_POSITION_Y: 0-4095
  - ABS_MT_PRESSURE: 0-255     (raw, before Android normalization)
  - ABS_MT_TOUCH_MAJOR: 0-255

Usage:
  python tools/verify_uhid.py <adb_serial>
  python tools/verify_uhid.py 2aa12f822d027ece

Exit codes:
  0 = PASS
  1 = FAIL
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Optional

# Android SOURCE_TOUCHSCREEN constant (0x00001002)
SOURCE_TOUCHSCREEN = 0x00001002

# Name we give our UHID device in HidDescriptor.java
UHID_DEVICE_NAME = "sec_touchscreen"

# Expected raw HID coordinate range (from our HID descriptor)
UHID_AXIS_MAX = 4095.0

# UHID devices always register with bus=0x0003 (USB).
# Real Samsung touchscreens use bus=0x0000 (internal/I2C).
UHID_BUS_ID = 0x0003


@dataclass
class MotionRange:
    name: str
    source: int
    min_val: float
    max_val: float


@dataclass
class InputDevice:
    device_id: int
    name: str
    sources: int = 0
    bus_id: int = 0       # from "Identifier: bus=0x####" line
    has_prop_direct: bool = False
    motion_ranges: dict = field(default_factory=dict)  # axis_name -> MotionRange

    def is_touchscreen(self) -> bool:
        return bool(self.sources & SOURCE_TOUCHSCREEN)

    def is_uhid(self) -> bool:
        """Heuristic: UHID registers as USB bus (0x0003) with our HID X range."""
        x = self.motion_ranges.get("X")
        x_ok = x is not None and abs(x.max_val - UHID_AXIS_MAX) < 1.0
        bus_ok = self.bus_id == UHID_BUS_ID
        return self.is_touchscreen() and (bus_ok or x_ok)


def parse_dumpsys_input(text: str) -> list[InputDevice]:
    """Parse 'dumpsys input' text into a list of InputDevice objects.

    Handles the standard 'adb shell dumpsys input' output format.
    Lines outside a device block are ignored gracefully.
    """
    devices: list[InputDevice] = []
    current: Optional[InputDevice] = None

    # Device header at start of line (0-2 spaces of indent).
    # Examples:
    #   "0: sec_touchscreen  /dev/input/event3"
    #   "-1: Virtual"
    #   "10: sec_touchscreen"
    device_header_pat = re.compile(r'^\s{0,2}(-?\d+):\s+(\S+)')

    # "  Sources: 0x00001002 (touchScreen)"
    sources_pat = re.compile(r'Sources:\s+(0x[0-9a-fA-F]+)')

    # "  Identifier: bus=0x0003, vendor=0x0000, ..."
    identifier_pat = re.compile(r'Identifier:\s+bus=(0x[0-9a-fA-F]+)')

    # "  Properties: { INPUT_PROP_DIRECT }"
    prop_direct_pat = re.compile(r'Properties:.*INPUT_PROP_DIRECT')

    # "    X: source=0x00001002, min=0.000000, max=4095.000000, ..."
    # Accept any positive whitespace prefix (handles both spaces and tabs).
    motion_range_pat = re.compile(
        r'^\s+(\w+):\s+source=(0x[0-9a-fA-F]+),\s+min=([\d.]+),\s+max=([\d.]+)'
    )

    for line in text.splitlines():
        stripped = line.strip()

        # New device header? Collapses lstrip + length check into one pattern.
        m = device_header_pat.match(line)
        if m:
            if current is not None:
                devices.append(current)
            dev_id = int(m.group(1))
            dev_name = m.group(2)
            current = InputDevice(device_id=dev_id, name=dev_name)
            continue

        if current is None:
            continue

        # Sources line
        m = sources_pat.search(stripped)
        if m:
            current.sources = int(m.group(1), 16)
            continue

        # Identifier: bus=
        m = identifier_pat.search(stripped)
        if m:
            current.bus_id = int(m.group(1), 16)
            continue

        # Properties line
        if prop_direct_pat.search(stripped):
            current.has_prop_direct = True
            continue

        # MotionRange entry — accepts any whitespace indent (spaces or tabs)
        m = motion_range_pat.match(line)
        if m:
            axis_name = m.group(1)
            source = int(m.group(2), 16)
            min_val = float(m.group(3))
            max_val = float(m.group(4))
            current.motion_ranges[axis_name] = MotionRange(
                name=axis_name, source=source, min_val=min_val, max_val=max_val
            )

    if current is not None:
        devices.append(current)

    return devices


def find_uhid_device(devices: list[InputDevice]) -> Optional[InputDevice]:
    """Find the UHID virtual touchscreen among the device list.

    Primary identifier: bus=0x0003 (UHID always registers as USB bus) AND
    is a touchscreen. Fallback: touchscreen with X axis raw max ~4095.

    When multiple candidates exist, prefer the device named 'sec_touchscreen'
    and with the highest device_id (UHID registered after the real device).
    """
    # Primary: bus=0x0003 touchscreens
    primary = [d for d in devices if d.is_touchscreen() and d.bus_id == UHID_BUS_ID]

    # Fallback: any touchscreen with X max ~4095 (may overlap with primary)
    fallback = []
    if not primary:
        for dev in devices:
            if not dev.is_touchscreen():
                continue
            x = dev.motion_ranges.get("X")
            if x and abs(x.max_val - UHID_AXIS_MAX) < 1.0:
                fallback.append(dev)

    candidates = primary or fallback
    if not candidates:
        return None

    # Prefer sec_touchscreen; among ties, highest device_id wins
    named = [d for d in candidates if UHID_DEVICE_NAME in d.name]
    pool = named if named else candidates
    return max(pool, key=lambda d: d.device_id)


def count_touchscreens(devices: list[InputDevice]) -> int:
    """Count devices that report SOURCE_TOUCHSCREEN."""
    return sum(1 for d in devices if d.is_touchscreen())


def _check(label: str, passed: bool, detail: str = "") -> dict:
    return {"label": label, "passed": passed, "detail": detail}


def verify_uhid_output(text: str) -> dict:
    """Verify UHID device from 'dumpsys input' text.

    Returns:
        {
            status: "PASS" | "FAIL",
            devices: list[InputDevice],
            uhid_device: InputDevice | None,
            total_touchscreens: int,
            checks: list[{label, passed, detail}],
        }
    """
    devices = parse_dumpsys_input(text)
    uhid_dev = find_uhid_device(devices)
    total_ts = count_touchscreens(devices)

    checks: list[dict] = []

    # Check 1: UHID device found
    checks.append(_check(
        "UHID device present",
        uhid_dev is not None,
        f"{uhid_dev.name} (ID: {uhid_dev.device_id})" if uhid_dev else "not found",
    ))

    if uhid_dev:
        # Check 2: bus=0x0003 (USB — UHID fingerprint)
        checks.append(_check(
            "Identifier bus=0x0003 (USB/UHID)",
            uhid_dev.bus_id == UHID_BUS_ID,
            f"bus=0x{uhid_dev.bus_id:04x}",
        ))

        # Check 3: SOURCE_TOUCHSCREEN
        checks.append(_check(
            "SOURCE_TOUCHSCREEN",
            uhid_dev.is_touchscreen(),
            f"0x{uhid_dev.sources:08x}",
        ))

        # Check 4: INPUT_PROP_DIRECT
        checks.append(_check(
            "INPUT_PROP_DIRECT",
            uhid_dev.has_prop_direct,
            "YES" if uhid_dev.has_prop_direct else "NO",
        ))

        # Check 5: ABS_MT_POSITION_X range 0-4095
        x = uhid_dev.motion_ranges.get("X")
        checks.append(_check(
            "ABS_MT_POSITION_X: min=0, max=4095",
            x is not None and x.min_val == 0.0 and abs(x.max_val - 4095.0) < 1.0,
            f"min={x.min_val:.0f}, max={x.max_val:.0f}" if x else "not found",
        ))

        # Check 6: ABS_MT_POSITION_Y range 0-4095
        y = uhid_dev.motion_ranges.get("Y")
        checks.append(_check(
            "ABS_MT_POSITION_Y: min=0, max=4095",
            y is not None and y.min_val == 0.0 and abs(y.max_val - 4095.0) < 1.0,
            f"min={y.min_val:.0f}, max={y.max_val:.0f}" if y else "not found",
        ))

        # Check 7: ABS_MT_PRESSURE range 0-255
        p = uhid_dev.motion_ranges.get("PRESSURE")
        checks.append(_check(
            "ABS_MT_PRESSURE: min=0, max=255",
            p is not None and p.min_val == 0.0 and abs(p.max_val - 255.0) < 1.0,
            f"min={p.min_val:.0f}, max={p.max_val:.0f}" if p else "not found",
        ))

        # Check 8: ABS_MT_TOUCH_MAJOR range 0-255
        tm = uhid_dev.motion_ranges.get("TOUCH_MAJOR")
        checks.append(_check(
            "ABS_MT_TOUCH_MAJOR: min=0, max=255",
            tm is not None and tm.min_val == 0.0 and abs(tm.max_val - 255.0) < 1.0,
            f"min={tm.min_val:.0f}, max={tm.max_val:.0f}" if tm else "not found",
        ))

    # Check 9: total touchscreens >= 2 (real + UHID)
    checks.append(_check(
        "Total touchscreens >= 2",
        total_ts >= 2,
        f"found {total_ts}",
    ))

    status = "PASS" if all(c["passed"] for c in checks) else "FAIL"
    return {
        "status": status,
        "devices": devices,
        "uhid_device": uhid_dev,
        "total_touchscreens": total_ts,
        "checks": checks,
    }


def _print_result(result: dict) -> None:
    """Print verification result in the documented output format."""
    print("=== UHID Verification ===")
    uhid = result["uhid_device"]
    if uhid:
        print(f"UHID Device: {uhid.name} (ID: {uhid.device_id})")
        src_label = "TOUCHSCREEN" if uhid.is_touchscreen() else "OTHER"
        print(f"  bus:              0x{uhid.bus_id:04x}")
        print(f"  Sources:          0x{uhid.sources:04x} ({src_label})")
        print(f"  INPUT_PROP_DIRECT: {'YES' if uhid.has_prop_direct else 'NO'}")
        for axis_label, axis_key in [
            ("ABS_MT_POSITION_X", "X"),
            ("ABS_MT_POSITION_Y", "Y"),
            ("ABS_MT_PRESSURE", "PRESSURE"),
            ("ABS_MT_TOUCH_MAJOR", "TOUCH_MAJOR"),
        ]:
            r = uhid.motion_ranges.get(axis_key)
            if r:
                print(f"  {axis_label}: min={int(r.min_val)}, max={int(r.max_val)}")
    else:
        print("UHID Device: NOT FOUND")

    print(f"Total touchscreens: {result['total_touchscreens']} "
          f"({'real + UHID' if result['total_touchscreens'] >= 2 else 'real only'})")
    print()

    for check in result["checks"]:
        icon = "OK  " if check["passed"] else "FAIL"
        print(f"  [{icon}] {check['label']}: {check['detail']}")

    print()
    print(f"Status: {result['status']}")


def run_verification(serial: str) -> dict:
    """Run 'adb shell dumpsys input' and verify UHID device.

    Prints results and returns the result dict.
    Exits with code 1 on FAIL, 0 on PASS.
    """
    try:
        proc = subprocess.run(
            ["adb", "-s", serial, "shell", "dumpsys", "input"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        text = proc.stdout
    except subprocess.TimeoutExpired:
        print("ERROR: 'adb dumpsys input' timed out", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: adb not found in PATH", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    result = verify_uhid_output(text)
    _print_result(result)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_uhid.py <adb_serial>")
        print("Example: python verify_uhid.py 2aa12f822d027ece")
        sys.exit(1)

    r = run_verification(sys.argv[1])
    sys.exit(0 if r["status"] == "PASS" else 1)
