diff --git a/insta-phone-SAAS-sneder/app/static/css/live-monitor.css b/insta-phone-SAAS-sneder/app/static/css/live-monitor.css
new file mode 100644
index 0000000..16f414f
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/static/css/live-monitor.css
@@ -0,0 +1,198 @@
+/* ── Live Monitor Card ───────────────────────────────────── */
+
+.live-monitor-row {
+    margin-bottom: 20px;
+}
+
+.live-monitor-card {
+    background: #1e1e1e;
+    border-radius: 12px;
+    padding: 16px;
+    display: none; /* hidden by default, shown via JS */
+}
+
+.live-monitor-header {
+    display: flex;
+    align-items: center;
+    gap: 10px;
+    margin-bottom: 14px;
+}
+
+.live-monitor-header h3 {
+    margin: 0;
+    font-size: 16px;
+    color: var(--text-primary, #e5e5e5);
+}
+
+.live-dot {
+    width: 8px;
+    height: 8px;
+    background: #22C55E;
+    border-radius: 50%;
+    animation: livePulse 2s ease-in-out infinite;
+}
+
+@keyframes livePulse {
+    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
+    50%       { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34,197,94,0); }
+}
+
+.live-monitor-elapsed {
+    margin-left: auto;
+    font-size: 14px;
+    font-family: 'Courier New', monospace;
+    color: var(--text-secondary, #a0a0a0);
+}
+
+.live-stale-indicator {
+    font-size: 11px;
+    color: #F59E0B;
+    margin-left: 8px;
+    display: none;
+}
+
+/* ── Body: 3-column layout ─────────────────────────────── */
+
+.live-monitor-body {
+    display: flex;
+    flex-direction: row;
+    gap: 16px;
+}
+
+.live-monitor-left {
+    flex: 1;
+    display: flex;
+    flex-direction: column;
+    gap: 10px;
+}
+
+.live-monitor-center {
+    display: flex;
+    gap: 16px;
+    align-items: center;
+}
+
+.live-monitor-right {
+    flex: 1;
+    display: flex;
+    flex-direction: column;
+}
+
+/* ── Gauges ────────────────────────────────────────────── */
+
+.live-gauge-wrapper {
+    display: flex;
+    flex-direction: column;
+    align-items: center;
+    gap: 4px;
+}
+
+.live-gauge-wrapper canvas {
+    width: 120px;
+    height: 120px;
+}
+
+.live-gauge-label {
+    font-size: 11px;
+    color: var(--text-secondary, #a0a0a0);
+    text-transform: uppercase;
+    letter-spacing: 0.5px;
+}
+
+/* ── Phase Bar ─────────────────────────────────────────── */
+
+.live-phase-bar {
+    display: flex;
+    align-items: center;
+    gap: 8px;
+    padding: 8px 12px;
+    border-radius: 8px;
+    background: rgba(255,255,255,0.05);
+}
+
+.live-phase-name {
+    font-size: 13px;
+    font-weight: 600;
+    color: var(--text-primary, #e5e5e5);
+}
+
+.live-phase-time {
+    font-size: 12px;
+    font-family: 'Courier New', monospace;
+    color: var(--text-secondary, #a0a0a0);
+    margin-left: auto;
+}
+
+/* ── Mood Pills ────────────────────────────────────────── */
+
+.live-mood-pills {
+    display: flex;
+    flex-wrap: wrap;
+    gap: 6px;
+}
+
+.live-mood-pill {
+    font-size: 11px;
+    padding: 3px 8px;
+    border-radius: 12px;
+    background: rgba(255,255,255,0.08);
+    color: var(--text-secondary, #a0a0a0);
+}
+
+/* ── Event Feed ────────────────────────────────────────── */
+
+.live-event-feed {
+    max-height: 200px;
+    overflow-y: auto;
+    font-size: 12px;
+    font-family: 'Courier New', monospace;
+    line-height: 1.6;
+    padding-right: 4px;
+}
+
+/* thin scrollbar */
+.live-event-feed::-webkit-scrollbar {
+    width: 4px;
+}
+.live-event-feed::-webkit-scrollbar-track {
+    background: transparent;
+}
+.live-event-feed::-webkit-scrollbar-thumb {
+    background: rgba(255,255,255,0.15);
+    border-radius: 2px;
+}
+
+.live-event-line {
+    white-space: nowrap;
+    overflow: hidden;
+    text-overflow: ellipsis;
+}
+
+.live-event-time {
+    color: #6B7280;
+    margin-right: 6px;
+}
+
+.live-event-empty {
+    color: var(--text-muted, #666);
+    font-style: italic;
+    text-align: center;
+    padding: 20px 0;
+}
+
+/* ── Responsive ────────────────────────────────────────── */
+
+@media (max-width: 1200px) {
+    .live-monitor-body {
+        flex-direction: column;
+    }
+    .live-monitor-center {
+        justify-content: center;
+    }
+}
+
+@media (max-width: 768px) {
+    .live-monitor-center {
+        flex-wrap: wrap;
+    }
+}
diff --git a/insta-phone-SAAS-sneder/app/static/js/live-monitor.js b/insta-phone-SAAS-sneder/app/static/js/live-monitor.js
new file mode 100644
index 0000000..324d631
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/static/js/live-monitor.js
@@ -0,0 +1,383 @@
+/**
+ * Live Monitor — real-time session state with Chart.js gauges + event feed.
+ *
+ * Uses JsonPoller for 5s polling with visibilitychange pause.
+ * Displays 3 doughnut gauges (boredom/fatigue/energy), phase bar,
+ * mood pills, elapsed timer, and smart-scroll event feed.
+ */
+
+// ── Event type colors ──────────────────────────────────────
+const EVENT_COLORS = {
+    like:    '#22C55E',
+    scroll:  '#6B7280',
+    follow:  '#3B82F6',
+    comment: '#8B5CF6',
+    popup:   '#F59E0B',
+    search:  '#EAB308',
+    error:   '#EF4444',
+};
+
+// ── JsonPoller ─────────────────────────────────────────────
+class JsonPoller {
+    constructor(url, intervalMs, onData, onError) {
+        this.url = url;
+        this.intervalMs = intervalMs;
+        this.onData = onData;
+        this.onError = onError;
+        this._interval = null;
+        this._controller = null;
+
+        this._onVisibility = () => {
+            if (document.hidden) {
+                this.stop();
+            } else {
+                this._fetchOnce();
+                this.start();
+            }
+        };
+        document.addEventListener('visibilitychange', this._onVisibility);
+    }
+
+    start() {
+        if (this._interval) return;
+        this._interval = setInterval(() => this._fetchOnce(), this.intervalMs);
+    }
+
+    stop() {
+        if (this._interval) {
+            clearInterval(this._interval);
+            this._interval = null;
+        }
+        if (this._controller) {
+            this._controller.abort();
+            this._controller = null;
+        }
+    }
+
+    destroy() {
+        this.stop();
+        document.removeEventListener('visibilitychange', this._onVisibility);
+    }
+
+    async _fetchOnce() {
+        if (this._controller) this._controller.abort();
+        this._controller = new AbortController();
+        try {
+            const res = await fetch(this.url, { signal: this._controller.signal });
+            if (!res.ok) {
+                this.onError({ status: res.status });
+                return;
+            }
+            const data = await res.json();
+            this.onData(data);
+        } catch (err) {
+            if (err.name !== 'AbortError') {
+                this.onError(err);
+            }
+        }
+    }
+}
+
+
+// ── Chart.js center text plugin (local) ────────────────────
+const centerTextPlugin = {
+    id: 'liveGaugeCenterText',
+    afterDraw(chart) {
+        const meta = chart._liveGaugeMeta;
+        if (!meta) return;
+        const { ctx, chartArea: { left, right, top, bottom } } = chart;
+        const cx = (left + right) / 2;
+        const cy = (top + bottom) / 2;
+
+        ctx.save();
+        ctx.textAlign = 'center';
+        ctx.textBaseline = 'middle';
+
+        // Value
+        ctx.font = 'bold 22px sans-serif';
+        ctx.fillStyle = meta.color;
+        ctx.fillText(meta.display, cx, cy - 6);
+
+        // Label
+        ctx.font = '10px sans-serif';
+        ctx.fillStyle = '#9CA3AF';
+        ctx.fillText(meta.label, cx, cy + 14);
+
+        ctx.restore();
+    }
+};
+
+
+// ── LiveMonitor ────────────────────────────────────────────
+class LiveMonitor {
+    constructor() {
+        this._card = document.getElementById('liveMonitorCard');
+        if (!this._card) return;
+
+        this._elapsedEl = document.getElementById('liveElapsed');
+        this._staleEl = document.getElementById('liveStaleIndicator');
+        this._phaseNameEl = document.getElementById('livePhaseText');
+        this._phaseTimeEl = document.getElementById('livePhaseTime');
+        this._moodPillsEl = document.getElementById('liveMoodPills');
+        this._feedEl = document.getElementById('liveEventFeed');
+
+        this._gauges = {};
+        this._poller = null;
+        this._tickInterval = null;
+        this._elapsedSeconds = 0;
+        this._lastEventCount = 0;
+        this._activeBotId = null;
+
+        this._initGauges();
+        this._checkForActiveSession();
+    }
+
+    // ── Init ───────────────────────────────────────────────
+    _initGauges() {
+        const configs = [
+            { id: 'gaugeBoredom',  label: 'Boredom', color: '#F59E0B' },
+            { id: 'gaugeFatigue',  label: 'Fatigue', color: '#EF4444' },
+            { id: 'gaugeEnergy',   label: 'Energy',  color: '#22C55E' },
+        ];
+        configs.forEach(cfg => {
+            const canvas = document.getElementById(cfg.id);
+            if (!canvas) return;
+            const chart = new Chart(canvas.getContext('2d'), {
+                type: 'doughnut',
+                data: {
+                    datasets: [{
+                        data: [0, 1],
+                        backgroundColor: [cfg.color, 'rgba(255,255,255,0.06)'],
+                        borderWidth: 0,
+                    }]
+                },
+                options: {
+                    cutout: '78%',
+                    rotation: -90,
+                    circumference: 360,
+                    responsive: false,
+                    plugins: { tooltip: { enabled: false }, legend: { display: false } },
+                    animation: false,
+                },
+                plugins: [centerTextPlugin],
+            });
+            chart._liveGaugeMeta = { color: cfg.color, display: '0%', label: cfg.label };
+            this._gauges[cfg.id] = chart;
+        });
+    }
+
+    async _checkForActiveSession() {
+        try {
+            const res = await fetch('/get_user_bots');
+            if (!res.ok) return;
+            const data = await res.json();
+            const bots = data.bots || [];
+
+            for (const bot of bots) {
+                try {
+                    const r = await fetch(`/api/bots/${bot.id}/live-state`);
+                    if (r.ok) {
+                        this._activeBotId = bot.id;
+                        const state = await r.json();
+                        this._show();
+                        this._handleStateUpdate(state);
+                        this._startPolling(bot.id);
+                        return;
+                    }
+                } catch (_) { /* next bot */ }
+            }
+            // No active session found — retry in 30s
+            setTimeout(() => this._checkForActiveSession(), 30000);
+        } catch (_) {
+            setTimeout(() => this._checkForActiveSession(), 30000);
+        }
+    }
+
+    _startPolling(botId) {
+        if (this._poller) this._poller.destroy();
+        this._poller = new JsonPoller(
+            `/api/bots/${botId}/live-state`,
+            5000,
+            (state) => this._handleStateUpdate(state),
+            (err) => this._handleError(err),
+        );
+        this._poller.start();
+        this._startTicker();
+    }
+
+    // ── Show / Hide ────────────────────────────────────────
+    _show() {
+        if (this._card) this._card.style.display = 'block';
+    }
+
+    _hide() {
+        if (this._card) this._card.style.display = 'none';
+        if (this._poller) { this._poller.destroy(); this._poller = null; }
+        this._stopTicker();
+        this._activeBotId = null;
+        this._lastEventCount = 0;
+        // Re-check after hiding
+        setTimeout(() => this._checkForActiveSession(), 15000);
+    }
+
+    // ── State Update ───────────────────────────────────────
+    _handleStateUpdate(state) {
+        // Hide stale indicator on good data
+        if (this._staleEl) this._staleEl.style.display = 'none';
+
+        // Gauges
+        this._updateGauge('gaugeBoredom', state.boredom || 0);
+        this._updateGauge('gaugeFatigue', state.fatigue || 0);
+        this._updateGauge('gaugeEnergy',  state.energy  || 0);
+
+        // Elapsed
+        if (state.elapsed_seconds != null) {
+            this._elapsedSeconds = state.elapsed_seconds;
+            this._renderElapsed();
+        }
+
+        // Phase bar
+        if (this._phaseNameEl) {
+            this._phaseNameEl.textContent = state.phase || 'Unknown';
+            this._phaseNameEl.style.color = this._phaseColor(state.phase);
+        }
+        if (this._phaseTimeEl && state.phase_elapsed != null) {
+            this._phaseTimeEl.textContent = this._fmtTime(state.phase_elapsed);
+        }
+
+        // Mood pills
+        this._renderMoodPills(state.mood || {});
+
+        // Events
+        this._renderEvents(state.recent_events || []);
+    }
+
+    _handleError(err) {
+        if (err && err.status === 404) {
+            this._hide();
+        } else {
+            // Network error — show stale
+            if (this._staleEl) this._staleEl.style.display = 'inline';
+        }
+    }
+
+    // ── Gauge helpers ──────────────────────────────────────
+    _updateGauge(id, value) {
+        const chart = this._gauges[id];
+        if (!chart) return;
+        const v = Math.max(0, Math.min(1, value));
+        chart.data.datasets[0].data = [v, 1 - v];
+        chart._liveGaugeMeta.display = Math.round(v * 100) + '%';
+        chart.update('none');
+    }
+
+    // ── Phase color ────────────────────────────────────────
+    _phaseColor(phase) {
+        const p = (phase || '').toLowerCase();
+        if (p === 'starting') return '#3B82F6';
+        if (p === 'running')  return '#22C55E';
+        if (p === 'completed') return '#6B7280';
+        if (p === 'error')    return '#EF4444';
+        return '#e5e5e5';
+    }
+
+    // ── Mood pills ─────────────────────────────────────────
+    _renderMoodPills(mood) {
+        if (!this._moodPillsEl) return;
+        const pills = [];
+        const keys = [
+            { key: 'energy_mult',   label: 'Energy' },
+            { key: 'social_mult',   label: 'Social' },
+            { key: 'patience_mult', label: 'Patience' },
+        ];
+        keys.forEach(({ key, label }) => {
+            const val = mood[key];
+            if (val != null && Math.abs(val - 1.0) > 0.05) {
+                pills.push(`<span class="live-mood-pill">${label} x${val.toFixed(1)}</span>`);
+            }
+        });
+        this._moodPillsEl.innerHTML = pills.join('');
+    }
+
+    // ── Event feed (smart scroll) ──────────────────────────
+    _renderEvents(events) {
+        if (!this._feedEl) return;
+        if (!events.length) {
+            if (!this._feedEl.children.length) {
+                this._feedEl.innerHTML = '<div class="live-event-empty">Waiting for events...</div>';
+            }
+            return;
+        }
+
+        // Only append new events
+        const newCount = events.length;
+        if (newCount <= this._lastEventCount) return;
+
+        // Check if at bottom before appending
+        const isAtBottom = this._feedEl.scrollHeight - this._feedEl.scrollTop - this._feedEl.clientHeight < 20;
+
+        // Clear empty message
+        const emptyEl = this._feedEl.querySelector('.live-event-empty');
+        if (emptyEl) emptyEl.remove();
+
+        const newEvents = events.slice(this._lastEventCount);
+        newEvents.forEach(ev => {
+            const div = document.createElement('div');
+            div.className = 'live-event-line';
+            const color = EVENT_COLORS[ev.type] || '#9CA3AF';
+            const time = ev.ts ? ev.ts.split('T')[1]?.substring(0, 8) || '' : '';
+            div.innerHTML = `<span class="live-event-time">${time}</span><span style="color:${color}">[${ev.type}]</span> ${this._escapeHtml(ev.detail || '')}`;
+            this._feedEl.appendChild(div);
+        });
+
+        this._lastEventCount = newCount;
+
+        if (isAtBottom) {
+            this._feedEl.scrollTop = this._feedEl.scrollHeight;
+        }
+    }
+
+    // ── Elapsed timer (smooth local tick) ──────────────────
+    _startTicker() {
+        if (this._tickInterval) return;
+        this._tickInterval = setInterval(() => {
+            this._elapsedSeconds++;
+            this._renderElapsed();
+        }, 1000);
+    }
+
+    _stopTicker() {
+        if (this._tickInterval) {
+            clearInterval(this._tickInterval);
+            this._tickInterval = null;
+        }
+    }
+
+    _renderElapsed() {
+        if (!this._elapsedEl) return;
+        this._elapsedEl.textContent = this._fmtTime(this._elapsedSeconds);
+    }
+
+    // ── Formatting helpers ─────────────────────────────────
+    _fmtTime(seconds) {
+        const s = seconds || 0;
+        const h = Math.floor(s / 3600);
+        const m = Math.floor((s % 3600) / 60);
+        const sec = s % 60;
+        const mm = String(m).padStart(2, '0');
+        const ss = String(sec).padStart(2, '0');
+        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
+    }
+
+    _escapeHtml(str) {
+        const div = document.createElement('div');
+        div.textContent = str;
+        return div.innerHTML;
+    }
+}
+
+
+// ── Auto-init ──────────────────────────────────────────────
+document.addEventListener('DOMContentLoaded', () => {
+    window.liveMonitor = new LiveMonitor();
+});
diff --git a/insta-phone-SAAS-sneder/app/templates/analysis.html b/insta-phone-SAAS-sneder/app/templates/analysis.html
index aed2564..5582b71 100644
--- a/insta-phone-SAAS-sneder/app/templates/analysis.html
+++ b/insta-phone-SAAS-sneder/app/templates/analysis.html
@@ -17,6 +17,7 @@
     <link rel="stylesheet" href="{{ url_for('static', filename='css/theme.css') }}">
     <link rel="stylesheet" href="{{ url_for('static', filename='css/after_login_styles.css') }}">
     <link rel="stylesheet" href="{{ url_for('static', filename='css/analysis.css') }}">
+    <link rel="stylesheet" href="{{ url_for('static', filename='css/live-monitor.css') }}">
 </head>
 <body>
     <div class="sidebar">
@@ -77,7 +78,49 @@
 
             <!-- Analytics Content -->
             <div id="analyticsContent" class="analytics-content" style="display: none;">
-                
+
+                <!-- Live Monitor Card (hidden when no active session) -->
+                <div class="live-monitor-row">
+                    <div id="liveMonitorCard" class="live-monitor-card">
+                        <div class="live-monitor-header">
+                            <div class="live-dot"></div>
+                            <h3>Live Session</h3>
+                            <span id="liveStaleIndicator" class="live-stale-indicator">
+                                <i class="fas fa-exclamation-triangle"></i> Stale
+                            </span>
+                            <span id="liveElapsed" class="live-monitor-elapsed">00:00</span>
+                        </div>
+                        <div class="live-monitor-body">
+                            <div class="live-monitor-left">
+                                <div class="live-phase-bar">
+                                    <span id="livePhaseText" class="live-phase-name">--</span>
+                                    <span id="livePhaseTime" class="live-phase-time">00:00</span>
+                                </div>
+                                <div id="liveMoodPills" class="live-mood-pills"></div>
+                            </div>
+                            <div class="live-monitor-center">
+                                <div class="live-gauge-wrapper">
+                                    <canvas id="gaugeBoredom" width="120" height="120"></canvas>
+                                    <span class="live-gauge-label">Boredom</span>
+                                </div>
+                                <div class="live-gauge-wrapper">
+                                    <canvas id="gaugeFatigue" width="120" height="120"></canvas>
+                                    <span class="live-gauge-label">Fatigue</span>
+                                </div>
+                                <div class="live-gauge-wrapper">
+                                    <canvas id="gaugeEnergy" width="120" height="120"></canvas>
+                                    <span class="live-gauge-label">Energy</span>
+                                </div>
+                            </div>
+                            <div class="live-monitor-right">
+                                <div id="liveEventFeed" class="live-event-feed">
+                                    <div class="live-event-empty">Waiting for events...</div>
+                                </div>
+                            </div>
+                        </div>
+                    </div>
+                </div>
+
                 <!-- Overview Cards -->
                 <div class="overview-cards">
                     <div class="overview-card">
@@ -368,6 +411,7 @@
     </div>
 
     <!-- Custom JavaScript -->
+    <script src="{{ url_for('static', filename='js/live-monitor.js') }}"></script>
     <script src="{{ url_for('static', filename='js/analysis.js') }}"></script>
 </body>
 </html>
