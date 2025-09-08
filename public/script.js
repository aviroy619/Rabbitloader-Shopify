// Dashboard State Management
class Dashboard {
    constructor() {
        this.shop = this.getQueryParam('shop');
        this.isRLConnected = false;
        this.currentDID = null;
        this.history = [];
        
        this.init();
    }

    // Initialize dashboard
    async init() {
        if (!this.shop) {
            this.showError('Missing shop parameter');
            return;
        }

        this.updateStoreName();
        this.handleFlashMessages();
        await this.loadStatus();
        this.updateUI();
    }

    // Get query parameter
    getQueryParam(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    // Update store name in header
    updateStoreName() {
        const storeNameEl = document.getElementById('storeName');
        if (storeNameEl && this.shop) {
            storeNameEl.textContent = this.shop;
        }
    }

    // Handle flash messages from query params
    handleFlashMessages() {
        const connected = this.getQueryParam('connected');
        const disconnected = this.getQueryParam('disconnected');
        
        if (connected === 'true') {
            this.showFlashMessage('🎉 RabbitLoader successfully connected and activated!', 'success');
        }
        
        if (disconnected === 'true') {
            this.showFlashMessage('🔌 RabbitLoader has been disconnected from your store.', 'warning');
        }
    }

    // Show flash message
    showFlashMessage(message, type = 'success') {
        const container = document.getElementById('flashMessages');
        const messageEl = document.createElement('div');
        messageEl.className = `flash-message ${type}`;
        messageEl.innerHTML = `
            <span>${message}</span>
        `;
        
        container.appendChild(messageEl);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            messageEl.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => messageEl.remove(), 300);
        }, 5000);
    }

    // Load status from backend
    async loadStatus() {
        try {
            const response = await fetch(`/api/status?shop=${encodeURIComponent(this.shop)}`);
            if (response.ok) {
                const data = await response.json();
                this.isRLConnected = data.rabbitloader_connected;
                this.currentDID = data.did;
                this.history = data.history || [];
            } else {
                // Fallback: parse from current page state
                this.parseStatusFromPage();
            }
        } catch (error) {
            console.warn('Failed to load status, using fallback:', error);
            this.parseStatusFromPage();
        }
    }

    // Fallback: parse status from page context
    parseStatusFromPage() {
        // Check if we're on a page that indicates connection status
        const connected = this.getQueryParam('connected');
        const disconnected = this.getQueryParam('disconnected');
        
        if (connected === 'true') {
            this.isRLConnected = true;
        } else if (disconnected === 'true') {
            this.isRLConnected = false;
        }
    }

    // Update UI based on current state
    updateUI() {
        this.updateRLStatus();
        this.updateDIDSection();
        this.updateActions();
        this.updateHistory();
    }

    // Update RabbitLoader status indicator
    updateRLStatus() {
        const statusDot = document.getElementById('rlStatusDot');
        const statusText = document.getElementById('rlStatusText');
        
        if (this.isRLConnected) {
            statusDot.className = 'status-dot success';
            statusText.textContent = 'Connected';
        } else {
            statusDot.className = 'status-dot error';
            statusText.textContent = 'Not Connected';
        }
    }

    // Show/hide DID section
    updateDIDSection() {
        const didSection = document.getElementById('didSection');
        const didValue = document.getElementById('didValue');
        
        if (this.isRLConnected && this.currentDID) {
            didSection.style.display = 'block';
            didValue.textContent = this.currentDID;
        } else {
            didSection.style.display = 'none';
        }
    }

    // Update action buttons
    updateActions() {
        const actionsContainer = document.getElementById('actions');
        actionsContainer.innerHTML = '';
        
        if (!this.isRLConnected) {
            // Show connect button
            actionsContainer.appendChild(this.createActionButton({
                text: '🔗 Activate RabbitLoader',
                href: `/connect-rabbitloader?shop=${encodeURIComponent(this.shop)}`,
                className: 'primary',
                description: 'Connect your store to RabbitLoader'
            }));
        } else {
            // Show connected actions
            const actions = [
                {
                    text: '🔧 Inject Script',
                    href: `/inject-script?shop=${encodeURIComponent(this.shop)}`,
                    className: 'success',
                    description: 'Add RabbitLoader script to your theme'
                },
                {
                    text: '🗑️ Revert Script',
                    href: `/revert-script?shop=${encodeURIComponent(this.shop)}`,
                    className: 'warning',
                    description: 'Remove RabbitLoader script from theme'
                },
                {
                    text: '🔌 Disconnect',
                    href: `/disconnect-rabbitloader?shop=${encodeURIComponent(this.shop)}`,
                    className: 'danger',
                    description: 'Disconnect RabbitLoader from your store',
                    requiresConfirm: true
                }
            ];
            
            actions.forEach(action => {
                actionsContainer.appendChild(this.createActionButton(action));
            });
        }
    }

    // Create action button element
    createActionButton(config) {
        const button = document.createElement('a');
        button.href = config.href;
        button.className = `action-btn ${config.className}`;
        button.innerHTML = config.text;
        button.title = config.description;
        
        if (config.requiresConfirm) {
            button.onclick = (e) => {
                if (!confirm('⚠️ Are you sure you want to disconnect RabbitLoader?')) {
                    e.preventDefault();
                }
            };
        }
        
        // Add loading state on click
        button.addEventListener('click', () => {
            button.classList.add('loading');
            button.innerHTML = `<span class="spinner"></span> Processing...`;
        });
        
        return button;
    }

    // Update activity history
    updateHistory() {
        const historyContainer = document.getElementById('historyContainer');
        
        if (this.history.length === 0) {
            historyContainer.innerHTML = `
                <div class="history-item">
                    <div class="history-icon">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="8" r="8"/>
                        </svg>
                    </div>
                    <div class="history-content">
                        <span class="history-message">No recent activity</span>
                        <span class="history-time">Connect RabbitLoader to see activity logs</span>
                    </div>
                </div>
            `;
            return;
        }
        
        historyContainer.innerHTML = '';
        
        this.history.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            const iconClass = this.getHistoryIconClass(item.type);
            const timeAgo = this.formatTimeAgo(item.timestamp);
            
            historyItem.innerHTML = `
                <div class="history-icon ${iconClass}">
                    ${this.getHistoryIcon(item.type)}
                </div>
                <div class="history-content">
                    <span class="history-message">${item.message}</span>
                    <span class="history-time">${timeAgo}</span>
                </div>
            `;
            
            historyContainer.appendChild(historyItem);
        });
    }

    // Get history icon class
    getHistoryIconClass(type) {
        const iconMap = {
            'auth': 'success',
            'connect': 'success',
            'inject': 'success',
            'revert': 'warning',
            'disconnect': 'error',
            'error': 'error'
        };
        return iconMap[type] || '';
    }

    // Get history icon SVG
    getHistoryIcon(type) {
        const icons = {
            'auth': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.5 6L7 10.5 4.5 8 6 6.5l1 1 3-3L11.5 6z"/></svg>',
            'connect': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.5 6L7 10.5 4.5 8 6 6.5l1 1 3-3L11.5 6z"/></svg>',
            'inject': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V9H4l4-5 4 5H9v3z"/></svg>',
            'revert': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V9H4l4-5 4 5H9v3z"/></svg>',
            'disconnect': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm5 7H3V7h10v2z"/></svg>',
            'error': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V7h2v5zm0-6H7V4h2v2z"/></svg>'
        };
        return icons[type] || '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="8"/></svg>';
    }

    // Format time ago
    formatTimeAgo(timestamp) {
        if (!timestamp) return 'Unknown time';
        
        const now = new Date();
        const time = new Date(timestamp);
        const diffInSeconds = Math.floor((now - time) / 1000);
        
        if (diffInSeconds < 60) {
            return 'Just now';
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            const days = Math.floor(diffInSeconds / 86400);
            return `${days} day${days > 1 ? 's' : ''} ago`;
        }
    }

    // Show error message
    showError(message) {
        this.showFlashMessage(`❌ ${message}`, 'error');
    }

    // Refresh dashboard data
    async refresh() {
        await this.loadStatus();
        this.updateUI();
    }
}

// Status API endpoint handler (for backend integration)
class StatusAPI {
    static async getStatus(shop) {
        try {
            const response = await fetch(`/api/status?shop=${encodeURIComponent(shop)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch status:', error);
            return null;
        }
    }

    static async performAction(action, shop) {
        try {
            const response = await fetch(`/${action}?shop=${encodeURIComponent(shop)}`, {
                method: 'GET'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return {
                success: true,
                message: await response.text()
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
}

// Utility functions
const Utils = {
    // Add loading state to element
    addLoadingState(element, text = 'Loading...') {
        element.classList.add('loading');
        element.dataset.originalText = element.innerHTML;
        element.innerHTML = `<span class="spinner"></span> ${text}`;
    },

    // Remove loading state from element
    removeLoadingState(element) {
        element.classList.remove('loading');
        if (element.dataset.originalText) {
            element.innerHTML = element.dataset.originalText;
            delete element.dataset.originalText;
        }
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the dashboard
    window.dashboard = new Dashboard();
    
    // Add refresh functionality
    window.refreshDashboard = () => {
        window.dashboard.refresh();
    };
    
    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        window.location.reload();
    });
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+R or Cmd+R for refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            window.dashboard.refresh();
        }
    });
    
    // Auto-refresh every 30 seconds if connected
    setInterval(() => {
        if (window.dashboard && window.dashboard.isRLConnected) {
            window.dashboard.refresh();
        }
    }, 30000);
});

// Add CSS for slideOut animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
    }
`;
document.head.appendChild(style);