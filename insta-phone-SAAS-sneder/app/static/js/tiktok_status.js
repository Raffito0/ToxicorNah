/**
 * TikTok Status Poller — polls /api/bots/<id>/status every 5s
 * for running TikTok bots and updates the phone card UI.
 */
class TikTokStatusPoller {
    constructor() {
        this.intervals = {};
    }

    startPolling(botId) {
        if (this.intervals[botId]) return;
        this.intervals[botId] = setInterval(() => this.pollStatus(botId), 5000);
        this.pollStatus(botId);
    }

    stopPolling(botId) {
        if (this.intervals[botId]) {
            clearInterval(this.intervals[botId]);
            delete this.intervals[botId];
        }
    }

    async pollStatus(botId) {
        try {
            const response = await fetch(`/api/bots/${botId}/status`);
            if (!response.ok) return;
            const data = await response.json();
            this.updateUI(botId, data);

            if (data.control_status === 'stopped' || data.control_status === 'error') {
                this.stopPolling(botId);
            }
        } catch (e) {
            console.error(`Status poll failed for bot ${botId}:`, e);
        }
    }

    updateUI(botId, data) {
        const card = document.querySelector(`[data-bot-id="${botId}"]`);
        if (!card) return;

        // Update status indicator
        const statusEl = card.querySelector('.tiktok-status');
        if (statusEl) {
            const statusMap = {
                'running': { text: 'Running', cls: 'status-running' },
                'stopping': { text: 'Stopping...', cls: 'status-stopping' },
                'stopped': { text: 'Stopped', cls: 'status-stopped' },
                'error': { text: 'Error', cls: 'status-error' },
            };
            const s = statusMap[data.control_status] || statusMap['stopped'];
            statusEl.textContent = s.text;
            statusEl.className = 'tiktok-status ' + s.cls;

            // Add phase info if running
            if (data.current_session && data.control_status === 'running') {
                const elapsed = this.formatElapsed(data.current_session.elapsed_seconds || 0);
                const phase = data.current_session.phase || '';
                statusEl.textContent = `Running (${phase} - ${elapsed})`;
            }

            // Show error message
            if (data.error) {
                statusEl.title = data.error;
                statusEl.textContent = `Error: ${data.error.substring(0, 40)}`;
            }
        }

        // Update action counts
        const actionsEl = card.querySelector('.tiktok-actions');
        if (actionsEl && data.current_session && data.current_session.actions) {
            const a = data.current_session.actions;
            actionsEl.textContent = `${a.likes || 0}L ${a.scrolls || 0}S ${a.comments || 0}C ${a.follows || 0}F`;
        }
    }

    formatElapsed(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // Check all bots on page load and start polling for running ones
    initFromPage(bots) {
        if (!bots) return;
        bots.forEach(bot => {
            if (bot.platform === 'tiktok' && bot.control_status === 'running') {
                this.startPolling(bot.id);
            }
        });
    }
}

// Global instance
window.tiktokPoller = new TikTokStatusPoller();
