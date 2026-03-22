"""Content stock API routes."""

from flask import Blueprint, jsonify
from flask_login import login_required
from .content_service import get_content_stock

content_bp = Blueprint('content', __name__)


@content_bp.route('/api/content/stock', methods=['GET'])
@login_required
def get_stock():
    try:
        data = get_content_stock()
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@content_bp.route('/api/content/stock/refresh', methods=['POST'])
@login_required
def refresh_stock():
    try:
        data = get_content_stock(force_refresh=True)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
