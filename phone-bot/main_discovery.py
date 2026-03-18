"""Device discovery logic extracted for testability.

main.py imports this via relative import (from .main_discovery import ...).
Tests import via absolute import (from main_discovery import ...).
Both paths are supported.
"""
import logging
import subprocess

try:
    # When imported as part of phone-bot package (from main.py)
    from .config import ADB_PATH, PHONES
    from .core.adb import ADBController, DeviceConfigError
except ImportError:
    # When imported directly (from tests or standalone)
    from config import ADB_PATH, PHONES
    from core.adb import ADBController, DeviceConfigError

log = logging.getLogger("phone_bot.discovery")


def discover_devices() -> dict[int, ADBController]:
    """Detect connected ADB devices and match them to phone configs.

    Three discovery paths (priority order):
      Path A: phone has adb_serial set -> check if connected
      Path B: phone has model set -> match via getprop
      Path C: no serial, no model -> skip

    DeviceConfigError from ADBController is caught per-phone.
    """
    # Get list of connected device serials
    result = subprocess.run(
        [ADB_PATH, "devices", "-l"], capture_output=True, text=True
    )
    lines = result.stdout.strip().split("\n")[1:]  # skip header

    connected_serials = set()
    for line in lines:
        if "device" not in line or "offline" in line:
            continue
        serial = line.split()[0]
        connected_serials.add(serial)

    controllers = {}
    matched_serials = set()  # claimed by Path A

    # --- Pass 1: Path A (pre-set serial) ---
    for phone in PHONES:
        serial = phone.get("adb_serial")
        if not serial:
            continue  # no pre-set serial, handle in pass 2

        if serial in connected_serials:
            try:
                ctrl = ADBController(serial, phone)
                controllers[phone["id"]] = ctrl
                matched_serials.add(serial)
                log.info("Phone %d: serial %s connected (pre-configured)",
                         phone["id"], serial)
            except DeviceConfigError as e:
                log.critical("Phone %d (%s): %s -- skipping",
                             phone["id"], phone["name"], e)
        else:
            log.warning("Phone %d: expected serial %s not connected, skipping",
                        phone["id"], serial)

    # --- Pass 2: Path B (model matching) + Path C (skip) ---
    for phone in PHONES:
        if phone.get("adb_serial"):
            continue  # already handled in pass 1

        model = phone.get("model", "unknown")
        if model == "unknown":
            # Path C: no serial, no model
            log.warning("Phone %d (%s): no serial and no model configured, cannot discover",
                        phone["id"], phone["name"])
            continue

        # Path B: try model matching on unclaimed serials
        for serial in connected_serials - matched_serials:
            model_output = subprocess.run(
                [ADB_PATH, "-s", serial, "shell", "getprop", "ro.product.model"],
                capture_output=True, text=True,
            )
            device_model = model_output.stdout.strip()

            if model.lower() in device_model.lower():
                try:
                    phone["adb_serial"] = serial  # assign discovered serial
                    ctrl = ADBController(serial, phone)
                    controllers[phone["id"]] = ctrl
                    matched_serials.add(serial)
                    log.info("Found Phone %d: %s (%s) [%s]",
                             phone["id"], phone["name"], device_model, serial)
                    break
                except DeviceConfigError as e:
                    log.critical("Phone %d (%s): %s -- skipping",
                                 phone["id"], phone["name"], e)
                    break

    # Log unknown devices
    for serial in connected_serials - matched_serials:
        model_output = subprocess.run(
            [ADB_PATH, "-s", serial, "shell", "getprop", "ro.product.model"],
            capture_output=True, text=True,
        )
        log.warning("Unknown device: %s (%s)", serial, model_output.stdout.strip())

    return controllers
