"""Contra — commission-free freelance platform. Apply to opportunities."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import write_proposal
from ..state.database import add_proposal, count_proposals_today, update_daily_stats
from ..config import RATE_LIMITS

log = logging.getLogger(__name__)

CONTRA_URL = "https://www.contra.com"
CONTRA_JOBS = "https://www.contra.com/opportunities"


def scrape_and_apply():
    """Find opportunities on Contra and apply."""
    max_apps = RATE_LIMITS["contra_applications"]
    sent_today = count_proposals_today("contra")
    if sent_today >= max_apps:
        log.info("[Contra] Daily application limit reached (%d/%d)", sent_today, max_apps)
        return

    remaining = max_apps - sent_today

    with BrowserSession("contra") as session:
        session.goto(CONTRA_JOBS, wait=8)

        title = session.page.title()
        if "Log In" in title or "Sign Up" in title:
            log.warning("[Contra] Not logged in!")
            return

        log.info("[Contra] Logged in, checking opportunities...")

        jobs = _find_opportunities(session)
        log.info("[Contra] Found %d opportunities", len(jobs))

        for job in jobs[:remaining]:
            try:
                _apply(session, job)
                time.sleep(40)
            except Exception as e:
                log.error("[Contra] Application failed: %s", e)


def _find_opportunities(session: BrowserSession) -> list[dict]:
    """Find writing opportunities on Contra."""
    jobs = []
    try:
        elements = session.page.query_selector_all("a[href*='/opportunity/']")
        if not elements:
            elements = session.page.query_selector_all("[class*='opportunity']")

        for elem in elements[:20]:
            try:
                text = elem.inner_text()
                href = elem.get_attribute("href") or ""
                keywords = ["write", "content", "blog", "copy", "thread", "email",
                           "social media", "seo", "article", "newsletter"]
                if any(kw in text.lower() for kw in keywords):
                    jobs.append({"element": elem, "text": text[:500], "url": href})
            except Exception:
                continue
    except Exception as e:
        log.warning("[Contra] Scraping failed: %s", e)
    return jobs


def _apply(session: BrowserSession, job: dict):
    """Apply to a Contra opportunity."""
    log.info("[Contra] Applying: %s", job["text"][:80])

    job["element"].click()
    time.sleep(4)

    page_text = session.get_text()
    title = session.page.title()

    proposal_text = write_proposal(job_title=title, job_description=page_text[:2000])
    if not proposal_text:
        return

    apply_btn = session.page.query_selector("text=Apply")
    if not apply_btn:
        apply_btn = session.page.query_selector("text=Send Proposal")
    if not apply_btn:
        apply_btn = session.page.query_selector("button[class*='apply']")

    if apply_btn:
        apply_btn.click()
        time.sleep(3)

        textarea = session.page.query_selector("textarea")
        if textarea:
            textarea.fill(proposal_text)
            time.sleep(1)
            submit = session.page.query_selector("button[type='submit']")
            if submit:
                submit.click()
                time.sleep(3)
                log.info("[Contra] Applied!")
                add_proposal("contra", title, job.get("url", ""), proposal_text)
                update_daily_stats("contra", proposals=1)

    session.page.go_back()
    time.sleep(2)
