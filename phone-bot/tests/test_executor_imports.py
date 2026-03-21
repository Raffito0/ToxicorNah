"""Tests that executor.py no longer imports push_to_phone.

Run with: pytest phone-bot/tests/test_executor_imports.py -v
"""
import ast
from pathlib import Path

import pytest

PHONE_BOT_DIR = Path(__file__).parent.parent
EXECUTOR_PATH = PHONE_BOT_DIR / "planner" / "executor.py"


def _get_executor_source() -> str:
    return EXECUTOR_PATH.read_text(encoding="utf-8")


def test_push_to_phone_not_in_executor_source():
    """'push_to_phone' must not appear anywhere in executor.py after the cleanup."""
    source = _get_executor_source()
    assert "push_to_phone" not in source, (
        "executor.py still references 'push_to_phone'. "
        "Remove it from the import line and the ImportError fallback stub."
    )


def test_delivery_import_line_does_not_include_push_to_phone():
    """The 'from delivery import ...' line must not include push_to_phone."""
    source = _get_executor_source()
    for line in source.splitlines():
        stripped = line.strip()
        if "from delivery import" in stripped or "delivery import" in stripped:
            assert "push_to_phone" not in stripped, (
                f"Found push_to_phone in delivery import line: {stripped!r}"
            )


def test_executor_imports_valid_delivery_functions():
    """executor.py must still import the 3 valid delivery functions."""
    source = _get_executor_source()
    # Check all three appear somewhere in the source (import or stub)
    for fn in ("get_next_video", "download_video", "mark_posted"):
        assert fn in source, (
            f"executor.py does not reference '{fn}'. "
            "The valid delivery imports must remain."
        )


def test_importerror_stub_does_not_assign_push_to_phone():
    """The 'except ImportError' fallback stub must not assign push_to_phone = None."""
    source = _get_executor_source()
    in_except_block = False
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("except ImportError"):
            in_except_block = True
        elif in_except_block:
            # End of except block when indentation drops back
            if stripped and not line.startswith(" ") and not line.startswith("\t"):
                in_except_block = False
            else:
                assert "push_to_phone" not in stripped, (
                    f"'push_to_phone' found in ImportError stub: {stripped!r}"
                )
