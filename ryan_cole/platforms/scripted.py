"""Scripted — accept writing jobs, write and deliver."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import generate
from ..state.database import update_daily_stats
from ..config import RATE_LIMITS

log = logging.getLogger(__name__)

SCRIPTED_URL = "https://www.scripted.com"
SCRIPTED_JOBS = "https://www.scripted.com/writer/jobs"


def check_and_write():
    """Check Scripted for available jobs, accept and write."""
    max_articles = RATE_LIMITS["scripted_articles"]

    with BrowserSession("scripted") as session:
        session.goto(SCRIPTED_JOBS, wait=8)

        title = session.page.title()
        if "Log In" in title or "Sign Up" in title:
            log.warning("[Scripted] Not logged in!")
            return

        log.info("[Scripted] Logged in, checking jobs...")

        jobs = _find_available_jobs(session)
        log.info("[Scripted] Found %d available jobs", len(jobs))

        for job in jobs[:max_articles]:
            try:
                _accept_and_write(session, job)
                time.sleep(20)
            except Exception as e:
                log.error("[Scripted] Job failed: %s", e)


def _find_available_jobs(session: BrowserSession) -> list[dict]:
    """Find available writing jobs."""
    jobs = []
    try:
        job_elements = session.page.query_selector_all("[class*='job']")
        for elem in job_elements[:20]:
            try:
                text = elem.inner_text()
                jobs.append({"element": elem, "text": text[:500]})
            except Exception:
                continue
    except Exception as e:
        log.warning("[Scripted] Could not parse jobs: %s", e)
    return jobs


def _accept_and_write(session: BrowserSession, job: dict):
    """Accept a job and write the content."""
    log.info("[Scripted] Working on: %s", job["text"][:80])

    job["element"].click()
    time.sleep(4)

    page_text = session.get_text()

    # Accept
    accept_btn = session.page.query_selector("text=Accept")
    if not accept_btn:
        accept_btn = session.page.query_selector("text=Claim")
    if accept_btn:
        accept_btn.click()
        time.sleep(3)

    # Write content
    content = generate(
        f"Write content based on these requirements:\n\n"
        f"{page_text[:3000]}\n\n"
        f"Follow all specifications exactly. Write naturally with good structure.",
        max_tokens=6000,
    )

    if not content:
        return

    # Find editor and paste
    textarea = session.page.query_selector("textarea")
    if not textarea:
        textarea = session.page.query_selector("[contenteditable='true']")
    if textarea:
        textarea.fill(content)
        time.sleep(2)
        submit = session.page.query_selector("text=Submit")
        if not submit:
            submit = session.page.query_selector("button[type='submit']")
        if submit:
            submit.click()
            time.sleep(3)
            log.info("[Scripted] Job submitted!")
            update_daily_stats("scripted", orders=1)
