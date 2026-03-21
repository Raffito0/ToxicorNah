"""Tests for TikTok engine integration (split 02)."""
import sys
import os


def test_phone_bot_path_in_sys_path(app):
    """After app init, project root should be in sys.path for phone_bot package."""
    project_root = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))
    assert project_root in sys.path or any(
        os.path.normpath(p) == project_root for p in sys.path
    ), f"Project root {project_root} not in sys.path"


def test_phone_bot_symlink_exists(app):
    """phone_bot symlink/junction should exist in project root."""
    project_root = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))
    phone_bot_link = os.path.join(project_root, 'phone_bot')
    assert os.path.exists(phone_bot_link), f"phone_bot link not found at {phone_bot_link}"


def test_config_module_importable(app):
    """phone-bot config should be importable as phone_bot.config."""
    from phone_bot import config as pb_config
    assert hasattr(pb_config, 'HUMAN')
    assert hasattr(pb_config, 'PHONES')
    assert len(pb_config.HUMAN) > 50  # 72+ timing params


def test_tiktok_bot_importable(app):
    """TikTokBot class should be importable from phone_bot package."""
    from phone_bot.actions.tiktok import TikTokBot
    assert TikTokBot is not None


def test_adb_controller_importable(app):
    """ADBController should be importable from phone_bot package."""
    from phone_bot.core.adb import ADBController
    assert ADBController is not None


def test_human_engine_importable(app):
    """HumanEngine should be importable from phone_bot package."""
    from phone_bot.core.human import HumanEngine
    assert HumanEngine is not None
