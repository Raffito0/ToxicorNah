diff --git a/insta-phone-SAAS-sneder/app/static/css/analysis.css b/insta-phone-SAAS-sneder/app/static/css/analysis.css
new file mode 100644
index 0000000..03ecac1
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/static/css/analysis.css
@@ -0,0 +1,520 @@
+/* Analysis Dashboard Styles */
+
+body {
+    margin: 0;
+    padding: 0;
+    display: flex;
+    min-height: 100vh;
+}
+
+.main-content {
+    flex: 1;
+    margin-left: 80px; /* Account for sidebar width */
+    background: var(--bg-secondary);
+    min-height: 100vh;
+}
+
+.analytics-content {
+    padding: 20px;
+}
+
+/* Header Styles */
+.header {
+    display: flex;
+    justify-content: space-between;
+    align-items: center;
+    margin-bottom: 30px;
+    padding: 20px;
+    background: var(--card-bg);
+    border-radius: 12px;
+    box-shadow: var(--shadow);
+}
+
+.header-left h1 {
+    margin: 0;
+    color: var(--text-primary);
+    font-size: 2rem;
+    font-weight: 600;
+}
+
+.header-left p {
+    margin: 5px 0 0 0;
+    color: var(--text-secondary);
+    font-size: 0.95rem;
+}
+
+.header-right {
+    display: flex;
+    align-items: center;
+}
+
+.filter-controls {
+    display: flex;
+    gap: 12px;
+    align-items: center;
+}
+
+/* Match selects with history/leads styling */
+.form-select {
+    padding: 10px 14px;
+    height: 38px;
+    border: 1px solid #333;
+    border-radius: 8px;
+    background: #0f1214;
+    color: #fff;
+    font-size: 0.95rem;
+    min-width: 140px;
+    max-width: 220px;
+    appearance: none;
+    -webkit-appearance: none;
+    -moz-appearance: none;
+    transition: border-color 0.2s, box-shadow 0.2s;
+}
+
+.form-select:focus {
+    outline: none;
+    border-color: #d62976;
+    box-shadow: 0 0 0 3px rgba(214, 41, 118, 0.1);
+}
+
+/* Button sizing to avoid thin appearance */
+.filter-controls .btn,
+.filter-controls button {
+    padding: 10px 14px;
+    height: 38px;
+    border-radius: 8px;
+    font-weight: 500;
+}
+
+/* Provide base .btn style in case Bootstrap is not loaded */
+.btn {
+    display: inline-flex;
+    align-items: center;
+    justify-content: center;
+    border: none;
+    cursor: pointer;
+}
+
+/* Loading Spinner */
+.loading-spinner {
+    display: flex;
+    flex-direction: column;
+    align-items: center;
+    justify-content: center;
+    padding: 60px 20px;
+    text-align: center;
+}
+
+.spinner {
+    width: 50px;
+    height: 50px;
+    border: 4px solid var(--border-color);
+    border-top: 4px solid var(--primary-color);
+    border-radius: 50%;
+    animation: spin 1s linear infinite;
+    margin-bottom: 20px;
+}
+
+@keyframes spin {
+    0% { transform: rotate(0deg); }
+    100% { transform: rotate(360deg); }
+}
+
+.loading-spinner p {
+    color: var(--text-secondary);
+    font-size: 1rem;
+    margin: 0;
+}
+
+/* Overview Cards */
+.overview-cards {
+    display: grid;
+    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+.overview-card {
+    background: var(--card-bg);
+    border-radius: 12px;
+    padding: 24px;
+    display: flex;
+    align-items: center;
+    gap: 16px;
+    box-shadow: var(--shadow);
+    transition: transform 0.3s ease, box-shadow 0.3s ease;
+}
+
+.overview-card:hover {
+    transform: translateY(-2px);
+    box-shadow: var(--shadow-hover);
+}
+
+.card-icon {
+    width: 50px;
+    height: 50px;
+    border-radius: 10px;
+    display: flex;
+    align-items: center;
+    justify-content: center;
+    font-size: 1.5rem;
+    color: white;
+    flex-shrink: 0;
+}
+
+.card-icon.blue { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
+.card-icon.green { background: linear-gradient(135deg, #10b981, #047857); }
+.card-icon.orange { background: linear-gradient(135deg, #f59e0b, #d97706); }
+.card-icon.purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
+.card-icon.red { background: linear-gradient(135deg, #ef4444, #dc2626); }
+
+.card-content {
+    flex: 1;
+}
+
+.card-content h3 {
+    font-size: 2rem;
+    font-weight: 700;
+    margin: 0 0 4px 0;
+    color: var(--text-primary);
+}
+
+.card-content p {
+    font-size: 0.95rem;
+    color: var(--text-secondary);
+    margin: 0 0 4px 0;
+}
+
+.card-content small {
+    font-size: 0.85rem;
+    color: var(--text-muted);
+}
+
+/* Charts Row */
+.charts-row {
+    display: grid;
+    grid-template-columns: 2fr 1fr;
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+.chart-container {
+    background: var(--card-bg);
+    border-radius: 12px;
+    padding: 24px;
+    box-shadow: var(--shadow);
+}
+
+.chart-header {
+    margin-bottom: 20px;
+}
+
+.chart-header h3 {
+    font-size: 1.25rem;
+    font-weight: 600;
+    color: var(--text-primary);
+    margin: 0 0 4px 0;
+}
+
+.chart-header p {
+    font-size: 0.9rem;
+    color: var(--text-secondary);
+    margin: 0;
+}
+
+.chart-container canvas {
+    max-height: 300px;
+}
+
+/* Tables Row */
+.tables-row {
+    display: grid;
+    grid-template-columns: 1fr 1fr;
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+.table-container {
+    background: var(--card-bg);
+    border-radius: 12px;
+    padding: 24px;
+    box-shadow: var(--shadow);
+}
+
+.table-header {
+    margin-bottom: 20px;
+}
+
+.table-header h3 {
+    font-size: 1.25rem;
+    font-weight: 600;
+    color: var(--text-primary);
+    margin: 0 0 4px 0;
+}
+
+.table-header p {
+    font-size: 0.9rem;
+    color: var(--text-secondary);
+    margin: 0;
+}
+
+.table-wrapper {
+    overflow-x: auto;
+}
+
+.performance-table {
+    width: 100%;
+    border-collapse: collapse;
+    font-size: 0.9rem;
+}
+
+.performance-table th {
+    text-align: left;
+    padding: 12px 8px;
+    color: var(--text-secondary);
+    font-weight: 600;
+    border-bottom: 2px solid var(--border-color);
+    white-space: nowrap;
+}
+
+.performance-table td {
+    padding: 12px 8px;
+    color: var(--text-primary);
+    border-bottom: 1px solid var(--border-light);
+}
+
+.performance-table tbody tr:hover {
+    background: var(--hover-bg);
+}
+
+/* Status badges */
+.status-badge {
+    padding: 4px 8px;
+    border-radius: 6px;
+    font-size: 0.75rem;
+    font-weight: 600;
+    text-transform: uppercase;
+}
+
+.status-active { background: #dcfce7; color: #166534; }
+.status-pending { background: #fef3c7; color: #92400e; }
+.status-stopped { background: #fee2e2; color: #991b1b; }
+
+/* Stats Row */
+.stats-row {
+    display: grid;
+    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+.stat-card {
+    background: var(--card-bg);
+    border-radius: 12px;
+    padding: 20px;
+    display: flex;
+    align-items: center;
+    gap: 16px;
+    box-shadow: var(--shadow);
+    transition: transform 0.3s ease;
+}
+
+.stat-card:hover {
+    transform: translateY(-2px);
+}
+
+.stat-icon {
+    width: 40px;
+    height: 40px;
+    border-radius: 8px;
+    background: linear-gradient(135deg, var(--primary-color), var(--primary-dark));
+    display: flex;
+    align-items: center;
+    justify-content: center;
+    color: white;
+    font-size: 1.2rem;
+}
+
+.stat-content h4 {
+    font-size: 1.5rem;
+    font-weight: 700;
+    margin: 0 0 4px 0;
+    color: var(--text-primary);
+}
+
+.stat-content p {
+    font-size: 0.9rem;
+    color: var(--text-secondary);
+    margin: 0;
+}
+
+/* Error Message */
+.error-message {
+    display: flex;
+    align-items: center;
+    justify-content: center;
+    padding: 60px 20px;
+    text-align: center;
+}
+
+.error-content {
+    max-width: 400px;
+}
+
+.error-content i {
+    font-size: 3rem;
+    color: #ef4444;
+    margin-bottom: 20px;
+}
+
+.error-content h3 {
+    color: var(--text-primary);
+    margin-bottom: 10px;
+}
+
+.error-content p {
+    color: var(--text-secondary);
+    margin-bottom: 20px;
+}
+
+/* TikTok Charts Row */
+.tiktok-charts-row {
+    display: grid;
+    grid-template-columns: 1fr 1fr;
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+/* Gemini Stats Row */
+.gemini-stats-row {
+    display: flex;
+    gap: 20px;
+    margin-bottom: 30px;
+}
+
+.gemini-stat-boxes {
+    display: flex;
+    flex-direction: column;
+    gap: 12px;
+    flex: 1;
+    min-width: 200px;
+}
+
+/* Stat Pills (follow-back) */
+.stat-pills {
+    display: flex;
+    gap: 10px;
+    margin-top: 16px;
+    flex-wrap: wrap;
+}
+
+.stat-pill {
+    display: inline-flex;
+    align-items: center;
+    gap: 6px;
+    padding: 6px 14px;
+    border-radius: 20px;
+    font-size: 0.82rem;
+    font-weight: 600;
+    background: rgba(255,255,255,0.05);
+    color: #d1d5db;
+}
+
+.stat-pill .pill-value {
+    color: #d62976;
+}
+
+/* Sidebar alignment fix for analytics page */
+.sidebar {
+    padding-bottom: 24px;
+}
+
+.sidebar .logout-icon {
+    margin-top: auto;
+    margin-bottom: 60px;
+}
+
+/* Responsive Design */
+@media (max-width: 1200px) {
+    .charts-row {
+        grid-template-columns: 1fr;
+    }
+
+    .tables-row {
+        grid-template-columns: 1fr;
+    }
+
+    .tiktok-charts-row {
+        grid-template-columns: 1fr;
+    }
+
+    .gemini-stats-row {
+        flex-direction: column;
+    }
+
+    .gemini-stat-boxes {
+        flex-direction: row;
+    }
+}
+
+@media (max-width: 768px) {
+    .header {
+        flex-direction: column;
+        gap: 20px;
+        text-align: center;
+    }
+    
+    .filter-controls {
+        flex-direction: column;
+        width: 100%;
+    }
+    
+    .form-select {
+        width: 100%;
+    }
+    
+    .overview-cards {
+        grid-template-columns: 1fr;
+    }
+    
+    .stats-row {
+        grid-template-columns: repeat(2, 1fr);
+    }
+    
+    .performance-table {
+        font-size: 0.8rem;
+    }
+    
+    .performance-table th,
+    .performance-table td {
+        padding: 8px 4px;
+    }
+}
+
+@media (max-width: 480px) {
+    .analytics-content {
+        padding: 15px;
+    }
+    
+    .header {
+        padding: 15px;
+    }
+    
+    .overview-card,
+    .chart-container,
+    .table-container,
+    .stat-card {
+        padding: 16px;
+    }
+    
+    .stats-row {
+        grid-template-columns: 1fr;
+    }
+}
+
+/* Dark mode adjustments */
+@media (prefers-color-scheme: dark) {
+    .status-active { background: #166534; color: #dcfce7; }
+    .status-pending { background: #92400e; color: #fef3c7; }
+    .status-stopped { background: #991b1b; color: #fee2e2; }
+}
diff --git a/insta-phone-SAAS-sneder/app/static/js/analysis.js b/insta-phone-SAAS-sneder/app/static/js/analysis.js
new file mode 100644
index 0000000..cb3e0c0
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/static/js/analysis.js
@@ -0,0 +1,696 @@
+// Analysis Dashboard JavaScript
+
+const DARK_CHART_DEFAULTS = {
+    color: '#d1d5db',
+    borderColor: 'rgba(255,255,255,0.05)',
+    plugins: {
+        legend: { labels: { color: '#d1d5db' } },
+        tooltip: { backgroundColor: '#1e1e1e', titleColor: '#fff', bodyColor: '#d1d5db' }
+    },
+    scales: {
+        x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
+        y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } }
+    }
+};
+
+class AnalyticsDashboard {
+    constructor() {
+        this.charts = {};
+        this.currentData = null;
+        this.initializeEventListeners();
+        this.loadBotOptions();
+        this.loadDashboard();
+    }
+
+    initializeEventListeners() {
+        // Filter change events
+        document.getElementById('botFilter').addEventListener('change', () => {
+            this.loadDashboard();
+        });
+
+        document.getElementById('timeFilter').addEventListener('change', () => {
+            this.loadDashboard();
+        });
+
+        // Refresh button
+        document.getElementById('refreshBtn').addEventListener('click', () => {
+            this.loadDashboard();
+        });
+
+        // Retry button
+        document.getElementById('retryBtn').addEventListener('click', () => {
+            this.loadDashboard();
+        });
+    }
+
+    async loadBotOptions() {
+        try {
+            const response = await fetch('/get_user_bots');
+            const data = await response.json();
+            
+            if (data.success) {
+                const botFilter = document.getElementById('botFilter');
+                // Clear existing options except "All Bots"
+                botFilter.innerHTML = '<option value="all">All Bots</option>';
+                
+                data.bots.forEach(bot => {
+                    const option = document.createElement('option');
+                    option.value = bot.id;
+                    option.textContent = bot.name;
+                    botFilter.appendChild(option);
+                });
+            }
+        } catch (error) {
+            console.error('Failed to load bot options:', error);
+        }
+    }
+
+    async loadDashboard() {
+        this.showLoading();
+        
+        try {
+            const botId = document.getElementById('botFilter').value;
+            const days = document.getElementById('timeFilter').value;
+            
+            const params = new URLSearchParams();
+            if (botId !== 'all') params.append('bot_id', botId);
+            params.append('days', days);
+            
+            const response = await fetch(`/api/analysis/dashboard?${params}`);
+            const result = await response.json();
+            
+            if (!response.ok || !result.success) {
+                throw new Error(result.message || 'Failed to load analytics data');
+            }
+            
+            this.currentData = result.data;
+            this.updateDashboard();
+            this.showContent();
+            
+        } catch (error) {
+            console.error('Dashboard load error:', error);
+            this.showError(error.message);
+        }
+    }
+
+    showLoading() {
+        document.getElementById('loadingSpinner').style.display = 'flex';
+        document.getElementById('analyticsContent').style.display = 'none';
+        document.getElementById('errorMessage').style.display = 'none';
+    }
+
+    showContent() {
+        document.getElementById('loadingSpinner').style.display = 'none';
+        document.getElementById('analyticsContent').style.display = 'block';
+        document.getElementById('errorMessage').style.display = 'none';
+    }
+
+    showError(message) {
+        document.getElementById('loadingSpinner').style.display = 'none';
+        document.getElementById('analyticsContent').style.display = 'none';
+        document.getElementById('errorMessage').style.display = 'flex';
+        document.getElementById('errorText').textContent = message;
+    }
+
+    updateDashboard() {
+        this.updateOverviewCards();
+        this.updateCharts();
+        this.updateTables();
+        this.updateMessageStats();
+    }
+
+    updateOverviewCards() {
+        const { overview, account_status_distribution, message_stats } = this.currentData;
+        
+        // Update basic counts
+        document.getElementById('totalBots').textContent = overview.total_bots;
+        document.getElementById('activeBots').textContent = `${overview.active_bots} active`;
+        document.getElementById('totalAccounts').textContent = overview.total_accounts;
+        document.getElementById('totalLeads').textContent = overview.total_leads;
+        document.getElementById('totalHighlights').textContent = overview.total_highlights;
+        document.getElementById('totalTextMessages').textContent = overview.total_text_messages;
+        
+        // Update account status
+        const statusTexts = [];
+        Object.entries(account_status_distribution).forEach(([status, count]) => {
+            if (count > 0) {
+                statusTexts.push(`${count} ${status}`);
+            }
+        });
+        document.getElementById('accountsStatus').textContent = statusTexts.join(', ') || 'No accounts';
+        
+        // Update conversion rates
+        const conversionRate = overview.total_leads > 0 
+            ? ((overview.total_messaged / overview.total_leads) * 100).toFixed(1)
+            : '0';
+        document.getElementById('conversionRate').textContent = `${conversionRate}% conversion`;
+        
+        // Update highlight success info
+        document.getElementById('highlightSuccess').textContent = `${overview.total_highlights} highlights sent`;
+        
+        const messageSuccessRate = message_stats.conversion_rate || 0;
+        document.getElementById('messageSuccess').textContent = `${messageSuccessRate}% conversion rate`;
+    }
+
+    updateCharts() {
+        this.updateDailyActivityChart();
+        this.updateFollowSuccessChart();
+        this.loadTikTokAnalytics();
+        this.loadGeminiAnalytics();
+    }
+
+    updateDailyActivityChart() {
+        const ctx = document.getElementById('dailyActivityChart').getContext('2d');
+        
+        // Destroy existing chart if it exists
+        if (this.charts.dailyActivity) {
+            this.charts.dailyActivity.destroy();
+        }
+        
+        const { daily_activity } = this.currentData;
+        
+        const labels = daily_activity.map(item => item.date);
+        const highlightsData = daily_activity.map(item => item.highlights);
+        const textMessagesData = daily_activity.map(item => item.text_messages);
+        const followsData = daily_activity.map(item => item.follows);
+        
+        this.charts.dailyActivity = new Chart(ctx, {
+            type: 'line',
+            data: {
+                labels: labels,
+                datasets: [
+                    {
+                        label: 'Highlights Sent',
+                        data: highlightsData,
+                        borderColor: '#8b5cf6',
+                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
+                        fill: true,
+                        tension: 0.4
+                    },
+                    {
+                        label: 'Text Messages',
+                        data: textMessagesData,
+                        borderColor: '#3b82f6',
+                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
+                        fill: true,
+                        tension: 0.4
+                    },
+                    {
+                        label: 'Follows',
+                        data: followsData,
+                        borderColor: '#10b981',
+                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
+                        fill: true,
+                        tension: 0.4
+                    }
+                ]
+            },
+            options: {
+                responsive: true,
+                maintainAspectRatio: false,
+                interaction: {
+                    intersect: false,
+                    mode: 'index'
+                },
+                plugins: {
+                    legend: {
+                        position: 'top',
+                        labels: {
+                            usePointStyle: true,
+                            padding: 20
+                        }
+                    }
+                },
+                scales: {
+                    x: {
+                        type: 'time',
+                        time: {
+                            unit: 'day',
+                            displayFormats: {
+                                day: 'MMM dd'
+                            }
+                        },
+                        grid: {
+                            display: false
+                        }
+                    },
+                    y: {
+                        beginAtZero: true,
+                        grid: {
+                            color: 'rgba(0,0,0,0.1)'
+                        }
+                    }
+                }
+            }
+        });
+    }
+
+    updateFollowSuccessChart() {
+        const ctx = document.getElementById('followSuccessChart').getContext('2d');
+        
+        // Destroy existing chart if it exists
+        if (this.charts.followSuccess) {
+            this.charts.followSuccess.destroy();
+        }
+        
+        const { follow_stats } = this.currentData;
+        
+        if (follow_stats.total === 0) {
+            // Show "No data" message
+            ctx.fillStyle = '#6b7280';
+            ctx.font = '16px Arial';
+            ctx.textAlign = 'center';
+            ctx.fillText('No follow data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
+            return;
+        }
+        
+        this.charts.followSuccess = new Chart(ctx, {
+            type: 'doughnut',
+            data: {
+                labels: ['Accepted', 'Pending', 'Rejected'],
+                datasets: [{
+                    data: [
+                        follow_stats.accepted,
+                        follow_stats.pending,
+                        follow_stats.rejected
+                    ],
+                    backgroundColor: [
+                        '#10b981',
+                        '#f59e0b',
+                        '#ef4444'
+                    ],
+                    borderWidth: 0
+                }]
+            },
+            options: {
+                responsive: true,
+                maintainAspectRatio: false,
+                plugins: {
+                    legend: {
+                        position: 'bottom',
+                        labels: {
+                            usePointStyle: true,
+                            padding: 20
+                        }
+                    }
+                },
+                cutout: '60%'
+            }
+        });
+    }
+
+    updateTables() {
+        this.updateTopAccountsTable();
+        this.updateBotPerformanceTable();
+    }
+
+    updateTopAccountsTable() {
+        const tbody = document.querySelector('#topAccountsTable tbody');
+        tbody.innerHTML = '';
+        
+        const { top_accounts } = this.currentData;
+        
+        if (top_accounts.length === 0) {
+            const row = tbody.insertRow();
+            const cell = row.insertCell();
+            cell.colSpan = 6;
+            cell.textContent = 'No account data available';
+            cell.style.textAlign = 'center';
+            cell.style.color = '#6b7280';
+            return;
+        }
+        
+        top_accounts.forEach(account => {
+            const row = tbody.insertRow();
+            
+            row.insertCell().textContent = account.username || 'N/A';
+            row.insertCell().textContent = account.bot_name;
+            row.insertCell().textContent = account.total_messages.toLocaleString();
+            row.insertCell().textContent = account.daily_messages.toLocaleString();
+            
+            const statusCell = row.insertCell();
+            const statusBadge = document.createElement('span');
+            statusBadge.className = `status-badge status-${account.status}`;
+            statusBadge.textContent = account.status;
+            statusCell.appendChild(statusBadge);
+            
+            row.insertCell().textContent = account.last_active;
+        });
+    }
+
+    updateBotPerformanceTable() {
+        const tbody = document.querySelector('#botPerformanceTable tbody');
+        tbody.innerHTML = '';
+        
+        const { bot_performance } = this.currentData;
+        
+        if (bot_performance.length === 0) {
+            const row = tbody.insertRow();
+            const cell = row.insertCell();
+            cell.colSpan = 6;
+            cell.textContent = 'No bot data available';
+            cell.style.textAlign = 'center';
+            cell.style.color = '#6b7280';
+            return;
+        }
+        
+        bot_performance.forEach(bot => {
+            const row = tbody.insertRow();
+            
+            row.insertCell().textContent = bot.bot_name;
+            
+            const statusCell = row.insertCell();
+            const statusBadge = document.createElement('span');
+            statusBadge.className = `status-badge status-${bot.status}`;
+            statusBadge.textContent = bot.status;
+            statusCell.appendChild(statusBadge);
+            
+            row.insertCell().textContent = bot.accounts_count;
+            row.insertCell().textContent = bot.active_accounts;
+            row.insertCell().textContent = bot.total_messages.toLocaleString();
+            row.insertCell().textContent = bot.leads_count.toLocaleString();
+        });
+    }
+
+    updateMessageStats() {
+        const { message_stats } = this.currentData;
+        
+        document.getElementById('highlightsSent').textContent = message_stats.highlights_sent.toLocaleString();
+        document.getElementById('textMessagesSent').textContent = message_stats.text_messages_sent.toLocaleString();
+        document.getElementById('pendingMessages').textContent = message_stats.pending_text_messages.toLocaleString();
+        document.getElementById('messageConversion').textContent = `${message_stats.conversion_rate}%`;
+    }
+
+    // ── TikTok Analytics ─────────────────────────────────────
+    async loadTikTokAnalytics() {
+        try {
+            const days = document.getElementById('timeFilter').value;
+            const botId = document.getElementById('botFilter').value;
+            const params = new URLSearchParams({ days });
+            if (botId !== 'all') params.append('bot_id', botId);
+
+            const response = await fetch(`/api/analysis/tiktok?${params}`);
+            const data = await response.json();
+            if (!response.ok) throw new Error(data.message || 'TikTok analytics failed');
+
+            this.renderEngagementChart(data.daily_engagement);
+            this.renderVideosPostedChart(data.videos_posted);
+            this.renderPhaseDistribution(data.phase_distribution);
+            this.renderFollowBackStats(data.follow_back_stats);
+        } catch (err) {
+            console.error('TikTok analytics error:', err);
+            this._emptyCanvas('engagementChart', 'No TikTok engagement data');
+            this._emptyCanvas('videosPostedChart', 'No video post data');
+            this._emptyCanvas('phaseDistributionChart', 'No phase data');
+            this._emptyCanvas('followBackChart', 'No follow-back data');
+        }
+    }
+
+    renderEngagementChart(data) {
+        const ctx = document.getElementById('engagementChart').getContext('2d');
+        if (this.charts.engagement) this.charts.engagement.destroy();
+
+        if (!data || data.length === 0) {
+            this._emptyCanvas('engagementChart', 'No engagement data yet');
+            return;
+        }
+
+        const labels = data.map(d => d.date);
+        const makeDs = (label, key, color) => ({
+            label, data: data.map(d => d[key] || 0),
+            borderColor: color, backgroundColor: color + '20',
+            fill: true, tension: 0.4, pointRadius: 2
+        });
+
+        this.charts.engagement = new Chart(ctx, {
+            type: 'line',
+            data: {
+                labels,
+                datasets: [
+                    makeDs('Likes', 'likes', '#e05555'),
+                    makeDs('Comments', 'comments', '#4a6fa5'),
+                    makeDs('Follows', 'follows', '#5a8a6a'),
+                    makeDs('Profile Visits', 'profile_visits', '#7c6bbf'),
+                    makeDs('Searches', 'searches', '#e8a838'),
+                ]
+            },
+            options: {
+                responsive: true, maintainAspectRatio: false,
+                interaction: { intersect: false, mode: 'index' },
+                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true, padding: 12 } } },
+                scales: {
+                    x: { ...DARK_CHART_DEFAULTS.scales.x, type: 'time', time: { unit: 'day', displayFormats: { day: 'MMM dd' } } },
+                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true }
+                }
+            }
+        });
+    }
+
+    renderVideosPostedChart(data) {
+        const ctx = document.getElementById('videosPostedChart').getContext('2d');
+        if (this.charts.videosPosted) this.charts.videosPosted.destroy();
+
+        if (!data || data.length === 0) {
+            this._emptyCanvas('videosPostedChart', 'No video post data yet');
+            return;
+        }
+
+        const labels = [...new Set(data.map(d => d.date))];
+        const sumByOutcome = (outcome) => labels.map(date =>
+            data.filter(d => d.date === date).reduce((s, d) => s + (d[outcome] || 0), 0)
+        );
+
+        this.charts.videosPosted = new Chart(ctx, {
+            type: 'bar',
+            data: {
+                labels,
+                datasets: [
+                    { label: 'Posted', data: sumByOutcome('posted'), backgroundColor: '#5a8a6a' },
+                    { label: 'Draft', data: sumByOutcome('draft'), backgroundColor: '#e8a838' },
+                    { label: 'Skipped', data: sumByOutcome('skipped'), backgroundColor: '#6b7280' },
+                ]
+            },
+            options: {
+                responsive: true, maintainAspectRatio: false,
+                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } } },
+                scales: {
+                    x: { ...DARK_CHART_DEFAULTS.scales.x, stacked: true },
+                    y: { ...DARK_CHART_DEFAULTS.scales.y, stacked: true, beginAtZero: true }
+                }
+            }
+        });
+    }
+
+    renderPhaseDistribution(data) {
+        const ctx = document.getElementById('phaseDistributionChart').getContext('2d');
+        if (this.charts.phaseDistribution) this.charts.phaseDistribution.destroy();
+
+        if (!data || data.length === 0) {
+            this._emptyCanvas('phaseDistributionChart', 'No session phase data yet');
+            return;
+        }
+
+        const accounts = data.map(d => d.account);
+        const phases = [
+            { key: 'arrival_min', label: 'Arrival', color: '#4a6fa5' },
+            { key: 'warmup_min', label: 'Warmup', color: '#e8a838' },
+            { key: 'peak_min', label: 'Peak', color: '#e05555' },
+            { key: 'fatigue_min', label: 'Fatigue', color: '#7c6bbf' },
+            { key: 'exit_min', label: 'Exit', color: '#5a8a6a' },
+        ];
+
+        this.charts.phaseDistribution = new Chart(ctx, {
+            type: 'bar',
+            data: {
+                labels: accounts,
+                datasets: phases.map(p => ({
+                    label: p.label,
+                    data: data.map(d => d[p.key] || 0),
+                    backgroundColor: p.color,
+                }))
+            },
+            options: {
+                responsive: true, maintainAspectRatio: false,
+                indexAxis: 'y',
+                plugins: {
+                    ...DARK_CHART_DEFAULTS.plugins,
+                    legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } },
+                    tooltip: { ...DARK_CHART_DEFAULTS.plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.x.toFixed(1)} min` } }
+                },
+                scales: {
+                    x: { ...DARK_CHART_DEFAULTS.scales.x, stacked: true, title: { display: true, text: 'Minutes', color: '#9ca3af' } },
+                    y: { ...DARK_CHART_DEFAULTS.scales.y, stacked: true }
+                }
+            }
+        });
+    }
+
+    renderFollowBackStats(stats) {
+        const ctx = document.getElementById('followBackChart').getContext('2d');
+        if (this.charts.followBack) this.charts.followBack.destroy();
+
+        if (!stats || stats.total_evaluated === 0) {
+            this._emptyCanvas('followBackChart', 'No follow-back data yet');
+            document.getElementById('followBackStats').innerHTML = '';
+            return;
+        }
+
+        const dist = stats.score_distribution || [];
+        this.charts.followBack = new Chart(ctx, {
+            type: 'bar',
+            data: {
+                labels: dist.map(d => d.range),
+                datasets: [{
+                    label: 'Profiles',
+                    data: dist.map(d => d.count),
+                    backgroundColor: '#d62976',
+                    borderRadius: 4,
+                }]
+            },
+            options: {
+                responsive: true, maintainAspectRatio: false,
+                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { display: false } },
+                scales: {
+                    x: { ...DARK_CHART_DEFAULTS.scales.x, title: { display: true, text: 'Niche Score', color: '#9ca3af' } },
+                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true }
+                }
+            }
+        });
+
+        const followRate = stats.total_evaluated > 0
+            ? ((stats.total_followed / stats.total_evaluated) * 100).toFixed(1) : '0';
+        document.getElementById('followBackStats').innerHTML = `
+            <span class="stat-pill">Follow Rate: <span class="pill-value">${followRate}%</span></span>
+            <span class="stat-pill">Avg Followed Score: <span class="pill-value">${stats.avg_score_followed}</span></span>
+            <span class="stat-pill">Avg Skipped Score: <span class="pill-value">${stats.avg_score_skipped}</span></span>
+        `;
+    }
+
+    // ── Gemini Analytics ─────────────────────────────────────
+    async loadGeminiAnalytics() {
+        try {
+            const days = document.getElementById('timeFilter').value;
+            const params = new URLSearchParams({ days });
+
+            const response = await fetch(`/api/analysis/gemini?${params}`);
+            const data = await response.json();
+            if (!response.ok) throw new Error(data.message || 'Gemini analytics failed');
+
+            this.renderGeminiUsageChart(data);
+        } catch (err) {
+            console.error('Gemini analytics error:', err);
+            this._emptyCanvas('geminiUsageChart', 'No Gemini usage data');
+        }
+    }
+
+    renderGeminiUsageChart(data) {
+        const ctx = document.getElementById('geminiUsageChart').getContext('2d');
+        if (this.charts.geminiUsage) this.charts.geminiUsage.destroy();
+
+        const daily = data.daily_calls || [];
+        if (daily.length === 0) {
+            this._emptyCanvas('geminiUsageChart', 'No Gemini usage data yet');
+            document.getElementById('geminiTotalCost').textContent = '$0';
+            document.getElementById('geminiErrorRate').textContent = '0%';
+            document.getElementById('geminiTopType').textContent = '-';
+            return;
+        }
+
+        const labels = daily.map(d => d.date);
+
+        this.charts.geminiUsage = new Chart(ctx, {
+            type: 'line',
+            data: {
+                labels,
+                datasets: [
+                    {
+                        label: 'Calls', data: daily.map(d => d.calls),
+                        borderColor: '#4a6fa5', backgroundColor: '#4a6fa520',
+                        fill: true, tension: 0.4, yAxisID: 'y', pointRadius: 2
+                    },
+                    {
+                        label: 'Cost ($)', data: daily.map(d => d.cost),
+                        borderColor: '#5a8a6a', backgroundColor: '#5a8a6a20',
+                        fill: true, tension: 0.4, yAxisID: 'y1', pointRadius: 2
+                    },
+                    {
+                        label: 'Errors', data: daily.map(d => d.errors),
+                        type: 'bar', backgroundColor: '#e0555560',
+                        yAxisID: 'y', barThickness: 8
+                    }
+                ]
+            },
+            options: {
+                responsive: true, maintainAspectRatio: false,
+                interaction: { intersect: false, mode: 'index' },
+                plugins: { ...DARK_CHART_DEFAULTS.plugins, legend: { position: 'top', labels: { color: '#d1d5db', usePointStyle: true } } },
+                scales: {
+                    x: { ...DARK_CHART_DEFAULTS.scales.x },
+                    y: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true, position: 'left', title: { display: true, text: 'Calls', color: '#9ca3af' } },
+                    y1: { ...DARK_CHART_DEFAULTS.scales.y, beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Cost ($)', color: '#9ca3af' } }
+                }
+            }
+        });
+
+        // Update stat boxes
+        document.getElementById('geminiTotalCost').textContent = `$${(data.total_cost || 0).toFixed(2)}`;
+
+        const totalCalls = daily.reduce((s, d) => s + d.calls, 0);
+        const totalErrors = daily.reduce((s, d) => s + d.errors, 0);
+        const errorRate = totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : '0';
+        document.getElementById('geminiErrorRate').textContent = `${errorRate}%`;
+
+        const byType = data.by_type || [];
+        const topType = byType.length > 0
+            ? byType.reduce((a, b) => b.count > a.count ? b : a).type
+            : '-';
+        document.getElementById('geminiTopType').textContent = topType;
+    }
+
+    // ── Canvas empty state helper ────────────────────────────
+    _emptyCanvas(canvasId, message) {
+        const canvas = document.getElementById(canvasId);
+        if (!canvas) return;
+        const ctx = canvas.getContext('2d');
+        ctx.clearRect(0, 0, canvas.width, canvas.height);
+        ctx.fillStyle = '#6b7280';
+        ctx.font = '14px Arial';
+        ctx.textAlign = 'center';
+        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
+    }
+
+    formatNumber(num) {
+        if (num >= 1000000) {
+            return (num / 1000000).toFixed(1) + 'M';
+        }
+        if (num >= 1000) {
+            return (num / 1000).toFixed(1) + 'K';
+        }
+        return num.toString();
+    }
+
+    formatDate(dateString) {
+        const date = new Date(dateString);
+        return date.toLocaleDateString('en-US', {
+            month: 'short',
+            day: 'numeric'
+        });
+    }
+}
+
+// Initialize dashboard when DOM is loaded
+document.addEventListener('DOMContentLoaded', () => {
+    new AnalyticsDashboard();
+});
+
+// Handle window resize for chart responsiveness
+window.addEventListener('resize', () => {
+    Object.values(window.dashboard?.charts || {}).forEach(chart => {
+        if (chart && typeof chart.resize === 'function') {
+            chart.resize();
+        }
+    });
+});
+
+// Export for global access if needed
+window.AnalyticsDashboard = AnalyticsDashboard;
diff --git a/insta-phone-SAAS-sneder/app/templates/analysis.html b/insta-phone-SAAS-sneder/app/templates/analysis.html
new file mode 100644
index 0000000..9410c1f
--- /dev/null
+++ b/insta-phone-SAAS-sneder/app/templates/analysis.html
@@ -0,0 +1,351 @@
+<!DOCTYPE html>
+<html lang="en">
+<head>
+    <meta charset="UTF-8">
+    <meta name="viewport" content="width=device-width, initial-scale=1.0">
+    <title>Analytics Dashboard</title>
+    
+    <!-- Chart.js -->
+    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
+    <script src="https://cdn.jsdelivr.net/npm/date-fns@2.29.3/index.min.js"></script>
+    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
+    
+    <!-- Font Awesome -->
+    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
+    
+    <!-- Custom CSS -->
+    <link rel="stylesheet" href="{{ url_for('static', filename='css/theme.css') }}">
+    <link rel="stylesheet" href="{{ url_for('static', filename='css/after_login_styles.css') }}">
+    <link rel="stylesheet" href="{{ url_for('static', filename='css/analysis.css') }}">
+</head>
+<body>
+    <div class="sidebar">
+        <div class="sidebar-icon" title="Phones" onclick="window.location.href='/'">
+            <i class="fas fa-mobile-alt"></i>
+        </div>
+        <div class="sidebar-icon" title="Messages" onclick="window.location.href='/'">
+            <i class="fas fa-paper-plane"></i>
+        </div>
+        <div class="sidebar-icon" title="Users" onclick="window.location.href='/'">
+            <i class="fas fa-users"></i>
+        </div>
+        <div class="sidebar-icon" title="History" onclick="window.location.href='/'">
+            <i class="fas fa-history"></i>
+        </div>
+        <div class="sidebar-icon active" title="Analytics">
+            <i class="fas fa-chart-bar"></i>
+        </div>
+        <div class="sidebar-icon logout-icon" title="Logout">
+            <a href="{{ url_for('auth.logout') }}"><i class="fas fa-sign-out-alt logout-icon"></i></a>
+        </div>
+    </div>
+
+    <!-- Main Content -->
+    <div class="main-content">
+            <!-- Header -->
+            <div class="header">
+                <div class="header-left">
+                    <h1><i class="fas fa-chart-bar"></i> Analytics Dashboard</h1>
+                    <p>Monitor your bot performance and engagement metrics</p>
+                </div>
+                
+                <div class="header-right">
+                    <div class="filter-controls">
+                        <select id="botFilter" class="form-select">
+                            <option value="all">All Bots</option>
+                        </select>
+                        
+                        <select id="timeFilter" class="form-select">
+                            <option value="7">Last 7 Days</option>
+                            <option value="14">Last 14 Days</option>
+                            <option value="30">Last 30 Days</option>
+                            <option value="90">Last 90 Days</option>
+                        </select>
+                        
+                        <button id="refreshBtn" class="btn btn-primary">
+                            <i class="fas fa-sync-alt"></i> Refresh
+                        </button>
+                    </div>
+                </div>
+            </div>
+
+            <!-- Loading Spinner -->
+            <div id="loadingSpinner" class="loading-spinner">
+                <div class="spinner"></div>
+                <p>Loading analytics data...</p>
+            </div>
+
+            <!-- Analytics Content -->
+            <div id="analyticsContent" class="analytics-content" style="display: none;">
+                
+                <!-- Overview Cards -->
+                <div class="overview-cards">
+                    <div class="overview-card">
+                        <div class="card-icon blue">
+                            <i class="fas fa-robot"></i>
+                        </div>
+                        <div class="card-content">
+                            <h3 id="totalBots">-</h3>
+                            <p>Total Bots</p>
+                            <small id="activeBots">- active</small>
+                        </div>
+                    </div>
+                    
+                    <div class="overview-card">
+                        <div class="card-icon green">
+                            <i class="fas fa-user-friends"></i>
+                        </div>
+                        <div class="card-content">
+                            <h3 id="totalAccounts">-</h3>
+                            <p>Bot Accounts</p>
+                            <small id="accountsStatus">Loading...</small>
+                        </div>
+                    </div>
+                    
+                    <div class="overview-card">
+                        <div class="card-icon orange">
+                            <i class="fas fa-users"></i>
+                        </div>
+                        <div class="card-content">
+                            <h3 id="totalLeads">-</h3>
+                            <p>Total Leads</p>
+                            <small id="conversionRate">- conversion</small>
+                        </div>
+                    </div>
+                    
+                    <div class="overview-card">
+                        <div class="card-icon purple">
+                            <i class="fas fa-eye"></i>
+                        </div>
+                        <div class="card-content">
+                            <h3 id="totalHighlights">-</h3>
+                            <p>Highlights Sent</p>
+                            <small id="highlightSuccess">- highlight views</small>
+                        </div>
+                    </div>
+                    
+                    <div class="overview-card">
+                        <div class="card-icon red">
+                            <i class="fas fa-comment"></i>
+                        </div>
+                        <div class="card-content">
+                            <h3 id="totalTextMessages">-</h3>
+                            <p>Text Messages</p>
+                            <small id="messageSuccess">- success rate</small>
+                        </div>
+                    </div>
+                </div>
+
+                <!-- Charts Row -->
+                <div class="charts-row">
+                    <!-- Daily Activity Chart -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-chart-line"></i> Daily Activity</h3>
+                            <p>Messages and follows over time</p>
+                        </div>
+                        <canvas id="dailyActivityChart"></canvas>
+                    </div>
+                    
+                    <!-- Follow Success Chart -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-chart-pie"></i> Follow Success Rate</h3>
+                            <p>Follow request outcomes</p>
+                        </div>
+                        <canvas id="followSuccessChart"></canvas>
+                    </div>
+                </div>
+
+                <!-- TikTok Analytics Row -->
+                <div class="tiktok-charts-row">
+                    <!-- Engagement Chart -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fab fa-tiktok"></i> TikTok Engagement</h3>
+                            <p>Likes, comments, follows, profile visits, searches</p>
+                        </div>
+                        <canvas id="engagementChart"></canvas>
+                    </div>
+
+                    <!-- Videos Posted Chart -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-video"></i> Videos Posted</h3>
+                            <p>Post outcomes by day</p>
+                        </div>
+                        <canvas id="videosPostedChart"></canvas>
+                    </div>
+                </div>
+
+                <!-- Phase + Follow-Back Row -->
+                <div class="tiktok-charts-row">
+                    <!-- Phase Distribution -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-layer-group"></i> Session Phase Distribution</h3>
+                            <p>Time spent per phase by account</p>
+                        </div>
+                        <canvas id="phaseDistributionChart"></canvas>
+                    </div>
+
+                    <!-- Follow-Back Histogram -->
+                    <div class="chart-container">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-user-plus"></i> Follow-Back Scores</h3>
+                            <p>Niche score distribution of evaluated profiles</p>
+                        </div>
+                        <canvas id="followBackChart"></canvas>
+                        <div id="followBackStats" class="stat-pills"></div>
+                    </div>
+                </div>
+
+                <!-- Gemini Usage Row -->
+                <div class="gemini-stats-row">
+                    <div class="chart-container" style="flex: 2;">
+                        <div class="chart-header">
+                            <h3><i class="fas fa-brain"></i> Gemini API Usage</h3>
+                            <p>Daily calls, errors, and cost</p>
+                        </div>
+                        <canvas id="geminiUsageChart"></canvas>
+                    </div>
+                    <div class="gemini-stat-boxes">
+                        <div class="stat-card">
+                            <div class="stat-icon"><i class="fas fa-dollar-sign"></i></div>
+                            <div class="stat-content">
+                                <h4 id="geminiTotalCost">$0</h4>
+                                <p>Total Cost</p>
+                            </div>
+                        </div>
+                        <div class="stat-card">
+                            <div class="stat-icon" style="background: linear-gradient(135deg, #ef4444, #dc2626);"><i class="fas fa-exclamation-triangle"></i></div>
+                            <div class="stat-content">
+                                <h4 id="geminiErrorRate">0%</h4>
+                                <p>Error Rate</p>
+                            </div>
+                        </div>
+                        <div class="stat-card">
+                            <div class="stat-icon" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed);"><i class="fas fa-star"></i></div>
+                            <div class="stat-content">
+                                <h4 id="geminiTopType">-</h4>
+                                <p>Top Call Type</p>
+                            </div>
+                        </div>
+                    </div>
+                </div>
+
+                <!-- Performance Tables Row -->
+                <div class="tables-row">
+                    <!-- Top Performing Accounts -->
+                    <div class="table-container">
+                        <div class="table-header">
+                            <h3><i class="fas fa-trophy"></i> Top Performing Accounts</h3>
+                            <p>Most active bot accounts</p>
+                        </div>
+                        <div class="table-wrapper">
+                            <table id="topAccountsTable" class="performance-table">
+                                <thead>
+                                    <tr>
+                                        <th>Account</th>
+                                        <th>Bot</th>
+                                        <th>Total Messages</th>
+                                        <th>Daily Messages</th>
+                                        <th>Status</th>
+                                        <th>Last Active</th>
+                                    </tr>
+                                </thead>
+                                <tbody>
+                                    <!-- Populated by JavaScript -->
+                                </tbody>
+                            </table>
+                        </div>
+                    </div>
+                    
+                    <!-- Bot Performance Comparison -->
+                    <div class="table-container">
+                        <div class="table-header">
+                            <h3><i class="fas fa-robot"></i> Bot Performance</h3>
+                            <p>Performance comparison across bots</p>
+                        </div>
+                        <div class="table-wrapper">
+                            <table id="botPerformanceTable" class="performance-table">
+                                <thead>
+                                    <tr>
+                                        <th>Bot Name</th>
+                                        <th>Status</th>
+                                        <th>Accounts</th>
+                                        <th>Active</th>
+                                        <th>Total Messages</th>
+                                        <th>Leads</th>
+                                    </tr>
+                                </thead>
+                                <tbody>
+                                    <!-- Populated by JavaScript -->
+                                </tbody>
+                            </table>
+                        </div>
+                    </div>
+                </div>
+
+                <!-- Message Stats Row -->
+                <div class="stats-row">
+                    <div class="stat-card">
+                        <div class="stat-icon">
+                            <i class="fas fa-eye"></i>
+                        </div>
+                        <div class="stat-content">
+                            <h4 id="highlightsSent">-</h4>
+                            <p>Highlights Sent</p>
+                        </div>
+                    </div>
+                    
+                    <div class="stat-card">
+                        <div class="stat-icon">
+                            <i class="fas fa-comment"></i>
+                        </div>
+                        <div class="stat-content">
+                            <h4 id="textMessagesSent">-</h4>
+                            <p>Text Messages</p>
+                        </div>
+                    </div>
+                    
+                    <div class="stat-card">
+                        <div class="stat-icon">
+                            <i class="fas fa-clock"></i>
+                        </div>
+                        <div class="stat-content">
+                            <h4 id="pendingMessages">-</h4>
+                            <p>Pending Messages</p>
+                        </div>
+                    </div>
+                    
+                    <div class="stat-card">
+                        <div class="stat-icon">
+                            <i class="fas fa-percentage"></i>
+                        </div>
+                        <div class="stat-content">
+                            <h4 id="messageConversion">-%</h4>
+                            <p>Conversion Rate</p>
+                        </div>
+                    </div>
+                </div>
+            </div>
+
+            <!-- Error Message -->
+            <div id="errorMessage" class="error-message" style="display: none;">
+                <div class="error-content">
+                    <i class="fas fa-exclamation-triangle"></i>
+                    <h3>Failed to Load Analytics</h3>
+                    <p id="errorText">Unable to fetch analytics data. Please try again.</p>
+                    <button id="retryBtn" class="btn btn-primary">
+                        <i class="fas fa-redo"></i> Retry
+                    </button>
+                </div>
+            </div>
+        </div>
+    </div>
+
+    <!-- Custom JavaScript -->
+    <script src="{{ url_for('static', filename='js/analysis.js') }}"></script>
+</body>
+</html>
