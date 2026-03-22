"""Planner API routes -- weekly plan generation, warmup management, session status."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request, render_template
from flask_login import login_required

from . import planner_service

planner_bp = Blueprint('planner', __name__)

EASTERN = ZoneInfo("US/Eastern")


# --- Template route ---

@planner_bp.route('/weekly-plan')
@login_required
def weekly_plan_page():
    """Render the weekly plan page."""
    return render_template('weekly-plan.html')


# --- API routes ---

@planner_bp.route('/api/planner/weekly-plan')
@login_required
def get_weekly_plan():
    """Get plan for proxy group + week."""
    proxy_id = request.args.get('proxy_id', type=int)
    if not proxy_id:
        return jsonify(error='proxy_id is required'), 400

    plan = planner_service.get_current_plan(proxy_id)
    if not plan:
        return jsonify(error='No plan found'), 404

    return jsonify(plan)


@planner_bp.route('/api/planner/weekly-plan/generate', methods=['POST'])
@login_required
def generate_plan():
    """Generate a new weekly plan for a proxy group."""
    data = request.get_json() or {}
    proxy_id = data.get('proxy_id')
    if not proxy_id:
        return jsonify(error='proxy_id is required'), 400

    week_date = None
    if data.get('week_date'):
        try:
            week_date = date.fromisoformat(data['week_date'])
        except ValueError:
            return jsonify(error='Invalid week_date format, use YYYY-MM-DD'), 400

    try:
        plan = planner_service.generate_weekly_plan(proxy_id, week_date)
        return jsonify(plan), 201
    except Exception as e:
        return jsonify(error=str(e)), 400


@planner_bp.route('/api/planner/weekly-plan/regenerate', methods=['POST'])
@login_required
def regenerate_plan():
    """Regenerate remaining days of active plan."""
    data = request.get_json() or {}
    proxy_id = data.get('proxy_id')
    if not proxy_id:
        return jsonify(error='proxy_id is required'), 400

    from_date = date.today()
    if data.get('from_date'):
        try:
            from_date = date.fromisoformat(data['from_date'])
        except ValueError:
            return jsonify(error='Invalid from_date format'), 400

    try:
        plan = planner_service.regenerate_remaining_days(proxy_id, from_date)
        return jsonify(plan)
    except Exception as e:
        return jsonify(error=str(e)), 400


@planner_bp.route('/api/planner/today-sessions')
@login_required
def today_sessions():
    """Today's sessions with execution status."""
    proxy_id = request.args.get('proxy_id', type=int)
    sessions = planner_service.get_today_sessions(proxy_id)
    current_time_et = datetime.now(EASTERN).strftime("%H:%M")

    return jsonify({
        "sessions": sessions,
        "current_time_et": current_time_et,
        "timezone": "US/Eastern",
    })


@planner_bp.route('/api/planner/warmup/<account_name>')
@login_required
def get_warmup(account_name):
    """Warmup status for account."""
    status = planner_service.get_warmup_status(account_name)
    if not status:
        return jsonify(error='Account not found or no warmup'), 404
    return jsonify(status)


@planner_bp.route('/api/planner/warmup/<account_name>/reset', methods=['POST'])
@login_required
def warmup_reset(account_name):
    """Reset warmup to day 1."""
    try:
        result = planner_service.update_warmup(account_name, action="reset")
        return jsonify(result)
    except ValueError as e:
        return jsonify(error=str(e)), 400


@planner_bp.route('/api/planner/warmup/<account_name>/skip', methods=['POST'])
@login_required
def warmup_skip(account_name):
    """Skip to target day."""
    data = request.get_json() or {}
    target_day = data.get('target_day')
    if not target_day:
        return jsonify(error='target_day is required'), 400

    try:
        result = planner_service.update_warmup(account_name, action="skip", target_day=target_day)
        return jsonify(result)
    except ValueError as e:
        return jsonify(error=str(e)), 400


@planner_bp.route('/api/planner/warmup/<account_name>/complete', methods=['POST'])
@login_required
def warmup_complete(account_name):
    """Mark warmup complete."""
    try:
        result = planner_service.update_warmup(account_name, action="complete")
        return jsonify(result)
    except ValueError as e:
        return jsonify(error=str(e)), 400


@planner_bp.route('/api/planner/weekly-plan/export')
@login_required
def export_plan():
    """Download executor-compatible JSON."""
    proxy_id = request.args.get('proxy_id', type=int)
    if not proxy_id:
        return jsonify(error='proxy_id is required'), 400

    plan = planner_service.get_current_plan(proxy_id)
    if not plan:
        return jsonify(error='No plan found'), 404

    week = plan.get('week', 0)
    year = plan.get('year', 0)
    filename = f"weekly_plan_W{week:02d}_{year}.json"

    response = jsonify(plan)
    response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@planner_bp.route('/api/planner/phone-added', methods=['POST'])
@login_required
def phone_added():
    """Triggered after phone add. Regenerates remaining days."""
    data = request.get_json() or {}
    proxy_id = data.get('proxy_id')
    if not proxy_id:
        return jsonify(error='proxy_id is required'), 400

    try:
        result = planner_service.regenerate_remaining_days(proxy_id, date.today())
        return jsonify(result)
    except Exception as e:
        return jsonify(error=str(e)), 400
