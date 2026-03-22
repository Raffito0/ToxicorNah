"""Tests for GeminiUsage model (section-01 of 06-analytics)."""
import pytest
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import GeminiUsage


@pytest.fixture
def app(tmp_path):
    os.environ['TESTING'] = '1'
    db_file = str(tmp_path / 'test.db')
    application = create_app()
    application.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_file}'
    application.config['TESTING'] = True
    application.config['SECRET_KEY'] = 'test-secret'
    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def db(app):
    with app.app_context():
        yield _db


def test_create_gemini_usage_record(db):
    record = GeminiUsage(
        session_log_id=None,
        call_type='bbox',
        latency_ms=450,
        success=True,
        estimated_cost=0.001,
    )
    db.session.add(record)
    db.session.commit()

    fetched = db.session.get(GeminiUsage, record.id)
    assert fetched.call_type == 'bbox'
    assert fetched.latency_ms == 450
    assert fetched.success is True
    assert fetched.estimated_cost == 0.001
    assert fetched.created_at is not None


def test_query_by_date_range(db):
    now = datetime.now(timezone.utc)
    db.session.add(GeminiUsage(call_type='bbox', latency_ms=100, created_at=now))
    db.session.add(GeminiUsage(call_type='popup', latency_ms=200,
                                created_at=now - timedelta(days=2)))
    db.session.add(GeminiUsage(call_type='niche', latency_ms=300,
                                created_at=now - timedelta(days=5)))
    db.session.commit()

    cutoff = now - timedelta(days=3)
    results = GeminiUsage.query.filter(GeminiUsage.created_at >= cutoff).all()
    assert len(results) == 2


def test_query_by_call_type(db):
    for ct in ['bbox', 'bbox', 'popup', 'niche']:
        db.session.add(GeminiUsage(call_type=ct, latency_ms=100))
    db.session.commit()

    bbox_count = GeminiUsage.query.filter_by(call_type='bbox').count()
    assert bbox_count == 2

    groups = (db.session.query(GeminiUsage.call_type, _db.func.count())
              .group_by(GeminiUsage.call_type).all())
    assert len(groups) == 3


def test_composite_index_exists(db):
    from sqlalchemy import inspect
    indexes = inspect(db.engine).get_indexes('gemini_usage')
    idx_cols = []
    for idx in indexes:
        idx_cols.extend(idx['column_names'])
    assert 'created_at' in idx_cols
    assert 'call_type' in idx_cols
