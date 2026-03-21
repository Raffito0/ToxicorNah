import pytest
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db


@pytest.fixture
def app():
    """Create a Flask app configured for testing with in-memory SQLite."""
    os.environ['TESTING'] = '1'
    application = create_app()
    application.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    application.config['TESTING'] = True
    application.config['WTF_CSRF_ENABLED'] = False

    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def db(app):
    """Provide the database instance within app context."""
    with app.app_context():
        yield _db
