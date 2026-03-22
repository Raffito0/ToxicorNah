/**
 * Warmup Panel - Phone Settings page warmup controls
 * Loaded as non-module script so onclick handlers work globally.
 */

let _warmupAccountName = null;

async function loadWarmupPanel(accountName) {
    _warmupAccountName = accountName;
    const section = document.getElementById('warmupSection');
    if (!section) return;

    try {
        const resp = await fetch(`/api/planner/warmup/${accountName}`);
        if (!resp.ok) {
            section.style.display = 'none';
            return;
        }

        const ws = await resp.json();
        section.style.display = 'block';

        // Day label + badge
        document.getElementById('warmupDayLabel').textContent = `Day ${ws.current_day} / ${ws.total_days}`;
        const badge = document.getElementById('warmupDayBadge');
        const completeBadge = document.getElementById('warmupCompleteBadge');

        if (ws.completed) {
            badge.style.display = 'none';
            completeBadge.style.display = 'inline';
            document.getElementById('warmupActions').style.display = 'none';
        } else {
            badge.style.display = 'inline';
            completeBadge.style.display = 'none';
            badge.textContent = ws.day_type;
            badge.className = 'badge ' + ({
                dead: 'bg-danger', lazy: 'bg-warning text-dark', normal: 'bg-success'
            }[ws.day_type] || 'bg-secondary');
            document.getElementById('warmupActions').style.display = 'flex';
        }

        // Progress bar
        const pct = ws.total_days > 0 ? Math.round((ws.current_day / ws.total_days) * 100) : 0;
        document.getElementById('warmupProgressBar').style.width = `${pct}%`;

        // Milestones
        const miles = document.getElementById('warmupMilestones');
        miles.innerHTML = '';
        if (ws.profile_pic) {
            const icon = ws.profile_pic.done ? 'fa-check text-success' : 'fa-clock text-warning';
            miles.innerHTML += `<span><i class="fas ${icon} me-1"></i>Profile Pic: Day ${ws.profile_pic.day}</span> `;
        }
        if (ws.bio) {
            const icon = ws.bio.done ? 'fa-check text-success' : 'fa-clock text-warning';
            miles.innerHTML += `<span><i class="fas ${icon} me-1"></i>Bio: Day ${ws.bio.day}</span>`;
        }

        // Caps table
        const capsBody = document.getElementById('warmupCapsBody');
        capsBody.innerHTML = '';
        if (ws.caps && !ws.completed) {
            if (ws.caps.scroll_only) {
                capsBody.innerHTML = '<tr><td colspan="2"><em>Scroll Only</em></td></tr>';
            } else {
                for (const [key, val] of Object.entries(ws.caps)) {
                    if (key === 'scroll_only') continue;
                    const display = Array.isArray(val) ? `${val[0]} - ${val[1]}` : String(val);
                    capsBody.innerHTML += `<tr><td>${key}</td><td>${display}</td></tr>`;
                }
            }
        }

        // Full plan table
        const planBody = document.getElementById('warmupPlanBody');
        planBody.innerHTML = '';
        if (ws.plan_summary) {
            ws.plan_summary.forEach(day => {
                const isCurrent = day.day === ws.current_day;
                const cls = isCurrent ? 'table-active' : '';
                planBody.innerHTML += `<tr class="${cls}"><td>${day.day}</td><td>${day.type}</td><td>${day.sessions}</td></tr>`;
            });
        }
    } catch (err) {
        console.error('Failed to load warmup panel:', err);
        section.style.display = 'none';
    }
}

async function warmupReset() {
    if (!_warmupAccountName) return;
    if (!confirm('Reset warmup to Day 1? This cannot be undone.')) return;

    try {
        const resp = await fetch(`/api/planner/warmup/${_warmupAccountName}/reset`, { method: 'POST' });
        if (resp.ok) {
            loadWarmupPanel(_warmupAccountName);
        } else {
            alert('Reset failed');
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

async function warmupSkipPrompt() {
    if (!_warmupAccountName) return;
    const day = prompt('Skip to which day?');
    if (!day || isNaN(day)) return;

    try {
        const resp = await fetch(`/api/planner/warmup/${_warmupAccountName}/skip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_day: parseInt(day) }),
        });
        if (resp.ok) {
            loadWarmupPanel(_warmupAccountName);
        } else {
            alert('Skip failed');
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

async function warmupComplete() {
    if (!_warmupAccountName) return;
    if (!confirm('Mark warmup as complete?')) return;

    try {
        const resp = await fetch(`/api/planner/warmup/${_warmupAccountName}/complete`, { method: 'POST' });
        if (resp.ok) {
            loadWarmupPanel(_warmupAccountName);
        } else {
            alert('Complete failed');
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}
