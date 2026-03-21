"""TikTok worker thread — runs phone-bot sessions from the Flask dashboard.

Spawned as a daemon thread by the toggle route. Creates its own Flask app
context, loads config from DB, monkey-patches phone-bot config, and executes
a TikTok browse session.
"""
import asyncio
import logging
import threading
import time
import traceback
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Thread-safe live status for each running bot
_worker_status = {}
_status_lock = threading.Lock()


def get_worker_status(bot_id):
    """Thread-safe read of worker status. Returns None if bot not running."""
    with _status_lock:
        return _worker_status.get(bot_id)


def _update_status(bot_id, **kwargs):
    """Thread-safe update of worker status."""
    with _status_lock:
        if bot_id not in _worker_status:
            _worker_status[bot_id] = {}
        _worker_status[bot_id].update(kwargs)


def _clear_status(bot_id):
    """Remove bot from status dict on exit."""
    with _status_lock:
        _worker_status.pop(bot_id, None)


def tiktok_worker(bot_id, user_id):
    """Main worker function. Runs in a background daemon thread.

    1. Creates Flask app context
    2. Loads config from DB
    3. Monkey-patches phone-bot config
    4. Creates TikTokBot instance
    5. Runs browse session
    6. Updates DB with results
    """
    from . import create_app, db
    from .models import Bot, Phone, Proxy, TimingPreset, TimingOverride, BotAccount, SessionLog
    from . import tiktok_config

    app = create_app()
    started_at = datetime.now(timezone.utc)

    with app.app_context():
        try:
            bot = db.session.get(Bot, bot_id)
            if not bot:
                logger.error(f"Bot {bot_id} not found")
                return

            # Prevent double-start
            if bot.control_status == 'running':
                logger.warning(f"Bot {bot_id} already running, skipping")
                return

            # Set running status
            bot.control_status = 'running'
            bot.should_stop = False
            db.session.commit()

            # Load related models
            phone = db.session.get(Phone, bot.phone_ref_id) if bot.phone_ref_id else None
            proxy = db.session.get(Proxy, bot.proxy_id) if bot.proxy_id else None
            preset = db.session.get(TimingPreset, bot.timing_preset_id) if bot.timing_preset_id else None
            overrides = TimingOverride.query.filter_by(bot_id=bot_id).all() if preset else []
            account = BotAccount.query.filter_by(bot_id=bot_id, platform='tiktok').first()

            if not account:
                account = BotAccount.query.filter_by(bot_id=bot_id).first()

            account_name = account.username if account else f'bot_{bot_id}'

            # Build config from DB
            phone_cfg = tiktok_config.build_phone_config(phone) if phone else {
                'id': 1, 'name': 'Default', 'model': 'Unknown',
                'screen_w': 1080, 'screen_h': 2220, 'density': 420,
                'adb_serial': None, 'retry_tolerance': 3
            }

            timing_cfg = tiktok_config.build_timing_config(preset, overrides) if preset else None
            niche_cfg = account.niche_json if account and account.niche_json else None

            # Apply config to phone-bot module
            proxy_cfg = None
            if proxy:
                try:
                    proxy_cfg = tiktok_config.build_proxy_config(proxy)
                except KeyError as e:
                    logger.warning(f"Proxy env var missing: {e}, running without proxy")

            tiktok_config.apply_config_to_module(
                phone_cfg, proxy_config=proxy_cfg,
                timing_config=timing_cfg, niche_config=niche_cfg
            )

            # Update live status
            _update_status(bot_id,
                           account=account_name,
                           phase='Starting',
                           elapsed_seconds=0,
                           actions={'likes': 0, 'scrolls': 0, 'comments': 0, 'follows': 0},
                           started_at=started_at.isoformat(),
                           error=None)

            # Import phone-bot classes
            from phone_bot.core.adb import ADBController
            from phone_bot.core.human import HumanEngine
            from phone_bot.actions.tiktok import TikTokBot

            # Create instances
            adb_serial = phone_cfg.get('adb_serial')
            if not adb_serial:
                # Auto-detect from connected devices
                logger.info("No ADB serial configured, will auto-detect")

            adb = ADBController(adb_serial or 'auto', phone_cfg)
            human = HumanEngine(account_name)
            tiktok_bot = TikTokBot(adb, human)

            # Check should_stop before starting session
            db.session.refresh(bot)
            if bot.should_stop:
                bot.control_status = 'stopped'
                db.session.commit()
                _clear_status(bot_id)
                return

            # Start session
            now = datetime.now()
            human.start_session(hour=now.hour, weekday=now.weekday(), duration_minutes=15)
            _update_status(bot_id, phase='Running')

            # Run browse session in asyncio event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                tiktok_bot.open_app()
                # Run a browse session (synchronous call)
                tiktok_bot.browse_session()
            finally:
                loop.close()

            # Session completed successfully
            _update_status(bot_id, phase='Completed')
            elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
            _update_status(bot_id, elapsed_seconds=int(elapsed))

            # Create session log
            session_log = SessionLog(
                bot_account_id=account.id if account else None,
                session_id=f'tk-{bot_id}-{int(started_at.timestamp())}',
                started_at=started_at,
                ended_at=datetime.now(timezone.utc),
                session_type='normal',
                status='completed',
                dry_run=bot.dry_run or False
            )
            db.session.add(session_log)

            bot.control_status = 'stopped'
            bot.should_stop = False
            db.session.commit()

        except Exception as e:
            error_msg = _classify_error(e)
            logger.error(f"TikTok worker error for bot {bot_id}: {error_msg}")
            logger.debug(traceback.format_exc())

            try:
                db.session.rollback()
                bot = db.session.get(Bot, bot_id)
                if bot:
                    bot.control_status = 'error'
                    db.session.commit()
            except Exception:
                pass

            _update_status(bot_id, phase='Error', error=error_msg)

        finally:
            # Always try to close app
            try:
                if 'tiktok_bot' in locals():
                    tiktok_bot.close_app()
            except Exception:
                pass

            # Clean up status after a delay (let UI poll one more time)
            def _delayed_cleanup():
                time.sleep(10)
                _clear_status(bot_id)

            cleanup_thread = threading.Thread(target=_delayed_cleanup, daemon=True)
            cleanup_thread.start()


def _classify_error(exc):
    """Convert exception to human-readable error message."""
    exc_str = str(exc).lower()
    exc_type = type(exc).__name__

    if exc_type == 'DeviceLostError' or 'device' in exc_str and 'lost' in exc_str:
        return 'Phone disconnected (USB)'
    elif 'captcha' in exc_str:
        return 'CAPTCHA detected -- manual intervention needed'
    elif 'wifi' in exc_str or 'network' in exc_str:
        return 'WiFi disconnected -- check phone connection'
    elif 'timeout' in exc_str:
        return 'Session timed out'
    else:
        return f'Session error: {str(exc)[:100]}'
