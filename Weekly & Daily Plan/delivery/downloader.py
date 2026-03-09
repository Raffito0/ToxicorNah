"""Download videos from Cloudflare R2."""
import os
import urllib.request

from .config import DOWNLOAD_DIR


def download_video(video_url: str, filename: str | None = None) -> str:
    """Download a video from R2 to local temp directory.

    Args:
        video_url: Full R2 public URL
        filename: Optional filename override. If None, extracted from URL.

    Returns:
        Local file path of the downloaded video.
    """
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    if not filename:
        filename = video_url.rsplit("/", 1)[-1]

    dest = os.path.join(DOWNLOAD_DIR, filename)

    # R2 requires User-Agent header (Python urllib default gets 403)
    req = urllib.request.Request(video_url, headers={
        "User-Agent": "ToxicOrNah-Delivery/1.0",
    })

    with urllib.request.urlopen(req) as resp:
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)

    return dest
