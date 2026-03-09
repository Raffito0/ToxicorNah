"""Push videos to physical phones via ADB."""
import random
import subprocess
from datetime import datetime

from .config import ADB_SERIALS, PHONE_VIDEO_DIR

# All phones are Samsung — same naming convention (VID_YYYYMMDD_HHMMSS_NNN.mp4)
def _samsung_filename(now):
    return f"VID_{now.strftime('%Y%m%d_%H%M%S')}_{random.randint(100, 999)}.mp4"


def push_to_phone(phone_id: int, local_path: str) -> str:
    """Push a video file to phone via ADB.

    Args:
        phone_id: Phone number (1, 2, or 3)
        local_path: Local path of the video file

    Returns:
        Remote path on the phone.

    Raises:
        ValueError: If no ADB serial configured for the phone.
        subprocess.CalledProcessError: If adb push fails.
    """
    serial = ADB_SERIALS.get(phone_id, "")
    if not serial:
        raise ValueError(
            f"No ADB serial configured for phone {phone_id}. "
            f"Set ADB_SERIAL_PHONE{phone_id} env var."
        )

    now = datetime.now()
    filename = _samsung_filename(now)
    remote_path = f"{PHONE_VIDEO_DIR}/{filename}"

    # Ensure target directory exists on phone
    subprocess.run(
        ["adb", "-s", serial, "shell", "mkdir", "-p", PHONE_VIDEO_DIR],
        check=True, capture_output=True, text=True,
    )

    # Push the file
    subprocess.run(
        ["adb", "-s", serial, "push", local_path, remote_path],
        check=True, capture_output=True, text=True,
    )

    return remote_path
