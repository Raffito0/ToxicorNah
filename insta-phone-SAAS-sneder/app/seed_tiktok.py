"""Seed script for TikTok phone-bot data.

Seeds phones, proxy, timing presets, and migrates personality/warmup/niche
from JSON files. Idempotent — safe to run multiple times.

Usage: cd insta-phone-SAAS-sneder && python -m app.seed_tiktok
"""
import json
import os

# Normal preset: current config.py HUMAN dict timing tuples (median, sigma, min, max)
NORMAL_PARAMS = {
    "zona_morta_duration": [18.0, 0.4, 5, 60],
    "zona_morta_interval": [420.0, 0.3, 180, 900],
    "post_like_pause": [1.8, 0.4, 0.5, 6],
    "first_video_watch": [8.0, 0.5, 3, 25],
    "watch_short": [2.5, 0.4, 0.8, 8],
    "watch_medium": [6.0, 0.4, 2, 18],
    "load_reaction": [3.5, 0.4, 1.0, 12],
    "interruption_duration": [12.0, 0.6, 3, 30],
    "bg_end_duration": [42.0, 0.3, 15, 120],
    "micro_pause": [0.1, 0.4, 0.02, 0.5],
    "t_app_load": [4.0, 0.3, 2, 10],
    "t_nav_settle": [1.8, 0.3, 0.5, 5],
    "t_browse_results": [7.0, 0.5, 3, 25],
    "t_profile_settle": [4.5, 0.4, 1.5, 15],
    "t_double_tap": [0.15, 0.3, 0.05, 0.5],
    "t_post_typing": [0.8, 0.4, 0.2, 3],
    "t_micro_scroll": [0.8, 0.4, 0.2, 3],
    "t_rewatch": [1.5, 0.5, 0.5, 6],
    "t_double_open_1": [0.8, 0.4, 0.2, 3],
    "t_double_open_2": [1.2, 0.4, 0.3, 4],
    "t_search_browse": [8.0, 0.5, 3, 30],
    "t_camera_record": [14.0, 0.2, 8, 25],
    "t_session_gap": [100.0, 0.4, 30, 360],
    "t_explore_browse": [3.5, 0.4, 1, 12],
    "t_typo_notice": [0.5, 0.3, 0.15, 1.5],
    "t_typo_backspace": [0.18, 0.3, 0.05, 0.6],
    "t_thinking": [0.5, 0.4, 0.15, 2.0],
    "t_file_push": [2.0, 0.3, 1.0, 5],
    "t_upload_load": [3.0, 0.3, 1.5, 7],
    "t_post_upload": [5.0, 0.3, 3, 12],
    "t_key_settle": [0.3, 0.3, 0.1, 0.8],
    "t_proxy_settle": [2.5, 0.3, 1, 6],
    "t_wifi_connect": [3.5, 0.3, 2, 8],
    "t_confirm_save": [3.0, 0.3, 1.5, 7],
    "t_poll_check": [1.0, 0.3, 0.5, 3],
    "t_caption_input": [0.5, 0.3, 0.2, 1.5],
    "t_story_watch": [3.0, 0.5, 1.0, 12],
    "t_search_scroll_pause": [1.5, 0.4, 0.5, 5],
    "t_search_clear": [0.8, 0.3, 0.3, 2],
    "t_tab_load_settle": [1.5, 0.3, 0.8, 3.0],
    "t_comment_load": [1.5, 0.3, 0.8, 4],
    "t_comment_read": [2.0, 0.5, 0.8, 8],
    "t_comment_read_deep": [3.5, 0.5, 1.5, 12],
    "t_comment_before_write": [1.2, 0.4, 0.4, 4],
    "t_frame_capture_gap": [2.2, 0.4, 1.2, 5],
    "t_popup_dismiss": [0.8, 0.3, 0.3, 2.0],
    "t_popup_read": [1.5, 0.4, 0.5, 4.0],
    "t_recovery_settle": [1.2, 0.3, 0.5, 3.0],
    "t_captcha_drag": [1.2, 0.3, 0.6, 2.5],
    "t_tab_switch": [1.0, 0.3, 0.5, 2.5],
    "t_inbox_glance": [2.0, 0.4, 1.0, 5.0],
    "t_shop_popup_read": [1.5, 0.3, 0.8, 3.0],
    "t_product_browse": [4.0, 0.5, 2.0, 10.0],
    "t_carousel_scroll": [0.8, 0.2, 0.3, 1.5],
    "t_follower_read": [1.5, 0.4, 0.5, 4.0],
    "t_niche_profile_glance": [2.5, 0.4, 1.0, 7.0],
    "t_niche_video_watch": [4.0, 0.5, 2.0, 12.0],
    "t_notification_read": [1.2, 0.4, 0.4, 3.5],
    "t_profile_views_browse": [4.0, 0.5, 2.0, 10.0],
    "t_back_verify": [1.2, 0.3, 0.6, 3.0],
    "t_tab_content_load": [2.5, 0.3, 1.5, 5.0],
    "t_comment_anim": [1.8, 0.3, 1.0, 4.0],
    "t_profile_load": [3.0, 0.3, 1.5, 6.0],
    "t_profile_from_story": [3.5, 0.3, 2.0, 7.0],
    "t_video_open": [2.0, 0.3, 1.0, 4.0],
    "t_tap_gap": [0.5, 0.3, 0.2, 1.5],
    "t_anim_complete": [1.5, 0.4, 0.8, 4.0],
    "t_brief_watch": [5.0, 0.5, 2.0, 15.0],
    "t_product_detail": [2.0, 0.4, 1.0, 5.0],
    "t_home_settle": [2.0, 0.3, 1.0, 4.0],
    "t_reopen_app": [3.5, 0.3, 2.0, 6.0],
    "t_frozen_retry": [4.0, 0.4, 2.0, 8.0],
    "t_close_before_open": [3.0, 0.3, 1.5, 6.0],
    "t_proxy_retry": [5.0, 0.3, 3.0, 10.0],
}

# Params classified as verification/recovery (stay at 1.0x in Stealth)
VERIFY_PREFIXES = ("t_verify_", "t_recovery_", "t_health_", "t_back_verify",
                   "t_tab_content_load", "t_comment_anim", "t_profile_load",
                   "t_profile_from_story", "t_video_open", "t_home_settle",
                   "t_reopen_app", "t_frozen_retry", "t_close_before_open",
                   "t_proxy_retry")

DEFAULT_PERSONALITY = {
    "reels_preference": 0.5,
    "story_affinity": 0.2,
    "double_tap_habit": 0.6,
    "explore_curiosity": 0.1,
    "boredom_rate": 0.12,
    "boredom_relief": 0.4,
    "switch_threshold": 0.7,
    "comment_sociality": 0.45,
    "dominant_hand": 1,
    "comment_style": "reactor",
    "sessions_count": 0
}

DEFAULT_NICHE = {
    "description": "Relationship and dating content",
    "keywords": [
        "toxic relationship", "red flags", "dating advice",
        "narcissist", "gaslighting", "manipulation",
        "breakup", "situationship", "couple goals",
        "relationship tips", "love bombing", "ghosting",
        "emotional abuse", "toxic ex", "boundaries",
        "self worth", "healing", "moving on",
        "trust issues", "attachment style", "green flags"
    ],
    "follow_threshold": 55,
    "session_keywords_count": 8
}


def apply_multiplier(params, median_mult, sigma_mult, is_stealth=False):
    """Apply multiplier to all params. Returns new params dict.

    For Stealth: action/cosmetic params get median_mult,
    verification/recovery stay 1.0x.
    Min clamp: max(value, normal_min * 0.5)
    Max clamp: min(value, normal_max * 2.0)
    """
    result = {}
    for name, values in params.items():
        normal_median, normal_sigma, normal_min, normal_max = values

        if is_stealth and any(name.startswith(p) for p in VERIFY_PREFIXES):
            m_mult = 1.0
        else:
            m_mult = median_mult

        new_median = round(normal_median * m_mult, 4)
        new_sigma = round(normal_sigma * sigma_mult, 4)
        new_min = round(max(normal_median * m_mult * 0.3, normal_min * 0.5), 4)
        new_max = round(min(normal_median * m_mult * 3.0, normal_max * 2.0), 4)

        # Ensure min < median < max
        new_min = min(new_min, new_median * 0.8)
        new_max = max(new_max, new_median * 1.5)

        result[name] = [new_median, new_sigma, new_min, new_max]
    return result


def seed_phones(db):
    """Seed 4 Phone records. Idempotent."""
    from .models import Phone

    phones = [
        dict(id=1, name='Galaxy S9+', model='SM-G965F', screen_w=1080, screen_h=2220, density=420, retry_tolerance=3),
        dict(id=2, name='Samsung S22', model='SM-S901B', screen_w=1080, screen_h=2340, density=420, retry_tolerance=3),
        dict(id=3, name='Galaxy S9', model='SM-G960F', screen_w=1080, screen_h=2220, density=420, retry_tolerance=3),
        dict(id=4, name='Motorola E22i', model='XT2239-14', screen_w=720, screen_h=1600, density=280, retry_tolerance=4),
    ]
    created = 0
    for data in phones:
        if db.session.get(Phone, data['id']) is None:
            db.session.add(Phone(**data))
            created += 1
    db.session.commit()
    return created


def seed_proxy(db):
    """Seed 1 Proxy record for sinister.services. Idempotent."""
    from .models import Proxy

    existing = Proxy.query.filter_by(host='sinister.services', port=20002).first()
    if existing:
        return 0
    proxy = Proxy(
        name='Florida Mobile',
        host='sinister.services',
        port=20002,
        username_env='PROXY_1_USERNAME',
        password_env='PROXY_1_PASSWORD',
        rotation_url_env='PROXY_1_ROTATION_URL',
    )
    db.session.add(proxy)
    db.session.commit()
    return 1


def seed_presets(db):
    """Seed 4 TimingPreset records. Idempotent."""
    from .models import TimingPreset

    presets = [
        ('Normal', 'Current config.py values — balanced timing', NORMAL_PARAMS),
        ('Cautious', 'Slower, more human-like variance (1.3x median, 1.2x sigma)',
         apply_multiplier(NORMAL_PARAMS, 1.3, 1.2)),
        ('Aggressive', 'Faster sessions, higher throughput (0.7x median, 0.9x sigma)',
         apply_multiplier(NORMAL_PARAMS, 0.7, 0.9)),
        ('Stealth', 'Longer action pauses, normal verification (1.5x action, 1.0x verify)',
         apply_multiplier(NORMAL_PARAMS, 1.5, 1.0, is_stealth=True)),
    ]

    created = 0
    for name, desc, params in presets:
        if TimingPreset.query.filter_by(name=name).first() is None:
            db.session.add(TimingPreset(
                name=name, description=desc,
                params_json=params, is_default=True
            ))
            created += 1
    db.session.commit()
    return created


def migrate_warmup(db, warmup_path=None):
    """Read warmup_state.json and populate BotAccount.warmup_json.
    Skips gracefully if file not found or account already has data."""
    from .models import BotAccount

    if warmup_path is None:
        warmup_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                                    'phone-bot', 'data', 'warmup_state.json')
    if not os.path.exists(warmup_path):
        print(f"  warmup file not found: {warmup_path} — skipping")
        return 0

    with open(warmup_path, 'r') as f:
        warmup_data = json.load(f)

    migrated = 0
    for account_name, data in warmup_data.items():
        acct = BotAccount.query.filter_by(username=account_name).first()
        if acct and acct.warmup_json is None:
            acct.warmup_json = data
            migrated += 1
    db.session.commit()
    return migrated


def migrate_personality(db, data_dir=None):
    """Populate BotAccount.personality_json with evolved values or defaults.
    Skips accounts that already have personality_json."""
    from .models import BotAccount

    if data_dir is None:
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                                'phone-bot', 'data')

    accounts = BotAccount.query.filter(BotAccount.personality_json.is_(None)).all()
    migrated = 0
    for acct in accounts:
        # Try to find memory file for this account
        personality = dict(DEFAULT_PERSONALITY)
        for phone_num in range(1, 5):
            memory_file = os.path.join(data_dir, f'memory_test_ph{phone_num}.json')
            if os.path.exists(memory_file):
                try:
                    with open(memory_file, 'r') as f:
                        memory = json.load(f)
                    if acct.username in memory:
                        personality = memory[acct.username]
                        break
                except (json.JSONDecodeError, KeyError):
                    pass
        acct.personality_json = personality
        migrated += 1
    db.session.commit()
    return migrated


def migrate_niche(db):
    """Populate niche_json on TikTok BotAccounts. Skips if already set."""
    from .models import BotAccount

    accounts = BotAccount.query.filter(
        BotAccount.platform == 'tiktok',
        BotAccount.niche_json.is_(None)
    ).all()
    migrated = 0
    for acct in accounts:
        acct.niche_json = dict(DEFAULT_NICHE)
        migrated += 1
    db.session.commit()
    return migrated


def main():
    """Run all seed + migration functions. Safe to run multiple times."""
    from . import create_app, db

    app = create_app()
    with app.app_context():
        print("=== TikTok Seed Script ===")
        phones = seed_phones(db)
        print(f"  Phones: {phones} created")
        proxies = seed_proxy(db)
        print(f"  Proxy: {proxies} created")
        presets = seed_presets(db)
        print(f"  Timing presets: {presets} created")
        warmup = migrate_warmup(db)
        print(f"  Warmup migration: {warmup} accounts")
        personality = migrate_personality(db)
        print(f"  Personality migration: {personality} accounts")
        niche = migrate_niche(db)
        print(f"  Niche migration: {niche} accounts")
        print("=== Done ===")


if __name__ == '__main__':
    main()
