"""Fiverr platform — check inbox, accept orders, write content, deliver."""
import logging
import time

from ..browser.session import BrowserSession
from ..brain.writer import (
    write_blog_post, write_twitter_thread, write_email_copy,
    write_ad_copy, generate,
)
from ..state.database import add_order, mark_delivered, update_daily_stats
from ..notifications.telegram import send_new_order_alert

log = logging.getLogger(__name__)

FIVERR_URL = "https://www.fiverr.com"
FIVERR_INBOX = "https://www.fiverr.com/inbox"
FIVERR_ORDERS = "https://www.fiverr.com/users/orders"


def check_and_deliver():
    """Main Fiverr task: check for new orders, write content, deliver."""
    with BrowserSession("fiverr") as session:
        # Navigate to orders page
        session.goto(FIVERR_ORDERS, wait=8)

        # Check if logged in
        title = session.page.title()
        if "Log In" in title or "Join" in title:
            log.warning("[Fiverr] Not logged in! Run save_login_cookies first.")
            return

        log.info("[Fiverr] Logged in, checking orders...")

        # Get page content to find active orders
        text = session.get_text()

        if "no active orders" in text.lower() or "you have no orders" in text.lower():
            log.info("[Fiverr] No active orders")
            _check_messages(session)
            return

        # Find active orders that need delivery
        active_orders = _find_active_orders(session)
        log.info("[Fiverr] Found %d active orders", len(active_orders))

        for order in active_orders:
            try:
                _process_order(session, order)
            except Exception as e:
                log.error("[Fiverr] Failed to process order: %s", e)

        # Also check messages for new inquiries
        _check_messages(session)

        # Save cookies after successful session
        session.save_cookies()


def _find_active_orders(session: BrowserSession) -> list[dict]:
    """Parse the orders page to find active orders needing delivery."""
    orders = []
    try:
        # Look for order cards/rows
        order_elements = session.page.query_selector_all("[class*='order']")
        for elem in order_elements:
            text = elem.inner_text()
            if "deliver" in text.lower() or "in progress" in text.lower():
                # Extract order details
                orders.append({
                    "element": elem,
                    "text": text[:500],
                })
    except Exception as e:
        log.warning("[Fiverr] Could not parse orders: %s", e)

    return orders


def _process_order(session: BrowserSession, order: dict):
    """Process a single order: read requirements, generate content, deliver."""
    log.info("[Fiverr] Processing order: %s", order["text"][:100])

    # Click into the order to read full requirements
    try:
        order["element"].click()
        time.sleep(3)
    except Exception:
        log.warning("[Fiverr] Could not click into order")
        return

    # Read the order requirements
    page_text = session.get_text()

    # Use AI to understand what's needed and generate content
    content = generate(
        f"A client on Fiverr ordered content from me. Here are their requirements:\n\n"
        f"{page_text[:3000]}\n\n"
        f"Write the content they requested. Deliver exactly what they asked for.\n"
        f"If they asked for a blog post, write a blog post.\n"
        f"If they asked for Twitter threads, write threads.\n"
        f"If they asked for email copy, write email copy.\n"
        f"Match the tone and specifications they provided.\n"
        f"Do NOT include any meta-commentary like 'Here's what I wrote' — just the content.",
        max_tokens=6000,
    )

    if not content:
        log.error("[Fiverr] Failed to generate content for order")
        return

    log.info("[Fiverr] Generated %d chars of content", len(content))

    # Find the delivery button and text area
    try:
        # Look for "Deliver Now" or similar button
        deliver_btn = session.page.query_selector("text=Deliver Now")
        if not deliver_btn:
            deliver_btn = session.page.query_selector("text=Deliver")
        if deliver_btn:
            deliver_btn.click()
            time.sleep(2)

            # Find the delivery text area and paste content
            textarea = session.page.query_selector("textarea")
            if textarea:
                textarea.fill(content)
                time.sleep(1)

                # Click submit/deliver
                submit = session.page.query_selector("text=Deliver Work")
                if not submit:
                    submit = session.page.query_selector("button[type='submit']")
                if submit:
                    submit.click()
                    time.sleep(3)
                    log.info("[Fiverr] Order delivered!")

                    # Track in database
                    update_daily_stats("fiverr", orders=1)
                    send_new_order_alert("Fiverr", "client", "order", 0)
                else:
                    log.warning("[Fiverr] Could not find submit button")
            else:
                log.warning("[Fiverr] Could not find delivery textarea")
        else:
            log.warning("[Fiverr] Could not find Deliver button")
    except Exception as e:
        log.error("[Fiverr] Delivery failed: %s", e)


def _check_messages(session: BrowserSession):
    """Check Fiverr inbox for new messages and respond."""
    try:
        session.goto(FIVERR_INBOX, wait=5)
        text = session.get_text()

        if "no messages" in text.lower():
            log.info("[Fiverr] No new messages")
            return

        # Find unread messages
        unread = session.page.query_selector_all("[class*='unread']")
        log.info("[Fiverr] Found %d unread messages", len(unread))

        for msg_elem in unread[:5]:  # Process max 5 at a time
            try:
                _respond_to_message(session, msg_elem)
            except Exception as e:
                log.warning("[Fiverr] Failed to respond to message: %s", e)

    except Exception as e:
        log.warning("[Fiverr] Message check failed: %s", e)


def _respond_to_message(session: BrowserSession, msg_element):
    """Read and respond to a Fiverr message."""
    msg_element.click()
    time.sleep(2)

    # Read the conversation
    page_text = session.get_text()

    # Generate a response
    response = generate(
        f"I'm Ryan Cole, a freelance content writer on Fiverr. A potential client sent me a message.\n"
        f"Here's the conversation:\n\n{page_text[:2000]}\n\n"
        f"Write a short, helpful response (under 100 words).\n"
        f"Be friendly but professional. Answer their question directly.\n"
        f"If they're asking about my services, briefly explain what I can do and suggest they place an order.\n"
        f"If they need a custom quote, give a reasonable price range.\n"
        f"Do NOT be salesy or pushy.",
        max_tokens=300,
        temperature=0.8,
    )

    if response:
        # Find message input and type response
        msg_input = session.page.query_selector("textarea[placeholder*='message']")
        if not msg_input:
            msg_input = session.page.query_selector("textarea")
        if msg_input:
            msg_input.fill(response)
            time.sleep(1)
            send_btn = session.page.query_selector("button[type='submit']")
            if send_btn:
                send_btn.click()
                log.info("[Fiverr] Responded to message")
