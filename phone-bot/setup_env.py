#!/usr/bin/env python3
"""
setup_env.py - Pre-production environment validator.

Run once before first production deployment to validate all configuration.

Usage:
    python phone-bot/setup_env.py

Checks:
  1. All required env vars are set (non-empty)
  2. ADB devices are reachable (lists connected phones)
  3. Airtable API key is valid (simple GET request)
  4. Proxy host is reachable (TCP connect)
  5. Gemini API key is valid (simple models list call)

Exit codes:
  0 = all checks passed
  1 = one or more checks failed
"""
import os
import socket
import subprocess
import sys
import urllib.error
import urllib.request

REQUIRED_VARS = [
    "AIRTABLE_API_KEY",
    "PROXY_USERNAME",
    "PROXY_PASSWORD",
    "PROXY_ROTATION_TOKEN",
    "HOTSPOT_SSID",
    "HOTSPOT_PASSWORD",
    "GEMINI_API_KEY",
    "PHONEBOT_TELEGRAM_TOKEN",
    "PHONEBOT_TELEGRAM_CHAT",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_URL",
]

OPTIONAL_VARS = [
    "ADB_SERIAL_PHONE1",
    "ADB_SERIAL_PHONE2",
    "ADB_SERIAL_PHONE3",
]

_PROXY_HOST = "sinister.services"
_PROXY_PORT = 20002


def validate_env() -> None:
    """Check all required env vars are set and non-empty.

    Raises ValueError with the missing variable name if any required var is absent.
    Prints a warning for missing optional vars (ADB serials) but does not raise.
    """
    for var in REQUIRED_VARS:
        val = os.environ.get(var, "").strip()
        if not val:
            raise ValueError(
                f"Required environment variable '{var}' is missing or empty. "
                f"Copy phone-bot/.env.template to phone-bot/.env and fill in all values."
            )

    # Check optional vars — warn but don't fail
    missing_optional = [v for v in OPTIONAL_VARS if not os.environ.get(v, "").strip()]
    if missing_optional:
        print(
            f"[WARNING] Optional ADB serial vars not set: {', '.join(missing_optional)}\n"
            f"          These are only needed if calling delivery.push_to_phone() directly.\n"
            f"          The executor manages ADB internally — this is usually fine."
        )


def check_adb_connections() -> bool:
    """Run `adb devices` and report connected phones. Non-fatal if none found."""
    try:
        result = subprocess.run(
            ["adb", "devices"],
            capture_output=True, text=True, timeout=10
        )
        lines = [ln for ln in result.stdout.strip().splitlines() if ln and "List of" not in ln]
        devices = [ln for ln in lines if "\t" in ln and "offline" not in ln]
        if devices:
            print(f"  [OK] ADB: {len(devices)} device(s) found")
            for d in devices:
                print(f"       {d.strip()}")
        else:
            print("  [WARN] ADB: no devices connected (phones must be plugged in for operation)")
        return True
    except FileNotFoundError:
        print("  [WARN] ADB: `adb` command not found in PATH — install Android SDK platform-tools")
        return True  # Non-fatal: ADB may not be installed on the planning machine
    except Exception as e:
        print(f"  [WARN] ADB check failed: {e}")
        return True  # Non-fatal


def check_airtable(api_key: str) -> bool:
    """Validate Airtable API key via GET /v0/meta/bases. Returns True on 200/OK."""
    try:
        req = urllib.request.Request(
            "https://api.airtable.com/v0/meta/bases",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                print("  [OK] Airtable: API key valid")
                return True
            print(f"  [FAIL] Airtable: unexpected status {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(f"  [FAIL] Airtable: invalid API key (401 Unauthorized)")
        else:
            print(f"  [FAIL] Airtable: HTTP {e.code}")
        return False
    except Exception as e:
        print(f"  [FAIL] Airtable: {e}")
        return False


def check_proxy(host: str = _PROXY_HOST, port: int = _PROXY_PORT) -> bool:
    """TCP connect to proxy host:port. Returns True if reachable."""
    try:
        with socket.create_connection((host, port), timeout=5):
            print(f"  [OK] Proxy: {host}:{port} reachable")
            return True
    except OSError as e:
        print(f"  [FAIL] Proxy: cannot reach {host}:{port} — {e}")
        return False


def check_gemini(api_key: str) -> bool:
    """Validate Gemini API key via models list. Returns True on success."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            if resp.status == 200:
                print("  [OK] Gemini: API key valid")
                return True
            print(f"  [FAIL] Gemini: unexpected status {resp.status}")
            return False
    except urllib.error.HTTPError as e:
        if e.code == 400:
            print("  [FAIL] Gemini: invalid API key (400 Bad Request)")
        else:
            print(f"  [FAIL] Gemini: HTTP {e.code}")
        return False
    except Exception as e:
        print(f"  [FAIL] Gemini: {e}")
        return False


def run_setup_checks() -> bool:
    """Run all checks in sequence. Print pass/fail for each. Returns True only if all pass."""
    print("\n" + "=" * 60)
    print("Phone-Bot Production Environment Validation")
    print("=" * 60)

    # Step 1: env vars (raises on failure — no point continuing if vars missing)
    print("\n[1/5] Checking required environment variables...")
    try:
        validate_env()
        print("  [OK] All required env vars present")
    except ValueError as e:
        print(f"  [FAIL] {e}")
        return False

    api_key = os.environ.get("AIRTABLE_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    # Step 2: ADB (non-fatal)
    print("\n[2/5] Checking ADB connections...")
    check_adb_connections()

    # Step 3: Airtable
    print("\n[3/5] Checking Airtable connectivity...")
    airtable_ok = check_airtable(api_key)

    # Step 4: Proxy
    print("\n[4/5] Checking proxy reachability...")
    proxy_ok = check_proxy()

    # Step 5: Gemini
    print("\n[5/5] Checking Gemini API key...")
    gemini_ok = check_gemini(gemini_key)

    all_ok = airtable_ok and proxy_ok and gemini_ok
    print("\n" + "=" * 60)
    if all_ok:
        print("RESULT: All checks passed. Ready for production.")
    else:
        print("RESULT: One or more checks failed. Fix the issues above before running.")
    print("=" * 60 + "\n")

    return all_ok


if __name__ == "__main__":
    # Load .env file if present (for convenience)
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_file):
        print(f"Loading .env from {env_file}")
        overridden = []
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    if key in os.environ and os.environ[key] != value:
                        overridden.append(key)
                    os.environ[key] = value  # .env takes precedence over shell env
        if overridden:
            print(f"[NOTE] .env overrode {len(overridden)} shell env var(s): {', '.join(overridden)}")

    success = run_setup_checks()
    sys.exit(0 if success else 1)
