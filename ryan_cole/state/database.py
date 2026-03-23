"""SQLite database for tracking orders, revenue, contacts, and daily activity."""
import sqlite3
import os
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from ..config import DB_PATH

log = logging.getLogger(__name__)
_ET = ZoneInfo("US/Eastern")

# Ensure state directory exists
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def _now_et() -> str:
    return datetime.now(_ET).isoformat()


def _today_et() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d")


def get_db() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            order_id TEXT,
            client_name TEXT,
            title TEXT,
            description TEXT,
            price REAL,
            status TEXT DEFAULT 'pending',
            content TEXT,
            delivered_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proposals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            job_title TEXT,
            job_url TEXT,
            proposal_text TEXT,
            status TEXT DEFAULT 'sent',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS forum_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            thread_url TEXT,
            thread_title TEXT,
            reply_text TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            platform TEXT NOT NULL,
            orders_completed INTEGER DEFAULT 0,
            proposals_sent INTEGER DEFAULT 0,
            forum_replies INTEGER DEFAULT 0,
            revenue REAL DEFAULT 0,
            UNIQUE(date, platform)
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            username TEXT NOT NULL,
            contacted_at TEXT,
            status TEXT DEFAULT 'contacted',
            UNIQUE(platform, username)
        );
    """)
    conn.commit()
    conn.close()
    log.info("Database initialized at %s", DB_PATH)


# --- Orders ---

def add_order(platform: str, order_id: str, client: str, title: str,
              description: str, price: float) -> int:
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO orders (platform, order_id, client_name, title, description, price, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (platform, order_id, client, title, description, price, _now_et()),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    return row_id


def mark_delivered(order_db_id: int, content: str):
    conn = get_db()
    conn.execute(
        "UPDATE orders SET status='delivered', content=?, delivered_at=? WHERE id=?",
        (content, _now_et(), order_db_id),
    )
    conn.commit()
    conn.close()


def get_pending_orders(platform: str = None) -> list[dict]:
    conn = get_db()
    if platform:
        rows = conn.execute(
            "SELECT * FROM orders WHERE status='pending' AND platform=?", (platform,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM orders WHERE status='pending'").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Proposals ---

def add_proposal(platform: str, job_title: str, job_url: str, proposal_text: str):
    conn = get_db()
    conn.execute(
        "INSERT INTO proposals (platform, job_title, job_url, proposal_text, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (platform, job_title, job_url, proposal_text, _now_et()),
    )
    conn.commit()
    conn.close()


def count_proposals_today(platform: str) -> int:
    conn = get_db()
    count = conn.execute(
        "SELECT COUNT(*) FROM proposals WHERE platform=? AND created_at LIKE ?",
        (platform, _today_et() + "%"),
    ).fetchone()[0]
    conn.close()
    return count


# --- Forum posts ---

def add_forum_post(platform: str, thread_url: str, thread_title: str, reply_text: str):
    conn = get_db()
    conn.execute(
        "INSERT INTO forum_posts (platform, thread_url, thread_title, reply_text, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (platform, thread_url, thread_title, reply_text, _now_et()),
    )
    conn.commit()
    conn.close()


def count_forum_posts_today(platform: str) -> int:
    conn = get_db()
    count = conn.execute(
        "SELECT COUNT(*) FROM forum_posts WHERE platform=? AND created_at LIKE ?",
        (platform, _today_et() + "%"),
    ).fetchone()[0]
    conn.close()
    return count


# --- Daily stats ---

def update_daily_stats(platform: str, orders: int = 0, proposals: int = 0,
                       replies: int = 0, revenue: float = 0):
    conn = get_db()
    conn.execute(
        "INSERT INTO daily_stats (date, platform, orders_completed, proposals_sent, "
        "forum_replies, revenue) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(date, platform) DO UPDATE SET "
        "orders_completed = orders_completed + ?, proposals_sent = proposals_sent + ?, "
        "forum_replies = forum_replies + ?, revenue = revenue + ?",
        (_today_et(), platform, orders, proposals, replies, revenue,
         orders, proposals, replies, revenue),
    )
    conn.commit()
    conn.close()


def get_today_summary() -> dict:
    conn = get_db()
    rows = conn.execute(
        "SELECT platform, orders_completed, proposals_sent, forum_replies, revenue "
        "FROM daily_stats WHERE date=?", (_today_et(),)
    ).fetchall()
    conn.close()

    total_orders = sum(r["orders_completed"] for r in rows)
    total_proposals = sum(r["proposals_sent"] for r in rows)
    total_replies = sum(r["forum_replies"] for r in rows)
    total_revenue = sum(r["revenue"] for r in rows)

    return {
        "date": _today_et(),
        "total_orders": total_orders,
        "total_proposals": total_proposals,
        "total_replies": total_replies,
        "total_revenue": total_revenue,
        "by_platform": {r["platform"]: dict(r) for r in rows},
    }


# --- Contacts (anti-duplicate) ---

def already_contacted(platform: str, username: str) -> bool:
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM contacts WHERE platform=? AND username=?",
        (platform, username),
    ).fetchone()
    conn.close()
    return row is not None


def mark_contacted(platform: str, username: str):
    conn = get_db()
    conn.execute(
        "INSERT OR IGNORE INTO contacts (platform, username, contacted_at) VALUES (?, ?, ?)",
        (platform, username, _now_et()),
    )
    conn.commit()
    conn.close()
