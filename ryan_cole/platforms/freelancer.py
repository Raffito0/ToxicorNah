"""Freelancer.com — scrape jobs, send proposals, deliver work."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import write_proposal, generate
from ..state.database import add_proposal, count_proposals_today, update_daily_stats
from ..config import RATE_LIMITS

log = logging.getLogger(__name__)

FREELANCER_JOBS_URL = "https://www.freelancer.com/jobs"
CATEGORIES = ["content-writing", "copywriting", "article-writing", "social-media-marketing"]


def scrape_and_propose():
    """Find relevant jobs on Freelancer and send proposals."""
    max_proposals = RATE_LIMITS["freelancer_proposals"]
    sent_today = count_proposals_today("freelancer")
    if sent_today >= max_proposals:
        log.info("[Freelancer] Daily proposal limit reached (%d/%d)", sent_today, max_proposals)
        return

    remaining = max_proposals - sent_today

    with BrowserSession("freelancer") as session:
        session.goto(FREELANCER_JOBS_URL, wait=8)

        title = session.page.title()
        if "Log In" in title or "Login" in title:
            log.warning("[Freelancer] Not logged in! Run save_login_cookies first.")
            return

        log.info("[Freelancer] Logged in, scraping jobs...")

        jobs = _scrape_jobs(session)
        log.info("[Freelancer] Found %d relevant jobs", len(jobs))

        for job in jobs[:remaining]:
            try:
                _send_proposal(session, job)
                sent_today += 1
                time.sleep(30)  # wait between proposals
            except Exception as e:
                log.error("[Freelancer] Proposal failed: %s", e)


def _scrape_jobs(session: BrowserSession) -> list[dict]:
    """Parse the jobs page to find relevant writing jobs."""
    jobs = []
    try:
        job_elements = session.page.query_selector_all("[class*='JobSearchCard']")
        if not job_elements:
            job_elements = session.page.query_selector_all("a[href*='/projects/']")

        for elem in job_elements[:30]:
            try:
                text = elem.inner_text()
                href = elem.get_attribute("href") or ""

                # Filter for writing-related jobs
                keywords = ["write", "content", "blog", "article", "copy", "thread",
                           "email", "newsletter", "social media", "seo"]
                if any(kw in text.lower() for kw in keywords):
                    jobs.append({
                        "element": elem,
                        "text": text[:500],
                        "url": href,
                    })
            except Exception:
                continue
    except Exception as e:
        log.warning("[Freelancer] Job scraping failed: %s", e)

    return jobs


def _send_proposal(session: BrowserSession, job: dict):
    """Click into a job and send a proposal."""
    log.info("[Freelancer] Sending proposal for: %s", job["text"][:80])

    # Click into the job
    try:
        job["element"].click()
        time.sleep(4)
    except Exception:
        if job.get("url"):
            session.goto("https://www.freelancer.com" + job["url"], wait=4)
        else:
            return

    # Read job details
    page_text = session.get_text()

    # Extract title and description
    title = session.page.title()

    # Generate proposal
    proposal_text = write_proposal(
        job_title=title,
        job_description=page_text[:2000],
    )

    if not proposal_text:
        log.warning("[Freelancer] Failed to generate proposal")
        return

    # Find "Bid on this Project" or "Place Bid" button
    bid_btn = session.page.query_selector("text=Bid on this Project")
    if not bid_btn:
        bid_btn = session.page.query_selector("text=Place Bid")
    if not bid_btn:
        bid_btn = session.page.query_selector("a[href*='createBid']")

    if bid_btn:
        bid_btn.click()
        time.sleep(3)

        # Find proposal textarea
        textarea = session.page.query_selector("textarea[id*='descr']")
        if not textarea:
            textarea = session.page.query_selector("textarea")

        if textarea:
            textarea.fill(proposal_text)
            time.sleep(1)

            # Submit
            submit = session.page.query_selector("button[type='submit']")
            if submit:
                submit.click()
                time.sleep(3)
                log.info("[Freelancer] Proposal sent!")
                add_proposal("freelancer", title, job.get("url", ""), proposal_text)
                update_daily_stats("freelancer", proposals=1)
            else:
                log.warning("[Freelancer] Submit button not found")
        else:
            log.warning("[Freelancer] Proposal textarea not found")
    else:
        log.warning("[Freelancer] Bid button not found")

    # Go back to jobs list
    session.page.go_back()
    time.sleep(2)
