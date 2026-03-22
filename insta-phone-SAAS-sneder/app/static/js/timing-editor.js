/**
 * Timing Editor (section-04)
 * Standalone page for editing timing presets with per-param overrides.
 */

let _currentBotId = null;
let _currentPresetId = null;
let _presetParams = {};
let _debounceTimers = {};

const CATEGORIES = {
    'Cosmetic Waits': p => /^t_(app_load|tab_switch|page_|scroll_|swipe_|cosmetic)/.test(p),
    'Verification': p => /^t_(verify|fingerprint|bbox)/.test(p),
    'Recovery': p => /^t_(recovery|popup|nuclear|dismiss|escape)/.test(p),
    'Touch Physics': p => /^touch_/.test(p),
    'Session Timing': p => /^(t_session|zona_morta|t_interruption|t_phase)/.test(p),
    'Engagement': p => /^t_(like|comment|follow|engagement|niche_profile|niche_video)/.test(p),
    'Search / Explore': p => /^t_(search|grid|explore|hashtag|keyword)/.test(p),
};


// ── Initialization ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await loadBots();
    await loadPresets();

    const urlParams = new URLSearchParams(window.location.search);
    const botId = urlParams.get('bot_id');
    if (botId) {
        document.getElementById('botSelector').value = botId;
        _currentBotId = parseInt(botId);
        await loadBotTiming();
    }
});


async function loadBots() {
    try {
        const resp = await fetch('/api/bots');
        const data = await resp.json();
        const sel = document.getElementById('botSelector');
        sel.innerHTML = '<option value="">Select bot...</option>';
        if (data.success && data.bots) {
            data.bots.forEach(b => {
                sel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
            });
        }
        sel.addEventListener('change', async (e) => {
            _currentBotId = e.target.value ? parseInt(e.target.value) : null;
            if (_currentBotId) await loadBotTiming();
        });
    } catch (e) { console.error('Failed to load bots:', e); }
}


async function loadPresets() {
    try {
        const resp = await fetch('/api/timing/presets');
        const data = await resp.json();
        const sel = document.getElementById('presetSelector');
        sel.innerHTML = '';
        data.presets.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name} (${p.param_count} params)</option>`;
        });
    } catch (e) { console.error('Failed to load presets:', e); }
}


async function loadBotTiming() {
    if (!_currentBotId) return;
    try {
        const resp = await fetch(`/api/bots/${_currentBotId}/timing`);
        const data = await resp.json();
        _presetParams = {};

        // Load base preset params
        if (data.preset_id) {
            _currentPresetId = data.preset_id;
            document.getElementById('presetSelector').value = data.preset_id;
            const presetResp = await fetch(`/api/timing/presets/${data.preset_id}`);
            const presetData = await presetResp.json();
            _presetParams = presetData.params_json || {};
        }

        renderCategories(data.params, data.overrides || []);
    } catch (e) { console.error('Failed to load timing:', e); }
}


// ── Rendering ───────────────────────────────────────────────

function renderCategories(params, overrides) {
    const container = document.getElementById('categoriesContainer');
    container.innerHTML = '';

    const paramNames = Object.keys(params).sort();
    const categorized = {};
    const uncategorized = [];

    for (const name of paramNames) {
        let found = false;
        for (const [cat, matcher] of Object.entries(CATEGORIES)) {
            if (matcher(name)) {
                if (!categorized[cat]) categorized[cat] = [];
                categorized[cat].push(name);
                found = true;
                break;
            }
        }
        if (!found) uncategorized.push(name);
    }

    // Add uncategorized to "Other"
    if (uncategorized.length > 0) categorized['Other'] = uncategorized;

    for (const [catName, catParams] of Object.entries(categorized)) {
        const overrideCount = catParams.filter(p => overrides.includes(p)).length;
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <div class="category-header" onclick="this.nextElementSibling.classList.toggle('show')">
                <h6>${catName} (${catParams.length})</h6>
                ${overrideCount > 0 ? `<span class="badge">${overrideCount} overrides</span>` : ''}
            </div>
            <div class="category-body">
                ${catParams.map(p => renderParamRow(p, params[p], overrides.includes(p))).join('')}
            </div>
        `;
        container.appendChild(card);
    }
}


function renderParamRow(paramName, values, isOverride) {
    const [median, sigma, minVal, maxVal] = values;
    const previewDots = generatePreviewDots(median, sigma, minVal, maxVal);

    return `
        <div class="param-row" data-param="${paramName}">
            <span class="param-label">
                ${paramName}${isOverride ? '<span class="override-indicator"></span>' : ''}
            </span>
            <input type="range" class="param-slider" data-field="median"
                   min="${minVal}" max="${Math.max(maxVal, median * 2)}" step="0.01"
                   value="${median}"
                   oninput="onParamChange('${paramName}', this)">
            <input type="number" class="param-input" data-field="min" value="${minVal}" step="0.01"
                   onchange="onParamInputChange('${paramName}')">
            <input type="number" class="param-input" data-field="max" value="${maxVal}" step="0.01"
                   onchange="onParamInputChange('${paramName}')">
            <div class="param-preview" id="preview_${paramName}">${previewDots}</div>
            <button class="param-reset-btn" onclick="resetParam('${paramName}')" title="Reset to preset">
                <i class="fas fa-undo"></i>
            </button>
        </div>
    `;
}


function generatePreviewDots(median, sigma, minVal, maxVal) {
    const dots = [];
    for (let i = 0; i < 5; i++) {
        const val = sampleLogNormal(median, sigma, minVal, maxVal);
        const opacity = 0.3 + Math.random() * 0.7;
        dots.push(`<span class="dot" style="opacity:${opacity.toFixed(2)}" title="${val.toFixed(3)}"></span>`);
    }
    return dots.join('');
}


function sampleLogNormal(median, sigma, minVal, maxVal) {
    const mu = Math.log(Math.max(median, 0.001));
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const val = Math.exp(mu + sigma * z);
    return Math.max(minVal, Math.min(maxVal, val));
}


// ── Event Handlers ──────────────────────────────────────────

function onParamChange(paramName, slider) {
    const row = slider.closest('.param-row');
    const median = parseFloat(slider.value);
    const minVal = parseFloat(row.querySelector('[data-field="min"]').value);
    const maxVal = parseFloat(row.querySelector('[data-field="max"]').value);
    const preview = document.getElementById(`preview_${paramName}`);
    if (preview) preview.innerHTML = generatePreviewDots(median, 0.3, minVal, maxVal);

    debouncedOverride(paramName, row);
}


function onParamInputChange(paramName) {
    const row = document.querySelector(`.param-row[data-param="${paramName}"]`);
    if (!row) return;
    debouncedOverride(paramName, row);
}


function debouncedOverride(paramName, row) {
    clearTimeout(_debounceTimers[paramName]);
    _debounceTimers[paramName] = setTimeout(() => saveOverride(paramName, row), 300);
}


async function saveOverride(paramName, row) {
    if (!_currentBotId) return;
    const median = parseFloat(row.querySelector('[data-field="median"]').value);
    const minVal = parseFloat(row.querySelector('[data-field="min"]').value);
    const maxVal = parseFloat(row.querySelector('[data-field="max"]').value);

    // Check if matches preset (no override needed)
    const preset = _presetParams[paramName];
    if (preset && preset[0] === median && preset[2] === minVal && preset[3] === maxVal) {
        await fetch(`/api/bots/${_currentBotId}/timing/override/${paramName}`, { method: 'DELETE' });
        return;
    }

    await fetch(`/api/bots/${_currentBotId}/timing/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ param_name: paramName, median, sigma: 0.3, min_val: minVal, max_val: maxVal }),
    });
}


// ── Actions ─────────────────────────────────────────────────

async function applyPreset() {
    if (!_currentBotId) return;
    const presetId = document.getElementById('presetSelector').value;
    await fetch(`/api/bots/${_currentBotId}/timing/preset`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset_id: parseInt(presetId) }),
    });
    await loadBotTiming();
}


async function saveAsCustomPreset() {
    const name = prompt('Custom preset name:');
    if (!name) return;

    // Collect all current param values
    const params = {};
    document.querySelectorAll('.param-row').forEach(row => {
        const paramName = row.dataset.param;
        const median = parseFloat(row.querySelector('[data-field="median"]').value);
        const minVal = parseFloat(row.querySelector('[data-field="min"]').value);
        const maxVal = parseFloat(row.querySelector('[data-field="max"]').value);
        params[paramName] = [median, 0.3, minVal, maxVal];
    });

    await fetch('/api/timing/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, params_json: params }),
    });
    await loadPresets();
}


async function clearAllOverrides() {
    if (!_currentBotId) return;
    await fetch(`/api/bots/${_currentBotId}/timing/overrides`, { method: 'DELETE' });
    await loadBotTiming();
}


async function resetParam(paramName) {
    if (!_currentBotId) return;
    await fetch(`/api/bots/${_currentBotId}/timing/override/${paramName}`, { method: 'DELETE' });
    await loadBotTiming();
}
