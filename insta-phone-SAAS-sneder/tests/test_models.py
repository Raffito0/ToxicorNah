"""Tests for the Phone model (section-01)."""
import time
from sqlalchemy.exc import IntegrityError
from app.models import Phone


def test_phone_table_created(app, db):
    """After db.create_all(), the phone table should exist with all columns."""
    inspector = db.inspect(db.engine)
    tables = inspector.get_table_names()
    assert 'phone' in tables

    columns = {col['name'] for col in inspector.get_columns('phone')}
    expected = {'id', 'name', 'model', 'adb_serial', 'screen_w', 'screen_h',
                'density', 'retry_tolerance', 'created_at', 'updated_at'}
    assert expected.issubset(columns)


def test_phone_explicit_id(app, db):
    """Phone(id=1, name='Galaxy S9+', model='SM-G965F') should persist with id=1."""
    phone = Phone(id=1, name='Galaxy S9+', model='SM-G965F')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result is not None
    assert result.id == 1
    assert result.name == 'Galaxy S9+'
    assert result.model == 'SM-G965F'


def test_phone_duplicate_id(app, db):
    """Inserting two Phone records with the same id should raise IntegrityError."""
    phone1 = Phone(id=1, name='Phone A', model='Model A')
    db.session.add(phone1)
    db.session.commit()

    phone2 = Phone(id=1, name='Phone B', model='Model B')
    db.session.add(phone2)
    import pytest
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_phone_defaults(app, db):
    """Phone created with only id/name/model should have correct defaults."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.screen_w == 1080
    assert result.screen_h == 2220
    assert result.density == 420
    assert result.retry_tolerance == 3


def test_phone_adb_serial_nullable(app, db):
    """Phone can be created without adb_serial (it's auto-detected at runtime)."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.adb_serial is None


def test_phone_updated_at(app, db):
    """After modifying a Phone and committing, updated_at should change."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    original_updated = phone.updated_at
    time.sleep(0.1)

    phone.name = 'Updated Phone'
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.updated_at > original_updated
