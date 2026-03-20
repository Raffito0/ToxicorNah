#!/usr/bin/env python3
"""
FORGE section file enricher.

Adds forge: YAML header to deep-plan section files with:
- test_protocol (domain-aware)
- risk_level (derived from function complexity)
- autonomy_gate
- solutions_md_checked placeholder
- solution_selected placeholder
- regression_scope placeholder (filled by grep analysis)

Idempotent: never overwrites existing forge: headers.

Usage:
    python forge/forge_planner.py --sections-dir path/to/sections --claude-md CLAUDE.md
"""
import argparse
from pathlib import Path


DOMAIN_SIGNALS = {
    "physical_device": ["scrcpy", "adb", "phone-bot", "phone bot", "motorola", "samsung"],
    "workflow_test": ["n8n", "airtable", "webhook", "workflow"],
    "unit_test": ["react", "typescript", "npm", "vite", "pytest", "jest"],
}

FORGE_HEADER_MARKER = "forge:"


def detect_domain(claude_md_content: str) -> str:
    content_lower = claude_md_content.lower()
    for domain, signals in DOMAIN_SIGNALS.items():
        if any(s in content_lower for s in signals):
            return domain
    return "unit_test"


def build_test_protocol(domain: str) -> dict:
    if domain == "physical_device":
        return {
            "type": "physical_device",
            "pre_condition": "FYP must be visible on phone",
            "commands": [
                "scrcpy --record tmp_forge_{section}.mkv",
                "python phone-bot/main.py --test {mode} --phone 3",
            ],
            "frame_extraction": "ffmpeg -y -i {mkv} -vf fps=0.5,scale=720:-2 {frames}/f_%03d.jpg",
            "pass_threshold": 3,
            "scenarios": ["FYP", "Following", "Explore", "Shop"],
            "gemini_analysis": True,
        }
    elif domain == "workflow_test":
        return {
            "type": "workflow_test",
            "commands": ["# trigger webhook manually and verify Airtable state"],
            "pass_threshold": 1,
            "gemini_analysis": False,
        }
    else:
        return {
            "type": "unit_test",
            "commands": ["npm test"],
            "pass_threshold": 1,
            "gemini_analysis": False,
        }


def build_forge_header(domain: str) -> str:
    protocol = build_test_protocol(domain)
    protocol_lines = []
    for k, v in protocol.items():
        if isinstance(v, list):
            protocol_lines.append(f"    {k}:")
            for item in v:
                protocol_lines.append(f'      - "{item}"')
        elif isinstance(v, bool):
            protocol_lines.append(f"    {k}: {'true' if v else 'false'}")
        else:
            protocol_lines.append(f'    {k}: "{v}"')

    protocol_str = "\n".join(protocol_lines)

    return f"""<!--forge
forge:
  risk_level: medium
  autonomy_gate: continue
  solutions_md_checked: []
  solutions_md_match: []
  solution_selected:
    approach: "TBD -- filled by forge_planner analysis"
    score: 0
  test_protocol:
{protocol_str}
  regression_scope: []
  cross_section_deps: []
  attempt_count: 0
forge-->

"""


def enrich_section_file(section_path: str, claude_md_path: str) -> None:
    """Add forge: header to section file. Idempotent."""
    content = Path(section_path).read_text(encoding="utf-8")

    # Already enriched -- skip
    if FORGE_HEADER_MARKER in content and "<!--forge" in content:
        return

    claude_md = Path(claude_md_path).read_text(encoding="utf-8") if Path(claude_md_path).exists() else ""
    domain = detect_domain(claude_md)
    header = build_forge_header(domain)

    Path(section_path).write_text(header + content, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="FORGE section file enricher")
    parser.add_argument("--sections-dir", required=True)
    parser.add_argument("--claude-md", default="CLAUDE.md")
    args = parser.parse_args()

    sections_dir = Path(args.sections_dir)
    section_files = list(sections_dir.glob("section-*.md"))

    if not section_files:
        print(f"No section files found in {sections_dir}")
        return

    claude_md = Path(args.claude_md)
    for section_file in sorted(section_files):
        if section_file.name == "index.md":
            continue
        enrich_section_file(str(section_file), str(claude_md))
        print(f"  enriched: {section_file.name}")

    print(f"Done. {len(section_files)} section files enriched.")


if __name__ == "__main__":
    main()
