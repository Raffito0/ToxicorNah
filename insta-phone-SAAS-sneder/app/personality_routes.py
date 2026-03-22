"""Personality API routes (section-01).

Blueprint `personality_bp` with CRUD for per-account personality traits,
lock toggles, randomize, reset, and 30-session history.
"""
import random
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from sqlalchemy.orm.attributes import flag_modified

from . import db
from .models import BotAccount, Bot

personality_bp = Blueprint('personality', __name__)

PERSONALITY_RANGES = {
    "reels_preference": (0.20, 0.80),
    "story_affinity": (0.05, 0.50),
    "double_tap_habit": (0.25, 0.90),
    "explore_curiosity": (0.03, 0.20),
    "boredom_rate": (0.06, 0.18),
    "boredom_relief": (0.25, 0.55),
    "switch_threshold": (0.55, 0.85),
    "comment_sociality": (0.15, 0.75),
}

MAX_HISTORY = 30


def _get_defaults():
    """Return midpoint defaults for all traits."""
    return {k: round((lo + hi) / 2, 3) for k, (lo, hi) in PERSONALITY_RANGES.items()}


def _clamp_traits(traits: dict) -> dict:
    """Clamp trait values to their defined ranges."""
    clamped = {}
    for k, v in traits.items():
        if k in PERSONALITY_RANGES:
            lo, hi = PERSONALITY_RANGES[k]
            clamped[k] = round(max(lo, min(hi, float(v))), 3)
    return clamped


def _get_account_or_404(account_id: int):
    """Get BotAccount with ownership check. Returns (account, error_response)."""
    account = db.session.get(BotAccount, account_id)
    if not account:
        return None, (jsonify({'error': 'Account not found'}), 404)
    bot = db.session.get(Bot, account.bot_id)
    if not bot or bot.user_id != current_user.id:
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return account, None


def _get_traits(account):
    """Get current traits, falling back to defaults if NULL. Clamps to valid ranges."""
    if account.personality_json and isinstance(account.personality_json, dict):
        defaults = _get_defaults()
        defaults.update(account.personality_json)
        return _clamp_traits(defaults)
    return _get_defaults()


def _get_locked(account):
    """Get locked traits list."""
    if account.personality_locked_traits and isinstance(account.personality_locked_traits, list):
        return account.personality_locked_traits
    return []


def _get_history(account):
    """Get history entries."""
    if account.personality_history_json and isinstance(account.personality_history_json, list):
        return account.personality_history_json
    return []


@personality_bp.route('/api/accounts/<int:account_id>/personality', methods=['GET'])
@login_required
def get_personality(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    traits = _get_traits(account)
    locked = _get_locked(account)
    history = _get_history(account)

    return jsonify({
        'traits': traits,
        'locked_traits': locked,
        'history': history,
        'sessions_count': len(history),
    })


@personality_bp.route('/api/accounts/<int:account_id>/personality', methods=['PUT'])
@login_required
def update_personality(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    data = request.get_json(silent=True) or {}
    new_traits = data.get('traits', {})
    record_history = data.get('record_history', False)

    # Reject unknown trait keys
    unknown = [k for k in new_traits if k not in PERSONALITY_RANGES]
    if unknown:
        return jsonify({'error': f'Unknown traits: {", ".join(unknown)}'}), 400

    current_traits = _get_traits(account)
    clamped = _clamp_traits(new_traits)
    current_traits.update(clamped)

    account.personality_json = current_traits
    flag_modified(account, 'personality_json')

    if record_history:
        history = _get_history(account)
        entry = {
            'traits': dict(current_traits),
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }
        history.append(entry)
        if len(history) > MAX_HISTORY:
            history = history[-MAX_HISTORY:]
        account.personality_history_json = history
        flag_modified(account, 'personality_history_json')

    db.session.commit()
    return jsonify({'traits': current_traits})


@personality_bp.route('/api/accounts/<int:account_id>/personality/randomize', methods=['POST'])
@login_required
def randomize_personality(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    locked = _get_locked(account)
    current_traits = _get_traits(account)

    for key, (lo, hi) in PERSONALITY_RANGES.items():
        if key not in locked:
            current_traits[key] = round(random.uniform(lo, hi), 3)

    account.personality_json = current_traits
    flag_modified(account, 'personality_json')
    db.session.commit()

    return jsonify({'traits': current_traits})


@personality_bp.route('/api/accounts/<int:account_id>/personality/reset', methods=['POST'])
@login_required
def reset_personality(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    account.personality_json = _get_defaults()
    account.personality_locked_traits = []
    flag_modified(account, 'personality_json')
    flag_modified(account, 'personality_locked_traits')
    db.session.commit()

    return jsonify({'traits': _get_defaults(), 'locked_traits': []})


@personality_bp.route('/api/accounts/<int:account_id>/personality/lock', methods=['PUT'])
@login_required
def toggle_lock(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    data = request.get_json(silent=True) or {}
    trait = data.get('trait')
    locked = data.get('locked', True)

    if not trait or trait not in PERSONALITY_RANGES:
        return jsonify({'error': 'Invalid trait'}), 400

    current_locked = _get_locked(account)
    if locked and trait not in current_locked:
        current_locked.append(trait)
    elif not locked and trait in current_locked:
        current_locked.remove(trait)

    account.personality_locked_traits = current_locked
    flag_modified(account, 'personality_locked_traits')
    db.session.commit()

    return jsonify({'locked_traits': current_locked})


# ── Niche Config (section-05) ────────────────────────────────

DEFAULT_NICHE = {
    'description': '',
    'keywords': [],
    'follow_threshold': 55,
    'session_keywords_count': 8,
}


def _get_niche(account):
    """Get niche config, falling back to defaults."""
    if account.niche_json and isinstance(account.niche_json, dict):
        result = dict(DEFAULT_NICHE)
        result.update(account.niche_json)
        return result
    return dict(DEFAULT_NICHE)


@personality_bp.route('/api/accounts/<int:account_id>/niche', methods=['GET'])
@login_required
def get_niche(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err
    return jsonify(_get_niche(account))


@personality_bp.route('/api/accounts/<int:account_id>/niche', methods=['PUT'])
@login_required
def update_niche(account_id):
    account, err = _get_account_or_404(account_id)
    if err:
        return err

    data = request.get_json(silent=True) or {}
    current = _get_niche(account)

    # Validate keywords
    if 'keywords' in data:
        if not isinstance(data['keywords'], list):
            return jsonify({'error': 'keywords must be an array'}), 400
        current['keywords'] = [str(k) for k in data['keywords']]

    if 'description' in data:
        current['description'] = str(data['description'])

    if 'follow_threshold' in data:
        current['follow_threshold'] = max(40, min(70, int(data['follow_threshold'])))

    if 'session_keywords_count' in data:
        current['session_keywords_count'] = max(4, min(12, int(data['session_keywords_count'])))

    account.niche_json = current
    flag_modified(account, 'niche_json')
    db.session.commit()

    return jsonify(current)
