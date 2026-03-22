// Main script for phone-settings.html page
import { showMultiAccountCalendar } from './phone-settings-calendar.js';
import { showToast, showConfirm } from './after_login_scripts.js';

let currentBotId = null;
let currentBotAccounts = [];

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Phone settings page loaded');
    
    // Get bot ID from URL (if accessing directly)
    const urlParams = new URLSearchParams(window.location.search);
    const botIdFromUrl = urlParams.get('bot_id');
    
    console.log('Bot ID from URL:', botIdFromUrl);
    
    if (botIdFromUrl) {
        openBotSettings(parseInt(botIdFromUrl));
    } else {
        console.warn('No bot_id parameter found in URL');
    }
    
    // Add account button
    const addBtn = document.getElementById('add-bot-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addAccount);
    }
});

// Open bot settings and load data
async function openBotSettings(botId) {
    currentBotId = botId;
    
    try {
        // Load bot data
        const response = await fetch(`/api/bots/${botId}`);
        const data = await response.json();
        
        if (data.success) {
            // Update title
            const title = document.getElementById('phoneTitleSettings');
            if (title) {
                title.textContent = `${data.bot.name} - Schedule`;
            }
            
            // Load accounts
            await loadBotAccounts(botId);

            // Load warmup panel for first account (if available)
            if (currentBotAccounts.length > 0 && typeof loadWarmupPanel === 'function') {
                const firstAccount = currentBotAccounts[0];
                loadWarmupPanel(firstAccount.username || firstAccount.name || firstAccount.clone_id);
            }

            // Show calendar with all accounts
            if (currentBotAccounts.length > 0) {
                await showMultiAccountCalendar(botId, currentBotAccounts);
            } else {
                // Show empty state in calendar
                await showMultiAccountCalendar(botId, []);
            }
        } else {
            showToast(data.message || 'Failed to load bot', 'error');
        }
    } catch (error) {
        console.error('Error loading bot settings:', error);
        showToast('Failed to load bot settings', 'error');
    }
}

// Load bot accounts
async function loadBotAccounts(botId) {
    try {
        const response = await fetch(`/api/bots/${botId}/accounts`);
        const data = await response.json();
        
        if (data.success) {
            currentBotAccounts = data.accounts || [];
        } else {
            console.error('Failed to load accounts:', data.message);
            currentBotAccounts = [];
        }
    } catch (error) {
        console.error('Error loading accounts:', error);
        currentBotAccounts = [];
    }
}

// Add new account
async function addAccount() {
    const cloneIdInput = document.getElementById('clone-id');
    const cloneId = cloneIdInput?.value.trim();
    
    if (!cloneId) {
        showToast('Please enter a clone ID', 'error');
        return;
    }
    
    if (!currentBotId) {
        showToast('Please select a bot first', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/bots/${currentBotId}/accounts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                clone_id: cloneId,
                username: cloneId,
                password: '' // You may want to prompt for this
            }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Account added successfully', 'success');
            cloneIdInput.value = '';
            
            // Reload accounts and calendar
            await loadBotAccounts(currentBotId);
            await showMultiAccountCalendar(currentBotId, currentBotAccounts);
        } else {
            showToast(data.message || 'Failed to add account', 'error');
        }
    } catch (error) {
        console.error('Error adding account:', error);
        showToast('Failed to add account', 'error');
    }
}

// Make functions globally available
window.phoneSettingsPage = {
    openBotSettings,
    loadBotAccounts,
    addAccount
};

// Export for use in other modules
export { openBotSettings, loadBotAccounts };

