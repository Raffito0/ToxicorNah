"""Per-account rate limiting for TikTok engagement actions.

Tracks follows, likes, and comments per account per day. Persists to JSON
so limits carry across sessions. Conservative caps below TikTok's actual
limits to avoid temporary blocks.

TikTok approximate limits (2025-2026):
  - Follows: ~200/day, ~15-30/hour safe
  - Likes: ~500/day
  - Comments: ~100/day (varies)
"""

import json
import logging
import os
import time
from datetime import date

from .. import config

log = logging.getLogger(__name__)

# Conservative caps (well below TikTok limits)
DEFAULT_LIMITS = {
    "max_follows_day": 150,
    "max_follows_hour": 25,
    "max_likes_day": 400,
    "max_comments_day": 50,
}


class SessionRateLimiter:
    """Track and enforce engagement rate limits per account."""

    def __init__(self, account_name: str):
        self.account_name = account_name
        self._today = date.today().isoformat()
        self._limits = getattr(config, "RATE_LIMITS", DEFAULT_LIMITS)
        self._data_dir = os.path.join(config.DATA_DIR, "rate_limits")
        os.makedirs(self._data_dir, exist_ok=True)

        # Load today's counts from disk
        self._counts = self._load()
        self._hour_follows: list[float] = self._counts.get("hour_follows", [])

    # --- Public API -------------------------------------------------------

    def can_follow(self) -> bool:
        """Check if another follow is allowed."""
        if self._counts["follows"] >= self._limits["max_follows_day"]:
            log.warning("RATE: %s hit daily follow cap (%d)",
                        self.account_name, self._limits["max_follows_day"])
            return False
        if self._follows_this_hour() >= self._limits["max_follows_hour"]:
            log.warning("RATE: %s hit hourly follow cap (%d)",
                        self.account_name, self._limits["max_follows_hour"])
            return False
        return True

    def can_like(self) -> bool:
        """Check if another like is allowed."""
        if self._counts["likes"] >= self._limits["max_likes_day"]:
            log.warning("RATE: %s hit daily like cap (%d)",
                        self.account_name, self._limits["max_likes_day"])
            return False
        return True

    def can_comment(self) -> bool:
        """Check if another comment is allowed."""
        if self._counts["comments"] >= self._limits["max_comments_day"]:
            log.warning("RATE: %s hit daily comment cap (%d)",
                        self.account_name, self._limits["max_comments_day"])
            return False
        return True

    def on_follow(self):
        """Record a follow action."""
        self._counts["follows"] += 1
        self._hour_follows.append(time.time())
        self._persist()
        log.debug("RATE: %s follows today: %d", self.account_name, self._counts["follows"])

    def on_like(self):
        """Record a like action."""
        self._counts["likes"] += 1
        self._persist()

    def on_comment(self):
        """Record a comment action."""
        self._counts["comments"] += 1
        self._persist()

    def summary(self) -> dict:
        """Return current counts for logging."""
        return {
            "follows": self._counts["follows"],
            "likes": self._counts["likes"],
            "comments": self._counts["comments"],
            "follows_this_hour": self._follows_this_hour(),
        }

    # --- Internal ---------------------------------------------------------

    def _follows_this_hour(self) -> int:
        """Count follows in the last 60 minutes."""
        cutoff = time.time() - 3600
        self._hour_follows = [t for t in self._hour_follows if t > cutoff]
        return len(self._hour_follows)

    def _file_path(self) -> str:
        return os.path.join(self._data_dir, f"{self.account_name}_{self._today}.json")

    def _load(self) -> dict:
        """Load today's counts from disk. Returns zeros if no file or wrong date."""
        path = self._file_path()
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    data = json.load(f)
                if data.get("date") == self._today:
                    return data
            except (json.JSONDecodeError, KeyError):
                pass
        return {"date": self._today, "follows": 0, "likes": 0, "comments": 0, "hour_follows": []}

    def _persist(self):
        """Save counts to disk."""
        self._counts["hour_follows"] = self._hour_follows
        try:
            with open(self._file_path(), "w") as f:
                json.dump(self._counts, f)
        except OSError as e:
            log.warning("RATE: failed to persist counts: %s", e)
