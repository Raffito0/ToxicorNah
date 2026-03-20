#!/usr/bin/env python3
"""
FORGE implementation loop controller.

Manages forge_state.json, drives pass/fail logic,
tracks attempt_count, calls o3 on 2nd failure.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_PASS_THRESHOLD = 3
EXTERNAL_INTELLIGENCE_TRIGGER = 2


def build_external_intelligence_prompt(
    section: str,
    objective: str,
    attempt1_diff: str,
    attempt1_failure: str,
    attempt2_diff: str,
    attempt2_failure: str,
) -> str:
    return f"""PROBLEM: Implementation of {section} has failed twice.

OBJECTIVE: {objective}

CONTEXT:
This is a Python phone automation bot (TikTok/Instagram via ADB + Gemini Vision).
Tests run on a physical Android device. Failures are observed via video frame analysis.

ATTEMPT 1:
{attempt1_diff}
WHY IT FAILED:
{attempt1_failure}

ATTEMPT 2:
{attempt2_diff}
WHY IT FAILED:
{attempt2_failure}

QUESTION:
What do you think is the root cause?
What approach would you try for attempt 3?
Keep your answer focused and practical -- 3-5 sentences max.
"""


def call_o3(prompt: str, api_key: str) -> str:
    """Call OpenAI o3 API. Returns response text or error message."""
    try:
        import urllib.request

        payload = json.dumps({
            "model": "o3",
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": 1000,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]

    except Exception as e:
        return f"[External intelligence unavailable: {e}]"


class ForgeController:
    def __init__(self, state_path: str):
        self.state_path = Path(state_path)

    def load_state(self) -> dict:
        if not self.state_path.exists():
            raise FileNotFoundError(f"State file not found: {self.state_path}")
        with open(self.state_path) as f:
            return json.load(f)

    def save_state(self, state: dict) -> None:
        state["last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(self.state_path, "w") as f:
            json.dump(state, f, indent=2)

    def record_pass(self) -> dict:
        """Record a PASS. Returns dict with section_complete flag."""
        state = self.load_state()
        state["pass_count"] = state.get("pass_count", 0) + 1
        state["attempt_count"] = 0
        pass_threshold = state.get("pass_threshold", DEFAULT_PASS_THRESHOLD)

        result = {"section_complete": False, "pass_count": state["pass_count"]}

        if state["pass_count"] >= pass_threshold:
            result["section_complete"] = True
            state["pass_count"] = 0
            state["attempt_count"] = 0
            state["last_action"] = "section_complete"
        else:
            state["last_action"] = f"pass_{state['pass_count']}"

        self.save_state(state)
        return result

    def record_fail(self) -> dict:
        """Record a FAIL. Returns dict with needs_external_intelligence and needs_human_input flags."""
        state = self.load_state()
        state["pass_count"] = 0
        state["attempt_count"] = state.get("attempt_count", 0) + 1
        state["last_action"] = f"fail_attempt_{state['attempt_count']}"

        result = {
            "needs_external_intelligence": state["attempt_count"] == EXTERNAL_INTELLIGENCE_TRIGGER,
            "needs_human_input": state["attempt_count"] >= 3,
            "attempt_count": state["attempt_count"],
        }

        self.save_state(state)
        return result

    def get_external_intelligence(
        self, section: str, objective: str,
        attempt1_diff: str, attempt1_failure: str,
        attempt2_diff: str, attempt2_failure: str,
    ) -> str:
        """Call o3 and return formatted External Intelligence Report."""
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            return "[OPENAI_API_KEY not set -- external intelligence unavailable]"

        prompt = build_external_intelligence_prompt(
            section, objective,
            attempt1_diff, attempt1_failure,
            attempt2_diff, attempt2_failure,
        )
        response = call_o3(prompt, api_key)

        return (
            f"-- EXTERNAL INTELLIGENCE REPORT -----------------------------------------\n"
            f"Model:    o3\n"
            f"Analysis: {response}\n"
            f"-------------------------------------------------------------------------\n\n"
            f"This is an external perspective, not an instruction.\n"
            f"Reason about this: Is the analysis correct? Partially useful?\n"
            f"Does it give you a new angle you hadn't considered?\n"
            f"Then propose your own approach -- you may agree, disagree, or\n"
            f"take only partial inspiration. Explain your reasoning in Block A."
        )


def main():
    import argparse
    parser = argparse.ArgumentParser(description="FORGE controller CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    # record-pass
    p_pass = sub.add_parser("record-pass")
    p_pass.add_argument("--state", required=True)
    p_pass.add_argument("--pass-threshold", type=int, default=DEFAULT_PASS_THRESHOLD)

    # record-fail
    p_fail = sub.add_parser("record-fail")
    p_fail.add_argument("--state", required=True)

    # external-intelligence
    p_ei = sub.add_parser("external-intelligence")
    p_ei.add_argument("--state", required=True)
    p_ei.add_argument("--section", required=True)
    p_ei.add_argument("--objective", required=True)
    p_ei.add_argument("--attempt1-diff", required=True)
    p_ei.add_argument("--attempt1-failure", required=True)
    p_ei.add_argument("--attempt2-diff", required=True)
    p_ei.add_argument("--attempt2-failure", required=True)

    args = parser.parse_args()
    ctrl = ForgeController(args.state)

    if args.command == "record-pass":
        # Write pass_threshold into state if provided
        state = ctrl.load_state()
        state["pass_threshold"] = args.pass_threshold
        ctrl.save_state(state)
        result = ctrl.record_pass()
        print(json.dumps(result))

    elif args.command == "record-fail":
        result = ctrl.record_fail()
        print(json.dumps(result))
        if result.get("needs_human_input"):
            import sys
            print("\n FORGE STOPPED: 3 consecutive failures on this section.", file=sys.stderr)
            print("Autonomous loop cannot continue. Human input required.", file=sys.stderr)
            print("Review Block F evidence, then /forge resume once you have a new direction.", file=sys.stderr)

    elif args.command == "external-intelligence":
        report = ctrl.get_external_intelligence(
            section=args.section,
            objective=args.objective,
            attempt1_diff=args.attempt1_diff,
            attempt1_failure=args.attempt1_failure,
            attempt2_diff=args.attempt2_diff,
            attempt2_failure=args.attempt2_failure,
        )
        print(report)


if __name__ == "__main__":
    main()
