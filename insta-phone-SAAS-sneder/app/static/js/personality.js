/**
 * Personality Panel (section-02)
 * Manages 8 trait sliders, lock toggles, Chart.js evolution graph,
 * and randomize/reset/save actions.
 */

let _personalityAccountId = null;
let _personalityChart = null;
let _personalityDebounceTimer = null;

const TRAIT_LABELS = {
    reels_preference: 'Reels Preference',
    story_affinity: 'Story Affinity',
    double_tap_habit: 'Double Tap Habit',
    explore_curiosity: 'Explore Curiosity',
    boredom_rate: 'Boredom Rate',
    boredom_relief: 'Boredom Relief',
    switch_threshold: 'Switch Threshold',
    comment_sociality: 'Comment Sociality',
};

const TRAIT_COLORS = {
    reels_preference: '#e05555',
    story_affinity: '#e8a838',
    double_tap_habit: '#4a6fa5',
    explore_curiosity: '#7c6bbf',
    boredom_rate: '#5a8a6a',
    boredom_relief: '#d4668e',
    switch_threshold: '#4ecdc4',
    comment_sociality: '#f7b267',
};

const TRAIT_RANGES = {
    reels_preference: [0.20, 0.80],
    story_affinity: [0.05, 0.50],
    double_tap_habit: [0.25, 0.90],
    explore_curiosity: [0.03, 0.20],
    boredom_rate: [0.06, 0.18],
    boredom_relief: [0.25, 0.55],
    switch_threshold: [0.55, 0.85],
    comment_sociality: [0.15, 0.75],
};


async function loadPersonalityPanel(accountId) {
    _personalityAccountId = accountId;
    const section = document.getElementById('personalitySection');
    if (!section) return;

    try {
        const resp = await fetch(`/api/accounts/${accountId}/personality`);
        if (!resp.ok) { section.style.display = 'none'; return; }
        const data = await resp.json();

        section.style.display = '';
        renderTraitSliders(data.traits, data.locked_traits || []);
        renderEvolutionChart(data.history || []);
    } catch (e) {
        console.error('Failed to load personality:', e);
        section.style.display = 'none';
    }
}


function renderTraitSliders(traits, lockedTraits) {
    const container = document.getElementById('personalitySlidersContainer');
    if (!container) return;
    container.innerHTML = '';

    for (const [key, label] of Object.entries(TRAIT_LABELS)) {
        const value = traits[key] ?? 0.5;
        const [min, max] = TRAIT_RANGES[key];
        const isLocked = lockedTraits.includes(key);

        const row = document.createElement('div');
        row.className = 'personality-slider-row';
        row.innerHTML = `
            <span class="personality-label">${label}</span>
            <input type="range" class="personality-slider"
                   data-trait="${key}"
                   min="${min}" max="${max}" step="0.01" value="${value}"
                   ${isLocked ? 'disabled' : ''}>
            <span class="personality-value" id="pval_${key}">${value.toFixed(2)}</span>
            <button class="personality-lock-btn ${isLocked ? 'locked' : ''}"
                    data-trait="${key}" title="${isLocked ? 'Unlock' : 'Lock'}">
                <i class="fas ${isLocked ? 'fa-lock' : 'fa-lock-open'}"></i>
            </button>
        `;
        container.appendChild(row);
    }

    // Bind slider change events
    container.querySelectorAll('.personality-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const trait = e.target.dataset.trait;
            const val = parseFloat(e.target.value);
            document.getElementById(`pval_${trait}`).textContent = val.toFixed(2);
            debouncedSave();
        });
    });

    // Bind lock toggle events
    container.querySelectorAll('.personality-lock-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const trait = e.currentTarget.dataset.trait;
            const isLocked = e.currentTarget.classList.contains('locked');
            toggleLock(trait, !isLocked);
        });
    });
}


function renderEvolutionChart(history) {
    const canvas = document.getElementById('personalityChart');
    if (!canvas) return;

    if (_personalityChart) {
        _personalityChart.destroy();
    }

    if (history.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    const labels = history.map((_, i) => `S${i + 1}`);
    const datasets = Object.entries(TRAIT_LABELS).map(([key, label]) => ({
        label: label,
        data: history.map(h => h.traits?.[key] ?? null),
        borderColor: TRAIT_COLORS[key],
        backgroundColor: TRAIT_COLORS[key] + '33',
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2,
        fill: false,
    }));

    _personalityChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#999' },
                    grid: { color: '#333' },
                },
                y: {
                    min: 0, max: 1,
                    ticks: { color: '#999' },
                    grid: { color: '#333' },
                },
            },
            plugins: {
                legend: {
                    labels: { color: '#ccc', boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3)}`,
                    },
                },
            },
        },
    });
}


function debouncedSave() {
    clearTimeout(_personalityDebounceTimer);
    _personalityDebounceTimer = setTimeout(() => savePersonality(), 500);
}


async function savePersonality() {
    if (!_personalityAccountId) return;
    const traits = {};
    document.querySelectorAll('.personality-slider').forEach(s => {
        traits[s.dataset.trait] = parseFloat(s.value);
    });

    try {
        await fetch(`/api/accounts/${_personalityAccountId}/personality`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ traits, record_history: true }),
        });
    } catch (e) {
        console.error('Failed to save personality:', e);
    }
}


async function toggleLock(traitKey, lock) {
    if (!_personalityAccountId) return;
    try {
        const resp = await fetch(`/api/accounts/${_personalityAccountId}/personality/lock`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trait: traitKey, locked: lock }),
        });
        if (resp.ok) {
            // Refresh panel to update UI
            loadPersonalityPanel(_personalityAccountId);
        }
    } catch (e) {
        console.error('Failed to toggle lock:', e);
    }
}


async function randomizePersonality() {
    if (!_personalityAccountId) return;
    try {
        const resp = await fetch(`/api/accounts/${_personalityAccountId}/personality/randomize`, {
            method: 'POST',
        });
        if (resp.ok) {
            loadPersonalityPanel(_personalityAccountId);
        }
    } catch (e) {
        console.error('Failed to randomize:', e);
    }
}


async function resetPersonality() {
    if (!_personalityAccountId) return;
    try {
        const resp = await fetch(`/api/accounts/${_personalityAccountId}/personality/reset`, {
            method: 'POST',
        });
        if (resp.ok) {
            loadPersonalityPanel(_personalityAccountId);
        }
    } catch (e) {
        console.error('Failed to reset:', e);
    }
}


// ── Niche Config (section-05) ────────────────────────────────

let _nicheKeywords = [];

async function loadNiche(accountId) {
    const section = document.getElementById('nicheSection');
    if (!section) return;
    try {
        const resp = await fetch(`/api/accounts/${accountId}/niche`);
        if (!resp.ok) { section.style.display = 'none'; return; }
        const data = await resp.json();
        section.style.display = '';

        document.getElementById('nicheDescription').value = data.description || '';
        _nicheKeywords = data.keywords || [];
        renderKeywordTags();

        const thresh = document.getElementById('nicheThreshold');
        thresh.value = data.follow_threshold;
        document.getElementById('nicheThresholdVal').textContent = data.follow_threshold;
        thresh.oninput = () => {
            document.getElementById('nicheThresholdVal').textContent = thresh.value;
        };

        const kwCount = document.getElementById('nicheKeywordsCount');
        kwCount.value = data.session_keywords_count;
        document.getElementById('nicheKeywordsCountVal').textContent = data.session_keywords_count;
        kwCount.oninput = () => {
            document.getElementById('nicheKeywordsCountVal').textContent = kwCount.value;
        };

        // Keyword input handler
        const input = document.getElementById('nicheKeywordInput');
        input.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addKeyword(input.value.trim().replace(',', ''));
                input.value = '';
            }
        };
    } catch (e) {
        console.error('Failed to load niche:', e);
        section.style.display = 'none';
    }
}


function renderKeywordTags() {
    const container = document.getElementById('nicheKeywordsContainer');
    if (!container) return;
    container.innerHTML = _nicheKeywords.map(kw => `
        <span style="background:#d62976; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.78rem; display:flex; align-items:center; gap:4px;">
            ${kw}
            <span style="cursor:pointer; font-weight:bold;" onclick="removeKeyword('${kw}')">&times;</span>
        </span>
    `).join('');
}


function addKeyword(kw) {
    if (!kw || _nicheKeywords.includes(kw)) return;
    _nicheKeywords.push(kw);
    renderKeywordTags();
}


function removeKeyword(kw) {
    _nicheKeywords = _nicheKeywords.filter(k => k !== kw);
    renderKeywordTags();
}


async function saveNiche() {
    if (!_personalityAccountId) return;
    try {
        await fetch(`/api/accounts/${_personalityAccountId}/niche`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: document.getElementById('nicheDescription').value,
                keywords: _nicheKeywords,
                follow_threshold: parseInt(document.getElementById('nicheThreshold').value),
                session_keywords_count: parseInt(document.getElementById('nicheKeywordsCount').value),
            }),
        });
    } catch (e) {
        console.error('Failed to save niche:', e);
    }
}


// ── Session Phase Display (section-06) ────────────────────────

const SESSION_PHASES = {
    arrival:  { duration: [2, 3],  color: '#4a6fa5', actions: { 'FYP Scroll': 93, 'Like': 3, 'Inbox': 3, 'Other': 1 } },
    warmup:   { duration: [3, 5],  color: '#e8a838', actions: { 'FYP Scroll': 77, 'Like': 6, 'Comment': 2, 'Search': 4, 'Follow': 1, 'Profile': 3, 'Other': 7 } },
    peak:     { duration: [7, 12], color: '#e05555', actions: { 'FYP Scroll': 69, 'Like': 6, 'Comment': 4, 'Search': 5, 'Follow': 2, 'Profile': 5, 'Other': 9 } },
    fatigue:  { duration: [5, 10], color: '#7c6bbf', actions: { 'FYP Scroll': 85, 'Like': 5, 'Comment': 1, 'Search': 2, 'Follow': 0, 'Profile': 2, 'Other': 5 } },
    exit:     { duration: [2, 3],  color: '#5a8a6a', actions: { 'FYP Scroll': 94, 'Like': 4, 'Comment': 0, 'Search': 0, 'Follow': 0, 'Profile': 1, 'Other': 1 } },
};


function renderSessionPhases() {
    const bar = document.getElementById('phaseBar');
    const durations = document.getElementById('phaseDurations');
    const details = document.getElementById('phaseDetails');
    if (!bar) return;

    const totalMid = Object.values(SESSION_PHASES).reduce((s, p) => s + (p.duration[0] + p.duration[1]) / 2, 0);

    bar.innerHTML = '';
    durations.innerHTML = '';

    for (const [name, phase] of Object.entries(SESSION_PHASES)) {
        const mid = (phase.duration[0] + phase.duration[1]) / 2;
        const pct = (mid / totalMid * 100).toFixed(1);

        // Bar segment
        const seg = document.createElement('div');
        seg.style.cssText = `width:${pct}%; background:${phase.color}; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:opacity 0.2s; font-size:0.7rem; color:#fff; text-transform:capitalize;`;
        seg.textContent = name;
        seg.onmouseenter = () => { seg.style.opacity = '0.8'; };
        seg.onmouseleave = () => { seg.style.opacity = '1'; };
        seg.onclick = () => showPhaseDetails(name, phase);
        bar.appendChild(seg);

        // Duration label
        const label = document.createElement('div');
        label.style.cssText = `width:${pct}%; text-align:center;`;
        label.textContent = `${phase.duration[0]}-${phase.duration[1]}m`;
        durations.appendChild(label);
    }
}


function showPhaseDetails(name, phase) {
    const details = document.getElementById('phaseDetails');
    if (!details) return;
    details.style.display = '';

    const rows = Object.entries(phase.actions)
        .filter(([, w]) => w > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([action, weight]) => `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <span style="width:80px; color:#aaa;">${action}</span>
                <div style="flex:1; background:#333; border-radius:3px; height:14px;">
                    <div style="width:${weight}%; background:${SESSION_PHASES[name].color}; height:100%; border-radius:3px; min-width:2px;"></div>
                </div>
                <span style="width:30px; text-align:right; color:#888; font-size:0.75rem;">${weight}%</span>
            </div>
        `).join('');

    details.innerHTML = `
        <div style="font-weight:600; margin-bottom:6px; text-transform:capitalize; color:${SESSION_PHASES[name].color};">${name} Phase</div>
        <div style="font-size:0.78rem; color:#888; margin-bottom:8px;">Duration: ${phase.duration[0]}-${phase.duration[1]} minutes</div>
        ${rows}
    `;
}


// Auto-render phases on page load
document.addEventListener('DOMContentLoaded', renderSessionPhases);
