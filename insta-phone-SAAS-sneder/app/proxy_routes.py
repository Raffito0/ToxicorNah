"""Proxy management routes — CRUD, test connection, IP rotation, history."""
import os
import logging
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from . import db
from .models import Proxy, ProxyRotation, Bot

logger = logging.getLogger(__name__)

proxy_bp = Blueprint('proxy', __name__)


@proxy_bp.route('/api/proxy', methods=['GET'])
@login_required
def list_proxies():
    """List all proxies with status and phone count."""
    proxies = Proxy.query.all()
    result = []
    for p in proxies:
        phones_count = Bot.query.filter_by(proxy_id=p.id).count()
        result.append({
            'id': p.id,
            'name': p.name,
            'host': p.host,
            'port': p.port,
            'username_env': p.username_env,
            'password_env': p.password_env,
            'rotation_url_env': p.rotation_url_env,
            'hotspot_ssid': p.hotspot_ssid,
            'current_ip': p.current_ip,
            'status': p.status,
            'phones_assigned': phones_count,
            'created_at': p.created_at.isoformat() if p.created_at else None,
        })
    return jsonify(success=True, proxies=result), 200


@proxy_bp.route('/api/proxy', methods=['POST'])
@login_required
def create_proxy():
    """Create a new proxy."""
    data = request.get_json()
    if not data:
        return jsonify(success=False, error='No data provided'), 400

    required = ['name', 'host', 'port', 'username_env', 'password_env']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify(success=False, error=f'Missing fields: {", ".join(missing)}'), 400

    proxy = Proxy(
        name=data['name'],
        host=data['host'],
        port=int(data['port']),
        username_env=data['username_env'],
        password_env=data['password_env'],
        rotation_url_env=data.get('rotation_url_env'),
        hotspot_ssid=data.get('hotspot_ssid'),
        hotspot_password_env=data.get('hotspot_password_env'),
    )
    db.session.add(proxy)
    db.session.commit()

    return jsonify(success=True, proxy={'id': proxy.id, 'name': proxy.name}), 201


@proxy_bp.route('/api/proxy/<int:proxy_id>', methods=['PUT'])
@login_required
def update_proxy(proxy_id):
    """Update proxy fields."""
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy:
        return jsonify(success=False, error='Proxy not found'), 404

    data = request.get_json()
    if not data:
        return jsonify(success=False, error='No data provided'), 400

    updatable = ['name', 'host', 'port', 'username_env', 'password_env',
                 'rotation_url_env', 'hotspot_ssid', 'hotspot_password_env', 'status']
    for field in updatable:
        if field in data:
            if field == 'port':
                setattr(proxy, field, int(data[field]))
            else:
                setattr(proxy, field, data[field])

    db.session.commit()
    return jsonify(success=True, proxy={'id': proxy.id, 'name': proxy.name, 'status': proxy.status}), 200


@proxy_bp.route('/api/proxy/<int:proxy_id>', methods=['DELETE'])
@login_required
def delete_proxy(proxy_id):
    """Delete proxy (only if no bots assigned)."""
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy:
        return jsonify(success=False, error='Proxy not found'), 404

    assigned = Bot.query.filter_by(proxy_id=proxy_id).count()
    if assigned > 0:
        return jsonify(success=False, error=f'Proxy is assigned to {assigned} bots'), 409

    db.session.delete(proxy)
    db.session.commit()
    return jsonify(success=True), 200


@proxy_bp.route('/api/proxy/<int:proxy_id>/test', methods=['POST'])
@login_required
def test_proxy_connection(proxy_id):
    """Test SOCKS5 connectivity and return current IP."""
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy:
        return jsonify(success=False, error='Proxy not found'), 404

    try:
        username = os.environ[proxy.username_env]
        password = os.environ[proxy.password_env]
        socks5_url = f'socks5://{username}:{password}@{proxy.host}:{proxy.port}'

        import httpx
        with httpx.Client(proxy=socks5_url, timeout=10) as client:
            response = client.get('https://api.ipify.org')
            current_ip = response.text.strip()

        proxy.current_ip = current_ip
        db.session.commit()

        return jsonify(success=True, ip=current_ip), 200

    except KeyError as e:
        return jsonify(success=False, error=f'Environment variable not set: {e}'), 400
    except Exception as e:
        return jsonify(success=False, error=f'Connection failed: {str(e)[:100]}'), 500


@proxy_bp.route('/api/proxy/<int:proxy_id>/rotate', methods=['POST'])
@login_required
def rotate_proxy(proxy_id):
    """Trigger IP rotation and return old->new IP."""
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy:
        return jsonify(success=False, error='Proxy not found'), 404

    try:
        import httpx
        import time as _time

        username = os.environ[proxy.username_env]
        password = os.environ[proxy.password_env]
        socks5_url = f'socks5://{username}:{password}@{proxy.host}:{proxy.port}'

        # Get current IP
        with httpx.Client(proxy=socks5_url, timeout=10) as client:
            old_ip = client.get('https://api.ipify.org').text.strip()

        # Call rotation URL
        rotation_url = os.environ.get(proxy.rotation_url_env, '') if proxy.rotation_url_env else ''
        if not rotation_url:
            return jsonify(success=False, error='No rotation URL configured'), 400

        httpx.get(rotation_url, timeout=10)
        _time.sleep(60)  # Wait for IP to change

        # Get new IP
        with httpx.Client(proxy=socks5_url, timeout=10) as client:
            new_ip = client.get('https://api.ipify.org').text.strip()

        status = 'success' if old_ip != new_ip else 'failed'

        # Log rotation
        rotation = ProxyRotation(
            proxy_id=proxy.id,
            old_ip=old_ip,
            new_ip=new_ip if old_ip != new_ip else None,
            triggered_by='manual',
            status=status,
        )
        db.session.add(rotation)
        proxy.current_ip = new_ip
        db.session.commit()

        return jsonify(success=True, old_ip=old_ip, new_ip=new_ip, status=status), 200

    except KeyError as e:
        return jsonify(success=False, error=f'Environment variable not set: {e}'), 400
    except Exception as e:
        return jsonify(success=False, error=f'Rotation failed: {str(e)[:100]}'), 500


@proxy_bp.route('/api/proxy/<int:proxy_id>/history', methods=['GET'])
@login_required
def rotation_history(proxy_id):
    """Get rotation history for a proxy."""
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy:
        return jsonify(success=False, error='Proxy not found'), 404

    limit = request.args.get('limit', 100, type=int)
    rotations = ProxyRotation.query.filter_by(proxy_id=proxy_id) \
        .order_by(ProxyRotation.rotated_at.desc()) \
        .limit(limit).all()

    result = []
    for r in rotations:
        result.append({
            'id': r.id,
            'old_ip': r.old_ip,
            'new_ip': r.new_ip,
            'status': r.status,
            'triggered_by': r.triggered_by,
            'phone_id': r.phone_id,
            'error_message': r.error_message,
            'rotated_at': r.rotated_at.isoformat() if r.rotated_at else None,
        })

    return jsonify(success=True, rotations=result), 200
