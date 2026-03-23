"""Textbroker — accept available articles from the pool, write and deliver."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import generate
from ..state.database import update_daily_stats
from ..config import RATE_LIMITS

log = logging.getLogger(__name__)

TEXTBROKER_URL = "https://www.textbroker.com"
TEXTBROKER_POOL = "https://www.textbroker.com/author/open-orders"


def check_and_write():
    """Check Textbroker for available articles, accept and write them."""
    max_articles = RATE_LIMITS["textbroker_articles"]

    with BrowserSession("textbroker") as session:
        session.goto(TEXTBROKER_POOL, wait=8)

        title = session.page.title()
        if "Login" in title or "Sign" in title or "Register" in title:
            log.warning("[Textbroker] Not logged in!")
            return

        log.info("[Textbroker] Logged in, checking open orders...")

        articles = _find_available_articles(session)
        log.info("[Textbroker] Found %d available articles", len(articles))

        for article in articles[:max_articles]:
            try:
                _accept_and_write(session, article)
                time.sleep(20)
            except Exception as e:
                log.error("[Textbroker] Article failed: %s", e)


def _find_available_articles(session: BrowserSession) -> list[dict]:
    """Find articles available to claim from the pool."""
    articles = []
    try:
        rows = session.page.query_selector_all("tr[class*='order']")
        if not rows:
            rows = session.page.query_selector_all("[class*='order-row']")

        for row in rows[:20]:
            try:
                text = row.inner_text()
                articles.append({"element": row, "text": text[:500]})
            except Exception:
                continue
    except Exception as e:
        log.warning("[Textbroker] Could not parse articles: %s", e)
    return articles


def _accept_and_write(session: BrowserSession, article: dict):
    """Accept an article and write it."""
    log.info("[Textbroker] Accepting: %s", article["text"][:80])

    article["element"].click()
    time.sleep(3)

    page_text = session.get_text()

    # Accept the order
    accept_btn = session.page.query_selector("text=Accept")
    if not accept_btn:
        accept_btn = session.page.query_selector("button[class*='accept']")
    if accept_btn:
        accept_btn.click()
        time.sleep(3)
    else:
        log.warning("[Textbroker] Accept button not found")
        return

    # Read requirements and write
    content = generate(
        f"Write an article based on these requirements:\n\n"
        f"{page_text[:3000]}\n\n"
        f"Follow the word count, topic, and any keyword requirements exactly.\n"
        f"Write naturally, informatively, with good structure (H2 headings, short paragraphs).\n"
        f"Do NOT include meta-commentary — just the article.",
        max_tokens=6000,
    )

    if not content:
        log.error("[Textbroker] Failed to generate article")
        return

    # Find the writing area and paste
    textarea = session.page.query_selector("textarea[id*='content']")
    if not textarea:
        textarea = session.page.query_selector("textarea")
    if not textarea:
        textarea = session.page.query_selector("[contenteditable='true']")

    if textarea:
        textarea.fill(content)
        time.sleep(2)

        # Submit
        submit = session.page.query_selector("text=Submit")
        if not submit:
            submit = session.page.query_selector("button[type='submit']")
        if submit:
            submit.click()
            time.sleep(3)
            log.info("[Textbroker] Article submitted!")
            update_daily_stats("textbroker", orders=1)
        else:
            log.warning("[Textbroker] Submit button not found")
    else:
        log.warning("[Textbroker] Text area not found")
