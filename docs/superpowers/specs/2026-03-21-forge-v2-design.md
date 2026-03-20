# FORGE v2 Design Spec

**Date**: 2026-03-21
**Status**: Approved for implementation

---

## Problem

FORGE v1 uses Block A/B/P as text patterns Claude writes in conversation. This is weak:
- Claude can write the blocks without doing the actual work
- Hooks check for text presence, not that the work happened
- Pixel numbers can be invented, callers can be skipped, proven code can be ignored

## Solution

Replace Block A/B/P text patterns with **three phases of enforced tool calls**. Each phase is a Python CLI with subcommands that Claude Code must invoke via Bash tool. Hooks verify the tool calls happened and that Claude's code is consistent with the tool output — not that Claude wrote the right words.

---

## Architecture

```
forge_analyze (7 steps)     ← before writing code         [replaces Block A]
       ↓
   implement code
       ↓
forge_predict (5 steps)     ← before running test         [replaces Block P]
       ↓
   run test (scrcpy + main.py + ffmpeg)
       ↓
forge_verify (5 steps)      ← after test                  [replaces Block B]
       ↓
   python forge/forge_controller.py record-pass/record-fail
```

### Three hooks enforce the sequence

| Hook | Trigger | Blocks |
|------|---------|--------|
| `require-forge-analyze.py` | PreToolUse:Edit | Edit if forge_analyze steps not in `.analyze_cache.json` |
| `require-forge-predict.py` | PreToolUse:Bash (scrcpy) | scrcpy launch if forge_predict steps not in `.predict_cache.json` |
| `require-forge-verify.py` | PreToolUse:Bash (`forge_controller.py record-pass`) | record-pass if forge_verify not in `.verify_result.json` |

Hooks verify **tool calls** (via cache files), not text patterns.

### v1 hooks retired in v2
- `require-block-a.py` → replaced by `require-forge-analyze.py`
- `require-block-p.py` → replaced by `require-forge-predict.py`
- `require-block-b.py` → replaced by `require-forge-verify.py`

These three hooks are **deleted** when v2 is deployed. `require-protected-core-test.py` and `require-solutions-write.py` are kept unchanged.

### Attempt accounting (unchanged from v1)
- FAIL → `forge_controller.py record-fail` → increments `attempt_count`, resets `pass_count`
- PASS → `forge_controller.py record-pass` → increments `pass_count`, resets `attempt_count`
- 3 consecutive PASS → section complete
- `attempt_count == 2` → external intelligence triggered
- `attempt_count == 3` → STOP, needs human input

---

## Cache Files

All three phases write to cache files in `forge/`. Hooks read these. All gitignored.

```
forge/.analyze_cache.json    — forge_analyze output
forge/.predict_cache.json    — forge_predict output
forge/.verify_result.json    — forge_verify output
```

### `.analyze_cache.json` schema
```json
{
  "session_id": "string (timestamp)",
  "section": "section-07",
  "steps_completed": ["callers", "call-chain", "regression-check", "protected-core", "config-check"],
  "conditional_steps": ["pixel-check"],
  "callers": [
    { "file": "tiktok.py", "line": 412, "usage": "return value ignored" }
  ],
  "app_states": ["FYP", "Following", "Explore"],
  "regression_files_to_read": ["tiktok.py:browse_session", "tiktok.py:browse_following_session"],
  "protected_core": false,
  "pixel_math": {
    "factor": 0.20,
    "motorola_1600": 320,
    "samsung_s9_2220": 444,
    "samsung_s22_2340": 468
  },
  "config_missing": [],
  "gemini_prompt_changed": false
}
```

Hook `require-forge-analyze.py`:
1. Checks `steps_completed` contains all required steps for this section
2. If `pixel-check` in `conditional_steps`: extracts numbers from the proposed Edit, compares against `pixel_math` values → BLOCK if mismatch
3. If `regression_files_to_read` non-empty: checks that Claude called Read on those files this session (tracked via PostToolUse:Read sentinel)

### `.predict_cache.json` schema
```json
{
  "session_id": "string",
  "section": "section-07",
  "steps_completed": ["import-check", "log-signatures", "recovery-predict", "precondition-verify", "test-command"],
  "import_check_passed": true,
  "expect_pass_signature": "[INFO] _return_to_fyp: FYP confirmed",
  "expect_fail_signature": "[WARNING] _return_to_fyp: still on Story after back",
  "recovery_at_risk": ["_return_to_fyp", "press_back"],
  "precondition_met": true,
  "precondition_description": "FYP must be visible",
  "test_command": "python phone-bot/main.py --test browse-smoke --phone 3"
}
```

### `.verify_result.json` schema
```json
{
  "session_id": "string",
  "section": "section-07",
  "steps_completed": ["filter-logs", "gemini-analysis", "compare-predictions", "interference-check", "write-emerging"],
  "verdict": "PASS",
  "confidence": 95,
  "interference_detected": false,
  "attempt_should_be_counted": true,
  "new_emerging_problems": []
}
```

---

## Phase 1 — forge_analyze

Executed **before writing any code**.

```
python forge/forge_analyze.py --callers <function>
python forge/forge_analyze.py --call-chain <function>
python forge/forge_analyze.py --regression-check
python forge/forge_analyze.py --protected-core <function>
python forge/forge_analyze.py --config-check
python forge/forge_analyze.py --pixel-check     # conditional
python forge/forge_analyze.py --gemini-check    # conditional
```

All subcommands append their results to `.analyze_cache.json`.

### Step 1 — Callers
`--callers <function>`
Grep finds every caller with exact `file:line` and the code line showing how the return value is used. Output written to `callers[]` in cache.

### Step 2 — Call chain / app states
`--call-chain <function>`
Grep traces upward through callers-of-callers to identify which app states (FYP/Following/Explore/Shop/Inbox) can reach this function. Implementation: grep for function name → for each caller grep for that caller's name → repeat up to 3 levels. Cross-references with known entry points in `main.py` and `executor.py`. Output written to `app_states[]` in cache.

### Step 3 — Regression check
`--regression-check`
Must run **after** `--callers <function>`. Reads the `function` field from `.analyze_cache.json` (written by `--callers`) to know which function is being modified. Then reads `forge/forge_registry.json` and identifies completed sections whose `functions[]` overlap. Produces `regression_files_to_read[]` — the exact `file:function` pairs Claude must read before implementing.

Enforcement: `require-forge-analyze.py` reads `forge/.read_log.json` (written by the `PostToolUse:Read` sentinel hook — see Sentinel Hook section below). If `regression_files_to_read` contains `tiktok.py:browse_session` and `tiktok.py` is not in `.read_log.json` → Edit blocked.

### Step 4 — Protected Core check
`--protected-core <function>`
Checks against PROTECTED_CORE list: `_return_to_fyp`, `_tap_top_tab`, `get_bounding_box`, `scan_sidebar`, `humanize_swipe`, `tap_nav_home`, `_inbox_enter_subpage`. Output written to `protected_core: true/false` in cache. If true: browse-smoke required, `require-protected-core-test.py` hook (v1, kept) handles enforcement.

### Step 5 — Config completeness
`--config-check`
Reads the section file description + any diff notes to identify `config.HUMAN["param"]` or `config.X` references. Checks `config.py` for their existence. Output: `config_missing[]`. If non-empty → STOP, add config values first.

Note: at forge_analyze time no diff exists yet. Claude passes the planned parameters explicitly:
`python forge/forge_analyze.py --config-check --params "t_new_param,NICHE_THRESHOLD"`

### Step 6 — Pixel math *(conditional)*
`--pixel-check --factor 0.20`
Activated when the section file or Claude's plan mentions new coordinate usage. Claude passes the factor(s) explicitly. Tool computes for all 3 phones, writes to `pixel_math{}` in cache.

Hook at Edit time: parses proposed Edit for numeric literals that match a coordinate context (line contains `screen_h *` or `screen_w *`), extracts the computed value, compares against cache. Mismatch → BLOCKED.

### Step 7 — Gemini call detection *(conditional)*
`--gemini-check`
Activated when the section file modifies a Gemini prompt string or adds a Gemini API call. Checks: do callers that parse the Gemini response have a fallback for JSON parse errors and timeouts? Sets `gemini_prompt_changed: true` in cache so forge_verify knows to include prompt-change analysis.

---

## Phase 2 — forge_predict

Executed **after implementation, before running the test**. All steps assume the Edit tool has already written the implementation files — `git diff phone-bot/` will return the changes.

```
python forge/forge_predict.py --import-check
python forge/forge_predict.py --log-signatures --section <name>
python forge/forge_predict.py --recovery-predict --section <name>
python forge/forge_predict.py --precondition-verify --section <name>
python forge/forge_predict.py --test-command --section <name>
```

All subcommands append to `.predict_cache.json`. forge_verify reads this cache for comparison.

### Step 1 — Import check
`--import-check`
Runs: `python -c "from phone_bot.actions.tiktok import TikTokBot"` (and instagram equivalent if modified). Exit code 0 → `import_check_passed: true`. Any failure → STOP, fix immediately. 2 seconds, zero phone involvement.

### Step 2 — Log signature extraction
`--log-signatures --section <name>`
Reads `forge_state.json` to get `current_section` → reads the section file to find the target file(s) → reads those files and extracts `log.info(...)` / `log.warning(...)` strings added in the current implementation (via `git diff phone-bot/`). Produces:
- `expect_pass_signature`: the log string that appears when the fix works
- `expect_fail_signature`: the log string that appears when it fails

Not Claude guessing — extracted from actual log statements in the code.

### Step 3 — Recovery prediction
`--recovery-predict --section <name>`
Reads the modified file(s) (via git diff), greps for calls to: `_return_to_fyp`, `press_back`, `nuclear_escape`, `tap_nav_home`. Lists them with context (which condition triggers them). Output: `recovery_at_risk[]` list of function names.

Used by `forge_verify --compare-predictions`: if an unexpected recovery fires (one not in `recovery_at_risk`), the failure cause analysis shifts.

### Step 4 — Precondition verify
`--precondition-verify --section <name>`
Reads `pre_condition` from section file. Takes ADB screenshot. Verifies via:
- OCR (RapidOCR or equivalent) for text-based preconditions (e.g., "New Followers" text visible) — fast, zero API cost
- Gemini Vision for visual/layout preconditions (e.g., "FYP with video content visible")

If precondition not met → STOP. Outputs exact instruction for user: "Navigate to [X] and reply ready."
Output: `precondition_met: true/false`, `precondition_description: string`.

### Step 5 — Test command validation
`--test-command --section <name>`
Reads `test_protocol.commands[]` from section forge header. Extracts `--test <mode>` value. Greps `main.py` for `elif args.test == "<mode>"`. If not found → ERROR: mode does not exist. Output: `test_command: "python phone-bot/main.py --test browse-smoke --phone 3"`.

---

## Phase 3 — forge_verify

Executed **after the test completes** (after ffmpeg frame extraction).

```
python forge/forge_verify.py --filter-logs --log <path>
python forge/forge_verify.py --gemini-analysis --video <path> --log <path>
python forge/forge_verify.py --compare-predictions
python forge/forge_verify.py --interference-check
python forge/forge_verify.py --write-emerging
```

All subcommands append to `.verify_result.json`.

### Step 1 — Log filtering
`--filter-logs --log tmp_forge_{section}_log.txt`
Filters to INFO+WARNING only, removes PIL noise. Writes `forge/.filtered_log.txt`. Subsequent steps use this file.

### Step 2 — Gemini analysis
`--gemini-analysis --video tmp_forge_{section}.mkv --log forge/.filtered_log.txt`
Uploads video via Gemini Files API + filtered logs text → Gemini 2.5 Flash + thinking (budget: 5000 tokens).

Video path convention: `tmp_forge_{section}.mkv` where `{section}` comes from `forge_state.json current_section`. forge_verify reads the state file to find this path automatically.

**Gemini output schema** (extends v1 schema, keeps all v1 fields):
```json
{
  "preliminary_verdict": "PASS",
  "confidence": 95,
  "flow_summary": "string",
  "log_video_correlation": { "quality": "excellent", "explanation": "string" },
  "events_analyzed": [
    {
      "timestamp": "00:01:23",
      "video_moment": "~83s",
      "log_entry": "string",
      "video_observation": "string",
      "correlation": "match",
      "notes": "string"
    }
  ],
  "recovery_analysis": [
    {
      "timestamp": "string",
      "reason_in_logs": "string",
      "video_confirms": true,
      "assessment": "justified"
    }
  ],
  "anomalies_detected": [
    {
      "video_timestamp": "string",
      "description": "string",
      "severity": "high",
      "category": "popup"
    }
  ],
  "suspicious_moments": [
    { "video_timestamp": "string", "frame_file": "string", "reason": "string" }
  ],
  "human_likeness": { "score": 75, "robotic_patterns": [], "human_patterns": [] },
  "recommendations": []
}
```

**Performance target** (based on validation run with 78s video, 142 log lines): ~$0.01/run, ~25s. These are targets, not guarantees — actual cost/time scales with video length and log volume.

**Model escalation**: Gemini 2.5 Flash (default) → Gemini 2.5 Pro after 1 failed attempt → always Pro for PROTECTED_CORE sections.

### Step 3 — Prediction comparison
`--compare-predictions`
Reads `.predict_cache.json` and Gemini result. Compares:
- `expect_pass_signature` → search in filtered log → found? ✓/✗
- `expect_fail_signature` → search in filtered log → found? ✓/✗
- `recovery_at_risk[]` → compare against `recovery_analysis[]` from Gemini → unexpected recovery fired? flag it

If failure cause doesn't match prediction → adds note: "predicted failure was X, actual was Y — diagnosis may be wrong."

### Step 4 — Interference detection
`--interference-check`
Reads Gemini `anomalies_detected[]`. An anomaly causes interference if:
- `category` is `popup` or `unexpected_screen` AND `severity` is `high` or `critical`
- AND it appears at a timestamp BEFORE the failure event in `events_analyzed`

If interference detected: `interference_detected: true`, `attempt_should_be_counted: false`. forge_controller is NOT called with record-fail — the attempt is replayed without counting.

If failure AND no interference: `attempt_should_be_counted: true` → call `forge_controller.py record-fail`.

### Step 5 — Emerging problems auto-write
`--write-emerging`
Reads `anomalies_detected[]` from Gemini result. For each anomaly with `severity: high` or `critical` that is NOT related to the current section's objective: appends to `emerging-problems.md` with description, video timestamp, and Gemini's exact description. Output: `new_emerging_problems[]` list.

---

## forge_state.json — relevant fields

v1 file, kept unchanged. forge_analyze, forge_predict, and forge_verify read from it.

```json
{
  "current_section": "section-07",
  "project": "06-navigation-completeness/07-bugfix-round",
  "autonomy_mode": "full",
  "pass_count": 0,
  "attempt_count": 0,
  "last_action": "idle"
}
```

`current_section` format: bare section name only (e.g., `"section-07"`), not the full path. The section file is found by combining `project` + `sections/` + `current_section` + `.md`.

Video path derived as: `tmp_forge_{current_section}.mkv` (e.g., `tmp_forge_section-07.mkv`).

---

## PostToolUse:Read Sentinel Hook

New hook added in v2: `forge/hooks/track-reads.py`

**Trigger**: PostToolUse:Read
**Action**: Appends the file path just read to `forge/.read_log.json`

```json
{
  "session_id": "2026-03-21T14:32:00",
  "files_read": [
    "phone-bot/actions/tiktok.py",
    "phone-bot/core/human.py"
  ]
}
```

`require-forge-analyze.py` reads `.read_log.json` to verify regression files were read. Session ID is reset at the start of each `/forge continue` invocation so reads from prior sessions don't falsely satisfy requirements.

---

## Key Files

```
forge/
  forge_analyze.py          — 7-subcommand CLI (Phase 1)   [NEW]
  forge_predict.py          — 5-subcommand CLI (Phase 2)   [NEW]
  forge_verify.py           — 5-subcommand CLI (Phase 3)   [NEW]
  forge_controller.py       — state machine (pass/fail)    [v1, kept]
  forge_registry.py         — completed sections registry  [v1, kept]
  forge_planner.py          — section file enricher        [v1, kept]
  forge_state.json          — current position             [v1, kept, gitignored]
  forge_registry.json       — completed sections           [v1, kept, gitignored]
  .analyze_cache.json       — Phase 1 output               [new, gitignored]
  .predict_cache.json       — Phase 2 output               [new, gitignored]
  .verify_result.json       — Phase 3 output               [new, gitignored]
  .filtered_log.txt         — filtered log for Gemini      [new, gitignored]
  hooks/
    require-forge-analyze.py  — PreToolUse:Edit            [NEW — replaces require-block-a.py]
    require-forge-predict.py  — PreToolUse:Bash (scrcpy)   [NEW — replaces require-block-p.py]
    require-forge-verify.py   — PreToolUse:Bash (record-pass) [NEW — replaces require-block-b.py]
    require-protected-core-test.py                         [v1, kept]
    require-solutions-write.py                             [v1, kept]
  tests/
    test_forge_analyze.py   [NEW]
    test_forge_predict.py   [NEW]
    test_forge_verify.py    [NEW]
    test_forge_controller.py  [v1, kept]
    test_forge_registry.py    [v1, kept]
```

---

## What Changes vs v1

| v1 | v2 |
|----|-----|
| Block A = text Claude writes | forge_analyze = 7 CLI subcommands Claude calls |
| Hook checks text patterns | Hook checks cache files (tool calls happened) |
| Pixel math invented by Claude | Pixel math computed by tool, hook checks Edit matches |
| Block P = Claude guesses signatures | forge_predict extracts signatures from actual log strings |
| Precondition = manual user check | forge_predict takes screenshot, verifies via OCR/Gemini |
| Block B = Claude describes frames | forge_verify = Gemini 2.5 Flash video+log analysis |
| Pass/fail based on Claude reading frames | Pass/fail based on Gemini structured JSON verdict |
| Emerging problems found manually | forge_verify auto-writes to emerging-problems.md |
| v1 hooks (block-a, block-p, block-b) | v1 hooks deleted, replaced by v2 hooks |
