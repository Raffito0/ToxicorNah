# Section 08: Status Polling

## Overview

Final section. Adds live session status updates to the timeline by implementing a `setTimeout`-based polling loop (30s interval) and an auto-regeneration trigger when a phone is added.

**Depends on:** Section 05 (timeline with status CSS classes), Section 07 (executor writes SessionLog), Section 04 (today-sessions API)

## Files to Modify

| File | Change |
|------|--------|
| `insta-phone-SAAS-sneder/app/static/js/weekly-plan.js` | Add `pollLoop()`, `updateSessionStatuses()`, visibility API pause |
| `insta-phone-SAAS-sneder/app/planner_routes.py` | Add `/phone-added` endpoint for auto-regeneration |

## Tests

```
# Verify: session blocks update status every 30s
# Verify: completed=green check, running=pulse blue, failed=red X
# Verify: polling uses setTimeout (not setInterval) -- no request accumulation
# Verify: polling pauses when tab hidden, resumes on visibility
# Verify: phone-added triggers regeneration and timeline refreshes
```

```python
# Test: POST /api/planner/phone-added triggers regenerate_remaining_days
# Test: POST /api/planner/phone-added returns 200 with updated plan
# Test: POST /api/planner/phone-added returns 404 if no active plan
# Test: POST /api/planner/phone-added requires @login_required
```

## Implementation Details

### 8.1 Polling Loop

Add to `weekly-plan.js`:

```javascript
let pollTimeoutId = null;

async function pollLoop() {
    try {
        const resp = await fetch(`/api/planner/today-sessions?proxy_id=${currentProxyId}`);
        const data = await resp.json();

        // Detect structural change (regeneration/day rollover)
        const currentIds = new Set([...document.querySelectorAll('[data-session-id]')].map(el => el.dataset.sessionId));
        const newIds = new Set(data.sessions.map(s => s.session_id));

        if (setsEqual(currentIds, newIds)) {
            updateSessionStatuses(data.sessions);  // lightweight DOM update
        } else {
            renderTimeline(data.sessions);  // full re-render
        }
    } catch (err) {
        console.error('Poll failed:', err);
    }
    pollTimeoutId = setTimeout(pollLoop, 30000);
}
```

### 8.2 Status Updates

`updateSessionStatuses(sessions)`:
- Find block by `data-session-id` attribute
- Compare current status class with new `execution_status`
- If changed, remove old status class, add new one
- Status classes: `.status-completed`, `.status-running`, `.status-failed`, `.status-skipped`
- Skip unchanged blocks (avoid DOM thrash)

**Requires:** Section 05's `renderTimeline()` must set `data-session-id` on each block div.

### 8.3 Visibility API (Pause When Hidden)

```javascript
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearTimeout(pollTimeoutId);
    } else {
        pollLoop();  // resume immediately
    }
});
```

### 8.4 Start Polling

In `DOMContentLoaded` handler (after `loadTodaySessions()`):
```javascript
pollLoop();
```

### 8.5 Auto-Regeneration on Phone Add

**API endpoint** (add to `planner_routes.py`):

```python
@planner_bp.route('/api/planner/phone-added', methods=['POST'])
@login_required
def phone_added():
    """Triggered after phone add. Regenerates remaining days."""
    proxy_id = request.get_json().get('proxy_id')
    result = regenerate_remaining_days(proxy_id, date.today())
    return jsonify(result), 200
```

**Frontend trigger:** In phone-add flow (Phone Settings), after success, POST to `/api/planner/phone-added` with `proxy_id`. Weekly plan page picks up changes via next poll cycle.

### 8.6 Full Re-render vs Status-Only

- **Status-only** (common): same session_ids, only execution_status changed. Use `updateSessionStatuses()`.
- **Structure change** (rare): session_id set differs. Trigger full `renderTimeline()`.

Detection: compare session_id sets between DOM and API response.

### 8.7 Error Handling

- **Network error:** Log, schedule next poll at 60s (extended). No toast (too noisy).
- **401 Unauthorized:** Redirect to login.
- **Empty response:** Valid (no sessions today). Keep timeline as-is.
- **3 consecutive failures:** Optionally show small "offline" indicator.

## Key Decisions

1. **setTimeout over setInterval** -- prevents request pile-up
2. **30-second interval** -- balance between freshness and load
3. **Visibility API pause** -- no polling when tab hidden
4. **DOM diffing by session_id set** -- avoids visual flicker on status-only updates
5. **Auto-regen as server POST** -- phone-add triggers it, weekly plan picks up via polling
