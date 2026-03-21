"""Config translation layer: DB models -> phone-bot config format.

Translates Flask/SQLAlchemy models into the dict format that phone-bot's
config.py expects. The key function apply_config_to_module() monkey-patches
the phone-bot config module so HumanEngine, TikTokBot etc. read from DB.
"""
import os


def build_phone_config(phone):
    """Translate Phone model to config.PHONES entry format."""
    return {
        'id': phone.id,
        'name': phone.name,
        'model': phone.model,
        'adb_serial': phone.adb_serial,
        'screen_w': phone.screen_w,
        'screen_h': phone.screen_h,
        'density': phone.density,
        'retry_tolerance': phone.retry_tolerance,
    }


def build_proxy_config(proxy):
    """Translate Proxy model to config.PROXIES entry format.
    Resolves env var names to actual values. Raises KeyError if env vars not set."""
    username = os.environ[proxy.username_env]
    password = os.environ[proxy.password_env]
    rotation_url = ''
    if proxy.rotation_url_env:
        rotation_url = os.environ.get(proxy.rotation_url_env, '')

    return {
        'id': f'proxy-{proxy.id}',
        'host': proxy.host,
        'port': proxy.port,
        'username': username,
        'password': password,
        'socks5_url': f'socks5://{username}:{password}@{proxy.host}:{proxy.port}',
        'rotation_url': rotation_url,
        'hotspot_ssid': proxy.hotspot_ssid or '',
        'hotspot_password': os.environ.get(proxy.hotspot_password_env, '') if proxy.hotspot_password_env else '',
    }


def build_timing_config(preset, overrides=None):
    """Merge preset params_json with per-bot TimingOverride records.

    Args:
        preset: TimingPreset model (has params_json dict)
        overrides: list of TimingOverride models (optional)

    Returns:
        dict of param_name -> [median, sigma, min, max]
    """
    result = dict(preset.params_json) if preset and preset.params_json else {}

    if overrides:
        for o in overrides:
            result[o.param_name] = [o.median, o.sigma, o.min_val, o.max_val]

    return result


def build_account_config(account, bot):
    """Translate BotAccount to config.ACCOUNTS entry format."""
    return {
        'name': account.username,
        'phone_id': bot.phone_ref_id or int(bot.phone_id) if bot.phone_id else 1,
        'platform': account.platform or 'tiktok',
        'proxy_id': f'proxy-{bot.proxy_id}' if bot.proxy_id else 'proxy-1',
    }


def apply_config_to_module(phone_config, proxy_config=None, timing_config=None,
                           account_config=None, niche_config=None):
    """Monkey-patch the phone-bot config module with DB-sourced values.

    This is the bridge between Flask/DB world and phone-bot world.
    Must be called before creating HumanEngine/TikTokBot instances.
    """
    from phone_bot import config

    # Phone
    config.PHONES = [phone_config]

    # Proxy
    if proxy_config:
        config.PROXIES = [proxy_config]
        config.PROXY = proxy_config

    # Timing (merge, don't replace - keeps non-timing keys like tap_sigma_x)
    if timing_config:
        config.HUMAN.update(timing_config)

    # Account
    if account_config:
        config.ACCOUNTS = [account_config]

    # Niche
    if niche_config:
        config.NICHE_DESCRIPTION = niche_config.get('description', '')
        config.NICHE_FOLLOW_THRESHOLD = niche_config.get('follow_threshold', 55)
        if 'keywords' in niche_config:
            config.NICHE_KEYWORDS = niche_config['keywords']

    # Production mode
    config.TEST_MODE = False
