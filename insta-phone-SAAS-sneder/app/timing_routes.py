"""Timing API routes (section-03).

Blueprint `timing_bp_api` with CRUD for timing presets, bot preset assignment,
per-bot parameter overrides, and custom preset creation.
"""
from flask import Blueprint, request, jsonify, render_template
from flask_login import login_required, current_user

from . import db
from .models import Bot, TimingPreset, TimingOverride

timing_bp_api = Blueprint('timing_api', __name__)


def _get_bot_or_403(bot_id):
    """Get bot with ownership check."""
    bot = db.session.get(Bot, bot_id)
    if not bot:
        return None, (jsonify({'error': 'Bot not found'}), 404)
    if bot.user_id != current_user.id:
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return bot, None


def _validate_override(data):
    """Validate override param values. Returns (cleaned_data, error)."""
    required = ['param_name', 'median', 'sigma', 'min_val', 'max_val']
    for field in required:
        if field not in data:
            return None, f'Missing field: {field}'
    try:
        median = float(data['median'])
        sigma = max(0.0, min(2.0, float(data['sigma'])))
        min_val = float(data['min_val'])
        max_val = float(data['max_val'])
    except (TypeError, ValueError):
        return None, 'Values must be numbers'

    if any(v < 0 for v in [median, min_val, max_val]):
        return None, 'Values must be non-negative'
    if not (min_val <= median <= max_val):
        return None, 'Must satisfy: min <= median <= max'

    return {
        'param_name': str(data['param_name']),
        'median': median,
        'sigma': sigma,
        'min_val': min_val,
        'max_val': max_val,
    }, None


# ── Preset CRUD ──────────────────────────────────────────────

@timing_bp_api.route('/api/timing/presets', methods=['GET'])
@login_required
def list_presets():
    presets = TimingPreset.query.all()
    return jsonify({
        'presets': [{
            'id': p.id,
            'name': p.name,
            'description': p.description,
            'is_default': p.is_default,
            'param_count': len(p.params_json) if p.params_json else 0,
        } for p in presets]
    })


@timing_bp_api.route('/api/timing/presets/<int:preset_id>', methods=['GET'])
@login_required
def get_preset(preset_id):
    preset = db.session.get(TimingPreset, preset_id)
    if not preset:
        return jsonify({'error': 'Preset not found'}), 404
    return jsonify({
        'id': preset.id,
        'name': preset.name,
        'description': preset.description,
        'params_json': preset.params_json,
        'is_default': preset.is_default,
    })


@timing_bp_api.route('/api/timing/presets', methods=['POST'])
@login_required
def create_preset():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    preset = TimingPreset(
        name=name,
        description=data.get('description', ''),
        params_json=data.get('params_json', {}),
        is_default=False,
    )
    db.session.add(preset)
    db.session.commit()
    return jsonify({
        'preset': {
            'id': preset.id,
            'name': preset.name,
            'description': preset.description,
            'is_default': preset.is_default,
        }
    }), 201


# ── Bot timing ───────────────────────────────────────────────

@timing_bp_api.route('/api/bots/<int:bot_id>/timing', methods=['GET'])
@login_required
def get_bot_timing(bot_id):
    bot, err = _get_bot_or_403(bot_id)
    if err:
        return err

    # Load preset params
    params = {}
    if bot.timing_preset_id:
        preset = db.session.get(TimingPreset, bot.timing_preset_id)
        if preset and preset.params_json:
            params = dict(preset.params_json)

    # Load overrides and merge
    overrides = TimingOverride.query.filter_by(bot_id=bot_id).all()
    override_names = []
    for ov in overrides:
        params[ov.param_name] = [ov.median, ov.sigma, ov.min_val, ov.max_val]
        override_names.append(ov.param_name)

    return jsonify({
        'params': params,
        'overrides': override_names,
        'preset_id': bot.timing_preset_id,
    })


@timing_bp_api.route('/api/bots/<int:bot_id>/timing/preset', methods=['PUT'])
@login_required
def set_bot_preset(bot_id):
    bot, err = _get_bot_or_403(bot_id)
    if err:
        return err

    data = request.get_json(silent=True) or {}
    preset_id = data.get('preset_id')
    if preset_id is not None:
        preset = db.session.get(TimingPreset, preset_id)
        if not preset:
            return jsonify({'error': 'Preset not found'}), 404

    bot.timing_preset_id = preset_id
    db.session.commit()
    return jsonify({'preset_id': bot.timing_preset_id})


@timing_bp_api.route('/api/bots/<int:bot_id>/timing/override', methods=['POST'])
@login_required
def upsert_override(bot_id):
    bot, err = _get_bot_or_403(bot_id)
    if err:
        return err

    data = request.get_json(silent=True) or {}
    cleaned, error = _validate_override(data)
    if error:
        return jsonify({'error': error}), 400

    existing = TimingOverride.query.filter_by(
        bot_id=bot_id, param_name=cleaned['param_name']).first()

    if existing:
        existing.median = cleaned['median']
        existing.sigma = cleaned['sigma']
        existing.min_val = cleaned['min_val']
        existing.max_val = cleaned['max_val']
    else:
        ov = TimingOverride(bot_id=bot_id, **cleaned)
        db.session.add(ov)

    db.session.commit()
    return jsonify({'status': 'ok'})


@timing_bp_api.route('/api/bots/<int:bot_id>/timing/override/<param>', methods=['DELETE'])
@login_required
def delete_override(bot_id, param):
    bot, err = _get_bot_or_403(bot_id)
    if err:
        return err

    ov = TimingOverride.query.filter_by(bot_id=bot_id, param_name=param).first()
    if ov:
        db.session.delete(ov)
        db.session.commit()
    return jsonify({'status': 'ok'})


@timing_bp_api.route('/api/bots/<int:bot_id>/timing/overrides', methods=['DELETE'])
@login_required
def delete_all_overrides(bot_id):
    bot, err = _get_bot_or_403(bot_id)
    if err:
        return err

    TimingOverride.query.filter_by(bot_id=bot_id).delete()
    db.session.commit()
    return jsonify({'status': 'ok'})


# ── Template route ───────────────────────────────────────────

@timing_bp_api.route('/timing-editor')
@login_required
def timing_editor():
    return render_template('timing-editor.html')
