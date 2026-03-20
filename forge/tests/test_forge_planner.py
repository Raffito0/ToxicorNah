import pytest
from pathlib import Path


SAMPLE_SECTION = """# Section 01: Navigation Fix

## Goal
Fix _return_to_fyp to handle Story state correctly.

## Implementation
Modify `phone-bot/actions/tiktok.py:892` function `_return_to_fyp`.
"""

SAMPLE_CLAUDE_MD_PHONE_BOT = """
# Phone Bot Project
Uses scrcpy, ADB, Python, Gemini Vision.
Target phones: Motorola 720x1600, Samsung S9 1080x2220, Samsung S22 1080x2340.
Test: python phone-bot/main.py --test browse-smoke --phone 3
"""


def test_adds_forge_header_to_section(tmp_path):
    """forge_planner adds forge: YAML header to section file."""
    from forge.forge_planner import enrich_section_file

    section_file = tmp_path / "section-01-navigation.md"
    section_file.write_text(SAMPLE_SECTION, encoding="utf-8")
    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text(SAMPLE_CLAUDE_MD_PHONE_BOT, encoding="utf-8")

    enrich_section_file(str(section_file), str(claude_md))

    content = section_file.read_text(encoding="utf-8")
    assert "forge:" in content
    assert "test_protocol:" in content
    assert "risk_level:" in content
    assert "autonomy_gate:" in content


def test_idempotent_does_not_overwrite(tmp_path):
    """Running enrich twice does not change the file."""
    from forge.forge_planner import enrich_section_file

    section_file = tmp_path / "section-01-navigation.md"
    section_file.write_text(SAMPLE_SECTION, encoding="utf-8")
    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text(SAMPLE_CLAUDE_MD_PHONE_BOT, encoding="utf-8")

    enrich_section_file(str(section_file), str(claude_md))
    content_after_first = section_file.read_text(encoding="utf-8")

    enrich_section_file(str(section_file), str(claude_md))
    content_after_second = section_file.read_text(encoding="utf-8")

    assert content_after_first == content_after_second


def test_detects_physical_device_domain(tmp_path):
    """Detects phone-bot domain -> type: physical_device."""
    from forge.forge_planner import detect_domain

    domain = detect_domain(SAMPLE_CLAUDE_MD_PHONE_BOT)
    assert domain == "physical_device"


def test_detects_unit_test_domain():
    """Detects React/npm project -> type: unit_test."""
    from forge.forge_planner import detect_domain

    claude_md = "# Web App\nUses React, TypeScript, npm, Vite."
    domain = detect_domain(claude_md)
    assert domain == "unit_test"


def test_detects_workflow_test_domain():
    """Detects n8n project -> type: workflow_test."""
    from forge.forge_planner import detect_domain

    claude_md = "# n8n workflow automation project. Uses n8n and Airtable."
    domain = detect_domain(claude_md)
    assert domain == "workflow_test"


def test_preserves_original_content(tmp_path):
    """Original section content is preserved after enrichment."""
    from forge.forge_planner import enrich_section_file

    section_file = tmp_path / "section-01.md"
    section_file.write_text(SAMPLE_SECTION, encoding="utf-8")
    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text(SAMPLE_CLAUDE_MD_PHONE_BOT, encoding="utf-8")

    enrich_section_file(str(section_file), str(claude_md))

    content = section_file.read_text(encoding="utf-8")
    assert "## Goal" in content
    assert "Fix _return_to_fyp" in content
