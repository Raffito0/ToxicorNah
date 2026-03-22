/**
 * Live Monitor — real-time session state with Chart.js gauges + event feed.
 *
 * Uses JsonPoller for 5s polling with visibilitychange pause.
 * Displays 3 doughnut gauges (boredom/fatigue/energy), phase bar,
 * mood pills, elapsed timer, and smart-scroll event feed.
 */

// ── Event type colors ──────────────────────────────────────
const EVENT_COLORS = {
    like:    '#22C55E',
    scroll:  '#6B7280',
    follow:  '#3B82F6',
    comment: '#8B5CF6',
    popup:   '#F59E0B',
    search:  '#EAB308',
    error:   '#EF4444',
};

// ── JsonPoller ─────────────────────────────────────────────
class JsonPoller {
    constructor(url, intervalMs, onData, onError) {
        this.url = url;
        this.intervalMs = intervalMs;
        this.onData = onData;
        this.onError = onError;
        this._interval = null;
        this._controller = null;

        this._onVisibility = () => {
            if (document.hidden) {
                this.stop();
            } else {
                this._fetchOnce();
                this.start();
            }
        };
        document.addEventListener('visibilitychange', this._onVisibility);
    }

    start() {
        if (this._interval) return;
        this._interval = setInterval(() => this._fetchOnce(), this.intervalMs);
    }

    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._controller) {
            this._controller.abort();
            this._controller = null;
        }
    }

    destroy() {
        this.stop();
        document.removeEventListener('visibilitychange', this._onVisibility);
    }

    async _fetchOnce() {
        if (this._controller) this._controller.abort();
        this._controller = new AbortController();
        try {
            const res = await fetch(this.url, { signal: this._controller.signal });
            if (!res.ok) {
                this.onError({ status: res.status });
                return;
            }
            const data = await res.json();
            this.onData(data);
        } catch (err) {
            if (err.name !== 'AbortError') {
                this.onError(err);
            }
        }
    }
}


// ── Chart.js center text plugin (local) ────────────────────
const centerTextPlugin = {
    id: 'liveGaugeCenterText',
    afterDraw(chart) {
        const meta = chart._liveGaugeMeta;
        if (!meta) return;
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Value
        ctx.font = 'bold 22px sans-serif';
        ctx.fillStyle = meta.color;
        ctx.fillText(meta.display, cx, cy - 6);

        // Label
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#9CA3AF';
        ctx.fillText(meta.label, cx, cy + 14);

        ctx.restore();
    }
};


// ── LiveMonitor ────────────────────────────────────────────
class LiveMonitor {
    constructor() {
        this._card = document.getElementById('liveMonitorCard');
        if (!this._card) return;

        this._elapsedEl = document.getElementById('liveElapsed');
        this._staleEl = document.getElementById('liveStaleIndicator');
        this._phaseNameEl = document.getElementById('livePhaseText');
        this._phaseTimeEl = document.getElementById('livePhaseTime');
        this._moodPillsEl = document.getElementById('liveMoodPills');
        this._feedEl = document.getElementById('liveEventFeed');
        this._accountEl = document.getElementById('liveAccountName');

        this._gauges = {};
        this._poller = null;
        this._tickInterval = null;
        this._elapsedSeconds = 0;
        this._lastEventTs = null;  // track by timestamp, not count (deque evicts old)
        this._activeBotId = null;
        this._retryTimeout = null;
        this._startedAt = null;    // ISO string from backend

        this._initGauges();
        this._checkForActiveSession();
    }

    // ── Init ───────────────────────────────────────────────
    _initGauges() {
        const configs = [
            { id: 'gaugeBoredom',  label: 'Boredom', color: '#F59E0B' },
            { id: 'gaugeFatigue',  label: 'Fatigue', color: '#EF4444' },
            { id: 'gaugeEnergy',   label: 'Energy',  color: '#22C55E' },
        ];
        configs.forEach(cfg => {
            const canvas = document.getElementById(cfg.id);
            if (!canvas) return;
            const chart = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data: [0, 1],
                        backgroundColor: [cfg.color, 'rgba(255,255,255,0.06)'],
                        borderWidth: 0,
                    }]
                },
                options: {
                    cutout: '78%',
                    rotation: -90,
                    circumference: 360,
                    responsive: false,
                    plugins: { tooltip: { enabled: false }, legend: { display: false } },
                    animation: false,
                },
                plugins: [centerTextPlugin],
            });
            chart._liveGaugeMeta = { color: cfg.color, display: '0%', label: cfg.label };
            this._gauges[cfg.id] = chart;
        });
    }

    async _checkForActiveSession() {
        try {
            const res = await fetch('/get_user_bots');
            if (!res.ok) return;
            const data = await res.json();
            const bots = data.bots || [];

            for (const bot of bots) {
                try {
                    const r = await fetch(`/api/bots/${bot.id}/live-state`);
                    if (r.ok) {
                        this._activeBotId = bot.id;
                        const state = await r.json();
                        this._show();
                        this._handleStateUpdate(state);
                        this._startPolling(bot.id);
                        return;
                    }
                } catch (_) { /* next bot */ }
            }
            // No active session found — retry in 30s
            this._scheduleRetry(30000);
        } catch (_) {
            this._scheduleRetry(30000);
        }
    }

    _startPolling(botId) {
        if (this._poller) this._poller.destroy();
        this._poller = new JsonPoller(
            `/api/bots/${botId}/live-state`,
            5000,
            (state) => this._handleStateUpdate(state),
            (err) => this._handleError(err),
        );
        this._poller.start();
        this._startTicker();
    }

    // ── Show / Hide ────────────────────────────────────────
    _show() {
        if (this._card) this._card.style.display = 'block';
    }

    _hide() {
        if (this._card) this._card.style.display = 'none';
        if (this._poller) { this._poller.destroy(); this._poller = null; }
        this._stopTicker();
        this._activeBotId = null;
        this._lastEventTs = null;
        this._startedAt = null;
        // Re-check after hiding
        this._scheduleRetry(15000);
    }

    _scheduleRetry(ms) {
        if (this._retryTimeout) clearTimeout(this._retryTimeout);
        this._retryTimeout = setTimeout(() => {
            this._retryTimeout = null;
            this._checkForActiveSession();
        }, ms);
    }

    // ── State Update ───────────────────────────────────────
    _handleStateUpdate(state) {
        // Hide stale indicator on good data
        if (this._staleEl) this._staleEl.style.display = 'none';

        // Account name
        if (this._accountEl && state.account) {
            this._accountEl.textContent = '- ' + state.account;
        }

        // Gauges
        this._updateGauge('gaugeBoredom', state.boredom || 0);
        this._updateGauge('gaugeFatigue', state.fatigue || 0);
        this._updateGauge('gaugeEnergy',  state.energy  || 0);

        // Elapsed — compute from started_at (backend doesn't update mid-session)
        if (state.started_at) {
            this._startedAt = state.started_at;
            this._elapsedSeconds = Math.floor((Date.now() - new Date(state.started_at).getTime()) / 1000);
            this._renderElapsed();
        }

        // Phase bar
        if (this._phaseNameEl) {
            this._phaseNameEl.textContent = state.phase || 'Unknown';
            this._phaseNameEl.style.color = this._phaseColor(state.phase);
        }
        if (this._phaseTimeEl && state.phase_elapsed != null) {
            this._phaseTimeEl.textContent = this._fmtTime(state.phase_elapsed);
        }

        // Mood pills
        this._renderMoodPills(state.mood || {});

        // Events
        this._renderEvents(state.recent_events || []);
    }

    _handleError(err) {
        if (err && err.status === 404) {
            this._hide();
        } else {
            // Network error — show stale
            if (this._staleEl) this._staleEl.style.display = 'inline';
        }
    }

    // ── Gauge helpers ──────────────────────────────────────
    _updateGauge(id, value) {
        const chart = this._gauges[id];
        if (!chart) return;
        const v = Math.max(0, Math.min(1, value));
        chart.data.datasets[0].data = [v, 1 - v];
        chart._liveGaugeMeta.display = Math.round(v * 100) + '%';
        chart.update('none');
    }

    // ── Phase color ────────────────────────────────────────
    _phaseColor(phase) {
        const p = (phase || '').toLowerCase();
        // Worker lifecycle phases
        if (p === 'starting')  return '#3B82F6';
        if (p === 'running')   return '#22C55E';
        if (p === 'completed') return '#6B7280';
        if (p === 'error')     return '#EF4444';
        // Session behavioral phases
        if (p === 'arrival')   return '#3B82F6';
        if (p === 'warmup')    return '#F59E0B';
        if (p === 'peak')      return '#22C55E';
        if (p === 'fatigue')   return '#EF4444';
        if (p === 'exit')      return '#6B7280';
        return '#e5e5e5';
    }

    // ── Mood pills ─────────────────────────────────────────
    _renderMoodPills(mood) {
        if (!this._moodPillsEl) return;
        const pills = [];
        const keys = [
            { key: 'energy_mult',   label: 'Energy' },
            { key: 'social_mult',   label: 'Social' },
            { key: 'patience_mult', label: 'Patience' },
        ];
        keys.forEach(({ key, label }) => {
            const val = mood[key];
            if (val != null && Math.abs(val - 1.0) > 0.05) {
                pills.push(`<span class="live-mood-pill">${label} x${val.toFixed(1)}</span>`);
            }
        });
        this._moodPillsEl.innerHTML = pills.join('');
    }

    // ── Event feed (smart scroll) ──────────────────────────
    _renderEvents(events) {
        if (!this._feedEl) return;
        if (!events.length) {
            if (!this._feedEl.children.length) {
                this._feedEl.innerHTML = '<div class="live-event-empty">Waiting for events...</div>';
            }
            return;
        }

        // Find new events by comparing timestamps (deque evicts old, so count is unreliable)
        let newEvents;
        if (this._lastEventTs) {
            const idx = events.findIndex(ev => ev.ts === this._lastEventTs);
            if (idx === -1) {
                // Last seen event was evicted — full re-render
                this._feedEl.innerHTML = '';
                newEvents = events;
            } else {
                newEvents = events.slice(idx + 1);
            }
        } else {
            newEvents = events;
        }

        if (!newEvents.length) return;

        // Check if at bottom before appending
        const isAtBottom = this._feedEl.scrollHeight - this._feedEl.scrollTop - this._feedEl.clientHeight < 20;

        // Clear empty message
        const emptyEl = this._feedEl.querySelector('.live-event-empty');
        if (emptyEl) emptyEl.remove();

        newEvents.forEach(ev => {
            const div = document.createElement('div');
            div.className = 'live-event-line';
            const color = EVENT_COLORS[ev.type] || '#9CA3AF';
            const time = ev.ts ? ev.ts.split('T')[1]?.substring(0, 8) || '' : '';
            div.innerHTML = `<span class="live-event-time">${time}</span><span style="color:${color}">[${ev.type}]</span> ${this._escapeHtml(ev.detail || '')}`;
            this._feedEl.appendChild(div);
        });

        // Track last event timestamp
        this._lastEventTs = events[events.length - 1].ts;

        if (isAtBottom) {
            this._feedEl.scrollTop = this._feedEl.scrollHeight;
        }
    }

    // ── Elapsed timer (smooth local tick) ──────────────────
    _startTicker() {
        if (this._tickInterval) return;
        this._tickInterval = setInterval(() => {
            this._elapsedSeconds++;
            this._renderElapsed();
        }, 1000);
    }

    _stopTicker() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    _renderElapsed() {
        if (!this._elapsedEl) return;
        this._elapsedEl.textContent = this._fmtTime(this._elapsedSeconds);
    }

    // ── Formatting helpers ─────────────────────────────────
    _fmtTime(seconds) {
        const s = seconds || 0;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(sec).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}


// ── Auto-init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.liveMonitor = new LiveMonitor();
});
