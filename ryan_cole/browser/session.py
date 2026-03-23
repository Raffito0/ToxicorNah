"""Camoufox browser session manager — anti-detect browser with cookie persistence."""
import json
import logging
import os
import time

from camoufox.sync_api import Camoufox

from ..config import COOKIES_DIR

log = logging.getLogger(__name__)

# Ensure cookies directory exists
os.makedirs(COOKIES_DIR, exist_ok=True)


class BrowserSession:
    """Manages a Camoufox browser session with cookie persistence.

    Usage:
        with BrowserSession("fiverr") as session:
            session.goto("https://www.fiverr.com")
            # ... do stuff
            session.save_cookies()
    """

    def __init__(self, platform: str, headless: bool = True):
        self.platform = platform
        self.headless = headless
        self._cookies_file = os.path.join(COOKIES_DIR, f"{platform}.json")
        self._browser = None
        self._context = None
        self.page = None

    def __enter__(self):
        self._browser = Camoufox(headless=self.headless).__enter__()
        self._context = self._browser  # Camoufox returns context directly
        self.page = self._context.new_page()

        # Load saved cookies if they exist
        if os.path.exists(self._cookies_file):
            self._load_cookies()
            log.info("[%s] Loaded saved cookies", self.platform)

        return self

    def __exit__(self, *args):
        if self._browser:
            self._browser.__exit__(*args)

    def goto(self, url: str, wait: float = 6.0, timeout: int = 30000):
        """Navigate to URL and wait for page to settle."""
        self.page.goto(url, timeout=timeout)
        time.sleep(wait)
        return self.page

    def save_cookies(self):
        """Save current session cookies to disk."""
        cookies = self._context.cookies()
        with open(self._cookies_file, "w") as f:
            json.dump(cookies, f, indent=2)
        log.info("[%s] Saved %d cookies", self.platform, len(cookies))

    def _load_cookies(self):
        """Load cookies from disk into browser context."""
        try:
            with open(self._cookies_file, "r") as f:
                cookies = json.load(f)
            self._context.add_cookies(cookies)
        except Exception as e:
            log.warning("[%s] Failed to load cookies: %s", self.platform, e)

    def is_logged_in(self, check_selector: str = None, check_url_contains: str = None) -> bool:
        """Check if we're logged in by looking for a selector or URL pattern."""
        if check_url_contains:
            return check_url_contains in self.page.url
        if check_selector:
            try:
                self.page.wait_for_selector(check_selector, timeout=5000)
                return True
            except Exception:
                return False
        return False

    def screenshot(self, path: str = None) -> bytes:
        """Take a screenshot. Returns bytes, optionally saves to path."""
        return self.page.screenshot(path=path)

    def get_text(self) -> str:
        """Get visible text content of the page."""
        try:
            return self.page.inner_text("body")
        except Exception:
            return ""

    def click(self, selector: str, timeout: int = 10000):
        """Click an element."""
        self.page.click(selector, timeout=timeout)

    def fill(self, selector: str, text: str, timeout: int = 10000):
        """Clear and fill a text input."""
        self.page.fill(selector, text, timeout=timeout)

    def type_human(self, selector: str, text: str, delay: float = 50):
        """Type text with human-like delay between keystrokes."""
        self.page.click(selector)
        self.page.type(selector, text, delay=delay)


def save_login_cookies(platform: str, url: str):
    """Interactive: open browser, let user login manually, save cookies.

    Run this once per platform:
        python -c "from ryan_cole.browser.session import save_login_cookies; save_login_cookies('fiverr', 'https://www.fiverr.com')"
    """
    print(f"\nOpening {platform} in visible browser...")
    print("Log in manually, then press Enter here when done.\n")

    with BrowserSession(platform, headless=False) as session:
        session.goto(url, wait=2)
        input(f"Press Enter after logging in to {platform}...")
        session.save_cookies()
        print(f"Cookies saved for {platform}!")
