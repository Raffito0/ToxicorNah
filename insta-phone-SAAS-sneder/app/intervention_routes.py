"""Intervention CRUD routes — active list, bot history, resolve."""
import logging
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from flask_login import login_required
from . import db
from .models import InterventionLog, Bot

logger = logging.getLogger(__name__)

intervention_bp = Blueprint('intervention', __name__,
                            url_prefix='/api/interventions')


# ── Service functions ──────────────────────────────────────────

def create_intervention(bot_id: int, account_id: int,
                        intervention_type: str, session_id: str) -> InterventionLog:
    """Create and persist a new InterventionLog row. Returns the new row."""
    log = InterventionLog(
        bot_id=bot_id,
        bot_account_id=account_id,
        intervention_type=intervention_type,
        session_id=session_id,
    )
    db.session.add(log)
    db.session.commit()
    return log


def resolve_intervention(intervention_id: int, resolution: str) -> tuple:
    """Set resolved_at + resolution on an InterventionLog row.
    Returns (success: bool, reason: str)."""
    log = InterventionLog.query.get(intervention_id)
    if log is None:
        return (False, 'not_found')
    if log.resolved_at is not None:
        return (False, 'already_resolved')
    log.resolved_at = datetime.now(timezone.utc)
    log.resolution = resolution
    db.session.commit()
    return (True, 'ok')


def get_active_interventions() -> list:
    """Return all unresolved intervention logs, oldest first."""
    return InterventionLog.query.filter(
        InterventionLog.resolved_at.is_(None)
    ).order_by(InterventionLog.requested_at.asc()).all()


def get_bot_history(bot_id: int, limit: int = 50) -> list:
    """Return up to `limit` rows for the given bot_id, newest first."""
    return InterventionLog.query.filter_by(bot_id=bot_id).order_by(
        InterventionLog.requested_at.desc()
    ).limit(limit).all()


# ── Serialization ──────────────────────────────────────────────

def _serialize(log: InterventionLog) -> dict:
    return {
        'id': log.id,
        'bot_id': log.bot_id,
        'bot_account_id': log.bot_account_id,
        'session_id': log.session_id,
        'intervention_type': log.intervention_type,
        'requested_at': log.requested_at.isoformat() if log.requested_at else None,
        'resolved_at': log.resolved_at.isoformat() if log.resolved_at else None,
        'resolution': log.resolution,
        'telegram_message_id': log.telegram_message_id,
    }


# ── Gate helper (isolated for mocking in tests) ───────────────

def _resolve_gate(phone_id: int, decision: str):
    """Call InterventionGate.resolve(). Separated for easy mocking."""
    try:
        from phone_bot.core.intervention import get_gate
        get_gate().resolve(phone_id, decision)
    except ImportError:
        logger.error("phone_bot not importable — gate resolve FAILED, worker may stay blocked")


# ── Routes ─────────────────────────────────────────────────────

@intervention_bp.route('/active', methods=['GET'])
@login_required
def list_active():
    rows = get_active_interventions()
    return jsonify([_serialize(r) for r in rows])


@intervention_bp.route('/<int:bot_id>/history', methods=['GET'])
@login_required
def bot_history(bot_id):
    rows = get_bot_history(bot_id)
    return jsonify([_serialize(r) for r in rows])


@intervention_bp.route('/<int:bot_id>/resolve', methods=['POST'])
@login_required
def resolve_bot(bot_id):
    data = request.get_json(silent=True) or {}
    resolution = data.get('resolution')
    if resolution not in ('approve', 'skip'):
        return jsonify({'error': 'invalid_resolution',
                        'detail': 'Must be "approve" or "skip"'}), 400

    # Find first pending intervention for this bot
    pending = InterventionLog.query.filter_by(
        bot_id=bot_id
    ).filter(InterventionLog.resolved_at.is_(None)).order_by(
        InterventionLog.requested_at.asc()
    ).first()

    if pending is None:
        return jsonify({'error': 'no_pending'}), 409

    ok, reason = resolve_intervention(pending.id, resolution)
    if not ok:
        return jsonify({'error': reason}), 409

    # Resolve the gate — look up phone_ref_id from Bot
    bot = Bot.query.get(bot_id)
    if bot and bot.phone_ref_id:
        _resolve_gate(bot.phone_ref_id, resolution)

    return jsonify({'status': 'ok', 'intervention_id': pending.id})
