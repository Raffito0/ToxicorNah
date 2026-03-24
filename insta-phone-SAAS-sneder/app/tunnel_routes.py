"""Cloudflare tunnel management routes — start, stop, status."""
from flask import Blueprint, jsonify
from flask_login import login_required
from .tunnel_service import get_manager

tunnel_bp = Blueprint('tunnel', __name__)


@tunnel_bp.route('/api/tunnel/status', methods=['GET'])
@login_required
def tunnel_status():
    mgr = get_manager()
    return jsonify({
        'running': mgr.is_running(),
        'url': mgr.get_url(),
        'local_port': mgr._port,
    })


@tunnel_bp.route('/api/tunnel/start', methods=['POST'])
@login_required
def tunnel_start():
    mgr = get_manager()
    started = mgr.start()
    if started:
        return jsonify({'started': True})
    return jsonify({'already_running': True})


@tunnel_bp.route('/api/tunnel/stop', methods=['POST'])
@login_required
def tunnel_stop():
    mgr = get_manager()
    if not mgr.is_running():
        return jsonify({'not_running': True})
    mgr.stop()
    return jsonify({'stopped': True})
