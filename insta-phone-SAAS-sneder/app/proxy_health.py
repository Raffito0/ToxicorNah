"""Proxy health-check background service.

Monitors offline proxies every 15 minutes. Attempts rotation to verify
proxy is working again. Auto-resumes when proxy recovers.
"""
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

# Track consecutive failures for offline detection
_proxy_failure_tracker = {}  # proxy_id -> {"first_failure": float, "count": int}
_OFFLINE_THRESHOLD_SECONDS = 30 * 60  # 30 minutes


def record_failure(proxy_id):
    """Record a proxy rotation failure. Returns True if proxy should go offline."""
    now = time.time()
    if proxy_id not in _proxy_failure_tracker:
        _proxy_failure_tracker[proxy_id] = {"first_failure": now, "count": 1}
    else:
        _proxy_failure_tracker[proxy_id]["count"] += 1

    tracker = _proxy_failure_tracker[proxy_id]
    elapsed = now - tracker["first_failure"]
    return elapsed >= _OFFLINE_THRESHOLD_SECONDS


def clear_failure(proxy_id):
    """Clear failure tracker on successful rotation."""
    _proxy_failure_tracker.pop(proxy_id, None)


def start_health_check(app):
    """Start background health-check thread for offline proxies."""
    t = threading.Thread(target=_health_check_loop, args=(app,), daemon=True)
    t.start()
    logger.info("Proxy health-check thread started")


def _health_check_loop(app):
    """Main health-check loop. Runs every 15 minutes."""
    while True:
        time.sleep(900)  # 15 minutes
        try:
            with app.app_context():
                _check_offline_proxies(app)
        except Exception as e:
            logger.error(f"Health check error: {e}")


def _check_offline_proxies(app):
    """Check all offline proxies. Attempt recovery if rotation URL is reachable."""
    from . import db
    from .models import Proxy

    offline_proxies = Proxy.query.filter_by(status='offline').all()
    if not offline_proxies:
        return

    for proxy in offline_proxies:
        logger.info(f"Health check for offline proxy: {proxy.name}")
        try:
            # Try to reach rotation URL
            rotation_url_env = proxy.rotation_url_env
            if not rotation_url_env:
                continue

            rotation_url = os.environ.get(rotation_url_env, '')
            if not rotation_url:
                continue

            import httpx
            # Test if rotation URL is reachable
            response = httpx.get(rotation_url, timeout=10)
            if response.status_code < 500:
                # URL is reachable -- try full rotation cycle
                try:
                    username = os.environ[proxy.username_env]
                    password = os.environ[proxy.password_env]
                    socks5_url = f'socks5://{username}:{password}@{proxy.host}:{proxy.port}'

                    with httpx.Client(proxy=socks5_url, timeout=10) as client:
                        old_ip = client.get('https://api.ipify.org').text.strip()

                    # Rotation already triggered above, wait and check
                    time.sleep(60)

                    with httpx.Client(proxy=socks5_url, timeout=10) as client:
                        new_ip = client.get('https://api.ipify.org').text.strip()

                    if old_ip != new_ip:
                        # Recovery successful
                        proxy.status = 'active'
                        proxy.current_ip = new_ip
                        db.session.commit()
                        clear_failure(proxy.id)
                        logger.info(f"Proxy {proxy.name} RECOVERED: {old_ip} -> {new_ip}")
                        # TODO: Send Telegram alert "Proxy back ONLINE" (split 07)
                    else:
                        logger.warning(f"Proxy {proxy.name}: rotation URL reachable but IP didn't change")

                except Exception as e:
                    logger.warning(f"Proxy {proxy.name}: rotation test failed: {e}")

        except Exception as e:
            logger.info(f"Proxy {proxy.name} still unreachable: {e}")
