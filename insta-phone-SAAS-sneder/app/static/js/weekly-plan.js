/**
 * Weekly Plan - Timeline rendering, session status polling, actions
 */

let currentProxyId = 1;
let currentWeekOffset = 0;
let currentPlan = null;
let pollTimeoutId = null;

const TIMELINE_HEIGHT = 960; // 40px per hour
const PLATFORM_COLORS = {
    tiktok: { bg: 'rgba(37, 244, 238, 0.2)', border: '#25F4EE' },
    instagram: { bg: 'rgba(225, 48, 108, 0.2)', border: '#E1306C' },
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    buildHourLabels();
    await loadTodaySessions();
    await loadWeekPlan();
    updateTimeMarker();
    setInterval(updateTimeMarker, 60000);
    pollLoop();
});

function buildHourLabels() {
    const container = document.getElementById('hourLabels');
    for (let h = 0; h < 24; h++) {
        const label = document.createElement('div');
        label.className = 'hour-label';
        label.textContent = `${String(h).padStart(2, '0')}:00`;
        label.style.top = `${(h / 24) * TIMELINE_HEIGHT}px`;
        container.appendChild(label);
    }
}

// --- Data Loading ---
async function loadTodaySessions() {
    try {
        const resp = await fetch(`/api/planner/today-sessions?proxy_id=${currentProxyId}`);
        const data = await resp.json();
        if (data.sessions && data.sessions.length > 0) {
            renderTimeline(data.sessions);
            document.getElementById('emptyState').style.display = 'none';
            document.querySelector('.timeline-container').style.display = 'flex';
            loadWarmupSummary(data.sessions);
        } else {
            document.getElementById('emptyState').style.display = 'flex';
            document.querySelector('.timeline-container').style.display = 'none';
        }
    } catch (err) {
        console.error('Failed to load sessions:', err);
    }
}

async function loadWeekPlan() {
    try {
        const now = new Date();
        now.setDate(now.getDate() + currentWeekOffset * 7);
        const isoWeek = getISOWeek(now);
        const year = now.getFullYear();

        document.getElementById('weekLabel').textContent = `Week ${isoWeek}, ${year}`;

        const resp = await fetch(`/api/planner/weekly-plan?proxy_id=${currentProxyId}&week_number=${isoWeek}&year=${year}`);
        if (resp.ok) {
            currentPlan = await resp.json();
            renderWeekOverview(currentPlan);
        }
    } catch (err) {
        console.error('Failed to load week plan:', err);
    }
}

// --- Timeline Rendering ---
function renderTimeline(sessions) {
    const track = document.getElementById('timelineTrack');
    // Remove old blocks (keep time marker)
    track.querySelectorAll('.session-block').forEach(el => el.remove());

    sessions.forEach(session => {
        const block = document.createElement('div');
        block.className = 'session-block';
        block.dataset.sessionId = session.session_id || '';

        // Platform color
        const platform = (session.platform || '').toLowerCase();
        const colors = PLATFORM_COLORS[platform] || PLATFORM_COLORS.tiktok;
        block.style.background = colors.bg;
        block.style.borderLeft = `3px solid ${colors.border}`;

        // Warmup dashed border
        if (session.session_type && session.session_type.startsWith('warmup')) {
            block.classList.add('session-warmup');
        }

        // Position
        const startET = session.start_time_et || session.start_time || '00:00';
        const endET = session.end_time_et || session.end_time || '00:00';
        const startMins = parseTimeToMinutes(startET);
        const endMins = parseTimeToMinutes(endET);
        const duration = Math.max(endMins - startMins, 1);

        const top = (startMins / 1440) * TIMELINE_HEIGHT;
        const height = Math.max((duration / 1440) * TIMELINE_HEIGHT, 20);
        block.style.top = `${top}px`;
        block.style.height = `${height}px`;

        // Content
        const phoneId = session.phone_id || session.phone || '?';
        const platLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';
        block.innerHTML = `
            <div class="block-title">P${phoneId} ${platLabel}</div>
            <div class="block-time">${startET} - ${endET}</div>
            <div class="block-duration">${duration}min</div>
        `;

        // Status
        const status = session.execution_status || 'planned';
        block.classList.add(`status-${status}`);

        // Click
        block.addEventListener('click', () => showSessionDetail(session));

        track.appendChild(block);
    });
}

// --- Week Overview ---
function renderWeekOverview(plan) {
    const grid = document.getElementById('weekGrid');
    grid.innerHTML = '';

    const days = plan.days || {};
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const sortedDates = Object.keys(days).sort();

    // If no days, show empty
    if (sortedDates.length === 0) {
        grid.innerHTML = '<div class="empty-state p-4">No plan data</div>';
        return;
    }

    sortedDates.forEach((dateStr, i) => {
        const dayData = days[dateStr];
        const sessions = dayData.sessions || [];
        const cell = document.createElement('div');
        cell.className = 'day-cell';

        const today = new Date().toISOString().split('T')[0];
        if (dateStr === today) cell.classList.add('today');

        const dayName = dayNames[i % 7] || '';
        const sessionCount = sessions.length;
        const hasRest = sessions.some(s => s.session_type === 'rest_only');
        const hasWarmup = sessions.some(s => (s.session_type || '').startsWith('warmup'));

        let badges = '';
        if (hasRest) badges += '<span class="badge bg-warning text-dark ms-1">Rest</span>';
        if (hasWarmup) badges += '<span class="badge bg-info ms-1">Warmup</span>';

        // Platform dots
        const platforms = [...new Set(sessions.map(s => s.platform))];
        const dots = platforms.map(p => {
            const color = p === 'tiktok' ? '#25F4EE' : '#E1306C';
            return `<span class="platform-dot" style="background:${color}"></span>`;
        }).join('');

        cell.innerHTML = `
            <div class="day-header">${dayName} <small class="text-muted">${dateStr.slice(5)}</small></div>
            <div class="day-count">${sessionCount} sessions ${dots}</div>
            <div>${badges}</div>
        `;

        grid.appendChild(cell);
    });
}

// --- Session Detail Modal ---
function showSessionDetail(session) {
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const platLabel = session.platform === 'tiktok' ? 'TikTok' : 'Instagram';
    title.textContent = `P${session.phone_id || session.phone} ${platLabel}`;

    let capsHTML = '';
    if (session.engagement_caps) {
        const caps = session.engagement_caps;
        capsHTML = `
            <tr><td>Engagement Caps</td><td>
                Likes: ${JSON.stringify(caps.likes || 0)},
                Comments: ${caps.comments || 0},
                Follows: ${caps.follows || 0}
                ${caps.scroll_only ? '<br><em>Scroll Only</em>' : ''}
            </td></tr>
        `;
    }

    body.innerHTML = `
        <table class="table table-sm table-dark mb-0">
            <tr><td>Account</td><td>${session.account_name || session.account}</td></tr>
            <tr><td>Time</td><td>${session.start_time_et || session.start_time} - ${session.end_time_et || session.end_time}</td></tr>
            <tr><td>Duration</td><td>${session.total_duration_minutes || session.duration_minutes}min</td></tr>
            <tr><td>Type</td><td>${session.session_type || session.type}</td></tr>
            <tr><td>Post</td><td>${session.post_scheduled ? (session.post_outcome || 'yes') : 'No'}</td></tr>
            <tr><td>Status</td><td><span class="badge bg-${statusColor(session.execution_status)}">${session.execution_status || 'planned'}</span></td></tr>
            ${capsHTML}
        </table>
    `;

    new bootstrap.Modal(document.getElementById('sessionDetailModal')).show();
}

function statusColor(status) {
    return { completed: 'success', running: 'primary', failed: 'danger', skipped: 'secondary' }[status] || 'secondary';
}

// --- Time Marker ---
function updateTimeMarker() {
    const marker = document.getElementById('timeMarker');
    const now = new Date();
    // Use Intl to get Eastern time
    const etStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    const mins = parseTimeToMinutes(etStr);
    marker.style.top = `${(mins / 1440) * TIMELINE_HEIGHT}px`;
}

// --- Polling ---
async function pollLoop() {
    try {
        const resp = await fetch(`/api/planner/today-sessions?proxy_id=${currentProxyId}`);
        const data = await resp.json();

        if (data.sessions) {
            const currentIds = new Set([...document.querySelectorAll('[data-session-id]')].map(el => el.dataset.sessionId));
            const newIds = new Set(data.sessions.map(s => s.session_id));

            if (currentIds.size === newIds.size && [...currentIds].every(id => newIds.has(id))) {
                updateSessionStatuses(data.sessions);
            } else {
                renderTimeline(data.sessions);
            }
        }
    } catch (err) {
        console.error('Poll failed:', err);
    }
    pollTimeoutId = setTimeout(pollLoop, 30000);
}

function updateSessionStatuses(sessions) {
    sessions.forEach(session => {
        const block = document.querySelector(`[data-session-id="${session.session_id}"]`);
        if (!block) return;
        const status = session.execution_status || 'planned';
        const currentClass = [...block.classList].find(c => c.startsWith('status-'));
        const newClass = `status-${status}`;
        if (currentClass !== newClass) {
            if (currentClass) block.classList.remove(currentClass);
            block.classList.add(newClass);
        }
    });
}

// Pause polling when tab hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearTimeout(pollTimeoutId);
    } else {
        pollLoop();
    }
});

// --- Warmup Summary ---
async function loadWarmupSummary(sessions) {
    const warmupAccounts = [...new Set(
        sessions.filter(s => (s.session_type || '').startsWith('warmup'))
                .map(s => s.account_name || s.account)
    )];

    const panel = document.getElementById('warmup-summary-panel');
    const container = document.getElementById('warmup-cards-container');

    if (warmupAccounts.length === 0) {
        panel.style.display = 'none';
        return;
    }

    container.innerHTML = '';
    for (const name of warmupAccounts) {
        try {
            const resp = await fetch(`/api/planner/warmup/${name}`);
            if (resp.ok) {
                const ws = await resp.json();
                if (!ws.completed) {
                    container.innerHTML += renderWarmupCard(ws);
                }
            }
        } catch (err) { /* skip */ }
    }

    panel.style.display = container.children.length > 0 ? 'block' : 'none';
}

function renderWarmupCard(ws) {
    const pct = Math.round((ws.current_day / ws.total_days) * 100);
    const badgeClass = { dead: 'bg-danger', lazy: 'bg-warning', normal: 'bg-success' }[ws.day_type] || 'bg-secondary';

    return `
        <div class="warmup-summary-card">
            <div class="account-name">${ws.account_name}</div>
            <div class="d-flex align-items-center gap-2 mb-1">
                <small>Day ${ws.current_day}/${ws.total_days}</small>
                <span class="badge ${badgeClass}">${ws.day_type}</span>
            </div>
            <div class="progress" style="height: 6px;">
                <div class="progress-bar" style="width: ${pct}%"></div>
            </div>
        </div>
    `;
}

// --- Actions ---
async function generatePlan() {
    try {
        const resp = await fetch('/api/planner/weekly-plan/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy_id: currentProxyId }),
        });
        if (resp.ok) {
            location.reload();
        } else {
            const err = await resp.json();
            alert('Error: ' + (err.error || 'Generation failed'));
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

async function regeneratePlan() {
    const today = new Date().toISOString().split('T')[0];
    try {
        const resp = await fetch('/api/planner/weekly-plan/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy_id: currentProxyId, from_date: today }),
        });
        if (resp.ok) location.reload();
        else alert('Regeneration failed');
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

async function downloadJSON() {
    try {
        const resp = await fetch(`/api/planner/weekly-plan/export?proxy_id=${currentProxyId}`);
        if (!resp.ok) { alert('No plan to export'); return; }
        const blob = await resp.blob();
        const cd = resp.headers.get('Content-Disposition') || '';
        const filename = cd.match(/filename="(.+)"/)?.[1] || 'weekly_plan.json';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (err) {
        alert('Download failed: ' + err.message);
    }
}

function navigateWeek(direction) {
    currentWeekOffset += direction;
    loadWeekPlan();
    if (currentWeekOffset === 0) loadTodaySessions();
}

// --- Utilities ---
function parseTimeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
}

function getISOWeek(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}
