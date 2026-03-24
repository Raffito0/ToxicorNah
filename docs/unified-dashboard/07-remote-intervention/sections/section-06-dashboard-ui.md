# Section 06 -- Dashboard UI: Intervention Controls

## Overview

This section adds remote-intervention UI to the existing Flask dashboard (`app/templates/after-login.html` and a new `app/static/js/intervention.js`). It is purely frontend -- no new Python modules are created here. All data comes from REST endpoints built in earlier sections.

**Dependencies (must be complete before this section):**

- **Section 03** (`app/intervention_routes.py`) -- provides `GET /api/interventions/active`, `GET /api/interventions/<bot_id>/history`, `POST /api/interventions/<bot_id>/resolve`
- **Section 04** (`app/scrcpy_routes.py`) -- provides `GET /api/scrcpy/status`, `POST /api/scrcpy/start`, `POST /api/scrcpy/stop`
- **Section 05** (`app/tunnel_routes.py`) -- provides `GET /api/tunnel/status`, `POST /api/tunnel/start`, `POST /api/tunnel/stop`

This section does NOT implement those routes -- it consumes them.

---

## Test Plan

Frontend sections are verified visually (no pytest). The full checklist is:

```
# Visual: "Live View" button is present on every bot card
# Visual: "Live View" button opens ws-scrcpy URL (localhost:8000) in a new browser tab
# Visual: Green dot appears on "Live View" button when scrcpy server is running
# Visual: No green dot (or grey dot) when scrcpy server is stopped
# Visual: "Take Over" button is present on every bot card while bot is running
# Visual: Clicking "Take Over" POSTs to /api/interventions/{bot_id}/takeover
# Visual: "Manual Control" badge appears on the card after Take Over succeeds
# Visual: "Release" button replaces "Take Over" button while manual control is active
# Visual: Clicking "Release" POSTs to /api/interventions/{bot_id}/resume
# Visual: "Manual Control" badge disappears after Release
# Visual: Intervention status bar appears at top of phone card when bot is in "paused" state
# Visual: Status bar shows message "Paused -- Awaiting post approval (Xm ago)"
# Visual: Status bar has "Approve" and "Skip" buttons
# Visual: Clicking "Approve" POSTs to /api/interventions/{bot_id}/resolve with body {"resolution":"approve"}
# Visual: Clicking "Skip" POSTs to /api/interventions/{bot_id}/resolve with body {"resolution":"skip"}
# Visual: Status bar disappears after resolution
# Visual: Settings panel has per-account "Notify before posting" toggle
# Visual: Toggle state reflects account.notify_before_post from server
# Visual: Toggling calls PATCH /api/bot-accounts/{account_id} with notify_before_post
# Visual: Note "Warmup first post always requires approval (cannot be disabled)" appears below toggle
# Visual: Tunnel status indicator appears in the sidebar or header area
# Visual: Tunnel indicator shows green dot + truncated URL when tunnel is running
# Visual: Tunnel indicator shows "Start Tunnel" button when tunnel is stopped
# Visual: Clicking "Start Tunnel" POSTs to /api/tunnel/start
# Visual: After tunnel starts, indicator updates to show URL
```

---

## What to Build

### 1. Files to Modify / Create

| File | Action |
|------|--------|
| `app/templates/after-login.html` | MODIFY -- add UI blocks described below |
| `app/static/js/intervention.js` | CREATE -- new JS module for intervention polling and actions |

---

### 2. Intervention Status Bar (per bot card)

The bot cards are rendered inside `#bots-table-body` by existing JS (see `tiktok_status.js`). When the bot status polling detects an active intervention (state = `"paused"`), a status bar must be shown above (or within) the card.

The status bar is a collapsible `<div>` that is hidden by default and shown when polling detects a pending intervention:

```html
<!-- Template fragment -- inject once per bot card row in bots-table-body -->
<div class="intervention-bar" id="intervention-bar-{bot_id}" style="display:none;">
  <span class="intervention-msg">Paused -- Awaiting post approval (<span class="intervention-age"></span>)</span>
  <div class="intervention-actions">
    <button class="btn btn-sm btn-success intervention-approve" data-bot-id="{bot_id}">Approve</button>
    <button class="btn btn-sm btn-warning intervention-skip" data-bot-id="{bot_id}">Skip</button>
  </div>
</div>
```

The age counter (`Xm ago`) is computed client-side from the `requested_at` timestamp returned by `GET /api/interventions/active`. It is updated on each poll cycle.

---

### 3. Per-Card Action Buttons

Each bot card row (inside `#bots-table-body`) needs two new action buttons appended alongside the existing Run/Stop controls:

**Live View button:**
```html
<button class="btn btn-sm btn-outline-info live-view-btn"
        data-bot-id="{bot_id}"
        title="Live phone view">
  <i class="fas fa-eye"></i>
  <span class="scrcpy-dot" style="display:none;">&#9679;</span>
</button>
```

- Opens `http://localhost:8000` in new tab via `window.open(url, '_blank')`
- The `.scrcpy-dot` is styled green (`color: #22C55E`) and shown/hidden based on `GET /api/scrcpy/status` response

**Take Over / Release button (toggles):**
```html
<!-- Default state: Take Over -->
<button class="btn btn-sm btn-outline-danger takeover-btn"
        data-bot-id="{bot_id}">
  Take Over
</button>

<!-- Active state: Release (hidden by default, shown when manual_control=true) -->
<button class="btn btn-sm btn-outline-secondary release-btn"
        data-bot-id="{bot_id}"
        style="display:none;">
  Release
</button>
```

A `<span class="badge bg-danger manual-badge" style="display:none;">Manual Control</span>` is placed next to the phone name cell. It is shown whenever `manual_control=true` in the bot's status response.

---

### 4. Settings Panel -- Notify Before Posting Toggle

The existing settings panel needs an additional section. Append before the closing of the settings panel content:

```html
<div class="setting-row">
  <div class="setting-label">
    <span>Notify before posting</span>
    <small class="text-muted d-block">
      Warmup first post always requires approval (cannot be disabled)
    </small>
  </div>
  <div class="setting-control">
    <!-- Per account, rendered for each BotAccount under this Bot -->
    <div class="account-notify-row" data-account-id="{account_id}">
      <label class="text-muted small">{account_username}</label>
      <div class="form-check form-switch">
        <input class="form-check-input notify-toggle"
               type="checkbox"
               data-account-id="{account_id}"
               {checked_attr}>
      </div>
    </div>
  </div>
</div>
```

The toggle is rendered for each `BotAccount` associated with the bot. The `checked_attr` is set based on `account.notify_before_post`.

---

### 5. Tunnel Status Indicator (Sidebar)

Add a dedicated sidebar entry:

```html
<div class="sidebar-icon" id="tunnel-status-icon" title="Remote Tunnel" data-tab="">
  <i class="fas fa-globe" id="tunnel-icon-globe"></i>
  <span class="tunnel-dot" style="display:none;">&#9679;</span>
</div>
```

When tunnel is running, show the URL:

```html
<div id="tunnel-url-bar" style="display:none;">
  <small>
    <a href="#" id="tunnel-url-link" target="_blank" rel="noopener"></a>
  </small>
  <button class="btn btn-xs btn-outline-danger" id="tunnel-stop-btn">Stop</button>
</div>
```

When tunnel is stopped, show a start button:

```html
<div id="tunnel-start-bar">
  <button class="btn btn-xs btn-outline-success" id="tunnel-start-btn">Start Tunnel</button>
</div>
```

---

### 6. `app/static/js/intervention.js` -- New Module

Create `app/static/js/intervention.js`. This module:

- Polls three endpoints on a 5-second interval: `GET /api/interventions/active`, `GET /api/scrcpy/status`, `GET /api/tunnel/status`
- Updates the DOM based on polling results
- Handles click events for all intervention buttons

**Module structure (stubs):**

```js
/**
 * intervention.js
 * Polls intervention, scrcpy, and tunnel state every 5s.
 * Updates per-bot cards, status bars, and tunnel indicator.
 */

// -- State --
const _state = {
  scrcpyRunning: false,
  scrcpyUrl: 'http://localhost:8000',
  tunnelRunning: false,
  tunnelUrl: null,
  pendingByBot: {},     // { [bot_id]: { intervention_id, requested_at } }
  manualByBot: {},      // { [bot_id]: true/false }
};

// -- Polling --

/** Start 5s polling cycle. Call once from DOMContentLoaded. */
export function startPolling() { /* ... */ }

/** Fetch all three endpoints in parallel, update _state. */
async function _poll() { /* ... */ }

// -- Intervention actions --

/**
 * Resolve a pending intervention.
 * @param {number} botId
 * @param {'approve'|'skip'} resolution
 */
async function resolveIntervention(botId, resolution) {
  // POST /api/interventions/{botId}/resolve
  // body: { resolution }
  // On success: hide intervention bar for this bot
}

async function takeover(botId) {
  // POST /api/interventions/{botId}/takeover
  // On success: show Manual Control badge, show Release button, hide Take Over button
}

async function release(botId) {
  // POST /api/interventions/{botId}/resume
  // On success: hide Manual Control badge, show Take Over button, hide Release button
}

// -- scrcpy actions --

function openLiveView() {
  window.open(_state.scrcpyUrl, '_blank', 'noopener');
}

// -- Tunnel actions --

async function startTunnel() { /* POST /api/tunnel/start, update indicator on success */ }
async function stopTunnel()  { /* POST /api/tunnel/stop, update indicator on success */ }

// -- DOM helpers --

function _updateInterventionBar(botId, pending) { /* ... */ }
function _updateTakeoverControls(botId, isManual) { /* ... */ }
function _updateScrcpyIndicators() { /* ... */ }
function _updateTunnelIndicator() { /* ... */ }

/** Format a past ISO timestamp as "Xm ago" or "Xs ago". */
function _relativeTime(isoStr) { /* ... */ }

// -- Event wiring --
export function wireEvents() {
  // Attach click handlers to:
  //   .intervention-approve  -> resolveIntervention(botId, 'approve')
  //   .intervention-skip     -> resolveIntervention(botId, 'skip')
  //   .takeover-btn          -> takeover(botId)
  //   .release-btn           -> release(botId)
  //   .live-view-btn         -> openLiveView()
  //   #tunnel-start-btn      -> startTunnel()
  //   #tunnel-stop-btn       -> stopTunnel()
  //   .notify-toggle         -> PATCH /api/bot-accounts/{accountId} with notify_before_post
}
```

**Polling detail -- what each poll cycle does:**

1. `GET /api/interventions/active` -- returns list of `{ intervention_id, bot_id, intervention_type, requested_at }`. For each entry, call `_updateInterventionBar(bot_id, entry)`. For bots NOT in the list, call `_updateInterventionBar(bot_id, null)` to hide the bar.

2. `GET /api/scrcpy/status` -- returns `{ running: bool, url: string }`. Update `_state.scrcpyRunning` and `_state.scrcpyUrl`, then call `_updateScrcpyIndicators()`.

3. `GET /api/tunnel/status` -- returns `{ running: bool, url: string|null }`. Update `_state.tunnelRunning` and `_state.tunnelUrl`, then call `_updateTunnelIndicator()`.

All three fetches happen with `Promise.all([...])` to avoid serial blocking. Errors in any single fetch are caught and logged without stopping the others.

---

### 7. `after-login.html` Integration

At the bottom of `after-login.html`, before the closing `</body>` tag, add the script tag:

```html
<script type="module" src="{{ url_for('static', filename='js/intervention.js') }}"></script>
```

Also add inline initialization in the existing DOMContentLoaded handler:

```js
import { startPolling, wireEvents } from '/static/js/intervention.js';

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  startPolling();
});
```

If `after-login.html` already has a module-type script block, add the two calls inside that block rather than creating a second `DOMContentLoaded` listener.

---

### 8. CSS Additions

Add to `app/static/css/after_login_styles.css`:

```css
/* Intervention status bar */
.intervention-bar {
  background: rgba(234, 179, 8, 0.15);
  border-left: 3px solid #EAB308;
  padding: 8px 12px;
  margin-bottom: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.intervention-msg { font-size: 0.875rem; color: #FDE047; }
.intervention-actions { display: flex; gap: 6px; }

/* Manual Control badge */
.manual-badge {
  font-size: 0.7rem;
  vertical-align: middle;
  margin-left: 6px;
}

/* scrcpy dot indicator on Live View button */
.scrcpy-dot { color: #22C55E; font-size: 0.5rem; vertical-align: super; margin-left: 2px; }

/* Tunnel indicator in sidebar area */
.tunnel-dot { color: #22C55E; font-size: 0.5rem; }
#tunnel-url-bar {
  font-size: 0.7rem;
  padding: 4px 8px;
  background: #1a1a2e;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
#tunnel-url-link {
  color: #60A5FA;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 120px;
}
```

---

## Key Implementation Notes

**Polling reuse.** The existing `TikTokStatusPoller` in `tiktok_status.js` already polls `/api/bots/{id}/status` every 5 seconds. If `control_status === 'paused'` or a `manual_control` flag is available in that response, `intervention.js` can piggyback on that signal rather than making a redundant call to `/api/interventions/active`. Coordinate with Section 03 to confirm whether the bot status endpoint already includes intervention state, or whether a separate poll to `/api/interventions/active` is needed.

**ws-scrcpy port.** The Live View button always opens the URL returned by `GET /api/scrcpy/status` as the `url` field -- read it from there rather than hardcoding `localhost:8000`, to allow the port to be configured in one place (Section 04's `ScrcpyManager`).

**Takeover is session-abort, not pause.** The "Take Over" action sends a stop signal to the running worker and resolves the pending intervention as "skip". After clicking "Release", the user must start a new session from the dashboard. The "Release" button tooltip should say "Resume scheduling (current session was ended)".

**Security note on Live View.** The Live View button opens `http://localhost:8000` directly -- this only works when the user's browser is on the same machine as the PC running ws-scrcpy. When accessing the dashboard remotely via the Cloudflare tunnel, `localhost:8000` will not resolve on the remote machine. Flag this as a known limitation in the UI with a tooltip: "Live View only available on local network".

**notify_before_post toggle PATCH.** The API endpoint `PATCH /api/bot-accounts/{account_id}` must accept `{ notify_before_post: bool }`. The toggle should optimistically update its checked state and revert on error.
