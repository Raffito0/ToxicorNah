"""Control.json IPC utilities for Flask <-> phone-bot communication."""
import json
import os
from datetime import datetime, timezone


def get_control_path():
    """Return path to control.json in phone-bot data dir."""
    project_root = os.path.normpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))
    return os.path.join(project_root, 'phone-bot', 'data', 'control.json')


def write_control(data):
    """Atomic write to control.json (tmp + os.replace)."""
    path = get_control_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data['updated_at'] = datetime.now(timezone.utc).isoformat()
    data['updated_by'] = 'dashboard'
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(data, f)
    os.replace(tmp_path, path)


def read_control():
    """Read control.json. Returns {} on missing/corrupt file."""
    path = get_control_path()
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
