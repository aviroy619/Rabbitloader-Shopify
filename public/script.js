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

    // Update store name in both states
    updateStoreName() {
        const storeNameElements = [
            document.getElementById('storeName'),
            document.getElementById('storeNameDisconnected')
        ];
        
        storeNameElements.forEach(el => {
            if (el && this.shop) {
                el.textContent = this.shop;
            }
        });
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
        if (container) {
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
        } else {
            // Fallback to console if no flash container
            console.log(`${type.toUpperCase()}: ${message}`);
        }
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
        // Hide loading state
        this.hideLoadingState();
        
        // Show appropriate state
        if (this.isRLConnected) {
            this.showConnectedState();
            this.updateConnectedElements();
        } else {
            this.showDisconnectedState();
            this.updateDisconnectedElements();
        }
        
        // Keep original update methods for backwards compatibility
        this.updateRLStatus();
        this.updateDIDSection();
        this.updateActions();
        this.updateHistory();
    }

    // Hide loading state
    hideLoadingState() {
        const loadingState = document.getElementById('loadingState');
        if (loadingState) {
            loadingState.style.display = 'none';
        }
    }

    // Show disconnected state (connect flow)
    showDisconnectedState() {
        console.log('showDisconnectedState called');
        const disconnectedState = document.getElementById('disconnectedState');
        const connectedState = document.getElementById('connectedState');
        
        console.log('disconnectedState element:', disconnectedState);
        console.log('connectedState element:', connectedState);
        
        if (disconnectedState) {
            disconnectedState.style.display = 'block';
            console.log('Set disconnectedState to block');
        } else {
            console.error('disconnectedState element not found!');
        }
        
        if (connectedState) {
            connectedState.style.display = 'none';
            console.log('Set connectedState to none');
        } else {
            console.log('connectedState element not found (this is ok)');
        }
    }

    // Show connected state (dashboard)
    showConnectedState() {
        const disconnectedState = document.getElementById('disconnectedState');
        const connectedState = document.getElementById('connectedState');
        
        if (disconnectedState) disconnectedState.style.display = 'none';
        if (connectedState) connectedState.style.display = 'block';
        
        // Fetch RabbitLoader data when showing connected state
        this.fetchRLDataForConnectedState();
        
        // Check App Embed block status
        this.checkEmbedStatus();
    }

    // Check RL App Embed block status
    async checkEmbedStatus() {
        try {
            const res = await fetch(`/api/embed-status?shop=${encodeURIComponent(this.shop)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const toggle = document.getElementById("embedToggle");
            if (toggle) {
                toggle.checked = !!data.enabled;
                toggle.onchange = async () => {
                    try {
                        await fetch(`/api/embed-toggle?shop=${encodeURIComponent(this.shop)}&enable=${toggle.checked}`);
                        this.showFlashMessage(`App Embed ${toggle.checked ? "enabled" : "disabled"}`, "success");
                    } catch (err) {
                        this.showFlashMessage("Failed to update App Embed", "error");
                        toggle.checked = !toggle.checked; // rollback
                    }
                };
            }
        } catch (err) {
            console.error("Failed to check embed status:", err);
        }
    }

    // Update elements in disconnected state  
    updateDisconnectedElements() {
        const activateBtn = document.getElementById('activateBtn');
        if (activateBtn) {
            activateBtn.onclick = async () => {
                try {
                    const res = await fetch(`/connect-rabbitloader?shop=${encodeURIComponent(this.shop)}`);
                    const data = await res.json();
                    if (data.url) {
                        window.top.location.href = data.url;
                    }
                } catch (err) {
                    console.error("❌ Error activating RabbitLoader:", err);
                    this.showFlashMessage("⚠️ Failed to open RabbitLoader connect", "error");
                }
            };
        }
    }

    // Update elements in connected state  
    updateConnectedElements() {
        // Update DID if available
        const didValue = document.getElementById('didValue');
        if (didValue && this.currentDID) {
            didValue.textContent = this.currentDID;
        }

        // Set up action buttons
        const injectBtn = document.getElementById('injectBtn');
        const revertBtn = document.getElementById('revertBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');

        if (injectBtn) {
            injectBtn.href = `/inject-script?shop=${encodeURIComponent(this.shop)}`;
        }

        if (revertBtn) {
            revertBtn.href = `/revert-script?shop=${encodeURIComponent(this.shop)}`;
        }

        if (disconnectBtn) {
            disconnectBtn.href = `/disconnect-rabbitloader?shop=${encodeURIComponent(this.shop)}`;
            disconnectBtn.onclick = async (e) => {
                if (!confirm('Are you sure you want to disconnect RabbitLoader?')) {
                    e.preventDefault();
                    return;
                }
                Utils.addLoadingState(disconnectBtn, "Disconnecting...");
                try {
                    // Let browser handle redirect
                } catch (err) {
                    Utils.removeLoadingState(disconnectBtn);
                    this.showFlashMessage("Disconnect failed", "error");
                    e.preventDefault();
                }
            };
        }
    }

    // Update RabbitLoader status indicator
    updateRLStatus() {
        const statusDot = document.getElementById('rlStatusDot');
        const statusText = document.getElementById('rlStatusText');
        
        if (statusDot && statusText) {
            if (this.isRLConnected) {
                statusDot.className = 'status-dot success';
                statusText.textContent = 'Connected';
            } else {
                statusDot.className = 'status-dot error';
                statusText.textContent = 'Not Connected';
            }
        }
    }

    // Show/hide DID section
    updateDIDSection() {
        const didSection = document.getElementById('didSection');
        const didValue = document.getElementById('didValue');
        
        if (didSection && didValue) {
            if (this.isRLConnected && this.currentDID) {
                didSection.style.display = 'block';
                didValue.textContent = this.currentDID;
            } else {
                didSection.style.display = 'none';
            }
        }
    }

    // Update action buttons - UPDATED TO USE NEW CONNECT LOGIC
    updateActions() {
        const actionsContainer = document.getElementById('actions');
        if (!actionsContainer) return;
        
        actionsContainer.innerHTML = '';
        
        if (!this.isRLConnected) {
            // Show connect button with new async handler
            const connectBtn = this.createActionButton({
                text: '🔌 Activate RabbitLoader',
                className: 'primary',
                description: 'Connect your store to RabbitLoader',
                isConnectButton: true
            });
            actionsContainer.appendChild(connectBtn);
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
                    text: '↩️ Revert Script',
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

    // Create action button element - UPDATED TO HANDLE CONNECT BUTTON
    createActionButton(config) {
        const button = document.createElement('a');
        button.className = `action-btn ${config.className}`;
        button.innerHTML = config.text;
        button.title = config.description;
        
        if (config.isConnectButton) {
            // Special handling for connect button
            button.href = '#';
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                
                const originalText = button.innerHTML;
                button.innerHTML = '<span class="spinner"></span> Connecting...';
                button.classList.add('loading');
                
                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const host = urlParams.get('host');
                    
                    let connectUrl = `/connect-rabbitloader?shop=${encodeURIComponent(this.shop)}`;
                    if (host) {
                        connectUrl += `&host=${encodeURIComponent(host)}`;
                    }
                    
                    const response = await fetch(connectUrl);
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.url) {
                            window.top.location.href = data.url;
                        } else {
                            throw new Error('No redirect URL provided by server');
                        }
                    } else {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Failed to connect to RabbitLoader');
                    }
                } catch (error) {
                    console.error('Connect failed:', error);
                    this.showFlashMessage(`Connect failed: ${error.message}`, "error");
                    button.innerHTML = originalText;
                    button.classList.remove('loading');
                }
            });
        } else {
            // Regular button with href
            button.href = config.href;
            
            if (config.requiresConfirm) {
                button.onclick = (e) => {
                    if (!confirm('⚠️ Are you sure you want to disconnect RabbitLoader?')) {
                        e.preventDefault();
                    }
                };
            }
            
            // Add loading state on click with error recovery
            button.addEventListener('click', (e) => {
                Utils.addLoadingState(button, 'Processing...');
                
                // Recovery mechanism if page doesn't redirect
                setTimeout(() => {
                    if (button.classList.contains('loading')) {
                        Utils.removeLoadingState(button);
                        this.showFlashMessage("Request timed out. Please try again.", "error");
                    }
                }, 10000); // 10 second timeout
            });
        }
        
        return button;
    }

    // Update activity history
    updateHistory() {
        const historyContainer = document.getElementById('historyContainer');
        if (!historyContainer) return;
        
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
        this.showFlashMessage(`⚠️ ${message}`, 'error');
    }

    // Refresh dashboard data
    async refresh() {
        await this.loadStatus();
        this.updateUI();
    }

    // Fetch RabbitLoader data for connected state using proxied routes
    async fetchRLDataForConnectedState() {
        const shop = this.shop;
        if (!shop) {
            console.warn("⚠️ Missing shop parameter");
            return;
        }

        try {
            // Dynamic last 30 days
            const endDate = new Date().toISOString().split("T")[0];
            const startDate = new Date(Date.now() - 30 * 864e5).toISOString().split("T")[0];

            const [billingRes, usageRes, perfRes] = await Promise.all([
                fetch(`/api/rl-billing-subscription?shop=${encodeURIComponent(shop)}`),
                fetch(`/api/rl-pageview-usage?shop=${encodeURIComponent(shop)}&start_date=${startDate}&end_date=${endDate}`),
                fetch(`/api/rl-performance-overview?shop=${encodeURIComponent(shop)}&start_date=${startDate}&end_date=${endDate}`)
            ]);

            if (billingRes.status === 401 || usageRes.status === 401 || perfRes.status === 401) {
                console.warn("⚠️ RabbitLoader token expired for", shop);
                this.isRLConnected = false;
                this.currentDID = null;
                this.showFlashMessage("RabbitLoader session expired. Please reconnect.", "error");
                this.updateUI();
                return;
            }

            // 1. Plan Info
            if (billingRes.ok) {
                const planData = await billingRes.json();
                this.safeUpdateElement("plan-name", planData?.plan_name || "Unknown Plan");
                this.safeUpdateElement("plan-domains", planData?.domains || "-");
                this.safeUpdateElement("plan-pageviews", planData?.pageviews || "-");
            }

            // 2. Pageview Usage
            if (usageRes.ok) {
                const usageData = await usageRes.json();
                this.safeUpdateElement("plan-usage", usageData?.total || "0");
            }

            // 3. Performance Snapshot
            if (perfRes.ok) {
                const overviewData = await perfRes.json();
                this.updatePerformanceSection(overviewData);
            }

            // 4. Status Update
            this.safeUpdateElement("rl-status", "✅ Connected");

        } catch (err) {
            console.error("⚠️ Error fetching RL data:", err);
            this.safeUpdateElement("rl-status", "⚠️ Error fetching data");
        }
    }

    // Helper function to safely update element content
    safeUpdateElement(id, content) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = content;
        }
    }

    // Update performance section with guard for missing elements
    updatePerformanceSection(data) {
        const performanceElements = ['score', 'lcp', 'cls', 'fid'];
        let hasPerformanceSection = false;
        
        performanceElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                hasPerformanceSection = true;
                element.textContent = data?.[id] || "-";
            }
        });
        
        if (!hasPerformanceSection) {
            console.warn("Performance section elements not found in DOM");
        }
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

    // Handle ?connection_error param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("connection_error")) {
        window.dashboard.showFlashMessage("❌ RabbitLoader connection failed. Please try again.", "error");
    }
    
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
    window.dashboard.refreshInterval = setInterval(() => {
        if (window.dashboard && window.dashboard.isRLConnected) {
            window.dashboard.refresh();
        }
    }, 30000);

    window.addEventListener('beforeunload', () => {
        if (window.dashboard.refreshInterval) {
            clearInterval(window.dashboard.refreshInterval);
        }
    });
});

// Add CSS for slideOut animation and page states
const style = document.createElement('style');
style.textContent = `
    .loading-screen {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
    }
    
    .page-state {
        min-height: 100vh;
    }
    
    @keyframes slideOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
    }
`;
document.head.appendChild(style);

// --- Static pages (success/error/disconnected) helpers ---
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get("shop");
  const host = urlParams.get("host");
  const baseUrl = `/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;

  const retryBtn = document.querySelector(".btn.retry");
  if (retryBtn) {
    retryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = baseUrl;
    });
  }

  const homeBtn = document.querySelector(".btn.home");
  if (homeBtn) {
    homeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = baseUrl;
    });
  }

  // Auto-redirect after success
  if (document.body.classList.contains("success-page")) {
    setTimeout(() => {
      window.location.href = baseUrl;
    }, 4000);
  }
});