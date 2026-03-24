/**
 * intervention.js
 * Polls intervention, scrcpy, and tunnel state every 5s.
 * Updates per-bot cards, status bars, and tunnel indicator.
 */

const _state = {
  scrcpyRunning: false,
  scrcpyUrl: 'http://localhost:8000',
  tunnelRunning: false,
  tunnelUrl: null,
  pendingByBot: {},
  manualByBot: {},
};

let _pollTimer = null;

// -- Polling --

export function startPolling() {
  _poll();
  _pollTimer = setInterval(_poll, 5000);
}

async function _poll() {
  try {
    const [interventions, scrcpy, tunnel] = await Promise.all([
      fetch('/api/interventions/active').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/scrcpy/status').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('/api/tunnel/status').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);

    // Update intervention state
    const newPending = {};
    (interventions || []).forEach(i => {
      newPending[i.bot_id] = i;
    });
    _state.pendingByBot = newPending;

    // Update scrcpy state
    _state.scrcpyRunning = scrcpy.running || false;
    _state.scrcpyUrl = scrcpy.url || 'http://localhost:8000';

    // Update tunnel state
    _state.tunnelRunning = tunnel.running || false;
    _state.tunnelUrl = tunnel.url || null;

    // Update DOM
    _updateAllInterventionBars();
    _updateScrcpyIndicators();
    _updateTunnelIndicator();
  } catch (e) {
    console.warn('Intervention poll error:', e);
  }
}

// -- Intervention actions --

async function resolveIntervention(botId, resolution) {
  try {
    const resp = await fetch(`/api/interventions/${botId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    });
    if (resp.ok) {
      delete _state.pendingByBot[botId];
      _updateInterventionBar(botId, null);
    }
  } catch (e) {
    console.error('Resolve failed:', e);
  }
}

function openLiveView() {
  window.open(_state.scrcpyUrl, '_blank', 'noopener');
}

async function startTunnel() {
  try {
    const resp = await fetch('/api/tunnel/start', { method: 'POST' });
    if (resp.ok) {
      _poll();
    }
  } catch (e) {
    console.error('Start tunnel failed:', e);
  }
}

async function stopTunnel() {
  try {
    const resp = await fetch('/api/tunnel/stop', { method: 'POST' });
    if (resp.ok) {
      _state.tunnelRunning = false;
      _state.tunnelUrl = null;
      _updateTunnelIndicator();
    }
  } catch (e) {
    console.error('Stop tunnel failed:', e);
  }
}

// -- DOM helpers --

function _updateAllInterventionBars() {
  document.querySelectorAll('.intervention-bar').forEach(bar => {
    const botId = bar.dataset.botId;
    const pending = _state.pendingByBot[botId] || null;
    _updateInterventionBar(botId, pending);
  });
}

function _updateInterventionBar(botId, pending) {
  const bar = document.getElementById(`intervention-bar-${botId}`);
  if (!bar) return;
  if (pending) {
    bar.style.display = 'flex';
    const ageEl = bar.querySelector('.intervention-age');
    if (ageEl && pending.requested_at) {
      ageEl.textContent = _relativeTime(pending.requested_at);
    }
  } else {
    bar.style.display = 'none';
  }
}

function _updateScrcpyIndicators() {
  document.querySelectorAll('.scrcpy-dot').forEach(dot => {
    dot.style.display = _state.scrcpyRunning ? 'inline' : 'none';
  });
}

function _updateTunnelIndicator() {
  const startBar = document.getElementById('tunnel-start-bar');
  const urlBar = document.getElementById('tunnel-url-bar');
  const urlLink = document.getElementById('tunnel-url-link');
  const dot = document.querySelector('.tunnel-dot');

  if (_state.tunnelRunning && _state.tunnelUrl) {
    if (startBar) startBar.style.display = 'none';
    if (urlBar) urlBar.style.display = 'flex';
    if (urlLink) {
      urlLink.href = _state.tunnelUrl;
      urlLink.textContent = _state.tunnelUrl.replace('https://', '').slice(0, 25) + '...';
    }
    if (dot) dot.style.display = 'inline';
  } else {
    if (startBar) startBar.style.display = 'block';
    if (urlBar) urlBar.style.display = 'none';
    if (dot) dot.style.display = 'none';
  }
}

function _relativeTime(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

// -- Event wiring --

export function wireEvents() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    if (target.classList.contains('intervention-approve')) {
      resolveIntervention(target.dataset.botId, 'approve');
    } else if (target.classList.contains('intervention-skip')) {
      resolveIntervention(target.dataset.botId, 'skip');
    } else if (target.classList.contains('live-view-btn')) {
      openLiveView();
    } else if (target.id === 'tunnel-start-btn') {
      startTunnel();
    } else if (target.id === 'tunnel-stop-btn') {
      stopTunnel();
    }
  });

  // Notify toggle change handlers
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('notify-toggle')) {
      const accountId = e.target.dataset.accountId;
      const checked = e.target.checked;
      fetch(`/api/bot-accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify_before_post: checked }),
      }).catch(() => {
        e.target.checked = !checked; // revert on error
      });
    }
  });
}
