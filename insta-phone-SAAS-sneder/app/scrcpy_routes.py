"""ws-scrcpy management routes — start, stop, status."""
import os
from flask import Blueprint, jsonify
from flask_login import login_required
from .scrcpy_service import scrcpy_manager

scrcpy_bp = Blueprint('scrcpy', __name__)


@scrcpy_bp.route('/api/scrcpy/status', methods=['GET'])
@login_required
def scrcpy_status():
    running = scrcpy_manager.is_running()
    return jsonify({
        'running': running,
        'port': scrcpy_manager._port,
        'url': scrcpy_manager.get_url(),
    })


@scrcpy_bp.route('/api/scrcpy/start', methods=['POST'])
@login_required
def scrcpy_start():
    scrcpy_dir = scrcpy_manager._ws_scrcpy_dir
    if not os.path.isdir(scrcpy_dir):
        return jsonify({
            'error': f'ws-scrcpy directory not found: {scrcpy_dir}. '
                     'Clone ws-scrcpy and run npm install first.'
        }), 400

    started = scrcpy_manager.start()
    return jsonify({
        'started': started,
        'url': scrcpy_manager.get_url(),
        'message': 'Started' if started else 'Already running',
    })


@scrcpy_bp.route('/api/scrcpy/stop', methods=['POST'])
@login_required
def scrcpy_stop():
    scrcpy_manager.stop()
    return jsonify({'stopped': True})
