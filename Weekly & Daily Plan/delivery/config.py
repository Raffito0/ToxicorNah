"""Configuration for the Video Delivery Bridge."""
import os

# ─── Airtable ─────────────────────────────────────────────────────────────────
AIRTABLE_TOKEN = os.environ.get("AIRTABLE_TOKEN", "patItz5T1GfrD9gYD.ba48d2cc8f468eb32197e2884567c7660f35c82526be29b31d78ff889d091640")
AIRTABLE_BASE_ID = "appsgjIdkpak2kaXq"
CONTENT_LIBRARY_TABLE = "tblx1KX7mlTX5QyGb"

AIRTABLE_API = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{CONTENT_LIBRARY_TABLE}"

# ─── R2 / Download ───────────────────────────────────────────────────────────
R2_PUBLIC_URL = "https://pub-6e119e86bbae4479912db5c9a79d8fed.r2.dev"

# Local temp directory for downloaded videos before ADB push
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tmp_videos")

# ─── Phone → ADB Serial mapping ──────────────────────────────────────────────
# Set these env vars on the machine connected to phones via USB
ADB_SERIALS = {
    1: os.environ.get("ADB_SERIAL_PHONE1", ""),
    2: os.environ.get("ADB_SERIAL_PHONE2", ""),
    3: os.environ.get("ADB_SERIAL_PHONE3", ""),
}

# Where videos land on the phone filesystem
PHONE_VIDEO_DIR = "/sdcard/DCIM/Camera"

# ─── Phone label mapping (Airtable content_label field) ──────────────────────
PHONE_LABELS = {
    1: "Phone 1",
    2: "Phone 2",
    3: "Phone 3",
}
