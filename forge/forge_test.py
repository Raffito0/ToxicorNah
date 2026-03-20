#!/usr/bin/env python3
"""
FORGE domain-aware test runner.

Wraps scrcpy + test command + ffmpeg frame extraction into one call.
Returns structured JSON result. Detects hardware failures separately from test failures.

Usage:
    python forge/forge_test.py --section section-06 --phone 3 --protocol path/to/section.yml
"""
import argparse
import json
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path


SCRCPY_READY_SIGNAL = "Recording started"
SCRCPY_WAIT_TIMEOUT = 8  # seconds


def build_ffmpeg_command(mkv_path: str, frames_dir: str) -> str:
    """Build ffmpeg frame extraction command. scale=720:-2 is MANDATORY."""
    Path(frames_dir).mkdir(parents=True, exist_ok=True)
    return (
        f'ffmpeg -y -i "{mkv_path}" '
        f'-vf "fps=0.5,scale=720:-2" '
        f'"{frames_dir}/f_%03d.jpg"'
    )


def run_scrcpy(mkv_path: str) -> tuple:
    """
    Launch scrcpy recording. Wait up to SCRCPY_WAIT_TIMEOUT for ready signal.
    Uses background thread for stderr to avoid readline() blocking on Windows.
    Returns (process, error_message). error_message is None on success.
    """
    proc = subprocess.Popen(
        ["scrcpy", "--record", mkv_path],
        stderr=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
    )

    lines_q: queue.Queue = queue.Queue()

    def _reader():
        try:
            if proc.stderr:  # always PIPE, guard satisfies type checker
                for raw in proc.stderr:
                    lines_q.put(raw.decode("utf-8", errors="replace"))
        except Exception:
            pass

    threading.Thread(target=_reader, daemon=True).start()

    deadline = time.time() + SCRCPY_WAIT_TIMEOUT
    while time.time() < deadline:
        try:
            line = lines_q.get(timeout=0.5)
            if SCRCPY_READY_SIGNAL in line:
                return proc, None
        except queue.Empty:
            pass
        rc = proc.poll()
        if rc is not None and rc != 0:
            return None, f"scrcpy exited with code {rc} — phone offline or not authorized?"

    proc.kill()
    return None, "scrcpy did not start within 8 seconds — phone offline?"


def stop_scrcpy(proc) -> None:
    """Gracefully stop scrcpy. Wait 3s for MKV finalization."""
    if proc is None:
        return
    try:
        subprocess.run(["taskkill", "/IM", "scrcpy.exe"], capture_output=True)
    except Exception:
        proc.terminate()
    time.sleep(3)


def count_frames(frames_dir: str) -> int:
    """Count extracted .jpg frames in directory."""
    d = Path(frames_dir)
    if not d.exists():
        return 0
    return len(list(d.glob("f_*.jpg")))


def run_test_protocol(section: str, protocol: dict, work_dir: str) -> dict:
    """
    Execute the test protocol for a section. Returns result dict.

    Result schema:
    {
        "section": str,
        "exit_code": int,
        "frames_extracted": int,
        "analysis_path": str | None,
        "hardware_error": bool,
        "message": str,
    }
    """
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    mkv_path = str(work / f"tmp_forge_{section}.mkv")
    frames_dir = str(work / f"tmp_forge_{section}_frames")
    test_type = protocol.get("type", "unit_test")
    commands = protocol.get("commands", [])

    result = {
        "section": section,
        "exit_code": -1,
        "frames_extracted": 0,
        "analysis_path": None,
        "hardware_error": False,
        "message": "",
    }

    scrcpy_proc = None

    # Print pre_condition so the skill can decide whether to pause
    pre_condition = protocol.get("pre_condition", "")
    if pre_condition:
        print(f"PRE-CONDITION: {pre_condition}")

    # Launch scrcpy for physical device tests
    if test_type == "physical_device":
        scrcpy_proc, err = run_scrcpy(mkv_path)
        if err:
            result["hardware_error"] = True
            result["message"] = err
            return result

    # Run test commands (skip scrcpy commands — already launched above)
    test_cmds = [c for c in commands if "scrcpy" not in c]
    exit_code = 0
    for cmd in test_cmds:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=work_dir)
        if r.returncode != 0:
            exit_code = r.returncode
            result["message"] = r.stderr[:500] if r.stderr else r.stdout[:500]
            break  # preserve first failure, don't overwrite with subsequent ones

    result["exit_code"] = exit_code

    # Stop scrcpy and extract frames
    if scrcpy_proc is not None:
        stop_scrcpy(scrcpy_proc)
        ffmpeg_cmd = build_ffmpeg_command(mkv_path, frames_dir)
        ffmpeg_result = subprocess.run(ffmpeg_cmd, shell=True, capture_output=True)
        if ffmpeg_result.returncode != 0:
            result["message"] += f" | ffmpeg failed (code {ffmpeg_result.returncode}): {ffmpeg_result.stderr[:200].decode('utf-8', errors='replace') if ffmpeg_result.stderr else 'no output'}"
        result["frames_extracted"] = count_frames(frames_dir)

    # Write result JSON
    result_path = str(work / f"forge_result_{section}.json")
    result["analysis_path"] = result_path
    result["suspicious_moments"] = []   # Phase 2: will contain Gemini frame analysis
    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)

    return result


def main():
    parser = argparse.ArgumentParser(description="FORGE test runner")
    parser.add_argument("--section", required=True)
    parser.add_argument("--phone", default="3")
    parser.add_argument("--protocol", help="Path to JSON protocol file")
    parser.add_argument("--work-dir", default=".")
    args = parser.parse_args()

    if args.protocol:
        with open(args.protocol) as f:
            protocol = json.load(f)
    else:
        protocol = {"type": "unit_test", "commands": ["echo no-protocol"], "pass_threshold": 1, "gemini_analysis": False}

    result = run_test_protocol(args.section, protocol, args.work_dir)
    print(json.dumps(result, indent=2))
    sys.exit(0 if not result["hardware_error"] else 1)


if __name__ == "__main__":
    main()
