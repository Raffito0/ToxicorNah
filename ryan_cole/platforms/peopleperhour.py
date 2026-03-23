"""PeoplePerHour — scrape jobs, send proposals."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import write_proposal
from ..state.database import add_proposal, count_proposals_today, update_daily_stats
from ..config import RATE_LIMITS

log = logging.getLogger(__name__)

PPH_JOBS_URL = "https://www.peopleperhour.com/freelance-jobs"


def scrape_and_propose():
    """Find relevant jobs on PeoplePerHour and send proposals."""
    max_proposals = RATE_LIMITS["peopleperhour_proposals"]
    sent_today = count_proposals_today("peopleperhour")
    if sent_today >= max_proposals:
        log.info("[PPH] Daily proposal limit reached (%d/%d)", sent_today, max_proposals)
        return

    remaining = max_proposals - sent_today

    with BrowserSession("peopleperhour") as session:
        session.goto(PPH_JOBS_URL, wait=8)

        title = session.page.title()
        if "Log in" in title or "Sign Up" in title:
            log.warning("[PPH] Not logged in!")
            return

        log.info("[PPH] Logged in, scraping jobs...")

        jobs = _scrape_jobs(session)
        log.info("[PPH] Found %d relevant jobs", len(jobs))

        for job in jobs[:remaining]:
            try:
                _send_proposal(session, job)
                time.sleep(45)
            except Exception as e:
                log.error("[PPH] Proposal failed: %s", e)


def _scrape_jobs(session: BrowserSession) -> list[dict]:
    """Parse PeoplePerHour job listings."""
    jobs = []
    try:
        job_elements = session.page.query_selector_all("[class*='job-listing']")
        if not job_elements:
            job_elements = session.page.query_selector_all("a[href*='/job/']")

        for elem in job_elements[:20]:
            try:
                text = elem.inner_text()
                href = elem.get_attribute("href") or ""
                keywords = ["write", "content", "blog", "article", "copy", "thread",
                           "email", "newsletter", "social media", "seo"]
                if any(kw in text.lower() for kw in keywords):
                    jobs.append({"element": elem, "text": text[:500], "url": href})
            except Exception:
                continue
    except Exception as e:
        log.warning("[PPH] Job scraping failed: %s", e)
    return jobs


def _send_proposal(session: BrowserSession, job: dict):
    """Send a proposal for a PeoplePerHour job."""
    log.info("[PPH] Proposing for: %s", job["text"][:80])

    try:
        job["element"].click()
        time.sleep(4)
    except Exception:
        if job.get("url"):
            session.goto("https://www.peopleperhour.com" + job["url"], wait=4)
        else:
            return

    page_text = session.get_text()
    title = session.page.title()

    proposal_text = write_proposal(job_title=title, job_description=page_text[:2000])
    if not proposal_text:
        return

    # Find proposal/apply button
    apply_btn = session.page.query_selector("text=Send Proposal")
    if not apply_btn:
        apply_btn = session.page.query_selector("text=Apply")
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
                log.info("[PPH] Proposal sent!")
                add_proposal("peopleperhour", title, job.get("url", ""), proposal_text)
                update_daily_stats("peopleperhour", proposals=1)

    session.page.go_back()
    time.sleep(2)
