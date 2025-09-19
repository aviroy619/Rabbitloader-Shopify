// Frontend Dashboard Logic for RabbitLoader Shopify App
class RabbitLoaderDashboard {
  constructor() {
    this.shop = window.appState.shop || new URLSearchParams(window.location.search).get('shop');
    this.host = window.appState.host || new URLSearchParams(window.location.search).get('host');
    this.embedded = window.appState.embedded || false;
    this.isRLConnected = false;
    this.currentDID = null;
    this.history = [];
    this.dashboardData = null;
    
    // UI element references
    this.loadingState = document.getElementById('loadingState');
    this.disconnectedState = document.getElementById('disconnectedState');
    this.connectedState = document.getElementById('connectedState');
    this.flashMessages = document.getElementById('flashMessages');
    
    this.init();
  }

  async init() {
    console.log('RabbitLoader Dashboard initializing...', {
      shop: this.shop,
      embedded: this.embedded,
      host: this.host ? this.host.substring(0, 20) + '...' : 'none'
    });

    // Set up event listeners
    this.setupEventListeners();
    
    // Check connection status
    await this.checkStatus();
    
    // Update UI based on status
    this.updateUI();
  }

  setupEventListeners() {
    // Activate button
    const activateBtn = document.getElementById('activateBtn');
    if (activateBtn) {
      activateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.initiateRabbitLoaderConnection();
      });
    }

    // Disconnect button
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.disconnect();
      });
    }

    // Handle URL changes (for connected parameter)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === '1') {
      // Re-check status after connection
      setTimeout(() => this.checkStatus(), 1000);
    }
  }

  async checkStatus() {
    if (!this.shop) {
      console.error('No shop parameter available');
      this.showError('Shop parameter is required');
      return;
    }

    try {
      console.log(`Checking status for shop: ${this.shop}`);
      
      const response = await fetch(`/shopify/status?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.isRLConnected = data.connected;
        this.currentDID = data.did;
        
        console.log('Status check result:', {
          connected: this.isRLConnected,
          did: this.currentDID,
          script_injected: data.script_injected
        });

        // If connected, also get dashboard data
        if (this.isRLConnected) {
          await this.loadDashboardData();
        }
      } else {
        console.error('Status check failed:', data.error);
        this.showError(`Failed to check connection status: ${data.error}`);
      }
    } catch (error) {
      console.error('Status check error:', error);
      this.showError('Failed to check connection status');
    }
  }

  async loadDashboardData() {
    try {
      const response = await fetch(`/shopify/dashboard-data?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.dashboardData = data.data;
        console.log('Dashboard data loaded:', this.dashboardData);
      } else {
        console.warn('Failed to load dashboard data:', data.error);
      }
    } catch (error) {
      console.error('Dashboard data error:', error);
    }
  }

  updateUI() {
    // Update store names
    const storeNames = [
      document.getElementById('storeName'),
      document.getElementById('storeNameDisconnected'),
      document.getElementById('storeNameConnected')
    ];
    
    storeNames.forEach(el => {
      if (el) {
        el.textContent = this.shop ? this.shop.replace('.myshopify.com', '') : 'Unknown Store';
      }
    });

    // Show appropriate state
    if (this.isRLConnected) {
      this.showConnectedState();
    } else {
      this.showDisconnectedState();
    }
    
    // Hide loading state
    if (this.loadingState) {
      this.loadingState.style.display = 'none';
    }
  }

  showDisconnectedState() {
    if (this.disconnectedState) {
      this.disconnectedState.style.display = 'block';
    }
    if (this.connectedState) {
      this.connectedState.style.display = 'none';
    }
  }

  showConnectedState() {
    if (this.connectedState) {
      this.connectedState.style.display = 'block';
      
      // Add enhanced dashboard if we have data
      if (this.dashboardData) {
        this.renderEnhancedDashboard();
      }
    }
    if (this.disconnectedState) {
      this.disconnectedState.style.display = 'none';
    }
  }

  renderEnhancedDashboard() {
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (!connectedSection || !this.dashboardData) return;

    // Check if dashboard already exists
    if (document.querySelector('.enhanced-dashboard')) return;

    const dashboardHTML = `
      <div class="enhanced-dashboard">
        <div class="dashboard-grid">
          <div class="psi-scores-section">
            <h3>PageSpeed Improvement</h3>
            <div class="psi-comparison">
              <div>
                <h4>Before RabbitLoader</h4>
                <div class="score-box">
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.before.mobile)}">${this.dashboardData.psi_scores.before.mobile}</span>
                    <span class="score-label">Mobile</span>
                  </div>
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.before.desktop)}">${this.dashboardData.psi_scores.before.desktop}</span>
                    <span class="score-label">Desktop</span>
                  </div>
                </div>
              </div>
              <div class="improvement-arrow">→</div>
              <div>
                <h4>After RabbitLoader</h4>
                <div class="score-box">
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.after.mobile)}">${this.dashboardData.psi_scores.after.mobile}</span>
                    <span class="score-label">Mobile</span>
                  </div>
                  <div class="score">
                    <span class="score-value ${this.getScoreClass(this.dashboardData.psi_scores.after.desktop)}">${this.dashboardData.psi_scores.after.desktop}</span>
                    <span class="score-label">Desktop</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="plan-section">
            <h3>Current Plan</h3>
            <div class="plan-info">
              <div class="plan-details">
                <h4>${this.dashboardData.plan.name}</h4>
                <p>Up to ${this.dashboardData.plan.pageviews} pageviews</p>
                <p><strong>${this.dashboardData.plan.price}</strong></p>
              </div>
            </div>
          </div>

          <div class="analytics-section">
            <h3>This Month</h3>
            <div class="analytics-stats">
              <div class="stat">
                <span class="stat-value">${this.dashboardData.pageviews_this_month}</span>
                <span class="stat-label">Pageviews</span>
              </div>
            </div>
          </div>

          <div class="actions-section">
            <h3>Quick Actions</h3>
            <div class="action-buttons">
              <a href="${this.dashboardData.reports_url}" target="_blank" class="btn btn-primary">View Reports</a>
              <a href="${this.dashboardData.customize_url}" target="_blank" class="btn btn-outline">Customize Settings</a>
              <button class="btn btn-secondary" onclick="dashboard.showScriptInstructions()">Manual Script Setup</button>
              <a href="/shopify/configure-defer?shop=${encodeURIComponent(this.shop)}" target="_blank" class="btn btn-outline">Configure Script Deferring</a>
            </div>
          </div>
        </div>
      </div>
    `;

    connectedSection.insertAdjacentHTML('beforeend', dashboardHTML);
  }

  getScoreClass(score) {
    if (score >= 90) return 'good';
    if (score >= 50) return 'average';
    return 'poor';
  }

  showScriptInstructions() {
    this.getManualInstructions();
  }

  async getManualInstructions() {
    try {
      const response = await fetch(`/shopify/manual-instructions?shop=${encodeURIComponent(this.shop)}`);
      const data = await response.json();

      if (data.ok) {
        this.displayScriptInstructions(data);
      } else {
        this.showError(`Failed to get instructions: ${data.error}`);
      }
    } catch (error) {
      console.error('Manual instructions error:', error);
      this.showError('Failed to load installation instructions');
    }
  }

  displayScriptInstructions(data) {
    // Check if instructions already exist
    let existingInstructions = document.querySelector('.script-instructions');
    if (existingInstructions) {
      existingInstructions.remove();
    }

    const instructionsHTML = `
      <div class="script-instructions">
        <h3>Manual Script Installation</h3>
        <p>If automatic injection didn't work, you can manually add the RabbitLoader script:</p>
        
        <div class="script-actions">
          <button class="btn btn-primary" onclick="dashboard.autoInjectScript()">Try Auto-Inject</button>
        </div>
        
        <div class="script-tag-box">
          <h4>Script to Add:</h4>
          <div class="copy-container">
            <code>${this.escapeHtml(data.scriptTag)}</code>
            <button class="copy-btn" onclick="dashboard.copyToClipboard('${this.escapeHtml(data.scriptTag)}')">Copy</button>
          </div>
        </div>
        
        <details class="manual-steps">
          <summary>Manual Installation Steps</summary>
          <ol>
            <li>${data.instructions.step1}</li>
            <li>${data.instructions.step2}</li>
            <li>${data.instructions.step3}</li>
            <li>${data.instructions.step4}</li>
            <li>${data.instructions.step5}</li>
            <li>Copy and paste the script tag above</li>
            <li>${data.instructions.step6}</li>
            <li>${data.instructions.step7}</li>
            <li>Optional: ${data.instructions.step8}</li>
          </ol>
        </details>
      </div>
    `;

    // Add to connected state
    const connectedSection = document.querySelector('#connectedState .connected-section');
    if (connectedSection) {
      connectedSection.insertAdjacentHTML('beforeend', instructionsHTML);
    }
  }

  async autoInjectScript() {
    if (!this.shop) {
      this.showError('Shop parameter is required');
      return;
    }

    try {
      this.showInfo('Attempting automatic script injection...');

      const response = await fetch('/shopify/inject-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess(`Script injection successful! ${data.message}`);
        
        // Refresh status after injection
        setTimeout(() => {
          this.checkStatus();
        }, 2000);
      } else {
        this.showError(`Script injection failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Auto inject error:', error);
      this.showError('Failed to inject script automatically');
    }
  }

  async disconnect() {
    if (!confirm('Are you sure you want to disconnect RabbitLoader from your store?')) {
      return;
    }

    try {
      this.showInfo('Disconnecting...');

      const response = await fetch('/shopify/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shop: this.shop })
      });

      const data = await response.json();

      if (data.ok) {
        this.showSuccess('Successfully disconnected from RabbitLoader');
        this.isRLConnected = false;
        this.currentDID = null;
        this.dashboardData = null;
        this.updateUI();
      } else {
        this.showError(`Disconnect failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      this.showError('Failed to disconnect');
    }
  }

  initiateRabbitLoaderConnection() {
    if (!this.shop) {
      this.showError('Shop parameter is required for connection');
      return;
    }

    console.log(`Initiating RabbitLoader connection for shop: ${this.shop}`);

    // Build RabbitLoader connect URL
    const connectUrl = new URL('/account', window.location.origin);
    connectUrl.searchParams.set('source', 'shopify');
    connectUrl.searchParams.set('action', 'connect');
    connectUrl.searchParams.set('site_url', `https://${this.shop}`);
    
    // Build redirect URL back to this app
    const redirectUrl = new URL(window.location.origin);
    redirectUrl.pathname = '/shopify/auth/callback';
    redirectUrl.searchParams.set('shop', this.shop);
    if (this.host) {
      redirectUrl.searchParams.set('host', this.host);
    }
    
    connectUrl.searchParams.set('redirect_url', redirectUrl.toString());
    connectUrl.searchParams.set('cms_v', 'shopify');
    connectUrl.searchParams.set('plugin_v', '1.0.0');

    console.log('Redirecting to RabbitLoader connect:', connectUrl.toString());

    // Redirect to RabbitLoader connection flow
    window.location.href = connectUrl.toString();
  }

  // Utility methods
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess('Copied to clipboard!');
    } catch (err) {
      console.error('Copy failed:', err);
      this.showError('Failed to copy to clipboard');
    }
  }

  showFlashMessage(message, type = 'info') {
    if (!this.flashMessages) return;

    const flash = document.createElement('div');
    flash.className = `flash-message ${type}`;
    flash.textContent = message;

    this.flashMessages.appendChild(flash);

    // Auto remove after 5 seconds
    setTimeout(() => {
      flash.classList.add('fade-out');
      setTimeout(() => {
        if (flash.parentNode) {
          flash.parentNode.removeChild(flash);
        }
      }, 500);
    }, 5000);
  }

  showSuccess(message) {
    console.log('Success:', message);
    this.showFlashMessage(message, 'success');
  }

  showError(message) {
    console.error('Error:', message);
    this.showFlashMessage(message, 'error');
  }

  showInfo(message) {
    console.log('Info:', message);
    this.showFlashMessage(message, 'info');
  }
}

// Initialize dashboard when DOM is loaded
let dashboard;
document.addEventListener('DOMContentLoaded', function() {
  dashboard = new RabbitLoaderDashboard();
});

// Make dashboard available globally for button callbacks
window.dashboard = dashboard;