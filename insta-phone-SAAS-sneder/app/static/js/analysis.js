// Analysis Dashboard JavaScript

const DARK_CHART_DEFAULTS = {
    color: '#d1d5db',
    borderColor: 'rgba(255,255,255,0.05)',
    plugins: {
        legend: { labels: { color: '#d1d5db' } },
        tooltip: { backgroundColor: '#1e1e1e', titleColor: '#fff', bodyColor: '#d1d5db' }
    },
    scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
};

class AnalyticsDashboard {
    constructor() {
        this.charts = {};
        this.currentData = null;
        this.initializeEventListeners();
        this.loadBotOptions();
        this.loadDashboard();
    }

    initializeEventListeners() {
        // Filter change events
        document.getElementById('botFilter').addEventListener('change', () => {
            this.loadDashboard();
        });

        document.getElementById('timeFilter').addEventListener('change', () => {
            this.loadDashboard();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadDashboard();
        });

        // Retry button
        document.getElementById('retryBtn').addEventListener('click', () => {
            this.loadDashboard();
        });
    }

    async loadBotOptions() {
        try {
            const response = await fetch('/get_user_bots');
            const data = await response.json();
            
            if (data.success) {
                const botFilter = document.getElementById('botFilter');
                // Clear existing options except "All Bots"
                botFilter.innerHTML = '<option value="all">All Bots</option>';
                
                data.bots.forEach(bot => {
                    const option = document.createElement('option');
                    option.value = bot.id;
                    option.textContent = bot.name;
                    botFilter.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load bot options:', error);
        }
    }

    async loadDashboard() {
        this.showLoading();
        
        try {
            const botId = document.getElementById('botFilter').value;
            const days = document.getElementById('timeFilter').value;
            
            const params = new URLSearchParams();
            if (botId !== 'all') params.append('bot_id', botId);
            params.append('days', days);
            
            const response = await fetch(`/api/analysis/dashboard?${params}`);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to load analytics data');
            }
            
            this.currentData = result.data;
            this.updateDashboard();
            this.showContent();
            
        } catch (error) {
            console.error('Dashboard load error:', error);
            this.showError(error.message);
        }
    }

    showLoading() {
        document.getElementById('loadingSpinner').style.display = 'flex';
        document.getElementById('analyticsContent').style.display = 'none';
        document.getElementById('errorMessage').style.display = 'none';
    }

    showContent() {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('analyticsContent').style.display = 'block';
        document.getElementById('errorMessage').style.display = 'none';
    }

    showError(message) {
        document.getElementById('loadingSpinner').style.display = 'none';
        document.getElementById('analyticsContent').style.display = 'none';
        document.getElementById('errorMessage').style.display = 'flex';
        document.getElementById('errorText').textContent = message;
    }

    updateDashboard() {
        this.updateOverviewCards();
        this.updateCharts();
        this.updateTables();
        this.updateMessageStats();
    }

    updateOverviewCards() {
        const { overview, account_status_distribution, message_stats } = this.currentData;
        
        // Update basic counts
        document.getElementById('totalBots').textContent = overview.total_bots;
        document.getElementById('activeBots').textContent = `${overview.active_bots} active`;
        document.getElementById('totalAccounts').textContent = overview.total_accounts;
        document.getElementById('totalLeads').textContent = overview.total_leads;
        document.getElementById('totalHighlights').textContent = overview.total_highlights;
        document.getElementById('totalTextMessages').textContent = overview.total_text_messages;
        
        // Update account status
        const statusTexts = [];
        Object.entries(account_status_distribution).forEach(([status, count]) => {
            if (count > 0) {
                statusTexts.push(`${count} ${status}`);
            }
        });
        document.getElementById('accountsStatus').textContent = statusTexts.join(', ') || 'No accounts';
        
        // Update conversion rates
        const conversionRate = overview.total_leads > 0 
            ? ((overview.total_messaged / overview.total_leads) * 100).toFixed(1)
            : '0';
        document.getElementById('conversionRate').textContent = `${conversionRate}% conversion`;
        
        // Update highlight success info
        document.getElementById('highlightSuccess').textContent = `${overview.total_highlights} highlights sent`;
        
        const messageSuccessRate = message_stats.conversion_rate || 0;
        document.getElementById('messageSuccess').textContent = `${messageSuccessRate}% conversion rate`;
    }

    updateCharts() {
        this.updateDailyActivityChart();
        this.updateFollowSuccessChart();
        this.loadTikTokAnalytics();
        this.loadGeminiAnalytics();
        this.loadContentStock();
    }

    updateDailyActivityChart() {
        const ctx = document.getElementById('dailyActivityChart').getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.dailyActivity) {
            this.charts.dailyActivity.destroy();
        }
        
        const { daily_activity } = this.currentData;
        
        const labels = daily_activity.map(item => item.date);
        const highlightsData = daily_activity.map(item => item.highlights);
        const textMessagesData = daily_activity.map(item => item.text_messages);
        const followsData = daily_activity.map(item => item.follows);
        
        this.charts.dailyActivity = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Highlights Sent',
                        data: highlightsData,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Text Messages',
                        data: textMessagesData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Follows',
                        data: followsData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    ...DARK_CHART_DEFAULTS.plugins,
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            color: '#d1d5db'
                        }
                    }
                },
                scales: {
                    x: {
                        ...DARK_CHART_DEFAULTS.scales.x,
                        type: 'time',
                        time: {
                            unit: 'day',
                            displayFormats: {
                                day: 'MMM dd'
                            }
                        },
                        grid: {
                            display: false
                        }
                    },
                    y: {
                        ...DARK_CHART_DEFAULTS.scales.y,
                        beginAtZero: true
                    }
                }
            }
        });
    }

    updateFollowSuccessChart() {
        const ctx = document.getElementById('followSuccessChart').getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.followSuccess) {
            this.charts.followSuccess.destroy();
        }
        
        const { follow_stats } = this.currentData;
        
        if (follow_stats.total === 0) {
            // Show "No data" message
            ctx.fillStyle = '#6b7280';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No follow data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
            return;
        }
        
        this.charts.followSuccess = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Accepted', 'Pending', 'Rejected'],
                datasets: [{
                    data: [
                        follow_stats.accepted,
                        follow_stats.pending,
                        follow_stats.rejected
                    ],
                    backgroundColor: [
                        '#10b981',
                        '#f59e0b',
                        '#ef4444'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    ...DARK_CHART_DEFAULTS.plugins,
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            color: '#d1d5db'
                        }
                    }
                },
                cutout: '60%'
            }
        });
    }

    updateTables() {
        this.updateTopAccountsTable();
        this.updateBotPerformanceTable();
    }

    updateTopAccountsTable() {
        const tbody = document.querySelector('#topAccountsTable tbody');
        tbody.innerHTML = '';
        
        const { top_accounts } = this.currentData;
        
        if (top_accounts.length === 0) {
            const row = tbody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = 'No account data available';
            cell.style.textAlign = 'center';
            cell.style.color = '#6b7280';
            return;
        }
        
        top_accounts.forEach(account => {
            const row = tbody.insertRow();
            
            row.insertCell().textContent = account.username || 'N/A';
            row.insertCell().textContent = account.bot_name;
            row.insertCell().textContent = account.total_messages.toLocaleString();
            row.insertCell().textContent = account.daily_messages.toLocaleString();
            
            const statusCell = row.insertCell();
            const statusBadge = document.createElement('span');
            statusBadge.className = `status-badge status-${account.status}`;
            statusBadge.textContent = account.status;
            statusCell.appendChild(statusBadge);
            
            row.insertCell().textContent = account.last_active;
        });
    }

    updateBotPerformanceTable() {
        const tbody = document.querySelector('#botPerformanceTable tbody');
        tbody.innerHTML = '';
        
        const { bot_performance } = this.currentData;
        
        if (bot_performance.length === 0) {
            const row = tbody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = 'No bot data available';
            cell.style.textAlign = 'center';
            cell.style.color = '#6b7280';
            return;
        }
        
        bot_performance.forEach(bot => {
            const row = tbody.insertRow();
            
            row.insertCell().textContent = bot.bot_name;
            
            const statusCell = row.insertCell();
            const statusBadge = document.createElement('span');
            statusBadge.className = `status-badge status-${bot.status}`;
            statusBadge.textContent = bot.status;
            statusCell.appendChild(statusBadge);
            
            row.insertCell().textContent = bot.accounts_count;
            row.insertCell().textContent = bot.active_accounts;
            row.insertCell().textContent = bot.total_messages.toLocaleString();
            row.insertCell().textContent = bot.leads_count.toLocaleString();
        });
    }

    updateMessageStats() {
        const { message_stats } = this.currentData;
        
        document.getElementById('highlightsSent').textContent = message_stats.highlights_sent.toLocaleString();
        document.getElementById('textMessagesSent').textContent = message_stats.text_messages_sent.toLocaleString();
        document.getElementById('pendingMessages').textContent = message_stats.pending_text_messages.toLocaleString();
        document.getElementById('messageConversion').textContent = `${message_stats.conversion_rate}%`;
    }

    // ── TikTok Analytics ─────────────────────────────────────
    async loadTikTokAnalytics() {
        try {
            const days = document.getElementById('timeFilter').value;
            const botId = document.getElementById('botFilter').value;
            const params = new URLSearchParams({ days });
            if (botId !== 'all') params.append('bot_id', botId);

            const response = await fetch(`/api/analysis/tiktok?${params}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'TikTok analytics failed');

            this.renderEngagementChart(data.daily_engagement);
            this.renderVideosPostedChart(data.videos_posted);
            this.renderPhaseDistribution(data.phase_distribution);
            this.renderFollowBackStats(data.follow_back_stats);
        } catch (err) {
            console.error('TikTok analytics error:', err);
            this._emptyCanvas('engagementChart', 'No TikTok engagement data');
            this._emptyCanvas('videosPostedChart', 'No video post data');
            this._emptyCanvas('phaseDistributionChart', 'No phase data');
            this._emptyCanvas('followBackChart', 'No follow-back data');
        }
    }

    renderEngagementChart(data) {
        const ctx = document.getElementById('engagementChart').getContext('2d');
        if (this.charts.engagement) this.charts.engagement.destroy();

        if (!data || data.length === 0) {
            this._emptyCanvas('engagementChart', 'No engagement data yet');
            return;
        }

        const labels = data.map(d => d.date);
        const makeDs = (label, key, color) => ({
            label, data: data.map(d => d[key] || 0),
            borderColor: color, backgroundColor: color + '20',
            fill: true, tension: 0.4, pointRadius: 2
        });

        this.charts.engagement = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    makeDs('Likes', 'likes', '#e05555'),
                    makeDs('Comments', 'comments', '#4a6fa5'),
                    makeDs('Follows', 'follows', '#5a8a6a'),
                    makeDs('Profile Visits', 'profile_visits', '#7c6bbf'),
                    makeDs('Searches', 'searches', '#e8a838'),
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true, padding: 12 } } },
                scales: {
                    x: { ...DARK_CHART_DEFAULTS.scales.x, type: 'time', time: { unit: 'day', displayFormats: { day: 'MMM dd' } } },
                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true }
                }
            }
        });
    }

    renderVideosPostedChart(data) {
        const ctx = document.getElementById('videosPostedChart').getContext('2d');
        if (this.charts.videosPosted) this.charts.videosPosted.destroy();

        if (!data || data.length === 0) {
            this._emptyCanvas('videosPostedChart', 'No video post data yet');
            return;
        }

        const labels = [...new Set(data.map(d => d.date))];
        const sumByOutcome = (outcome) => labels.map(date =>
            data.filter(d => d.date === date).reduce((s, d) => s + (d[outcome] || 0), 0)
        );

        this.charts.videosPosted = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Posted', data: sumByOutcome('posted'), backgroundColor: '#5a8a6a' },
                    { label: 'Draft', data: sumByOutcome('draft'), backgroundColor: '#e8a838' },
                    { label: 'Skipped', data: sumByOutcome('skipped'), backgroundColor: '#6b7280' },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } } },
                scales: {
                    x: { ...DARK_CHART_DEFAULTS.scales.x, stacked: true },
                    y: { ...DARK_CHART_DEFAULTS.scales.y, stacked: true, beginAtZero: true }
                }
            }
        });
    }

    renderPhaseDistribution(data) {
        const ctx = document.getElementById('phaseDistributionChart').getContext('2d');
        if (this.charts.phaseDistribution) this.charts.phaseDistribution.destroy();

        if (!data || data.length === 0) {
            this._emptyCanvas('phaseDistributionChart', 'No session phase data yet');
            return;
        }

        const accounts = data.map(d => d.account);
        const phases = [
            { key: 'arrival_min', label: 'Arrival', color: '#4a6fa5' },
            { key: 'warmup_min', label: 'Warmup', color: '#e8a838' },
            { key: 'peak_min', label: 'Peak', color: '#e05555' },
            { key: 'fatigue_min', label: 'Fatigue', color: '#7c6bbf' },
            { key: 'exit_min', label: 'Exit', color: '#5a8a6a' },
        ];

        this.charts.phaseDistribution = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: accounts,
                datasets: phases.map(p => ({
                    label: p.label,
                    data: data.map(d => d[p.key] || 0),
                    backgroundColor: p.color,
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    ...DARK_CHART_DEFAULTS.plugins,
                    legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } },
                    tooltip: { ...DARK_CHART_DEFAULTS.plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.x.toFixed(1)} min` } }
                },
                scales: {
                    x: { ...DARK_CHART_DEFAULTS.scales.x, stacked: true, title: { display: true, text: 'Minutes', color: '#9ca3af' } },
                    y: { ...DARK_CHART_DEFAULTS.scales.y, stacked: true }
                }
            }
        });
    }

    renderFollowBackStats(stats) {
        const ctx = document.getElementById('followBackChart').getContext('2d');
        if (this.charts.followBack) this.charts.followBack.destroy();

        if (!stats || stats.total_evaluated === 0) {
            this._emptyCanvas('followBackChart', 'No follow-back data yet');
            document.getElementById('followBackStats').innerHTML = '';
            return;
        }

        const dist = stats.score_distribution || [];
        this.charts.followBack = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dist.map(d => d.range),
                datasets: [{
                    label: 'Profiles',
                    data: dist.map(d => d.count),
                    backgroundColor: '#d62976',
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
                scales: {
                    x: { ...DARK_CHART_DEFAULTS.scales.x, title: { display: true, text: 'Niche Score', color: '#9ca3af' } },
                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true }
                }
            }
        });

        const followRate = stats.total_evaluated > 0
            ? ((stats.total_followed / stats.total_evaluated) * 100).toFixed(1) : '0';
        document.getElementById('followBackStats').innerHTML = `
            <span class="stat-pill">Follow Rate: <span class="pill-value">${followRate}%</span></span>
            <span class="stat-pill">Avg Followed Score: <span class="pill-value">${stats.avg_score_followed}</span></span>
            <span class="stat-pill">Avg Skipped Score: <span class="pill-value">${stats.avg_score_skipped}</span></span>
        `;
    }

    // ── Gemini Analytics ─────────────────────────────────────
    async loadGeminiAnalytics() {
        try {
            const days = document.getElementById('timeFilter').value;
            const botId = document.getElementById('botFilter').value;
            const params = new URLSearchParams({ days });
            if (botId !== 'all') params.append('bot_id', botId);

            const response = await fetch(`/api/analysis/gemini?${params}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Gemini analytics failed');

            this.renderGeminiUsageChart(data);
        } catch (err) {
            console.error('Gemini analytics error:', err);
            this._emptyCanvas('geminiUsageChart', 'No Gemini usage data');
        }
    }

    renderGeminiUsageChart(data) {
        const ctx = document.getElementById('geminiUsageChart').getContext('2d');
        if (this.charts.geminiUsage) this.charts.geminiUsage.destroy();

        const daily = data.daily_calls || [];
        if (daily.length === 0) {
            this._emptyCanvas('geminiUsageChart', 'No Gemini usage data yet');
            document.getElementById('geminiTotalCost').textContent = '$0';
            document.getElementById('geminiErrorRate').textContent = '0%';
            document.getElementById('geminiTopType').textContent = '-';
            return;
        }

        const labels = daily.map(d => d.date);

        this.charts.geminiUsage = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Calls', data: daily.map(d => d.calls),
                        borderColor: '#4a6fa5', backgroundColor: '#4a6fa520',
                        fill: true, tension: 0.4, yAxisID: 'y', pointRadius: 2
                    },
                    {
                        label: 'Cost ($)', data: daily.map(d => d.cost),
                        borderColor: '#5a8a6a', backgroundColor: '#5a8a6a20',
                        fill: true, tension: 0.4, yAxisID: 'y1', pointRadius: 2
                    },
                    {
                        label: 'Errors', data: daily.map(d => d.errors),
                        type: 'bar', backgroundColor: '#e0555560',
                        yAxisID: 'y', barThickness: 8
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } } },
                scales: {
                    x: { ...DARK_CHART_DEFAULTS.scales.x },
                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true, position: 'left', title: { display: true, text: 'Calls', color: '#9ca3af' } },
                    y1: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cost ($)', color: '#9ca3af' } }
                }
            }
        });

        // Update stat boxes
        document.getElementById('geminiTotalCost').textContent = `$${(data.total_cost || 0).toFixed(2)}`;

        const totalCalls = daily.reduce((s, d) => s + d.calls, 0);
        const totalErrors = daily.reduce((s, d) => s + d.errors, 0);
        const errorRate = totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : '0';
        document.getElementById('geminiErrorRate').textContent = `${errorRate}%`;

        const byType = data.by_type || [];
        const topType = byType.length > 0
            ? byType.reduce((a, b) => b.count > a.count ? b : a).type
            : '-';
        document.getElementById('geminiTopType').textContent = topType;
    }

    // ── Content Stock ──────────────────────────────────────────
    async loadContentStock() {
        try {
            const response = await fetch('/api/content/stock');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Content stock failed');
            this.renderContentStockGrid(data);
        } catch (err) {
            console.error('Content stock error:', err);
            document.getElementById('contentStockGrid').innerHTML =
                '<p style="color: var(--text-muted);">No content data</p>';
        }
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    renderContentStockGrid(data) {
        const grid = document.getElementById('contentStockGrid');
        const phones = data.phones || [];

        if (phones.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-muted);">No content data</p>';
            return;
        }

        const colorClass = (days) => {
            if (days === null || days === undefined) return '';
            if (days < 7) return 'stock-red';
            if (days < 14) return 'stock-yellow';
            return 'stock-green';
        };

        const cellContent = (pending, days) => {
            const daysText = (days !== null && days !== undefined) ? days.toFixed(1) : 'N/A';
            return `<strong>${parseInt(pending) || 0}</strong> <span class="stock-days">(${this._escapeHtml(daysText)} days)</span>`;
        };

        let html = '<div class="stock-grid-header">' +
            '<div class="stock-col-phone">Phone</div>' +
            '<div class="stock-col-platform">TikTok</div>' +
            '<div class="stock-col-platform">Instagram</div>' +
            '</div>';

        phones.forEach(p => {
            html += '<div class="stock-grid-row">' +
                `<div class="stock-col-phone">${this._escapeHtml(p.name)}</div>` +
                `<div class="stock-cell ${colorClass(p.tiktok_days)}">${cellContent(p.tiktok_pending, p.tiktok_days)}</div>` +
                `<div class="stock-cell ${colorClass(p.instagram_days)}">${cellContent(p.instagram_pending, p.instagram_days)}</div>` +
                '</div>';
        });

        grid.innerHTML = html;

        // Stale warning
        const staleEl = document.getElementById('stockStaleWarning');
        staleEl.style.display = data.cache_stale ? 'block' : 'none';

        // Timestamp
        const tsEl = document.getElementById('stockTimestamp');
        if (data.last_refresh) {
            const d = new Date(data.last_refresh);
            tsEl.textContent = 'Last refresh: ' + d.toLocaleTimeString();
        }
    }

    async refreshContentStock() {
        const btn = document.getElementById('refreshStockBtn');
        const icon = btn.querySelector('i');
        btn.disabled = true;
        icon.classList.add('fa-spin');

        try {
            const response = await fetch('/api/content/stock/refresh', { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Refresh failed');
            this.renderContentStockGrid(data);
        } catch (err) {
            console.error('Content stock refresh error:', err);
            const staleEl = document.getElementById('stockStaleWarning');
            if (staleEl) staleEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            icon.classList.remove('fa-spin');
        }
    }

    // ── Canvas empty state helper ────────────────────────────
    _emptyCanvas(canvasId, message) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        // Destroy any existing Chart.js instance on this canvas
        const chartKey = Object.keys(this.charts).find(k => {
            const c = this.charts[k];
            return c && c.canvas === canvas;
        });
        if (chartKey) {
            this.charts[chartKey].destroy();
            delete this.charts[chartKey];
        }
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, rect.width / 2, rect.height / 2);
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new AnalyticsDashboard();
});

// Handle window resize for chart responsiveness
window.addEventListener('resize', () => {
    Object.values(window.dashboard?.charts || {}).forEach(chart => {
        if (chart && typeof chart.resize === 'function') {
            chart.resize();
        }
    });
});

// Export for global access if needed
window.AnalyticsDashboard = AnalyticsDashboard;
